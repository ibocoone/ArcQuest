import { mkdir } from 'node:fs/promises'
import { one, rows, sql } from '../db'
import {
  HttpError, amount, audit, httpUrl, notify, optStr, rateLimit, route, str, txHash, uuid, type AuthUser,
} from '../http'
import { toRaw, verifyFunding, verifyRelease } from '../chain'

const TYPES = ['social', 'video', 'community', 'manuel', 'autre']
const UPLOAD_DIR = `${import.meta.dir}/../uploads`
const isDup = (e: unknown) => String(e instanceof Error ? e.message : e).includes('duplicate key')

interface TaskRow {
  id: string; title: string; description: string; instructions?: string; type: string
  platform: string | null; url: string | null; reward: string; slots: number; deadline: Date
  status: string; created_at: Date; creator: string; creator_id: string; taken: number; my_status: string | null
}

const taskOut = (t: TaskRow) => ({
  id: t.id, title: t.title, description: t.description, instructions: t.instructions, type: t.type,
  platform: t.platform, url: t.url, reward: t.reward, slots: t.slots, taken: t.taken,
  deadline: t.deadline, status: t.status, createdAt: t.created_at, creator: t.creator,
  creatorId: t.creator_id, myStatus: t.my_status,
})

const SELECT = (uid: string) => sql`
  SELECT t.id, t.title, t.description, t.instructions, t.type, t.platform, t.url, t.reward, t.slots, t.deadline,
         t.status, t.created_at, t.creator_id, u.username AS creator,
         (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND s.status IN ('pending','approved'))::int AS taken,
         (SELECT s.status FROM submissions s WHERE s.task_id = t.id AND s.worker_id = ${uid}) AS my_status
  FROM tasks t JOIN users u ON u.id = t.creator_id`

// ── Pièces jointes (captures d'écran) ─────────────────────────────────────────

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  return null
}

route('POST', '/uploads', 'user', async (c) => {
  const me = c.user as AuthUser
  rateLimit(`upload:${me.id}`, 30, 3_600_000)
  const form = await c.req.formData().catch(() => { throw new HttpError(400, 'Fichier invalide.') })
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'Aucun fichier envoyé.')
  if (file.size > 3 * 1024 * 1024) throw new HttpError(413, 'Image trop lourde (3 Mo max).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniff(bytes)
  if (!mime) throw new HttpError(400, 'Formats acceptés : PNG, JPEG, WebP.')
  const row = await one<{ id: string }>(sql`INSERT INTO uploads (user_id, mime, size) VALUES (${me.id}, ${mime}, ${bytes.length}) RETURNING id`)
  if (!row) throw new HttpError(500, 'Envoi impossible.')
  await mkdir(UPLOAD_DIR, { recursive: true })
  await Bun.write(`${UPLOAD_DIR}/${row.id}`, bytes)
  return { id: row.id }
})

route('GET', '/uploads/:id', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Fichier')
  const up = await one<{ user_id: string; mime: string }>(sql`SELECT user_id, mime FROM uploads WHERE id = ${id}`)
  if (!up) throw new HttpError(404, 'Fichier introuvable.')
  let allowed = up.user_id === me.id || me.role === 'admin'
  if (!allowed) {
    allowed = !!(await one(sql`
      SELECT 1 FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.proof_file = ${id} AND t.creator_id = ${me.id}
      UNION ALL
      SELECT 1 FROM contest_entries e JOIN contests k ON k.id = e.contest_id WHERE e.proof_file = ${id} AND k.creator_id = ${me.id}`))
  }
  if (!allowed) throw new HttpError(403, 'Accès refusé.')
  return new Response(Bun.file(`${UPLOAD_DIR}/${id}`), {
    headers: { 'content-type': up.mime, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'private, max-age=3600' },
  })
})

// ── Tâches ────────────────────────────────────────────────────────────────────

route('GET', '/tasks', 'user', async (c) => {
  const me = c.user as AuthUser
  const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const type = c.url.searchParams.get('type') ?? ''
  const page = Math.max(1, Number(c.url.searchParams.get('page')) || 1)
  const size = Math.min(50, Math.max(1, Number(c.url.searchParams.get('pageSize')) || 12))
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const qf = q ? sql`AND (t.title ILIKE ${like} OR t.description ILIKE ${like})` : sql``
  const tf = TYPES.includes(type) ? sql`AND t.type = ${type}` : sql``
  const items = await rows<TaskRow>(sql`${SELECT(me.id)} WHERE t.status = 'open' AND t.deadline > now() ${qf} ${tf}
    ORDER BY t.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`)
  const total = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM tasks t WHERE t.status = 'open' AND t.deadline > now() ${qf} ${tf}`)
  return { items: items.map(taskOut), total: total?.n ?? 0, page, pageSize: size }
})

route('GET', '/tasks/:id', 'user', async (c) => {
  const t = await one<TaskRow>(sql`${SELECT((c.user as AuthUser).id)} WHERE t.id = ${uuid(c.params.id, 'Tâche')}`)
  if (!t || t.status === 'removed') throw new HttpError(404, 'Tâche introuvable.')
  return taskOut(t)
})

route('POST', '/tasks', 'user', async (c) => {
  const me = c.user as AuthUser
  const b = await c.json()
  rateLimit(`task:${me.id}`, 20, 3_600_000)
  const id = uuid(b.id, 'Identifiant')
  const title = str(b.title, 3, 120, 'Titre')
  const description = str(b.description, 10, 1000, 'Description')
  const instructions = str(b.instructions, 10, 2000, 'Instructions')
  const type = str(b.type, 2, 20, 'Type')
  if (!TYPES.includes(type)) throw new HttpError(400, 'Type invalide.')
  const reward = amount(b.reward, 'Récompense')
  const slots = Number(b.slots)
  if (!Number.isInteger(slots) || slots < 1 || slots > 10_000) throw new HttpError(400, 'Nombre de places invalide (1 à 10 000).')
  const deadline = new Date(str(b.deadline, 10, 40, 'Date limite'))
  if (!(deadline.getTime() > Date.now() + 3_600_000) || deadline.getTime() > Date.now() + 365 * 86_400_000) {
    throw new HttpError(400, 'La date limite doit être dans plus d\'une heure et moins d\'un an.')
  }
  if (!me.wallet_address) throw new HttpError(400, 'Liez un portefeuille à votre compte pour publier une tâche.')
  const hash = txHash(b.fundTx)
  await verifyFunding(hash, id, me.wallet_address, toRaw(reward) * BigInt(slots))
  try {
    await sql`INSERT INTO tasks (id, creator_id, title, description, instructions, type, platform, url, reward, slots, deadline, fund_tx)
      VALUES (${id}, ${me.id}, ${title}, ${description}, ${instructions}, ${type}, ${optStr(b.platform, 60, 'Plateforme')}, ${httpUrl(b.url, 'Lien')},
              ${reward}, ${slots}, ${deadline.toISOString()}, ${hash})`
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'Cette tâche ou cette transaction est déjà enregistrée.')
    throw e
  }
  return { id }
})

route('POST', '/tasks/:id/close', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Tâche')
  const r = await one(sql`UPDATE tasks SET status = 'closed' WHERE id = ${id} AND (creator_id = ${me.id} OR ${me.role === 'admin'}) AND status = 'open' RETURNING id`)
  if (!r) throw new HttpError(404, 'Tâche introuvable ou déjà fermée.')
  return { ok: true }
})

// ── Soumissions ───────────────────────────────────────────────────────────────

route('POST', '/tasks/:id/submissions', 'user', async (c) => {
  const me = c.user as AuthUser
  const taskId = uuid(c.params.id, 'Tâche')
  const b = await c.json()
  rateLimit(`submit:${me.id}`, 60, 3_600_000)
  if (!me.wallet_address) throw new HttpError(400, 'Liez un portefeuille à votre compte pour être payé.')
  const proofUrl = httpUrl(b.proofUrl, 'Lien de preuve')
  const note = optStr(b.note, 1000, 'Note')
  const proofFile = b.proofFile ? uuid(b.proofFile, 'Fichier') : null
  if (!proofUrl && !proofFile) throw new HttpError(400, 'Ajoutez une preuve : un lien ou une capture d\'écran.')
  if (proofFile && !(await one(sql`SELECT 1 FROM uploads WHERE id = ${proofFile} AND user_id = ${me.id}`))) throw new HttpError(400, 'Fichier introuvable.')

  try {
    const creator = await sql.begin(async (tx) => {
      const [t] = (await tx`SELECT id, creator_id, slots, deadline, status, title FROM tasks WHERE id = ${taskId} FOR UPDATE`) as
        { id: string; creator_id: string; slots: number; deadline: Date; status: string; title: string }[]
      if (!t || t.status !== 'open') throw new HttpError(404, 'Cette tâche n\'est plus disponible.')
      if (t.creator_id === me.id) throw new HttpError(400, 'Vous ne pouvez pas réaliser votre propre tâche.')
      if (new Date(t.deadline).getTime() <= Date.now()) throw new HttpError(400, 'La date limite est dépassée.')
      const [n] = (await tx`SELECT count(*)::int AS n FROM submissions WHERE task_id = ${taskId} AND status IN ('pending','approved')`) as { n: number }[]
      if ((n?.n ?? 0) >= t.slots) throw new HttpError(409, 'Toutes les places sont prises.')
      await tx`INSERT INTO submissions (task_id, worker_id, proof_url, proof_file, note) VALUES (${taskId}, ${me.id}, ${proofUrl}, ${proofFile}, ${note})`
      return { id: t.creator_id, title: t.title }
    })
    await notify(creator.id, 'submission', 'Nouvelle soumission', `@${me.username} a soumis « ${creator.title} ».`, 'jobs:mine')
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'Vous avez déjà soumis cette tâche.')
    throw e
  }
  return { ok: true }
})

route('GET', '/me/submissions', 'user', async (c) => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT s.id, s.status, s.reject_reason, s.pay_tx, s.created_at, t.id AS task_id, t.title, t.reward
    FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.worker_id = ${(c.user as AuthUser).id} ORDER BY s.created_at DESC LIMIT 200`)
  return { items: list.map((s) => ({ id: s.id, status: s.status, rejectReason: s.reject_reason, payTx: s.pay_tx, createdAt: s.created_at, taskId: s.task_id, title: s.title, reward: s.reward })) }
})

route('GET', '/me/tasks', 'user', async (c) => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT t.id, t.title, t.reward, t.slots, t.deadline, t.status, t.created_at,
      (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND s.status IN ('pending','approved'))::int AS taken,
      (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND s.status = 'pending')::int AS pending
    FROM tasks t WHERE t.creator_id = ${(c.user as AuthUser).id} ORDER BY t.created_at DESC LIMIT 200`)
  return { items: list.map((t) => ({ id: t.id, title: t.title, reward: t.reward, slots: t.slots, deadline: t.deadline, status: t.status, createdAt: t.created_at, taken: t.taken, pending: t.pending })) }
})

route('GET', '/tasks/:id/submissions', 'user', async (c) => {
  const me = c.user as AuthUser
  const taskId = uuid(c.params.id, 'Tâche')
  const t = await one<{ creator_id: string }>(sql`SELECT creator_id FROM tasks WHERE id = ${taskId}`)
  if (!t || (t.creator_id !== me.id && me.role !== 'admin')) throw new HttpError(403, 'Accès refusé.')
  const list = await rows<Record<string, unknown>>(sql`
    SELECT s.id, s.status, s.proof_url, s.proof_file, s.note, s.reject_reason, s.pay_tx, s.created_at, u.username, u.wallet_address
    FROM submissions s JOIN users u ON u.id = s.worker_id WHERE s.task_id = ${taskId} ORDER BY s.created_at ASC`)
  return { items: list.map((s) => ({ id: s.id, status: s.status, proofUrl: s.proof_url, proofFile: s.proof_file, note: s.note, rejectReason: s.reject_reason, payTx: s.pay_tx, createdAt: s.created_at, worker: s.username, workerWallet: s.wallet_address })) }
})

async function ownedSubmission(c: { user: AuthUser | null; params: Record<string, string> }) {
  const me = c.user as AuthUser
  const s = await one<{ id: string; status: string; task_id: string; worker_id: string; reward: string; title: string; creator_id: string; wallet: string | null }>(sql`
    SELECT s.id, s.status, s.task_id, s.worker_id, t.reward, t.title, t.creator_id, u.wallet_address AS wallet
    FROM submissions s JOIN tasks t ON t.id = s.task_id JOIN users u ON u.id = s.worker_id WHERE s.id = ${uuid(c.params.id, 'Soumission')}`)
  if (!s || s.creator_id !== me.id) throw new HttpError(403, 'Accès refusé.')
  if (s.status !== 'pending') throw new HttpError(409, 'Cette soumission a déjà été traitée.')
  return s
}

route('POST', '/submissions/:id/approve', 'user', async (c) => {
  const s = await ownedSubmission(c)
  const hash = txHash((await c.json()).txHash)
  if (!s.wallet) throw new HttpError(400, 'Le travailleur n\'a pas de portefeuille lié.')
  await verifyRelease(hash, s.task_id, s.wallet, toRaw(s.reward))
  try {
    await sql`UPDATE submissions SET status = 'approved', pay_tx = ${hash}, reviewed_at = now() WHERE id = ${s.id} AND status = 'pending'`
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'Cette transaction est déjà associée à un paiement.')
    throw e
  }
  await notify(s.worker_id, 'paid', 'Paiement reçu', `${s.reward} USDC pour « ${s.title} » ont été ajoutés à votre solde.`, 'wallet')
  await audit((c.user as AuthUser).id, 'submission.approve', s.id, { hash })
  return { ok: true }
})

route('POST', '/submissions/:id/reject', 'user', async (c) => {
  const s = await ownedSubmission(c)
  const reason = str((await c.json()).reason, 3, 300, 'Motif')
  await sql`UPDATE submissions SET status = 'rejected', reject_reason = ${reason}, reviewed_at = now() WHERE id = ${s.id} AND status = 'pending'`
  await notify(s.worker_id, 'rejected', 'Soumission refusée', `« ${s.title} » : ${reason}`, 'jobs:submissions')
  await audit((c.user as AuthUser).id, 'submission.reject', s.id, { reason })
  return { ok: true }
})

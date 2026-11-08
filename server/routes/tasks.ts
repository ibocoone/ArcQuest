import { one, rows, sql } from '../db'
import {
  HttpError, amount, audit, httpUrl, optStr, rateLimit, requireVerified, route, str, txHash, uuid, type AuthUser,
} from '../http'
import { signClaimPermit, toRaw, verifyJobCreated } from '../chain'
import { syncSubmission } from '../submissions'

const TYPES = ['social', 'video', 'community', 'manuel', 'autre']
const isDup = (e: unknown) => String(e instanceof Error ? e.message : e).includes('duplicate key')

interface TaskRow {
  id: string; title: string; description: string; instructions?: string; type: string; review_days: number
  platform: string | null; url: string | null; reward: string; slots: number; deadline: Date
  status: string; created_at: Date; creator: string; creator_id: string; taken: number; my_status: string | null
}

const taskOut = (t: TaskRow) => ({
  id: t.id, title: t.title, description: t.description, instructions: t.instructions, type: t.type,
  platform: t.platform, url: t.url, reward: t.reward, slots: t.slots, taken: t.taken,
  deadline: t.deadline, status: t.status, createdAt: t.created_at, creator: t.creator,
  creatorId: t.creator_id, myStatus: t.my_status, reviewDays: t.review_days,
})

const SELECT = (uid: string) => sql`
  SELECT t.id, t.title, t.description, t.instructions, t.type, t.review_days, t.platform, t.url, t.reward, t.slots, t.deadline,
         t.status, t.created_at, t.creator_id, u.username AS creator,
         (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND (s.status IN ('pending','approved','rejected','disputed','split') OR (s.status = 'draft' AND s.permit_expires > now())))::int AS taken,
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
  const form = await c.req.formData().catch(() => { throw new HttpError(400, 'Invalid file.') })
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded.')
  if (file.size > 3 * 1024 * 1024) throw new HttpError(413, 'Image too large (3 MB max).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniff(bytes)
  if (!mime) throw new HttpError(400, 'Accepted formats: PNG, JPEG, WebP.')
  const row = await one<{ id: string }>(sql`INSERT INTO uploads (user_id, mime, size, data) VALUES (${me.id}, ${mime}, ${bytes.length}, ${Buffer.from(bytes)}) RETURNING id`)
  if (!row) throw new HttpError(500, 'Upload failed.')
  return { id: row.id }
})

route('GET', '/uploads/:id', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'File')
  const up = await one<{ user_id: string; mime: string; data: Uint8Array | null }>(sql`SELECT user_id, mime, data FROM uploads WHERE id = ${id}`)
  if (!up?.data) throw new HttpError(404, 'File not found.')
  let allowed = up.user_id === me.id || me.role === 'admin'
  if (!allowed) {
    allowed = !!(await one(sql`
      SELECT 1 FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.proof_file = ${id} AND t.creator_id = ${me.id}
      UNION ALL
      SELECT 1 FROM contest_entries e JOIN contests k ON k.id = e.contest_id WHERE e.proof_file = ${id} AND k.creator_id = ${me.id}`))
  }
  if (!allowed) throw new HttpError(403, 'Access denied.')
  return new Response(new Uint8Array(up.data), {
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
  const items = await rows<TaskRow>(sql`${SELECT(me.id)} WHERE t.status = 'open' AND t.protocol = 2 AND t.deadline > now() ${qf} ${tf}
    ORDER BY t.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`)
  const total = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM tasks t WHERE t.status = 'open' AND t.protocol = 2 AND t.deadline > now() ${qf} ${tf}`)
  return { items: items.map(taskOut), total: total?.n ?? 0, page, pageSize: size }
})

route('GET', '/tasks/:id', 'user', async (c) => {
  const t = await one<TaskRow>(sql`${SELECT((c.user as AuthUser).id)} WHERE t.id = ${uuid(c.params.id, 'Task')}`)
  if (!t || t.status === 'removed') throw new HttpError(404, 'Task not found.')
  return taskOut(t)
})

route('POST', '/tasks', 'user', async (c) => {
  const me = c.user as AuthUser
  requireVerified(me)
  const b = await c.json()
  rateLimit(`task:${me.id}`, 20, 3_600_000)
  const id = uuid(b.id, 'ID')
  const title = str(b.title, 3, 120, 'Title')
  const description = str(b.description, 10, 1000, 'Description')
  const instructions = str(b.instructions, 10, 2000, 'Instructions')
  const type = str(b.type, 2, 20, 'Type')
  if (!TYPES.includes(type)) throw new HttpError(400, 'Invalid type.')
  const reward = amount(b.reward, 'Reward')
  const slots = Number(b.slots)
  if (!Number.isInteger(slots) || slots < 1 || slots > 10_000) throw new HttpError(400, 'Invalid number of places (1 to 10,000).')
  const reviewDays = b.reviewDays === undefined ? 3 : Number(b.reviewDays)
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > 14) throw new HttpError(400, 'The review period must be between 1 and 14 days.')
  const deadline = new Date(str(b.deadline, 10, 40, 'Deadline'))
  if (!(deadline.getTime() > Date.now() + 3_600_000) || deadline.getTime() > Date.now() + 365 * 86_400_000) {
    throw new HttpError(400, 'The deadline must be more than one hour and less than one year away.')
  }
  if (!me.wallet_address) throw new HttpError(400, 'Link a wallet to your account to publish a task.')
  const hash = txHash(b.fundTx)
  await verifyJobCreated(hash, id, me.wallet_address, {
    rewardRaw: toRaw(reward), slots, deadline: Math.floor(deadline.getTime() / 1000), reviewPeriod: reviewDays * 86_400,
  })
  try {
    await sql`INSERT INTO tasks (id, creator_id, title, description, instructions, type, platform, url, reward, slots, deadline, fund_tx, review_days, protocol)
      VALUES (${id}, ${me.id}, ${title}, ${description}, ${instructions}, ${type}, ${optStr(b.platform, 60, 'Platform')}, ${httpUrl(b.url, 'Link')},
              ${reward}, ${slots}, ${deadline.toISOString()}, ${hash}, ${reviewDays}, 2)`
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'This task or transaction is already registered.')
    throw e
  }
  return { id }
})

route('POST', '/tasks/:id/close', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Task')
  const r = await one(sql`UPDATE tasks SET status = 'closed' WHERE id = ${id} AND (creator_id = ${me.id} OR ${me.role === 'admin'}) AND status = 'open' RETURNING id`)
  if (!r) throw new HttpError(404, 'Task not found or already closed.')
  return { ok: true }
})

// ── Soumissions (enregistrées dans le contrat) ───────────────────────────────

const ACTIVE = sql`(s.status IN ('pending','approved','rejected','disputed','split') OR (s.status = 'draft' AND s.permit_expires > now()))`

/** Étape 1 : le serveur vérifie les règles et remet au travailleur une autorisation signée pour enregistrer sa soumission dans le contrat. */
route('POST', '/tasks/:id/claim-permit', 'user', async (c) => {
  const me = c.user as AuthUser
  requireVerified(me)
  const taskId = uuid(c.params.id, 'Task')
  const b = await c.json()
  rateLimit(`submit:${me.id}`, 60, 3_600_000)
  if (!me.wallet_address) throw new HttpError(400, 'Link a wallet to your account to get paid.')
  const proofUrl = httpUrl(b.proofUrl, 'Proof link')
  const note = optStr(b.note, 1000, 'Note')
  const proofFile = b.proofFile ? uuid(b.proofFile, 'File') : null
  if (!proofUrl && !proofFile) throw new HttpError(400, 'Add proof: a link or a screenshot.')
  if (proofFile && !(await one(sql`SELECT 1 FROM uploads WHERE id = ${proofFile} AND user_id = ${me.id}`))) throw new HttpError(400, 'File not found.')

  let submissionId: string
  try {
    submissionId = await sql.begin(async (tx) => {
      const [t] = (await tx`SELECT id, creator_id, slots, deadline, status, protocol FROM tasks WHERE id = ${taskId} FOR UPDATE`) as
        { id: string; creator_id: string; slots: number; deadline: Date; status: string; protocol: number }[]
      if (!t || t.status !== 'open') throw new HttpError(404, 'This task is no longer available.')
      if (t.protocol !== 2) throw new HttpError(410, 'This task uses an older version and no longer accepts submissions.')
      if (t.creator_id === me.id) throw new HttpError(400, 'You cannot do your own task.')
      if (new Date(t.deadline).getTime() <= Date.now() + 120_000) throw new HttpError(400, 'The deadline has passed.')
      const [mine] = (await tx`SELECT id, status FROM submissions WHERE task_id = ${taskId} AND worker_id = ${me.id} FOR UPDATE`) as { id: string; status: string }[]
      if (mine && mine.status !== 'draft') throw new HttpError(409, 'You have already submitted this task.')
      const [n] = (await tx`SELECT count(*)::int AS n FROM submissions s WHERE s.task_id = ${taskId} AND s.worker_id <> ${me.id} AND ${ACTIVE}`) as { n: number }[]
      if ((n?.n ?? 0) >= t.slots) throw new HttpError(409, 'All places are taken.')
      if (mine) {
        await tx`UPDATE submissions SET proof_url = ${proofUrl}, proof_file = ${proofFile}, note = ${note} WHERE id = ${mine.id}`
        return mine.id
      }
      const [row] = (await tx`INSERT INTO submissions (task_id, worker_id, proof_url, proof_file, note, status)
        VALUES (${taskId}, ${me.id}, ${proofUrl}, ${proofFile}, ${note}, 'draft') RETURNING id`) as { id: string }[]
      return (row as { id: string }).id
    })
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'You have already submitted this task.')
    throw e
  }
  const permit = await signClaimPermit(taskId, me.wallet_address)
  await sql`UPDATE submissions SET permit_expires = to_timestamp(${permit.expiry}) WHERE id = ${submissionId}`
  return { submissionId, expiry: permit.expiry, signature: permit.signature }
})

/** Aligne la soumission sur l'état réel du contrat (après une transaction, ou pour rafraîchir). */
route('POST', '/submissions/:id/sync', 'user', async (c) => {
  const me = c.user as AuthUser
  rateLimit(`sync:${me.id}`, 600, 3_600_000)
  const id = uuid(c.params.id, 'Submission')
  const s = await one<{ worker_id: string; creator_id: string }>(sql`
    SELECT s.worker_id, t.creator_id FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.id = ${id}`)
  if (!s || (s.worker_id !== me.id && s.creator_id !== me.id && me.role !== 'admin')) throw new HttpError(403, 'Access denied.')
  const out = await syncSubmission(id)
  return { status: out?.status ?? null }
})

/** Le créateur explique son refus (visible par le travailleur). Le refus lui-même est enregistré dans le contrat. */
route('POST', '/submissions/:id/reject-reason', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Submission')
  const reason = str((await c.json()).reason, 3, 300, 'Reason')
  const synced = await syncSubmission(id)
  if (!synced || synced.creator_id !== me.id) throw new HttpError(403, 'Access denied.')
  if (synced.status !== 'rejected') throw new HttpError(409, 'This submission is not rejected onchain.')
  const r = await one(sql`UPDATE submissions SET reject_reason = ${reason} WHERE id = ${id} AND reject_reason IS NULL RETURNING id`)
  if (!r) throw new HttpError(409, 'A reason was already given.')
  await audit(me.id, 'submission.reject-reason', id, { reason })
  return { ok: true }
})

const subOut = (s: Record<string, unknown>) => ({
  id: s.id, status: s.status, rejectReason: s.reject_reason, createdAt: s.created_at,
  claimAt: s.claim_at, statusAt: s.status_at,
})

route('GET', '/me/submissions', 'user', async (c) => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT s.id, s.status, s.reject_reason, s.created_at, s.claim_at, s.status_at, t.id AS task_id, t.title, t.reward, t.review_days, t.deadline
    FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.worker_id = ${(c.user as AuthUser).id} AND s.status <> 'draft' ORDER BY s.created_at DESC LIMIT 200`)
  return { items: list.map((s) => ({ ...subOut(s), taskId: s.task_id, title: s.title, reward: s.reward, reviewDays: s.review_days, taskDeadline: s.deadline })) }
})

route('GET', '/me/tasks', 'user', async (c) => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT t.id, t.title, t.reward, t.slots, t.deadline, t.status, t.created_at, t.review_days, t.protocol,
      (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND ${ACTIVE})::int AS taken,
      (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND s.status = 'pending')::int AS pending,
      (SELECT count(*) FROM submissions s WHERE s.task_id = t.id AND s.status = 'disputed')::int AS disputed
    FROM tasks t WHERE t.creator_id = ${(c.user as AuthUser).id} ORDER BY t.created_at DESC LIMIT 200`)
  return { items: list.map((t) => ({
    id: t.id, title: t.title, reward: t.reward, slots: t.slots, deadline: t.deadline, status: t.status, createdAt: t.created_at,
    reviewDays: t.review_days, protocol: t.protocol, taken: t.taken, pending: t.pending, disputed: t.disputed,
  })) }
})

route('GET', '/tasks/:id/submissions', 'user', async (c) => {
  const me = c.user as AuthUser
  const taskId = uuid(c.params.id, 'Task')
  const t = await one<{ creator_id: string }>(sql`SELECT creator_id FROM tasks WHERE id = ${taskId}`)
  if (!t || (t.creator_id !== me.id && me.role !== 'admin')) throw new HttpError(403, 'Access denied.')
  const list = await rows<Record<string, unknown>>(sql`
    SELECT s.id, s.status, s.proof_url, s.proof_file, s.note, s.reject_reason, s.created_at, s.claim_at, s.status_at, u.username, u.wallet_address
    FROM submissions s JOIN users u ON u.id = s.worker_id WHERE s.task_id = ${taskId} AND s.status <> 'draft' ORDER BY s.created_at ASC`)
  return { items: list.map((s) => ({ ...subOut(s), proofUrl: s.proof_url, proofFile: s.proof_file, note: s.note, worker: s.username, workerWallet: s.wallet_address })) }
})

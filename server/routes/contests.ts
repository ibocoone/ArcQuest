import { formatUnits } from 'viem'
import { one, rows, sql } from '../db'
import { HttpError, audit, httpUrl, notify, optStr, rateLimit, route, str, txHash, uuid, amount, type AuthUser } from '../http'
import { toRaw, verifyFunding, verifyRelease } from '../chain'

const TYPES = ['meme', 'contenu', 'referral', 'video', 'autre']
const isDup = (e: unknown) => String(e instanceof Error ? e.message : e).includes('duplicate key')

interface Prize { place: string; amount: string }
interface ContestRow {
  id: string; title: string; description: string; prompt: string; type: string; ends_at: Date; slots: number
  prizes: Prize[]; prize_pool: string; status: string; created_at: Date; creator: string; creator_id: string
  entries: number; my_status: string | null
}

const out = (k: ContestRow) => ({
  id: k.id, title: k.title, description: k.description, prompt: k.prompt, type: k.type, endsAt: k.ends_at,
  slots: k.slots, prizes: k.prizes, prizePool: k.prize_pool, status: k.status, createdAt: k.created_at,
  creator: k.creator, creatorId: k.creator_id, entries: k.entries, myStatus: k.my_status,
})

const SELECT = (uid: string) => sql`
  SELECT k.id, k.title, k.description, k.prompt, k.type, k.ends_at, k.slots, k.prizes, k.prize_pool, k.status, k.created_at,
         k.creator_id, u.username AS creator,
         (SELECT count(*) FROM contest_entries e WHERE e.contest_id = k.id AND e.status <> 'rejected')::int AS entries,
         (SELECT e.status FROM contest_entries e WHERE e.contest_id = k.id AND e.user_id = ${uid}) AS my_status
  FROM contests k JOIN users u ON u.id = k.creator_id`

route('GET', '/contests', 'user', async (c) => {
  const list = await rows<ContestRow>(sql`${SELECT((c.user as AuthUser).id)} WHERE k.status = 'open' AND k.ends_at > now() ORDER BY k.created_at DESC LIMIT 100`)
  return { items: list.map(out) }
})

route('POST', '/contests', 'user', async (c) => {
  const me = c.user as AuthUser
  const b = await c.json()
  rateLimit(`contest:${me.id}`, 10, 3_600_000)
  const id = uuid(b.id, 'Identifiant')
  const type = str(b.type, 2, 20, 'Type')
  if (!TYPES.includes(type)) throw new HttpError(400, 'Type invalide.')
  const endsAt = new Date(str(b.endsAt, 10, 40, 'Date de fin'))
  if (!(endsAt.getTime() > Date.now() + 3_600_000) || endsAt.getTime() > Date.now() + 330 * 86_400_000) {
    throw new HttpError(400, 'La date de fin doit être dans plus d\'une heure et moins de 11 mois.')
  }
  const slots = Number(b.slots)
  if (!Number.isInteger(slots) || slots < 1 || slots > 100_000) throw new HttpError(400, 'Nombre de places invalide.')
  if (!Array.isArray(b.prizes) || b.prizes.length < 1 || b.prizes.length > 10) throw new HttpError(400, 'Ajoutez entre 1 et 10 prix.')
  const prizes: Prize[] = (b.prizes as Record<string, unknown>[]).map((p) => ({ place: str(p.place, 1, 20, 'Rang'), amount: amount(p.amount, 'Montant du prix') }))
  if (new Set(prizes.map((p) => p.place)).size !== prizes.length) throw new HttpError(400, 'Deux prix ont le même rang.')
  const poolRaw = prizes.reduce((s, p) => s + toRaw(p.amount), 0n)
  if (!me.wallet_address) throw new HttpError(400, 'Liez un portefeuille à votre compte pour créer un concours.')
  const hash = txHash(b.fundTx)
  await verifyFunding(hash, id, me.wallet_address, poolRaw)
  try {
    await sql`INSERT INTO contests (id, creator_id, title, description, prompt, type, ends_at, slots, prizes, prize_pool, fund_tx)
      VALUES (${id}, ${me.id}, ${str(b.title, 3, 120, 'Titre')}, ${str(b.description, 10, 1000, 'Description')}, ${str(b.prompt, 10, 2000, 'Instructions')},
              ${type}, ${endsAt.toISOString()}, ${slots}, ${JSON.stringify(prizes)}::jsonb, ${formatUnits(poolRaw, 6)}, ${hash})`
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'Ce concours ou cette transaction est déjà enregistré.')
    throw e
  }
  return { id }
})

route('POST', '/contests/:id/close', 'user', async (c) => {
  const me = c.user as AuthUser
  const r = await one(sql`UPDATE contests SET status = 'closed' WHERE id = ${uuid(c.params.id, 'Concours')} AND (creator_id = ${me.id} OR ${me.role === 'admin'}) AND status = 'open' RETURNING id`)
  if (!r) throw new HttpError(404, 'Concours introuvable ou déjà fermé.')
  return { ok: true }
})

route('POST', '/contests/:id/entries', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Concours')
  const b = await c.json()
  rateLimit(`entry:${me.id}`, 60, 3_600_000)
  if (!me.wallet_address) throw new HttpError(400, 'Liez un portefeuille à votre compte pour recevoir un prix.')
  const proofUrl = httpUrl(b.proofUrl, 'Lien')
  const note = optStr(b.note, 1000, 'Note')
  const proofFile = b.proofFile ? uuid(b.proofFile, 'Fichier') : null
  if (!proofUrl && !proofFile && !note) throw new HttpError(400, 'Ajoutez votre participation : lien, image ou texte.')
  if (proofFile && !(await one(sql`SELECT 1 FROM uploads WHERE id = ${proofFile} AND user_id = ${me.id}`))) throw new HttpError(400, 'Fichier introuvable.')
  try {
    const k = await sql.begin(async (tx) => {
      const [k] = (await tx`SELECT creator_id, slots, ends_at, status, title FROM contests WHERE id = ${id} FOR UPDATE`) as
        { creator_id: string; slots: number; ends_at: Date; status: string; title: string }[]
      if (!k || k.status !== 'open' || new Date(k.ends_at).getTime() <= Date.now()) throw new HttpError(404, 'Ce concours est terminé.')
      if (k.creator_id === me.id) throw new HttpError(400, 'Vous ne pouvez pas participer à votre propre concours.')
      const [n] = (await tx`SELECT count(*)::int AS n FROM contest_entries WHERE contest_id = ${id} AND status <> 'rejected'`) as { n: number }[]
      if ((n?.n ?? 0) >= k.slots) throw new HttpError(409, 'Toutes les places sont prises.')
      await tx`INSERT INTO contest_entries (contest_id, user_id, proof_url, proof_file, note) VALUES (${id}, ${me.id}, ${proofUrl}, ${proofFile}, ${note})`
      return k
    })
    await notify(k.creator_id, 'entry', 'Nouvelle participation', `@${me.username} participe à « ${k.title} ».`, 'contests:mine')
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'Vous participez déjà à ce concours.')
    throw e
  }
  return { ok: true }
})

route('GET', '/me/contests', 'user', async (c) => {
  const list = await rows<ContestRow>(sql`${SELECT((c.user as AuthUser).id)} WHERE k.creator_id = ${(c.user as AuthUser).id} ORDER BY k.created_at DESC LIMIT 100`)
  return { items: list.map(out) }
})

route('GET', '/me/entries', 'user', async (c) => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT e.id, e.status, e.prize_place, e.prize_amount, e.pay_tx, e.created_at, k.id AS contest_id, k.title
    FROM contest_entries e JOIN contests k ON k.id = e.contest_id WHERE e.user_id = ${(c.user as AuthUser).id} ORDER BY e.created_at DESC LIMIT 100`)
  return { items: list.map((e) => ({ id: e.id, status: e.status, prizePlace: e.prize_place, prizeAmount: e.prize_amount, payTx: e.pay_tx, createdAt: e.created_at, contestId: e.contest_id, title: e.title })) }
})

route('GET', '/contests/:id/entries', 'user', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Concours')
  const k = await one<{ creator_id: string }>(sql`SELECT creator_id FROM contests WHERE id = ${id}`)
  if (!k || (k.creator_id !== me.id && me.role !== 'admin')) throw new HttpError(403, 'Accès refusé.')
  const list = await rows<Record<string, unknown>>(sql`
    SELECT e.id, e.status, e.proof_url, e.proof_file, e.note, e.prize_place, e.prize_amount, e.pay_tx, e.created_at, u.username, u.wallet_address
    FROM contest_entries e JOIN users u ON u.id = e.user_id WHERE e.contest_id = ${id} ORDER BY e.created_at ASC`)
  return { items: list.map((e) => ({ id: e.id, status: e.status, proofUrl: e.proof_url, proofFile: e.proof_file, note: e.note, prizePlace: e.prize_place, prizeAmount: e.prize_amount, payTx: e.pay_tx, createdAt: e.created_at, user: e.username, userWallet: e.wallet_address })) }
})

async function ownedEntry(c: { user: AuthUser | null; params: Record<string, string> }) {
  const e = await one<{ id: string; status: string; contest_id: string; user_id: string; creator_id: string; prizes: Prize[]; title: string; wallet: string | null }>(sql`
    SELECT e.id, e.status, e.contest_id, e.user_id, k.creator_id, k.prizes, k.title, u.wallet_address AS wallet
    FROM contest_entries e JOIN contests k ON k.id = e.contest_id JOIN users u ON u.id = e.user_id WHERE e.id = ${uuid(c.params.id, 'Participation')}`)
  if (!e || e.creator_id !== (c.user as AuthUser).id) throw new HttpError(403, 'Accès refusé.')
  if (e.status !== 'pending') throw new HttpError(409, 'Cette participation a déjà été traitée.')
  return e
}

route('POST', '/entries/:id/award', 'user', async (c) => {
  const e = await ownedEntry(c)
  const b = await c.json()
  const place = str(b.prizePlace, 1, 20, 'Rang')
  const prize = e.prizes.find((p) => p.place === place)
  if (!prize) throw new HttpError(400, 'Ce rang n\'existe pas dans le concours.')
  if (await one(sql`SELECT 1 FROM contest_entries WHERE contest_id = ${e.contest_id} AND prize_place = ${place}`)) throw new HttpError(409, 'Ce prix est déjà attribué.')
  if (!e.wallet) throw new HttpError(400, 'Le participant n\'a pas de portefeuille lié.')
  const hash = txHash(b.txHash)
  await verifyRelease(hash, e.contest_id, e.wallet, toRaw(prize.amount))
  try {
    await sql`UPDATE contest_entries SET status = 'winner', prize_place = ${place}, prize_amount = ${prize.amount}, pay_tx = ${hash} WHERE id = ${e.id} AND status = 'pending'`
  } catch (err) {
    if (isDup(err)) throw new HttpError(409, 'Prix ou transaction déjà enregistré.')
    throw err
  }
  await notify(e.user_id, 'paid', 'Vous avez gagné !', `${prize.amount} USDC (${place}) pour « ${e.title} » ont été ajoutés à votre solde.`, 'wallet')
  await audit((c.user as AuthUser).id, 'entry.award', e.id, { place, hash })
  return { ok: true }
})

route('POST', '/entries/:id/reject', 'user', async (c) => {
  const e = await ownedEntry(c)
  await sql`UPDATE contest_entries SET status = 'rejected' WHERE id = ${e.id} AND status = 'pending'`
  await notify(e.user_id, 'rejected', 'Participation non retenue', `« ${e.title} »`, 'contests')
  return { ok: true }
})

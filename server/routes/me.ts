import { one, rows, sql } from '../db'
import { HttpError, rateLimit, route, str, txHash, uuid, type AuthUser } from '../http'
import { activityFromTx } from '../chain'
import { formatUnits } from 'viem'

const num = (v: unknown) => Number(v ?? 0)

route('GET', '/me/stats', 'user', async (c) => {
  const id = (c.user as AuthUser).id
  const s = await one<Record<string, unknown>>(sql`
    SELECT
      (SELECT count(*) FROM submissions WHERE worker_id = ${id} AND status = 'approved')::int AS done,
      (SELECT count(*) FROM submissions WHERE worker_id = ${id} AND status = 'pending')::int AS pending,
      (SELECT count(*) FROM contest_entries WHERE user_id = ${id} AND status = 'winner')::int AS wins,
      (SELECT coalesce(sum(t.reward), 0) FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.worker_id = ${id} AND s.status = 'approved')
        + (SELECT coalesce(sum(prize_amount), 0) FROM contest_entries WHERE user_id = ${id} AND status = 'winner') AS earned,
      (SELECT count(*) FROM tasks WHERE creator_id = ${id} AND status = 'open')::int AS my_open_tasks,
      (SELECT count(*) FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE t.creator_id = ${id} AND s.status = 'pending')::int AS to_review,
      (SELECT count(*) FROM users WHERE referred_by = ${id})::int AS referrals,
      (SELECT count(*) FROM users r WHERE r.referred_by = ${id} AND (
        EXISTS (SELECT 1 FROM submissions WHERE worker_id = r.id AND status = 'approved')
        OR EXISTS (SELECT 1 FROM contest_entries WHERE user_id = r.id AND status = 'winner')))::int AS active_referrals`)
  return {
    tasksDone: num(s?.done), pendingSubmissions: num(s?.pending), contestWins: num(s?.wins), earned: String(s?.earned ?? '0'),
    myOpenTasks: num(s?.my_open_tasks), toReview: num(s?.to_review), referrals: num(s?.referrals), activeReferrals: num(s?.active_referrals),
  }
})

/** Gains réels : uniquement les paiements confirmés onchain. */
route('GET', '/me/earnings', 'user', async (c) => {
  const id = (c.user as AuthUser).id
  const list = await rows<Record<string, unknown>>(sql`
    SELECT 'task' AS kind, t.title, t.reward AS amount, s.pay_tx AS tx, s.reviewed_at AS at
      FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.worker_id = ${id} AND s.status = 'approved'
    UNION ALL
    SELECT 'contest', k.title || ' (' || e.prize_place || ')', e.prize_amount, e.pay_tx, e.created_at
      FROM contest_entries e JOIN contests k ON k.id = e.contest_id WHERE e.user_id = ${id} AND e.status = 'winner'
    ORDER BY at DESC LIMIT 200`)
  return { items: list.map((r) => ({ kind: r.kind, title: r.title, amount: r.amount, tx: r.tx, at: r.at })) }
})

route('GET', '/me/referrals', 'user', async (c) => {
  const id = (c.user as AuthUser).id
  const list = await rows<Record<string, unknown>>(sql`
    SELECT r.username, r.created_at,
      (EXISTS (SELECT 1 FROM submissions WHERE worker_id = r.id AND status = 'approved')
       OR EXISTS (SELECT 1 FROM contest_entries WHERE user_id = r.id AND status = 'winner')) AS active
    FROM users r WHERE r.referred_by = ${id} ORDER BY r.created_at DESC LIMIT 200`)
  return { items: list.map((r) => ({ username: r.username, joinedAt: r.created_at, active: r.active === true })) }
})

route('GET', '/notifications', 'user', async (c) => {
  const id = (c.user as AuthUser).id
  const list = await rows<Record<string, unknown>>(sql`
    SELECT id, kind, title, body, link, read, created_at FROM notifications WHERE user_id = ${id} ORDER BY created_at DESC LIMIT 50`)
  const unread = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${id} AND read = false`)
  return {
    unread: unread?.n ?? 0,
    items: list.map((n) => ({ id: String(n.id), kind: n.kind, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.created_at })),
  }
})

route('POST', '/notifications/read', 'user', async (c) => {
  await sql`UPDATE notifications SET read = true WHERE user_id = ${(c.user as AuthUser).id} AND read = false`
})

route('POST', '/reports', 'user', async (c) => {
  const me = c.user as AuthUser
  const b = await c.json()
  rateLimit(`report:${me.id}`, 10, 3_600_000)
  const type = str(b.targetType, 4, 10, 'Type')
  if (!['task', 'contest', 'user'].includes(type)) throw new HttpError(400, 'Type invalide.')
  const target = uuid(b.targetId, 'Cible')
  const reason = str(b.reason, 5, 500, 'Motif')
  const exists = type === 'task' ? sql`SELECT 1 FROM tasks WHERE id = ${target}`
    : type === 'contest' ? sql`SELECT 1 FROM contests WHERE id = ${target}` : sql`SELECT 1 FROM users WHERE id = ${target}`
  if (!(await one(exists))) throw new HttpError(404, 'Élément introuvable.')
  if (await one(sql`SELECT 1 FROM reports WHERE reporter_id = ${me.id} AND target_id = ${target} AND status = 'open'`)) {
    throw new HttpError(409, 'Vous avez déjà signalé cet élément.')
  }
  await sql`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (${me.id}, ${type}, ${target}, ${reason})`
})

// ── Historique du portefeuille ────────────────────────────────────────────────

route('POST', '/me/activity', 'user', async (c) => {
  const me = c.user as AuthUser
  rateLimit(`activity:${me.id}`, 200, 3_600_000)
  if (!me.wallet_address) throw new HttpError(400, 'Aucun portefeuille lié.')
  const hash = txHash((await c.json()).txHash)
  const entries = await activityFromTx(hash, me.wallet_address)
  for (const e of entries) {
    await sql`INSERT INTO activity (user_id, tx_hash, log_index, kind, amount, at)
      VALUES (${me.id}, ${hash}, ${e.logIndex}, ${e.kind}, ${formatUnits(e.amountRaw, 6)}, ${e.at.toISOString()})
      ON CONFLICT (tx_hash, log_index) DO NOTHING`
  }
  return { recorded: entries.length }
})

route('GET', '/me/activity', 'user', async (c) => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT id, tx_hash, kind, amount, at FROM activity WHERE user_id = ${(c.user as AuthUser).id} ORDER BY at DESC, id DESC LIMIT 100`)
  return { items: list.map((a) => ({ id: String(a.id), txHash: a.tx_hash, kind: a.kind, amount: a.amount, at: a.at })) }
})

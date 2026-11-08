import { formatUnits } from 'viem'
import { one, rows, sql } from '../db'
import { HttpError, audit, notify, route, str, uuid, type AuthUser } from '../http'
import { vaultUsdcRaw } from '../chain'
import { USDC_DECIMALS } from '../../src/onchain-facts'

type Row = Record<string, unknown>

/** Vue financière : fonds détenus par le contrat, volumes financés et payés, activité des 7 derniers jours. */
route('GET', '/admin/finance', 'admin', async () => {
  const raw = await vaultUsdcRaw()
  const t = await one<Row>(sql`
    SELECT
      (SELECT count(*) FROM submissions WHERE status = 'approved')::int AS task_paid_count,
      (SELECT COALESCE(sum(t.reward), 0) FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.status = 'approved')::text AS task_paid_total,
      (SELECT count(*) FROM contest_entries WHERE status = 'winner')::int AS contest_paid_count,
      (SELECT COALESCE(sum(prize_amount), 0) FROM contest_entries WHERE status = 'winner')::text AS contest_paid_total,
      (SELECT COALESCE(sum(reward * slots), 0) FROM tasks)::text AS tasks_funded,
      (SELECT COALESCE(sum(prize_pool), 0) FROM contests)::text AS contests_funded`)
  const daily = await rows<Row>(sql`
    SELECT d::date::text AS day,
      (SELECT count(*) FROM users WHERE created_at::date = d::date)::int AS users,
      (SELECT count(*) FROM submissions WHERE created_at::date = d::date)::int AS submissions,
      (SELECT count(*) FROM tasks WHERE created_at::date = d::date)::int AS tasks
    FROM generate_series(now() - interval '6 days', now(), interval '1 day') d ORDER BY d`)
  return {
    vaultUsdc: raw === null ? null : formatUnits(raw, USDC_DECIMALS),
    taskPaid: { count: t?.task_paid_count ?? 0, total: t?.task_paid_total ?? '0' },
    contestPaid: { count: t?.contest_paid_count ?? 0, total: t?.contest_paid_total ?? '0' },
    funded: { tasks: t?.tasks_funded ?? '0', contests: t?.contests_funded ?? '0' },
    daily,
  }
})

/** Tous les paiements confirmés (tâches et concours), du plus récent au plus ancien. */
route('GET', '/admin/payments', 'admin', async () => {
  const list = await rows<Row>(sql`
    SELECT * FROM (
      SELECT 'task' AS kind, t.title, w.username AS worker, c.username AS creator, t.reward::text AS amount, s.pay_tx AS tx, coalesce(s.status_at, s.reviewed_at) AS at
      FROM submissions s JOIN tasks t ON t.id = s.task_id JOIN users w ON w.id = s.worker_id JOIN users c ON c.id = t.creator_id
      WHERE s.status = 'approved'
      UNION ALL
      SELECT 'contest', k.title, w.username, c.username, e.prize_amount::text, e.pay_tx, e.created_at
      FROM contest_entries e JOIN contests k ON k.id = e.contest_id JOIN users w ON w.id = e.user_id JOIN users c ON c.id = k.creator_id
      WHERE e.status = 'winner' AND e.pay_tx IS NOT NULL
    ) p ORDER BY at DESC NULLS LAST LIMIT 200`)
  return { items: list }
})

function kindOf(v: string | undefined): 'task' | 'contest' {
  if (v === 'task' || v === 'contest') return v
  throw new HttpError(400, 'Invalid type.')
}

/** Toutes les tâches ou tous les concours, quel que soit leur statut. */
route('GET', '/admin/items', 'admin', async (c) => {
  const kind = kindOf(c.url.searchParams.get('kind') ?? undefined)
  const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const f = q ? sql`WHERE x.title ILIKE ${like}` : sql``
  const list = kind === 'task'
    ? await rows<Row>(sql`
        SELECT x.id, x.title, x.status, x.reward::text AS amount, x.slots, x.deadline AS ends, x.fund_tx, x.created_at, u.username AS creator,
          (SELECT count(*) FROM submissions s WHERE s.task_id = x.id)::int AS participants
        FROM tasks x JOIN users u ON u.id = x.creator_id ${f} ORDER BY x.created_at DESC LIMIT 100`)
    : await rows<Row>(sql`
        SELECT x.id, x.title, x.status, x.prize_pool::text AS amount, x.slots, x.ends_at AS ends, x.fund_tx, x.created_at, u.username AS creator,
          (SELECT count(*) FROM contest_entries e WHERE e.contest_id = x.id)::int AS participants
        FROM contests x JOIN users u ON u.id = x.creator_id ${f} ORDER BY x.created_at DESC LIMIT 100`)
  return { items: list }
})

/** Retire, ferme ou remet en ligne une tâche ou un concours. */
route('POST', '/admin/items/:kind/:id/status', 'admin', async (c) => {
  const me = c.user as AuthUser
  const kind = kindOf(c.params.kind)
  const id = uuid(c.params.id, 'Item')
  const status = str((await c.json()).status, 4, 7, 'Status')
  if (!['open', 'closed', 'removed'].includes(status)) throw new HttpError(400, 'Invalid status.')
  const r = kind === 'task'
    ? await one<{ creator_id: string; title: string }>(sql`UPDATE tasks SET status = ${status} WHERE id = ${id} RETURNING creator_id, title`)
    : await one<{ creator_id: string; title: string }>(sql`UPDATE contests SET status = ${status} WHERE id = ${id} RETURNING creator_id, title`)
  if (!r) throw new HttpError(404, 'Item not found.')
  if (status === 'removed') await notify(r.creator_id, 'moderation', kind === 'task' ? 'Task removed' : 'Contest removed', `"${r.title}" was removed by moderation.`)
  await audit(me.id, `${kind}.${status}`, id)
})

/** Soumissions ou participations d'une tâche ou d'un concours (traitement des litiges). */
route('GET', '/admin/items/:kind/:id/entries', 'admin', async (c) => {
  const kind = kindOf(c.params.kind)
  const id = uuid(c.params.id, 'Item')
  const list = kind === 'task'
    ? await rows<Row>(sql`
        SELECT s.id, s.status, s.proof_url, s.proof_file, s.note, s.reject_reason AS reason, s.pay_tx AS tx, s.created_at, u.username AS author
        FROM submissions s JOIN users u ON u.id = s.worker_id WHERE s.task_id = ${id} ORDER BY s.created_at DESC LIMIT 200`)
    : await rows<Row>(sql`
        SELECT e.id, e.status, e.proof_url, e.proof_file, e.note, NULL AS reason, e.pay_tx AS tx, e.created_at, u.username AS author
        FROM contest_entries e JOIN users u ON u.id = e.user_id WHERE e.contest_id = ${id} ORDER BY e.created_at DESC LIMIT 200`)
  return {
    items: list.map((r) => ({ id: r.id, status: r.status, proofUrl: r.proof_url, proofFile: r.proof_file, note: r.note, reason: r.reason, tx: r.tx, createdAt: r.created_at, author: r.author })),
  }
})

/** Litiges ouverts : refus contestés par les travailleurs, que l'arbitre doit trancher dans le contrat. */
route('GET', '/admin/disputes', 'admin', async () => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT s.id, s.proof_url, s.proof_file, s.note, s.reject_reason, s.status_at, s.claim_at,
           t.id AS task_id, t.title, t.reward, t.review_days,
           w.username AS worker, w.wallet_address AS worker_wallet,
           c.username AS creator, c.wallet_address AS creator_wallet
    FROM submissions s JOIN tasks t ON t.id = s.task_id
      JOIN users w ON w.id = s.worker_id JOIN users c ON c.id = t.creator_id
    WHERE s.status = 'disputed' ORDER BY s.status_at ASC LIMIT 100`)
  return { items: list.map((d) => ({
    id: d.id, taskId: d.task_id, title: d.title, reward: d.reward, reviewDays: d.review_days,
    proofUrl: d.proof_url, proofFile: d.proof_file, note: d.note, rejectReason: d.reject_reason,
    disputedAt: d.status_at, claimAt: d.claim_at,
    worker: d.worker, workerWallet: d.worker_wallet, creator: d.creator, creatorWallet: d.creator_wallet,
  })) }
})

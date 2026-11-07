import { one, rows, sql } from '../db'
import { HttpError, audit, notify, route, str, uuid, type AuthUser } from '../http'

route('GET', '/admin/overview', 'admin', async () => {
  const s = await one<Record<string, number>>(sql`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM users WHERE status = 'suspended')::int AS suspended,
           (SELECT count(*) FROM tasks WHERE status = 'open')::int AS tasks,
           (SELECT count(*) FROM contests WHERE status = 'open')::int AS contests,
           (SELECT count(*) FROM submissions WHERE status = 'pending')::int AS pending_submissions,
           (SELECT count(*) FROM reports WHERE status = 'open')::int AS open_reports`)
  return s ?? {}
})

route('GET', '/admin/users', 'admin', async (c) => {
  const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const f = q ? sql`WHERE username ILIKE ${like} OR email ILIKE ${like} OR wallet_address ILIKE ${like}` : sql``
  const list = await rows<Record<string, unknown>>(sql`
    SELECT u.id, u.username, u.email, u.wallet_address, u.role, u.status, u.created_at, u.referral_code,
      (SELECT username FROM users r WHERE r.id = u.referred_by) AS referred_by,
      (SELECT count(*) FROM tasks t WHERE t.creator_id = u.id)::int AS tasks_created,
      (SELECT count(*) FROM submissions s WHERE s.worker_id = u.id)::int AS submissions,
      (SELECT count(*) FROM submissions s WHERE s.worker_id = u.id AND s.status = 'approved')::int AS approved,
      ((SELECT COALESCE(sum(t.reward), 0) FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.worker_id = u.id AND s.status = 'approved')
       + (SELECT COALESCE(sum(e.prize_amount), 0) FROM contest_entries e WHERE e.user_id = u.id AND e.status = 'winner'))::text AS earned
    FROM users u ${f} ORDER BY u.created_at DESC LIMIT 100`)
  return {
    items: list.map((u) => ({
      id: u.id, username: u.username, email: u.email, wallet: u.wallet_address, role: u.role, status: u.status, createdAt: u.created_at,
      referralCode: u.referral_code, referredBy: u.referred_by, tasksCreated: u.tasks_created, submissions: u.submissions, approved: u.approved, earned: u.earned,
    })),
  }
})

route('POST', '/admin/users/:id/status', 'admin', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'User')
  const status = str((await c.json()).status, 6, 9, 'Status')
  if (status !== 'active' && status !== 'suspended') throw new HttpError(400, 'Invalid status.')
  const target = await one<{ role: string }>(sql`SELECT role FROM users WHERE id = ${id}`)
  if (!target) throw new HttpError(404, 'User not found.')
  if (target.role === 'admin' || id === me.id) throw new HttpError(400, 'Administrators cannot be modified.')
  await sql`UPDATE users SET status = ${status} WHERE id = ${id}`
  if (status === 'suspended') await sql`DELETE FROM sessions WHERE user_id = ${id}`
  await audit(me.id, `user.${status}`, id)
})

route('GET', '/admin/reports', 'admin', async (c) => {
  const status = c.url.searchParams.get('status') === 'done' ? sql`r.status <> 'open'` : sql`r.status = 'open'`
  const list = await rows<Record<string, unknown>>(sql`
    SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at, u.username AS reporter,
      COALESCE((SELECT title FROM tasks WHERE id::text = r.target_id), (SELECT title FROM contests WHERE id::text = r.target_id),
               (SELECT username FROM users WHERE id::text = r.target_id)) AS target_label
    FROM reports r JOIN users u ON u.id = r.reporter_id WHERE ${status} ORDER BY r.created_at DESC LIMIT 100`)
  return { items: list.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, targetLabel: r.target_label, reason: r.reason, status: r.status, reporter: r.reporter, createdAt: r.created_at })) }
})

route('POST', '/admin/reports/:id/resolve', 'admin', async (c) => {
  const me = c.user as AuthUser
  const id = uuid(c.params.id, 'Report')
  const action = str((await c.json()).action, 6, 7, 'Action')
  const rep = await one<{ target_type: string; target_id: string; status: string }>(sql`SELECT target_type, target_id, status FROM reports WHERE id = ${id}`)
  if (!rep || rep.status !== 'open') throw new HttpError(404, 'Report not found or already handled.')

  if (action === 'remove' && rep.target_type === 'task') {
    const t = await one<{ creator_id: string; title: string }>(sql`UPDATE tasks SET status = 'removed' WHERE id = ${rep.target_id} RETURNING creator_id, title`)
    if (t) await notify(t.creator_id, 'moderation', 'Task removed', `"${t.title}" was removed by moderation.`)
  } else if (action === 'remove' && rep.target_type === 'contest') {
    const k = await one<{ creator_id: string; title: string }>(sql`UPDATE contests SET status = 'removed' WHERE id = ${rep.target_id} RETURNING creator_id, title`)
    if (k) await notify(k.creator_id, 'moderation', 'Contest removed', `"${k.title}" was removed by moderation.`)
  } else if (action === 'suspend') {
    const uid = rep.target_type === 'user' ? rep.target_id
      : (await one<{ creator_id: string }>(rep.target_type === 'task' ? sql`SELECT creator_id FROM tasks WHERE id = ${rep.target_id}` : sql`SELECT creator_id FROM contests WHERE id = ${rep.target_id}`))?.creator_id
    const target = uid ? await one<{ role: string }>(sql`SELECT role FROM users WHERE id = ${uid}`) : null
    if (!uid || !target || target.role === 'admin') throw new HttpError(400, 'Cannot suspend.')
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${uid}`
    await sql`DELETE FROM sessions WHERE user_id = ${uid}`
  } else if (action !== 'dismiss') {
    throw new HttpError(400, 'Invalid action.')
  }
  await sql`UPDATE reports SET status = ${action === 'dismiss' ? 'dismissed' : 'resolved'}, resolved_by = ${me.id}, resolved_at = now() WHERE id = ${id}`
  await audit(me.id, `report.${action}`, id, { target: rep.target_id })
})

route('GET', '/admin/audit', 'admin', async () => {
  const list = await rows<Record<string, unknown>>(sql`
    SELECT a.id, a.action, a.target, a.created_at, u.username AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 100`)
  return { items: list.map((a) => ({ id: String(a.id), action: a.action, target: a.target, actor: a.actor, createdAt: a.created_at })) }
})

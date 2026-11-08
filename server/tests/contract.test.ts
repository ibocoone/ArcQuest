/* oxlint-disable typescript/no-explicit-any */
// Vérifie que chaque réponse de l'API contient tous les champs que l'interface déclare comme obligatoires.
import { afterAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { sql } from '../db'

const BASE = process.env.TEST_API ?? 'http://localhost:3001'
const SRC = `${import.meta.dir}/../../src`
const hex = () => crypto.randomUUID().replace(/-/g, '').padEnd(64, '0')
const ids: string[] = []

class Client {
  cookie = ''
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const sc = res.headers.get('set-cookie')
    if (sc) this.cookie = sc.split(';')[0]
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any }
  }
}

/** Champs obligatoires (sans « ? ») d'une interface TypeScript d'un fichier source. */
function requiredKeys(file: string, name: string): string[] {
  const src = readFileSync(`${SRC}/${file}`, 'utf8')
  const start = src.search(new RegExp(`interface ${name}\\b[^{]*\\{`))
  if (start < 0) throw new Error(`interface ${name} introuvable dans ${file}`)
  let i = src.indexOf('{', start)
  let depth = 0
  const begin = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    if (src[i] === '}' && --depth === 0) break
  }
  const inner = src.slice(begin + 1, i)
  const keys: string[] = []
  depth = 0
  let buf = ''
  for (const ch of inner) {
    if ('{[('.includes(ch)) depth++
    if ('}])'.includes(ch)) depth--
    if (depth === 0 && (ch === ';' || ch === '\n')) { keys.push(buf); buf = '' } else buf += ch
  }
  keys.push(buf)
  return keys
    .map((k) => k.trim())
    .filter((k) => /^[A-Za-z_]\w*\s*:/.test(k))
    .map((k) => k.split(':')[0]?.trim() ?? '')
}

function check(file: string, name: string, value: any, where: string) {
  expect(value, `${where} : aucun élément pour vérifier ${name}`).toBeTruthy()
  for (const key of requiredKeys(file, name)) {
    expect(value, `${where} : le champ « ${key} » (interface ${name}, ${file}) manque`).toHaveProperty(key)
  }
}

afterAll(async () => {
  if (!ids.length) return
  await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`
  await sql`DELETE FROM reports WHERE reporter_id IN ${sql(ids)}`
  await sql`DELETE FROM audit_log WHERE actor_id IN ${sql(ids)}`
  await sql`DELETE FROM contest_entries WHERE user_id IN ${sql(ids)}`
  await sql`DELETE FROM contests WHERE creator_id IN ${sql(ids)}`
  await sql`DELETE FROM submissions WHERE worker_id IN ${sql(ids)}`
  await sql`DELETE FROM tasks WHERE creator_id IN ${sql(ids)}`
  await sql`DELETE FROM sessions WHERE user_id IN ${sql(ids)}`
  await sql`DELETE FROM users WHERE id IN ${sql(ids)}`
})

test("l'API renvoie tous les champs attendus par chaque écran", async () => {
  const mk = async () => {
    const c = new Client()
    const r = await c.req('POST', '/auth/register', { email: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`, password: 'motdepasse123' })
    expect(r.status).toBe(200)
    ids.push(r.body.user.id)
    return { c, id: r.body.user.id as string, user: r.body.user }
  }
  const A = await mk()
  const B = await mk()
  const addr = () => '0x' + crypto.randomUUID().replace(/-/g, '').padEnd(40, 'a').slice(0, 40)
  await sql`UPDATE users SET wallet_address = ${addr()}, role = 'admin' WHERE id = ${A.id}`
  await sql`UPDATE users SET wallet_address = ${addr()}, referred_by = ${A.id} WHERE id = ${B.id}`

  const t1 = crypto.randomUUID()
  const t2 = crypto.randomUUID()
  const dl = new Date(Date.now() + 5 * 86400_000).toISOString()
  for (const [id, title] of [[t1, 'Tâche A'], [t2, 'Tâche B']] as const) {
    await sql`INSERT INTO tasks (id, creator_id, title, description, instructions, type, reward, slots, deadline, fund_tx, protocol, review_days)
      VALUES (${id}, ${A.id}, ${title}, 'Description de test', 'Instructions de test', 'autre', '0.5', 3, ${dl}, ${hex()}, 2, 3)`
  }
  await sql`INSERT INTO submissions (task_id, worker_id, proof_url, status, claim_at, status_at) VALUES (${t1}, ${B.id}, 'https://example.com/p', 'pending', now(), now())`
  await sql`INSERT INTO submissions (task_id, worker_id, proof_url, status, claim_at, status_at, reviewed_at) VALUES (${t2}, ${B.id}, 'https://example.com/q', 'approved', now(), now(), now())`
  const t3 = crypto.randomUUID()
  await sql`INSERT INTO tasks (id, creator_id, title, description, instructions, type, reward, slots, deadline, fund_tx, protocol, review_days)
    VALUES (${t3}, ${A.id}, 'Tâche C', 'Description de test', 'Instructions de test', 'autre', '0.5', 3, ${dl}, ${hex()}, 2, 3)`
  await sql`INSERT INTO submissions (task_id, worker_id, proof_url, status, reject_reason, claim_at, status_at) VALUES (${t3}, ${B.id}, 'https://example.com/r', 'disputed', 'Refus de test', now(), now())`

  const k1 = crypto.randomUUID()
  const k2 = crypto.randomUUID()
  const prizes = JSON.stringify([{ place: '1er', amount: '0.3' }])
  for (const [id, title] of [[k1, 'Concours A'], [k2, 'Concours B']] as const) {
    await sql`INSERT INTO contests (id, creator_id, title, description, prompt, type, ends_at, slots, prizes, prize_pool, fund_tx, protocol)
      VALUES (${id}, ${A.id}, ${title}, 'Description de test', 'Consigne de test', 'autre', ${dl}, 10, ${prizes}::jsonb, '0.3', ${hex()}, 2)`
  }
  await sql`INSERT INTO contest_entries (contest_id, user_id, note) VALUES (${k1}, ${B.id}, 'Mon idée')`
  await sql`INSERT INTO contest_entries (contest_id, user_id, note, status, prize_place, prize_amount, pay_tx) VALUES (${k2}, ${B.id}, 'Gagnant', 'winner', '1er', '0.3', ${hex()})`
  await sql`INSERT INTO notifications (user_id, kind, title, body, link) VALUES (${A.id}, 'submission', 'Titre', 'Corps', 'jobs:mine')`
  await sql`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (${B.id}, 'task', ${t1}, 'Raison de test')`

  const get = async (who: typeof A, path: string) => {
    const r = await who.c.req('GET', path)
    expect(r.status, `${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(200)
    return r.body
  }
  const first = (body: any, where: string) => {
    expect(Array.isArray(body.items), `${where} : « items » doit être un tableau`).toBe(true)
    return body.items[0]
  }

  check('../src/api.ts'.replace('../src/', ''), 'User', (await get(A, '/me')).user, '/me')
  check('components/TaskOffers.tsx', 'Task', first(await get(B, '/tasks'), '/tasks'), '/tasks')
  check('components/MySubmissions.tsx', 'Item', first(await get(B, '/me/submissions'), '/me/submissions'), '/me/submissions')
  check('components/MyTasks.tsx', 'MyTask', first(await get(A, '/me/tasks'), '/me/tasks'), '/me/tasks')
  check('components/MyTasks.tsx', 'Sub', first(await get(A, `/tasks/${t1}/submissions`), 'submissions'), '/tasks/:id/submissions')
  const contests = first(await get(B, '/contests'), '/contests')
  check('components/ContestsPage.tsx', 'Contest', contests, '/contests')
  expect(Array.isArray(contests.prizes), '/contests : « prizes » doit être un tableau').toBe(true)
  check('components/ContestsPage.tsx', 'MyEntry', first(await get(B, '/me/entries'), '/me/entries'), '/me/entries')
  const mine = first(await get(A, '/me/contests'), '/me/contests')
  check('components/MyContests.tsx', 'MyContest', mine, '/me/contests')
  expect(Array.isArray(mine.prizes), '/me/contests : « prizes » doit être un tableau').toBe(true)
  check('components/MyContests.tsx', 'Entry', first(await get(A, `/contests/${k1}/entries`), 'entries'), '/contests/:id/entries')
  check('components/NotificationsBell.tsx', 'Notif', first(await get(A, '/notifications'), '/notifications'), '/notifications')
  check('components/DashboardHome.tsx', 'Stats', await get(A, '/me/stats'), '/me/stats')
  check('components/EarningsPage.tsx', 'Earning', first(await get(B, '/me/earnings'), '/me/earnings'), '/me/earnings')
  check('components/ReferralsPage.tsx', 'Referral', first(await get(A, '/me/referrals'), '/me/referrals'), '/me/referrals')
  check('components/AdminPage.tsx', 'Overview', await get(A, '/admin/overview'), '/admin/overview')
  check('components/AdminPage.tsx', 'Report', first(await get(A, '/admin/reports'), '/admin/reports'), '/admin/reports')
  check('components/AdminPage.tsx', 'AdminUser', first(await get(A, '/admin/users'), '/admin/users'), '/admin/users')
  check('components/AdminPage.tsx', 'AuditItem', { id: '1', action: 'x', target: null, actor: null, createdAt: 'x', ...first(await get(A, '/admin/audit'), '/admin/audit') }, '/admin/audit')
  check('components/AdminPayments.tsx', 'Payment', first(await get(A, '/admin/payments'), '/admin/payments'), '/admin/payments')
  check('components/AdminFinance.tsx', 'Finance', await get(A, '/admin/finance'), '/admin/finance')
  check('components/AdminItems.tsx', 'Item', first(await get(A, '/admin/items?kind=task'), '/admin/items?kind=task'), '/admin/items?kind=task')
  check('components/AdminItems.tsx', 'Item', first(await get(A, '/admin/items?kind=contest'), '/admin/items?kind=contest'), '/admin/items?kind=contest')
  check('components/AdminDisputes.tsx', 'Dispute', first(await get(A, '/admin/disputes'), '/admin/disputes'), '/admin/disputes')
  check('components/AdminItems.tsx', 'Entry', first(await get(A, `/admin/items/task/${t1}/entries`), 'admin entries'), '/admin/items/task/:id/entries')
})

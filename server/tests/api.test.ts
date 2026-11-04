/* oxlint-disable typescript/no-explicit-any */
import { afterAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sql } from '../db'

// Ces tests s'exécutent contre l'API en cours d'exécution (bun run server) et sa base Postgres.
const BASE = process.env.TEST_API ?? 'http://localhost:3001'
const ids: string[] = []
const taskIds: string[] = []
const contestIds: string[] = []
let n = 0
const rnd = () => crypto.randomUUID().replace(/-/g, '')

class Client {
  cookie = ''
  userId = ''
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const sc = res.headers.get('set-cookie')
    if (sc) this.cookie = sc.split(';')[0]
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    return { status: res.status, body: data }
  }
}

async function emailUser(): Promise<{ c: Client; email: string }> {
  const c = new Client()
  const email = `test_${Date.now()}_${n++}@example.test`
  const r = await c.req('POST', '/auth/register', { email, password: 'motdepasse123' })
  expect(r.status).toBe(200)
  c.userId = r.body.user.id
  ids.push(c.userId)
  return { c, email }
}

async function walletUser(): Promise<{ c: Client; address: string }> {
  const account = privateKeyToAccount(generatePrivateKey())
  const c = new Client()
  const { body: nb } = await c.req('GET', '/auth/nonce')
  const message = `ArcQuest : preuve de propriété du portefeuille\nAdresse : ${account.address}\nNonce : ${nb.nonce}`
  const signature = await account.signMessage({ message })
  const r = await c.req('POST', '/auth/wallet', { address: account.address, message, signature })
  expect(r.status).toBe(200)
  c.userId = r.body.user.id
  ids.push(c.userId)
  return { c, address: account.address.toLowerCase() }
}

async function insertTask(creatorId: string, over: { slots?: number; deadline?: string; status?: string } = {}) {
  const id = crypto.randomUUID()
  const [t] = (await sql`
    INSERT INTO tasks (id, creator_id, title, description, instructions, type, reward, slots, deadline, fund_tx, status)
    VALUES (${id}, ${creatorId}, 'Tâche de test', 'Description de test', 'Instructions de test', 'social', 0.5, ${over.slots ?? 2},
            ${over.deadline ?? new Date(Date.now() + 86_400_000).toISOString()}, ${'0x' + rnd() + rnd()}, ${over.status ?? 'open'})
    RETURNING id`) as { id: string }[]
  taskIds.push(t.id)
  return t.id
}

afterAll(async () => {
  if (ids.length) {
    await sql`DELETE FROM submissions WHERE worker_id IN ${sql(ids)}`
    await sql`DELETE FROM contest_entries WHERE user_id IN ${sql(ids)}`
    await sql`DELETE FROM tasks WHERE creator_id IN ${sql(ids)}`
    await sql`DELETE FROM contests WHERE creator_id IN ${sql(ids)}`
  }
  if (taskIds.length) await sql`DELETE FROM tasks WHERE id IN ${sql(taskIds)}`
  if (contestIds.length) await sql`DELETE FROM contests WHERE id IN ${sql(contestIds)}`
  if (ids.length) {
    await sql`DELETE FROM reports WHERE reporter_id IN ${sql(ids)}`
    await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`
    await sql`DELETE FROM uploads WHERE user_id IN ${sql(ids)}`
    await sql`DELETE FROM audit_log WHERE actor_id IN ${sql(ids)}`
    await sql`DELETE FROM users WHERE id IN ${sql(ids)}`
  }
})

describe('comptes et sessions', () => {
  test('inscription, session, déconnexion', async () => {
    const { c } = await emailUser()
    expect((await c.req('GET', '/me')).body.user).not.toBeNull()
    await c.req('POST', '/auth/logout', {})
    expect((await new Client().req('GET', '/tasks')).status).toBe(401)
  })

  test('e-mail déjà utilisé, mot de passe trop court', async () => {
    const { email } = await emailUser()
    expect((await new Client().req('POST', '/auth/register', { email, password: 'motdepasse123' })).status).toBe(409)
    expect((await new Client().req('POST', '/auth/register', { email: `x_${rnd()}@example.test`, password: 'court' })).status).toBe(400)
  })

  test('connexion : mauvais mot de passe refusé, blocage après trop d\'essais', async () => {
    const { email } = await emailUser()
    const c = new Client()
    expect((await c.req('POST', '/auth/login', { email, password: 'motdepasse123' })).status).toBe(200)
    let last = 0
    for (let i = 0; i < 12; i++) last = (await new Client().req('POST', '/auth/login', { email, password: 'faux-mot-de-passe' })).status
    expect(last).toBe(429)
  })

  test('connexion par portefeuille : signature valide, nonce à usage unique, signature d\'un autre refusée', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const c = new Client()
    const { body } = await c.req('GET', '/auth/nonce')
    const message = `ArcQuest : preuve de propriété du portefeuille\nAdresse : ${account.address}\nNonce : ${body.nonce}`
    const forged = await other.signMessage({ message })
    expect((await c.req('POST', '/auth/wallet', { address: account.address, message, signature: forged })).status).toBe(401)
    const { body: b2 } = await c.req('GET', '/auth/nonce')
    const m2 = `ArcQuest : preuve de propriété du portefeuille\nAdresse : ${account.address}\nNonce : ${b2.nonce}`
    const sig = await account.signMessage({ message: m2 })
    const ok = await c.req('POST', '/auth/wallet', { address: account.address, message: m2, signature: sig })
    expect(ok.status).toBe(200)
    ids.push(ok.body.user.id)
    expect((await new Client().req('POST', '/auth/wallet', { address: account.address, message: m2, signature: sig })).status).toBeGreaterThanOrEqual(400)
  })

  test('liaison d\'un portefeuille à un compte e-mail, et refus s\'il appartient à un autre compte', async () => {
    const { c } = await emailUser()
    const account = privateKeyToAccount(generatePrivateKey())
    const { body } = await c.req('GET', '/auth/nonce')
    const message = `ArcQuest : preuve de propriété du portefeuille\nAdresse : ${account.address}\nNonce : ${body.nonce}`
    const signature = await account.signMessage({ message })
    expect((await c.req('POST', '/me/wallet', { address: account.address, message, signature })).status).toBe(200)
    const { c: c2 } = await emailUser()
    const { body: b2 } = await c2.req('GET', '/auth/nonce')
    const m2 = `ArcQuest : preuve de propriété du portefeuille\nAdresse : ${account.address}\nNonce : ${b2.nonce}`
    expect((await c2.req('POST', '/me/wallet', { address: account.address, message: m2, signature: await account.signMessage({ message: m2 }) })).status).toBe(409)
  })
})

describe('tâches : anti-triche', () => {
  test('publication refusée sans portefeuille lié ou avec un faux paiement', async () => {
    const { c } = await emailUser()
    const payload = { id: crypto.randomUUID(), title: 'Titre', description: 'Description longue', instructions: 'Instructions longues', type: 'social', reward: '0.5', slots: 2, deadline: new Date(Date.now() + 2 * 86_400_000).toISOString(), fundTx: '0x' + rnd() + rnd() }
    expect((await c.req('POST', '/tasks', payload)).status).toBe(400)
    const { c: w } = await walletUser()
    const r = await w.req('POST', '/tasks', payload)
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await w.req('GET', '/tasks')).body.items.find((t: any) => t.id === payload.id)).toBeUndefined()
  }, 40_000)

  test('une soumission par personne, places décomptées, date limite, auto-soumission interdite', async () => {
    const { c: creator } = await walletUser()
    const { c: a } = await walletUser()
    const { c: b } = await walletUser()
    const { c: d } = await walletUser()
    const taskId = await insertTask(creator.userId, { slots: 2 })
    const proof = { proofUrl: 'https://example.com/preuve' }

    expect((await creator.req('POST', `/tasks/${taskId}/submissions`, proof)).status).toBe(400)
    expect((await a.req('POST', `/tasks/${taskId}/submissions`, { note: 'sans preuve' })).status).toBe(400)
    expect((await a.req('POST', `/tasks/${taskId}/submissions`, proof)).status).toBe(200)
    expect((await a.req('POST', `/tasks/${taskId}/submissions`, proof)).status).toBe(409)
    expect((await b.req('POST', `/tasks/${taskId}/submissions`, proof)).status).toBe(200)
    expect((await d.req('POST', `/tasks/${taskId}/submissions`, proof)).status).toBe(409)
    expect((await d.req('GET', `/tasks/${taskId}`)).body.taken).toBe(2)

    const late = await insertTask(creator.userId, { deadline: new Date(Date.now() - 1000).toISOString() })
    expect((await a.req('POST', `/tasks/${late}/submissions`, proof)).status).toBeGreaterThanOrEqual(400)
  })

  test('soumissions simultanées : jamais plus de places que prévu', async () => {
    const { c: creator } = await walletUser()
    const workers = await Promise.all(Array.from({ length: 6 }, () => walletUser()))
    const taskId = await insertTask(creator.userId, { slots: 3 })
    const res = await Promise.all(workers.map((w) => w.c.req('POST', `/tasks/${taskId}/submissions`, { proofUrl: 'https://example.com/p' })))
    expect(res.filter((r) => r.status === 200).length).toBe(3)
    expect(res.filter((r) => r.status === 409).length).toBe(3)
  }, 30_000)

  test('seul le créateur examine ; refus avec motif obligatoire ; la place est libérée', async () => {
    const { c: creator } = await walletUser()
    const { c: worker } = await walletUser()
    const { c: other } = await walletUser()
    const taskId = await insertTask(creator.userId, { slots: 1 })
    await worker.req('POST', `/tasks/${taskId}/submissions`, { proofUrl: 'https://example.com/p' })
    const list = await creator.req('GET', `/tasks/${taskId}/submissions`)
    const sid = list.body.items[0].id as string

    expect((await other.req('GET', `/tasks/${taskId}/submissions`)).status).toBe(403)
    expect((await other.req('POST', `/submissions/${sid}/reject`, { reason: 'Non conforme' })).status).toBe(403)
    expect((await creator.req('POST', `/submissions/${sid}/reject`, {})).status).toBe(400)
    expect((await creator.req('POST', `/submissions/${sid}/reject`, { reason: 'Capture illisible' })).status).toBe(200)
    expect((await creator.req('POST', `/submissions/${sid}/reject`, { reason: 'Encore' })).status).toBe(409)
    const mine = await worker.req('GET', '/me/submissions')
    expect(mine.body.items[0].rejectReason).toBe('Capture illisible')
    expect((await other.req('POST', `/tasks/${taskId}/submissions`, { proofUrl: 'https://example.com/p' })).status).toBe(200)
  })

  test('approbation avec un faux paiement refusée, rien n\'est marqué payé', async () => {
    const { c: creator } = await walletUser()
    const { c: worker } = await walletUser()
    const taskId = await insertTask(creator.userId)
    await worker.req('POST', `/tasks/${taskId}/submissions`, { proofUrl: 'https://example.com/p' })
    const sid = (await creator.req('GET', `/tasks/${taskId}/submissions`)).body.items[0].id as string
    const r = await creator.req('POST', `/submissions/${sid}/approve`, { txHash: '0x' + rnd() + rnd() })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await creator.req('GET', `/tasks/${taskId}/submissions`)).body.items[0].status).toBe('pending')
    expect((await worker.req('GET', '/me/earnings')).body.items.length).toBe(0)
  }, 40_000)
})

describe('preuves, signalements et modération', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

  test('téléversement : seules les images sont acceptées et l\'accès est restreint', async () => {
    const { c } = await walletUser()
    const { c: stranger } = await walletUser()
    const send = async (client: Client, bytes: Uint8Array, name: string) => {
      const form = new FormData()
      form.set('file', new File([new Uint8Array(bytes)], name))
      const res = await fetch(BASE + '/uploads', { method: 'POST', headers: { cookie: client.cookie }, body: form })
      return { status: res.status, body: (await res.json()) as Record<string, any> }
    }
    expect((await send(c, new TextEncoder().encode('<script>alert(1)</script>'), 'x.png')).status).toBe(400)
    const ok = await send(c, png, 'preuve.png')
    expect(ok.status).toBe(200)
    const get = (client: Client) => fetch(`${BASE}/uploads/${ok.body.id}`, { headers: { cookie: client.cookie } })
    expect((await get(c)).status).toBe(200)
    expect((await get(stranger)).status).toBe(403)
  })

  test('un signalement est traité par un administrateur, qui peut retirer et suspendre', async () => {
    const { c: creator } = await walletUser()
    const { c: reporter } = await walletUser()
    const { c: admin } = await emailUser()
    const taskId = await insertTask(creator.userId)
    expect((await reporter.req('POST', '/reports', { targetType: 'task', targetId: taskId, reason: 'Arnaque probable' })).status).toBe(200)
    expect((await reporter.req('POST', '/reports', { targetType: 'task', targetId: taskId, reason: 'Arnaque probable' })).status).toBe(409)

    expect((await reporter.req('GET', '/admin/reports')).status).toBe(403)
    await sql`UPDATE users SET role = 'admin' WHERE id = ${admin.userId}`
    const reports = await admin.req('GET', '/admin/reports')
    const rep = reports.body.items.find((r: any) => r.targetId === taskId)
    expect(rep).toBeDefined()
    expect((await admin.req('POST', `/admin/reports/${rep.id}/resolve`, { action: 'remove' })).status).toBe(200)
    expect((await reporter.req('GET', `/tasks/${taskId}`)).status).toBe(404)

    expect((await admin.req('POST', `/admin/users/${creator.userId}/status`, { status: 'suspended' })).status).toBe(200)
    expect((await creator.req('GET', '/tasks')).status).toBeGreaterThanOrEqual(401)
    expect((await admin.req('POST', `/admin/users/${admin.userId}/status`, { status: 'suspended' })).status).toBe(400)
  })
  test('les données financières et la modération de contenu sont réservées aux administrateurs', async () => {
    const { c: user } = await emailUser()
    const { c: admin } = await emailUser()
    for (const path of ['/admin/finance', '/admin/payments', '/admin/items?kind=task', '/admin/users']) {
      expect((await user.req('GET', path)).status).toBe(403)
    }
    await sql`UPDATE users SET role = 'admin' WHERE id = ${admin.userId}`
    const fin = await admin.req('GET', '/admin/finance')
    expect(fin.status).toBe(200)
    expect(fin.body.daily.length).toBeGreaterThanOrEqual(7)
    expect((await admin.req('GET', '/admin/payments')).status).toBe(200)
    expect((await admin.req('GET', '/admin/items?kind=bad')).status).toBe(400)

    const taskId = await insertTask(admin.userId)
    const items = await admin.req('GET', '/admin/items?kind=task')
    expect(items.body.items.some((t: any) => t.id === taskId)).toBe(true)
    expect((await admin.req('POST', `/admin/items/task/${taskId}/status`, { status: 'removed' })).status).toBe(200)
    expect((await admin.req('POST', `/admin/items/task/${taskId}/status`, { status: 'open' })).status).toBe(200)
    expect((await admin.req('GET', `/admin/items/task/${taskId}/entries`)).status).toBe(200)
    expect((await user.req('POST', `/admin/items/task/${taskId}/status`, { status: 'removed' })).status).toBe(403)
    const users = await admin.req('GET', '/admin/users')
    expect(users.body.items[0]).toHaveProperty('earned')
  })
})

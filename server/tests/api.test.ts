/* oxlint-disable typescript/no-explicit-any */
import { afterAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sql } from '../db'
import { outboxFor } from '../email'
import { notify } from '../http'

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
  constructor(private base = BASE) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(this.base + path, {
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

async function emailUser(base = BASE): Promise<{ c: Client; email: string }> {
  const c = new Client(base)
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
  const message = `ArcQuest : proof of wallet ownership\nAddress: ${account.address}\nNonce: ${nb.nonce}`
  const signature = await account.signMessage({ message })
  const r = await c.req('POST', '/auth/wallet', { address: account.address, message, signature })
  expect(r.status).toBe(200)
  c.userId = r.body.user.id
  ids.push(c.userId)
  return { c, address: account.address.toLowerCase() }
}

async function insertTask(creatorId: string, over: { slots?: number; deadline?: string; status?: string; protocol?: number } = {}) {
  const id = crypto.randomUUID()
  const [t] = (await sql`
    INSERT INTO tasks (id, creator_id, title, description, instructions, type, reward, slots, deadline, fund_tx, status, protocol, review_days)
    VALUES (${id}, ${creatorId}, 'Tâche de test', 'Description de test', 'Instructions de test', 'social', 0.5, ${over.slots ?? 2},
            ${over.deadline ?? new Date(Date.now() + 86_400_000).toISOString()}, ${'0x' + rnd() + rnd()}, ${over.status ?? 'open'}, ${over.protocol ?? 2}, 3)
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
  await sql`DELETE FROM email_outbox WHERE to_email LIKE 'test\_%@example.test'`
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
    const message = `ArcQuest : proof of wallet ownership\nAddress: ${account.address}\nNonce: ${body.nonce}`
    const forged = await other.signMessage({ message })
    expect((await c.req('POST', '/auth/wallet', { address: account.address, message, signature: forged })).status).toBe(401)
    const { body: b2 } = await c.req('GET', '/auth/nonce')
    const m2 = `ArcQuest : proof of wallet ownership\nAddress: ${account.address}\nNonce: ${b2.nonce}`
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
    const message = `ArcQuest : proof of wallet ownership\nAddress: ${account.address}\nNonce: ${body.nonce}`
    const signature = await account.signMessage({ message })
    expect((await c.req('POST', '/me/wallet', { address: account.address, message, signature })).status).toBe(200)
    const { c: c2 } = await emailUser()
    const { body: b2 } = await c2.req('GET', '/auth/nonce')
    const m2 = `ArcQuest : proof of wallet ownership\nAddress: ${account.address}\nNonce: ${b2.nonce}`
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

  test('autorisation de soumission : une par personne, places décomptées, date limite, auto-soumission interdite', async () => {
    const { c: creator } = await walletUser()
    const { c: a } = await walletUser()
    const { c: b } = await walletUser()
    const { c: d } = await walletUser()
    const taskId = await insertTask(creator.userId, { slots: 2 })
    const proof = { proofUrl: 'https://example.com/preuve' }
    const permit = (c: Client, id: string, body: object) => c.req('POST', `/tasks/${id}/claim-permit`, body)

    expect((await permit(creator, taskId, proof)).status).toBe(400)
    expect((await permit(a, taskId, { note: 'sans preuve' })).status).toBe(400)
    const first = await permit(a, taskId, proof)
    expect(first.status).toBe(200)
    expect(first.body.signature).toMatch(/^0x[0-9a-f]{130}$/i)
    const left = first.body.expiry - Math.floor(Date.now() / 1000)
    expect(left).toBeGreaterThan(25 * 60)
    expect(left).toBeLessThanOrEqual(30 * 60)
    // un brouillon peut être redemandé (transaction échouée), il ne prend qu'une place
    expect((await permit(a, taskId, proof)).status).toBe(200)
    expect((await permit(b, taskId, proof)).status).toBe(200)
    expect((await permit(d, taskId, proof)).status).toBe(409)
    expect((await d.req('GET', `/tasks/${taskId}`)).body.taken).toBe(2)

    const late = await insertTask(creator.userId, { deadline: new Date(Date.now() - 1000).toISOString() })
    expect((await permit(a, late, proof)).status).toBeGreaterThanOrEqual(400)
    const legacy = await insertTask(creator.userId, { protocol: 1 })
    expect((await permit(a, legacy, proof)).status).toBe(410)
  })

  test('autorisations simultanées : jamais plus de places que prévu', async () => {
    const { c: creator } = await walletUser()
    const workers = await Promise.all(Array.from({ length: 6 }, () => walletUser()))
    const taskId = await insertTask(creator.userId, { slots: 3 })
    const res = await Promise.all(workers.map((w) => w.c.req('POST', `/tasks/${taskId}/claim-permit`, { proofUrl: 'https://example.com/p' })))
    expect(res.filter((r) => r.status === 200).length).toBe(3)
    expect(res.filter((r) => r.status === 409).length).toBe(3)
  }, 30_000)

  test('sans enregistrement dans le contrat, la soumission reste un brouillon invisible du créateur', async () => {
    const { c: creator } = await walletUser()
    const { c: worker } = await walletUser()
    const { c: other } = await walletUser()
    const taskId = await insertTask(creator.userId, { slots: 1 })
    const p = await worker.req('POST', `/tasks/${taskId}/claim-permit`, { proofUrl: 'https://example.com/p' })
    const sid = p.body.submissionId as string

    expect((await worker.req('POST', `/submissions/${sid}/sync`, {})).body.status).toBe('draft')
    expect((await other.req('POST', `/submissions/${sid}/sync`, {})).status).toBe(403)
    expect((await creator.req('GET', `/tasks/${taskId}/submissions`)).body.items.length).toBe(0)
    expect((await worker.req('GET', '/me/submissions')).body.items.length).toBe(0)
    expect((await other.req('GET', `/tasks/${taskId}/submissions`)).status).toBe(403)
    // le motif de refus exige un refus réel dans le contrat, et seulement du créateur
    expect((await creator.req('POST', `/submissions/${sid}/reject-reason`, { reason: 'Capture illisible' })).status).toBe(409)
    expect((await other.req('POST', `/submissions/${sid}/reject-reason`, { reason: 'Capture illisible' })).status).toBe(403)
    expect((await creator.req('POST', `/submissions/${sid}/reject-reason`, {})).status).toBe(400)
    // les anciennes routes de paiement déclaratif n'existent plus
    expect((await creator.req('POST', `/submissions/${sid}/approve`, { txHash: '0x' + rnd() + rnd() })).status).toBe(404)
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
    for (const path of ['/admin/finance', '/admin/payments', '/admin/disputes', '/admin/items?kind=task', '/admin/users']) {
      expect((await user.req('GET', path)).status).toBe(403)
    }
    await sql`UPDATE users SET role = 'admin' WHERE id = ${admin.userId}`
    const fin = await admin.req('GET', '/admin/finance')
    expect(fin.status).toBe(200)
    expect(fin.body.daily.length).toBeGreaterThanOrEqual(7)
    expect((await admin.req('GET', '/admin/payments')).status).toBe(200)
    expect((await admin.req('GET', '/admin/disputes')).status).toBe(200)
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

const token = (mail: { body: string } | undefined, kind: 'verify' | 'reset') => mail?.body.match(new RegExp(`\\?${kind}=([0-9a-f]{64})`))?.[1] ?? ''

describe('e-mails : confirmation, mot de passe oublié, notifications', () => {
  test('confirmation d\'adresse : un seul usage, jeton inventé refusé', async () => {
    const { c, email } = await emailUser()
    const mail = (await outboxFor(email)).find((m) => /Confirm your email/.test(m.subject))
    expect(mail).toBeDefined()
    const t = token(mail, 'verify')
    expect(t).toHaveLength(64)
    expect((await c.req('GET', '/me')).body.user.emailVerified).toBe(false)
    expect((await c.req('POST', '/auth/verify', { token: 'a'.repeat(64) })).status).toBe(400)
    expect((await c.req('POST', '/auth/verify', { token: t })).status).toBe(200)
    expect((await c.req('GET', '/me')).body.user.emailVerified).toBe(true)
    expect((await c.req('POST', '/auth/verify', { token: t })).status).toBe(400)
    expect((await c.req('POST', '/auth/resend-verification', {})).body.alreadyVerified).toBe(true)
  })

  test('mot de passe oublié : réponse identique, lien à usage unique, anciennes sessions coupées', async () => {
    const { c, email } = await emailUser()
    const ghost = `test_ghost_${Date.now()}@example.test`
    const a = await new Client().req('POST', '/auth/forgot', { email })
    const b = await new Client().req('POST', '/auth/forgot', { email: ghost })
    expect(a.status).toBe(200)
    expect(b.body).toEqual(a.body)
    expect((await outboxFor(ghost)).length).toBe(0)

    const t = token((await outboxFor(email)).find((m) => /Reset your/.test(m.subject)), 'reset')
    expect(t).toHaveLength(64)
    expect((await new Client().req('POST', '/auth/reset', { token: t, password: 'court' })).status).toBe(400)
    expect((await new Client().req('POST', '/auth/reset', { token: 'b'.repeat(64), password: 'nouveau-mot-de-passe' })).status).toBe(400)
    expect((await new Client().req('POST', '/auth/reset', { token: t, password: 'nouveau-mot-de-passe' })).status).toBe(200)
    // le lien ne marche qu'une fois ; l'ancien mot de passe et l'ancienne session ne marchent plus
    expect((await new Client().req('POST', '/auth/reset', { token: t, password: 'encore-un-autre' })).status).toBe(400)
    expect((await new Client().req('POST', '/auth/login', { email, password: 'motdepasse123' })).status).toBe(401)
    expect((await new Client().req('POST', '/auth/login', { email, password: 'nouveau-mot-de-passe' })).status).toBe(200)
    expect((await c.req('GET', '/me')).body.user).toBeNull()
  })

  test('un nouveau lien annule le précédent ; un lien expiré est refusé ; trop de demandes bloquées', async () => {
    const { email } = await emailUser()
    const k = new Client()
    await k.req('POST', '/auth/forgot', { email })
    const first = token((await outboxFor(email)).filter((m) => /Reset your/.test(m.subject)).slice(-1)[0], 'reset')
    await k.req('POST', '/auth/forgot', { email })
    const second = token((await outboxFor(email)).filter((m) => /Reset your/.test(m.subject)).slice(-1)[0], 'reset')
    expect(second).not.toBe(first)
    expect((await k.req('POST', '/auth/reset', { token: first, password: 'nouveau-mot-de-passe' })).status).toBe(400)
    await sql`UPDATE email_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = ${email}) AND kind = 'reset'`
    expect((await k.req('POST', '/auth/reset', { token: second, password: 'nouveau-mot-de-passe' })).status).toBe(400)
    await k.req('POST', '/auth/forgot', { email })
    expect((await k.req('POST', '/auth/forgot', { email })).status).toBe(429)
  })

  test('e-mail de notification : seulement si l\'adresse est confirmée et l\'option activée', async () => {
    const { c, email } = await emailUser()
    const uid = c.userId
    const count = async () => (await outboxFor(email)).filter((m) => m.subject === 'Payment received').length
    await notify(uid, 'paid', 'Payment received', '0.05 USDC were added to your balance.')
    await Bun.sleep(300)
    expect(await count()).toBe(0)
    await sql`UPDATE users SET email_verified_at = now() WHERE id = ${uid}`
    await notify(uid, 'paid', 'Payment received', '0.05 USDC were added to your balance.')
    await Bun.sleep(300)
    expect(await count()).toBe(1)
    expect((await c.req('POST', '/me/settings', { emailNotifications: false })).status).toBe(200)
    await notify(uid, 'paid', 'Payment received', '0.05 USDC were added to your balance.')
    await Bun.sleep(300)
    expect(await count()).toBe(1)
    expect((await c.req('POST', '/me/settings', { emailNotifications: 'oui' })).status).toBe(400)
  })

  test('avec l\'envoi d\'e-mails actif : publier ou soumettre exige une adresse confirmée', async () => {
    const port = 3099
    const proc = Bun.spawn(['bun', 'run', 'server/index.ts'], { env: { ...process.env, API_PORT: String(port), PORT: String(port), REQUIRE_EMAIL_VERIFICATION: '1' }, stdout: 'ignore', stderr: 'ignore' })
    try {
      const base = `http://localhost:${port}`
      for (let i = 0; i < 40; i++) { if ((await fetch(base + '/me').catch(() => null))?.ok) break; await Bun.sleep(250) }
      const { c, email } = await emailUser(base)
      const { c: creator } = await walletUser()
      const taskId = await insertTask(creator.userId)
      expect((await c.req('GET', '/me')).body.user.verificationRequired).toBe(true)
      const blocked = await c.req('POST', `/tasks/${taskId}/claim-permit`, { proofUrl: 'https://example.com/p' })
      expect(blocked.status).toBe(403)
      expect(blocked.body.error).toMatch(/Verify your email/)
      expect((await c.req('POST', '/tasks', {})).status).toBe(403)
      expect((await c.req('POST', '/contests', {})).status).toBe(403)
      const t = token((await outboxFor(email)).find((m) => /Confirm your email/.test(m.subject)), 'verify')
      expect((await c.req('POST', '/auth/verify', { token: t })).status).toBe(200)
      // une fois confirmée, la demande passe l'étape de vérification (elle est ensuite refusée pour une autre raison : pas de portefeuille lié)
      const after = await c.req('POST', `/tasks/${taskId}/claim-permit`, { proofUrl: 'https://example.com/p' })
      expect(after.status).toBe(400)
      expect(after.body.error).toMatch(/Link a wallet/)
      // un compte portefeuille n'est pas concerné
      const w = await walletUser()
      expect((await w.c.req('POST', '/tasks/' + taskId + '/claim-permit', {})).status).not.toBe(403)
    } finally { proc.kill() }
  }, 30_000)
})

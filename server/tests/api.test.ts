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

  test('signature de portefeuille : une longue signature de compte intelligent n\'est plus refusée pour sa taille', async () => {
    const c = new Client()
    const { body: n } = await c.req('GET', '/auth/nonce')
    const address = '0x' + '1'.repeat(40)
    const message = `ArcQuest: proof of wallet ownership\nAddress: ${address}\nNonce: ${n.nonce}`
    const r = await c.req('POST', '/auth/wallet', { address, message, signature: '0x' + 'ab'.repeat(1800) })
    // rejetée parce que la signature est fausse, pas parce qu'elle est trop longue
    expect(r.status).not.toBe(400)
    expect(String(r.body.error)).toMatch(/Invalid signature/)
  })

  test('diagnostic e-mail : réservé aux administrateurs, avec un message clair si rien n\'est configuré', async () => {
    const { c: user } = await emailUser()
    expect((await user.req('GET', '/admin/email-status')).status).toBe(403)
    expect((await user.req('POST', '/admin/email-test', { to: 'x@example.test' })).status).toBe(403)
    const { c: admin, email: adminEmail } = await emailUser()
    await sql`UPDATE users SET role = 'admin' WHERE email = ${adminEmail}`
    const st = await admin.req('GET', '/admin/email-status')
    expect(st.status).toBe(200)
    expect(st.body.configured).toBe(false)
    expect(Array.isArray(st.body.recentErrors)).toBe(true)
    const t = await admin.req('POST', '/admin/email-test', { to: 'x@example.test' })
    expect(t.status).toBe(200)
    expect(t.body.ok).toBe(false)
    expect(String(t.body.error)).toMatch(/BREVO_API_KEY/)
    expect((await admin.req('POST', '/admin/email-test', { to: 'not-an-email' })).status).toBe(400)
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

// ── Classement, liens X / Telegram, ajout d'un e-mail ───────────────────────

async function approve(creatorId: string, workerId: string, daysAgo = 0) {
  const taskId = await insertTask(creatorId)
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  await sql`INSERT INTO submissions (task_id, worker_id, status, proof_url, claim_at, status_at, created_at)
            VALUES (${taskId}, ${workerId}, 'approved', 'https://example.test/proof', ${at}, ${at}, ${at})`
}

describe('classement', () => {
  test('classe par gains, tâches et créateurs, en respectant visibilité, suspension et période', async () => {
    const boss = await emailUser()
    const a = await emailUser(), b = await emailUser(), c = await emailUser(), d = await emailUser(), e = await emailUser()
    for (let i = 0; i < 3; i++) await approve(boss.c.userId, a.c.userId)
    await approve(boss.c.userId, b.c.userId)
    for (let i = 0; i < 2; i++) await approve(boss.c.userId, c.c.userId, 45)
    for (let i = 0; i < 5; i++) await approve(boss.c.userId, d.c.userId)
    await approve(boss.c.userId, e.c.userId)
    const nameOf = async (x: { c: Client }) => (await x.c.req('GET', '/me')).body.user.username as string
    const [na, nb, nc, nd, ne, nboss] = await Promise.all([nameOf(a), nameOf(b), nameOf(c), nameOf(d), nameOf(e), nameOf(boss)])
    await sql`UPDATE users SET leaderboard_visible = false WHERE id = ${d.c.userId}`
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${e.c.userId}`
    const viewer = a.c

    const all = await viewer.req('GET', '/leaderboard?metric=earned&period=all')
    expect(all.status).toBe(200)
    const ours = (res: any, names: string[]) => (res.body.items as any[]).filter((i) => names.includes(i.username))
    const order = ours(all, [na, nb, nc, nd, ne]).map((i) => i.username)
    expect(order).toEqual([na, nc, nb]) // A 1.5 > C 1.0 > B 0.5 ; D masqué, E suspendu
    expect(ours(all, [na])[0].tasks).toBe(3)
    expect(Number(ours(all, [na])[0].earned)).toBeCloseTo(1.5, 6)
    expect(all.body.me.username).toBe(na)
    expect(all.body.me.isMe).toBe(true)
    expect(ours(all, [na])[0].rank).toBeLessThan(ours(all, [nb])[0].rank)

    const days30 = await viewer.req('GET', '/leaderboard?metric=earned&period=30d')
    expect(ours(days30, [na, nb, nc]).map((i) => i.username)).toEqual([na, nb]) // C date de plus de 30 jours

    const tasks = await viewer.req('GET', '/leaderboard?metric=tasks&period=all')
    expect(ours(tasks, [na, nb, nc]).map((i) => i.username)).toEqual([na, nc, nb])

    const creators = await viewer.req('GET', '/leaderboard?metric=creators&period=all')
    const bossRow = ours(creators, [nboss])[0]
    expect(Number(bossRow.earned)).toBeCloseTo(0.5 * (3 + 1 + 2 + 5 + 1), 6)

    // quelqu'un sans paiement n'est pas classé
    const nobody = await emailUser()
    const r = await nobody.c.req('GET', '/leaderboard')
    expect(r.status).toBe(200)
    expect(r.body.me).toBeNull()
    // accès réservé aux comptes connectés
    expect((await new Client().req('GET', '/leaderboard')).status).toBe(401)
    // valeurs inconnues : retombent sur les réglages par défaut
    expect((await viewer.req('GET', '/leaderboard?metric=x&period=y')).body.metric).toBe('earned')
  })
})

describe('liens X et Telegram', () => {
  test('validation, normalisation et confidentialité sur le classement', async () => {
    const boss = await emailUser()
    const u = await emailUser()
    await approve(boss.c.userId, u.c.userId)
    const name = (await u.c.req('GET', '/me')).body.user.username as string
    const mine = async () => ((await u.c.req('GET', '/leaderboard')).body.items as any[]).find((i) => i.username === name)

    expect((await u.c.req('POST', '/me/social', { xHandle: 'pas valide!' })).status).toBe(400)
    expect((await u.c.req('POST', '/me/social', { telegramHandle: 'abc' })).status).toBe(400)
    expect((await u.c.req('POST', '/me/social', { leaderboardVisible: 'oui' })).status).toBe(400)

    const ok = await u.c.req('POST', '/me/social', { xHandle: 'https://x.com/@ArcQuest_app?s=1', telegramHandle: '@Ibrahim7910' })
    expect(ok.status).toBe(200)
    expect(ok.body.xHandle).toBe('ArcQuest_app')
    expect(ok.body.telegramHandle).toBe('Ibrahim7910')
    const me = (await u.c.req('GET', '/me')).body.user
    expect(me.xHandle).toBe('ArcQuest_app')
    expect(me.showLinks).toBe(false)

    expect((await mine()).links).toBeNull() // privés par défaut
    await u.c.req('POST', '/me/social', { showLinks: true })
    expect((await mine()).links).toEqual({ x: 'ArcQuest_app', telegram: 'Ibrahim7910' })

    // effacer un lien sans toucher à l'autre
    await u.c.req('POST', '/me/social', { xHandle: '' })
    expect((await mine()).links).toEqual({ x: null, telegram: 'Ibrahim7910' })

    // se retirer du classement
    await u.c.req('POST', '/me/social', { leaderboardVisible: false })
    expect(await mine()).toBeUndefined()
  })
})

describe('ajout d\'une adresse e-mail à un compte portefeuille', () => {
  test('lien de confirmation, adresse déjà prise, limites', async () => {
    const w = await walletUser()
    expect((await w.c.req('POST', '/me/email', { email: 'pas-un-email' })).status).toBe(400)
    const email = `test_link_${rnd().slice(0, 10)}@example.test`
    expect((await w.c.req('POST', '/me/email', { email })).status).toBe(200)
    const mail = (await outboxFor(email))[0]
    expect(mail?.body).toContain('?verify=')
    const token = (mail?.body.match(/\?verify=([0-9a-f]{64})/) as RegExpMatchArray)[1]
    // tant que le lien n'est pas utilisé, rien n'est enregistré
    expect((await w.c.req('GET', '/me')).body.user.email).toBeNull()
    const v = await new Client().req('POST', '/auth/verify', { token })
    expect(v.status).toBe(200)
    expect(v.body.linked).toBe(true)
    const me = (await w.c.req('GET', '/me')).body.user
    expect(me.email).toBe(email)
    expect(me.emailVerified).toBe(true)
    expect((await new Client().req('POST', '/auth/verify', { token })).status).toBe(400) // usage unique
    expect((await w.c.req('POST', '/me/email', { email: `x_${email}` })).status).toBe(400) // a déjà une adresse

    // adresse déjà utilisée par un autre compte : même réponse, aucun e-mail envoyé
    const w2 = await walletUser()
    const r = await w2.c.req('POST', '/me/email', { email })
    expect(r.status).toBe(200)
    expect((await outboxFor(email)).length).toBe(1)

    // limite : 3 demandes par heure
    const w3 = await walletUser()
    for (let i = 0; i < 3; i++) expect((await w3.c.req('POST', '/me/email', { email: `test_rl${i}_${rnd().slice(0, 8)}@example.test` })).status).toBe(200)
    expect((await w3.c.req('POST', '/me/email', { email: `test_rl9_${rnd().slice(0, 8)}@example.test` })).status).toBe(429)
  })
})

import { isAddress } from 'viem'
import { verifyWalletSignature } from '../chain'
import { one, sql } from '../db'
import { sendVerification } from '../email'
import { COOKIE, baseUrl, HttpError, createSession, publicUser, rateLimit, route, sha256, str, type AuthUser } from '../http'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function referralCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALPHABET[b % ALPHABET.length]).join('')
}

async function uniqueUsername(base: string): Promise<string> {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'membre'
  let name = clean
  while (await one(sql`SELECT 1 FROM users WHERE username = ${name}`)) {
    name = clean + Math.random().toString(36).slice(2, 5)
  }
  return name
}

async function referrerId(code: unknown): Promise<string | null> {
  if (typeof code !== 'string' || !code.trim()) return null
  const r = await one<{ id: string }>(sql`SELECT id FROM users WHERE referral_code = ${code.trim().toUpperCase()} AND status = 'active'`)
  return r?.id ?? null
}

async function startSession(c: { setCookie: (v: string, s: number) => void }, userId: string): Promise<void> {
  c.setCookie(await createSession(userId), 30 * 86_400)
}

/** Consomme un nonce valide et vérifie la signature du message. Retourne l'adresse en minuscules. */
async function checkWalletProof(body: Record<string, unknown>): Promise<string> {
  const address = str(body.address, 42, 42, 'Address')
  const message = str(body.message, 10, 500, 'Message')
  const signature = str(body.signature, 10, 16_000, 'Signature')
  if (!isAddress(address)) throw new HttpError(400, 'Invalid address.')
  const nonce = /Nonce ?: ?([0-9a-f]{32})/.exec(message)?.[1]
  const claimed = /(?:Address|Adresse) ?: ?(0x[0-9a-fA-F]{40})/.exec(message)?.[1]
  if (!nonce || claimed?.toLowerCase() !== address.toLowerCase()) throw new HttpError(400, 'Invalid sign-in message.')
  const used = await one(sql`DELETE FROM nonces WHERE nonce = ${nonce} AND expires_at > now() RETURNING nonce`)
  if (!used) throw new HttpError(400, 'Message expired. Please try again.')
  const valid = await verifyWalletSignature(address as `0x${string}`, message, signature as `0x${string}`)
  if (!valid) throw new HttpError(401, 'Invalid signature.')
  return address.toLowerCase()
}

async function promoteIfAdmin(u: { id: string; email?: string | null; wallet?: string | null }): Promise<void> {
  const isAdmin = (u.email && ADMIN_EMAILS.includes(u.email)) || (u.wallet && ADMIN_WALLETS.includes(u.wallet))
  if (isAdmin) await sql`UPDATE users SET role = 'admin' WHERE id = ${u.id}`
}

route('POST', '/auth/register', 'none', async (c) => {
  const b = await c.json()
  const email = str(b.email, 5, 254, 'Email').toLowerCase()
  const password = str(b.password, 8, 128, 'Password')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email address.')
  rateLimit('register:all', 60, 3_600_000)
  rateLimit(`register:${email}`, 5, 3_600_000)
  if (await one(sql`SELECT 1 FROM users WHERE email = ${email}`)) throw new HttpError(409, 'An account with this email already exists.')

  const local = email.split('@')[0] ?? 'member'
  const username = await uniqueUsername(local)
  const hash = await Bun.password.hash(password)
  const ref = await referrerId(b.referralCode)
  const u = await one<AuthUser>(sql`
    INSERT INTO users (email, password_hash, username, display_name, referral_code, referred_by)
    VALUES (${email}, ${hash}, ${username}, ${local}, ${referralCode()}, ${ref})
    RETURNING id, email, username, display_name, wallet_address, referral_code, role, status, created_at, email_verified_at, email_notifications`)
  if (!u) throw new HttpError(500, 'Could not create the account.')
  await promoteIfAdmin({ id: u.id, email })
  await startSession(c, u.id)
  void sendVerification(u.id, email, baseUrl(c)).catch((e) => console.error('[email] verification failed:', e instanceof Error ? e.message : e))
  const fresh = await one<AuthUser>(sql`SELECT id, email, username, display_name, wallet_address, referral_code, role, status, created_at, email_verified_at, email_notifications FROM users WHERE id = ${u.id}`)
  return { user: publicUser(fresh ?? u) }
})

route('POST', '/auth/login', 'none', async (c) => {
  const b = await c.json()
  const email = str(b.email, 5, 254, 'Email').toLowerCase()
  const password = str(b.password, 1, 128, 'Password')
  rateLimit(`login:${email}`, 10, 15 * 60_000)
  const fail = new HttpError(401, 'Incorrect email or password.')
  const u = await one<AuthUser & { password_hash: string | null }>(sql`
    SELECT id, email, username, display_name, wallet_address, referral_code, role, status, created_at, email_verified_at, email_notifications, password_hash
    FROM users WHERE email = ${email}`)
  if (!u?.password_hash || !(await Bun.password.verify(password, u.password_hash))) throw fail
  if (u.status === 'suspended') throw new HttpError(403, 'This account is suspended.')
  await promoteIfAdmin({ id: u.id, email })
  await startSession(c, u.id)
  return { user: publicUser(u) }
})

route('GET', '/auth/nonce', 'none', async () => {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')
  await sql`DELETE FROM nonces WHERE expires_at < now()`
  await sql`INSERT INTO nonces (nonce, expires_at) VALUES (${nonce}, now() + interval '10 minutes')`
  return { nonce }
})

route('POST', '/auth/wallet', 'none', async (c) => {
  const b = await c.json()
  const address = await checkWalletProof(b)
  rateLimit(`wallet:${address}`, 20, 15 * 60_000)
  let u = await one<AuthUser>(sql`
    SELECT id, email, username, display_name, wallet_address, referral_code, role, status, created_at, email_verified_at, email_notifications FROM users WHERE wallet_address = ${address}`)
  if (!u) {
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`
    const username = await uniqueUsername(`wallet_${address.slice(2, 8)}`)
    const ref = await referrerId(b.referralCode)
    u = await one<AuthUser>(sql`
      INSERT INTO users (wallet_address, username, display_name, referral_code, referred_by)
      VALUES (${address}, ${username}, ${short}, ${referralCode()}, ${ref})
      RETURNING id, email, username, display_name, wallet_address, referral_code, role, status, created_at, email_verified_at, email_notifications`)
  }
  if (!u) throw new HttpError(500, 'Could not sign in.')
  if (u.status === 'suspended') throw new HttpError(403, 'This account is suspended.')
  await promoteIfAdmin({ id: u.id, wallet: address })
  await startSession(c, u.id)
  const fresh = await one<AuthUser>(sql`SELECT id, email, username, display_name, wallet_address, referral_code, role, status, created_at, email_verified_at, email_notifications FROM users WHERE id = ${u.id}`)
  return { user: publicUser(fresh ?? u) }
})

route('POST', '/auth/logout', 'none', async (c) => {
  const token = (c.req.headers.get('cookie') ?? '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(decodeURIComponent(token))}`
  c.setCookie('', 0)
  return { ok: true }
})

route('GET', '/me', 'none', async (c) => {
  const u = c.user
  if (!u || u.status !== 'active') return { user: null }
  // L'appartenance à ADMIN_EMAILS / ADMIN_WALLETS est revérifiée à chaque chargement du profil
  const wasAdmin = u.role === 'admin'
  if (!wasAdmin) await promoteIfAdmin({ id: u.id, email: u.email, wallet: u.wallet_address })
  const shouldBeAdmin = wasAdmin || (!!u.email && ADMIN_EMAILS.includes(u.email)) || (!!u.wallet_address && ADMIN_WALLETS.includes(u.wallet_address))
  return { user: publicUser(shouldBeAdmin ? { ...u, role: 'admin' } : u) }
})

/** Lie un portefeuille au compte courant (preuve de propriété par signature). */
route('POST', '/me/wallet', 'user', async (c) => {
  const address = await checkWalletProof(await c.json())
  const me = c.user as AuthUser
  if (me.wallet_address && me.wallet_address !== address) throw new HttpError(409, 'A different wallet is already linked to this account.')
  const taken = await one(sql`SELECT 1 FROM users WHERE wallet_address = ${address} AND id <> ${me.id}`)
  if (taken) throw new HttpError(409, 'This wallet is already linked to another account.')
  await sql`UPDATE users SET wallet_address = ${address} WHERE id = ${me.id}`
  return { walletAddress: address }
})

route('POST', '/me/password', 'user', async (c) => {
  const b = await c.json()
  const me = c.user as AuthUser
  const current = str(b.current, 1, 128, 'Current password')
  const next = str(b.next, 8, 128, 'New password')
  rateLimit(`pwd:${me.id}`, 10, 15 * 60_000)
  const row = await one<{ password_hash: string | null }>(sql`SELECT password_hash FROM users WHERE id = ${me.id}`)
  if (!row?.password_hash) throw new HttpError(400, "This account does not use a password.")
  if (!(await Bun.password.verify(current, row.password_hash))) throw new HttpError(401, 'Current password is incorrect.')
  await sql`UPDATE users SET password_hash = ${await Bun.password.hash(next)} WHERE id = ${me.id}`
  return { ok: true }
})

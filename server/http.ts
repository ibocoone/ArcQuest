import { one, sql } from './db'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface AuthUser {
  id: string
  email: string | null
  username: string
  display_name: string
  wallet_address: string | null
  referral_code: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  created_at: Date
}

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  user: AuthUser | null
  headers: Headers
  json: () => Promise<Record<string, unknown>>
  setCookie: (value: string, maxAgeSec: number) => void
}

type Handler = (c: Ctx) => Promise<unknown> | unknown
type Auth = 'none' | 'user' | 'admin'
interface Route { method: string; re: RegExp; keys: string[]; auth: Auth; handler: Handler }

const routes: Route[] = []
export const COOKIE = 'sid'
const SECURE = process.env.COOKIE_SECURE === 'true'

export function route(method: string, path: string, auth: Auth, handler: Handler): void {
  const keys: string[] = []
  const src = path.replace(/:([a-zA-Z]+)/g, (_, k: string) => { keys.push(k); return '([^/]+)' })
  routes.push({ method, re: new RegExp(`^${src}$`), keys, auth, handler })
}

// ── Validation ────────────────────────────────────────────────────────────────

export function str(v: unknown, min: number, max: number, field: string): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} est obligatoire.`)
  const s = v.trim()
  if (s.length < min) throw new HttpError(400, `${field} est trop court (min. ${min}).`)
  if (s.length > max) throw new HttpError(400, `${field} est trop long (max. ${max}).`)
  return s
}

export function optStr(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null || v === '') return null
  return str(v, 1, max, field)
}

export function httpUrl(v: unknown, field: string): string | null {
  const s = optStr(v, 500, field)
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
    return u.toString()
  } catch { throw new HttpError(400, `${field} doit être un lien http(s) valide.`) }
}

export function amount(v: unknown, field: string): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(s) || Number(s) <= 0) throw new HttpError(400, `${field} invalide (6 décimales max).`)
  return s
}

export function uuid(v: unknown, field: string): string {
  const s = str(v, 36, 36, field)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new HttpError(400, `${field} invalide.`)
  return s.toLowerCase()
}

export function txHash(v: unknown): `0x${string}` {
  const s = str(v, 66, 66, 'Hash de transaction')
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new HttpError(400, 'Hash de transaction invalide.')
  return s.toLowerCase() as `0x${string}`
}

// ── Limitation de débit (mémoire) ─────────────────────────────────────────────

const hits = new Map<string, number[]>()
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.')
  list.push(now)
  hits.set(key, list)
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function sha256(s: string): string {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex')
}

export async function createSession(userId: string): Promise<string> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, now() + interval '30 days')`
  return token
}

function readCookie(req: Request, name: string): string | null {
  const m = (req.headers.get('cookie') ?? '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`))
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null
}

export async function sessionUser(req: Request): Promise<AuthUser | null> {
  const token = readCookie(req, COOKIE)
  if (!token) return null
  return one<AuthUser>(sql`
    SELECT u.id, u.email, u.username, u.display_name, u.wallet_address, u.referral_code, u.role, u.status, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()`)
}

export function publicUser(u: AuthUser) {
  return {
    id: u.id,
    fullName: u.display_name,
    username: u.username,
    email: u.email,
    walletAddress: u.wallet_address,
    avatar: u.display_name.replace(/^0x/i, '').slice(0, 2).toUpperCase(),
    referralCode: u.referral_code,
    createdAt: u.created_at,
    role: u.role,
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const headers = new Headers()
  headers.set('cache-control', 'no-store')
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue
      const m = r.re.exec(url.pathname)
      if (!m) continue
      const params: Record<string, string> = {}
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] ?? '') })

      const user = await sessionUser(req)
      if (r.auth !== 'none') {
        if (!user) throw new HttpError(401, 'Connexion requise.')
        if (user.status === 'suspended') throw new HttpError(403, 'Ce compte est suspendu.')
        if (r.auth === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Accès réservé aux administrateurs.')
      }
      const ctx: Ctx = {
        req, url, params, user, headers,
        json: async () => {
          const ct = req.headers.get('content-type') ?? ''
          if (!ct.includes('application/json')) throw new HttpError(415, 'Format JSON requis.')
          const body: unknown = await req.json().catch(() => { throw new HttpError(400, 'JSON invalide.') })
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps invalide.')
          return body as Record<string, unknown>
        },
        setCookie: (value, maxAgeSec) => {
          headers.append('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE ? '; Secure' : ''}`)
        },
      }
      const out = await r.handler(ctx)
      if (out instanceof Response) return out
      return Response.json(out ?? { ok: true }, { headers })
    }
    throw new HttpError(404, 'Introuvable.')
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status, headers })
    console.error('[server]', err instanceof Error ? err.message : err)
    return Response.json({ error: 'Erreur interne du serveur.' }, { status: 500, headers })
  }
}

export async function audit(actor: string | null, action: string, target: string, detail: unknown = null): Promise<void> {
  await sql`INSERT INTO audit_log (actor_id, action, target, detail) VALUES (${actor}, ${action}, ${target}, ${JSON.stringify(detail)}::jsonb)`
}

export async function notify(userId: string, kind: string, title: string, body = '', link: string | null = null): Promise<void> {
  await sql`INSERT INTO notifications (user_id, kind, title, body, link) VALUES (${userId}, ${kind}, ${title}, ${body}, ${link})`
}

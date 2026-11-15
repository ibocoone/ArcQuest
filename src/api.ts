export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong.')
  return data as T
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  return parse<T>(res)
}

/** Envoie une image (preuve) et renvoie son identifiant. */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch('/api/uploads', { method: 'POST', credentials: 'same-origin', body: form })
  return (await parse<{ id: string }>(res)).id
}

export const uploadUrl = (id: string) => `/api/uploads/${id}`

/** Message signé pour prouver la propriété d'un portefeuille. Le format est vérifié par le serveur. */
export function walletMessage(address: string, nonce: string): string {
  return `ArcQuest: proof of wallet ownership\nAddress: ${address}\nNonce: ${nonce}`
}

export interface User {
  id: string
  fullName: string
  username: string
  email: string | null
  walletAddress: string | null
  avatar: string
  referralCode: string
  createdAt: string
  role: 'user' | 'admin'
  /** null pour un compte sans e-mail (portefeuille) */
  emailVerified: boolean | null
  verificationRequired: boolean
  emailNotifications: boolean
  xHandle: string | null
  telegramHandle: string | null
  leaderboardVisible: boolean
  showLinks: boolean
}

export const usdc = (v: string | number | null | undefined): string => {
  const n = Number(v ?? 0)
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}

export const fmtDate = (iso: string | Date): string =>
  new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

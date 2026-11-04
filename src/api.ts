export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Une erreur est survenue.')
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
  return `ArcQuest : preuve de propriété du portefeuille\nAdresse : ${address}\nNonce : ${nonce}`
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
}

export const usdc = (v: string | number | null | undefined): string => {
  const n = Number(v ?? 0)
  return `$${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}

export const fmtDate = (iso: string | Date): string =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

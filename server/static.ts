// Sert l'interface construite (dossier web) : un seul service héberge le site et l'API.
import { stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'

const DIST = process.env.STATIC_DIR ?? join(import.meta.dir, '..', 'web')
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY' }

const isFile = async (p: string) => (await stat(p).catch(() => null))?.isFile() ?? false

/** Vrai si le dossier de l'interface est présent (absent en développement : Vite sert l'interface). */
export const hasStatic = await isFile(join(DIST, 'index.html'))

/** Renvoie le fichier demandé, ou null si ce chemin n'est pas un fichier de l'interface. */
export async function serveStatic(pathname: string): Promise<Response | null> {
  let rel: string
  try {
    rel = normalize(decodeURIComponent(pathname))
  } catch {
    return null
  }
  const full = join(DIST, rel === '/' || rel === '.' ? 'index.html' : rel)
  if (!full.startsWith(DIST + '/') || !(await isFile(full))) return null
  const hashed = full.includes('/assets/')
  return new Response(Bun.file(full), {
    headers: { ...SECURITY, 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' },
  })
}

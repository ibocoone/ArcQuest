/**
 * Liens reçus dans l'adresse du site : une tâche partagée (`/?task=<id>`), la page d'aide publique (`/?page=help`), un lien de réinitialisation
 * de mot de passe (`/?reset=<jeton>`) ou de confirmation d'e-mail (`/?verify=<jeton>`).
 * On les garde le temps de la session puis on nettoie l'adresse (les jetons ne doivent pas rester visibles).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/
const KEYS = { task: 'arcquest:shared-task', reset: 'arcquest:reset-token', verify: 'arcquest:verify-token', page: 'arcquest:open-page' } as const
const PUBLIC_PAGES = ['help']
export type LinkKind = keyof typeof KEYS

export function captureDeepLink(): void {
  const url = new URL(window.location.href)
  let changed = false
  for (const kind of Object.keys(KEYS) as LinkKind[]) {
    const value = url.searchParams.get(kind)
    if (value === null) continue
    const valid = kind === 'task' ? UUID.test(value) : kind === 'page' ? PUBLIC_PAGES.includes(value) : TOKEN.test(value)
    if (valid) sessionStorage.setItem(KEYS[kind], value)
    url.searchParams.delete(kind)
    changed = true
  }
  if (changed) window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export const getLink = (kind: LinkKind): string | null => sessionStorage.getItem(KEYS[kind])
export const clearLink = (kind: LinkKind): void => sessionStorage.removeItem(KEYS[kind])
export const getSharedTask = (): string | null => getLink('task')
export const clearSharedTask = (): void => clearLink('task')

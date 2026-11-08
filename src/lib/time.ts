/** Heure actuelle en secondes Unix (fonction séparée pour rester pure dans le rendu des composants). */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/** Durée restante lisible : « 2d 3h », « 5h 10m », « 12m ». */
export function formatLeft(seconds: number): string {
  if (seconds <= 0) return 'now'
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  const m = Math.floor((seconds % 3_600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

export const DAY_SECONDS = 86_400

/** Secondes Unix d'une date ISO (0 si absente). */
export function toSec(iso: string | null | undefined): number {
  return iso ? Math.floor(new Date(iso).getTime() / 1000) : 0
}

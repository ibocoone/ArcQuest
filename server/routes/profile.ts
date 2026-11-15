import { one, rows, sql } from '../db'
import { HttpError, audit, baseUrl, rateLimit, route, type AuthUser } from '../http'
import { emailEnabled, sendEmailLink } from '../email'

// ── Classement ───────────────────────────────────────────────

type Metric = 'earned' | 'tasks' | 'creators'
interface Ranked {
  id: string; username: string; display_name: string; created_at: Date
  x_handle: string | null; telegram_handle: string | null; show_links: boolean
  earned: string; tasks: string | number; rank: string | number
}

/** Classement des utilisateurs visibles : gains (USDC reçus), tâches validées, ou USDC versés par les créateurs. Seuls les paiements approuvés comptent. */
route('GET', '/leaderboard', 'user', async (c) => {
  const me = c.user as AuthUser
  const m = c.url.searchParams.get('metric')
  const metric: Metric = m === 'tasks' || m === 'creators' ? m : 'earned'
  const period = c.url.searchParams.get('period') === '30d' ? '30d' : 'all'
  const since = period === '30d' ? sql`at > now() - interval '30 days'` : sql`true`
  const order = metric === 'tasks'
    ? sql`agg.tasks DESC, agg.earned DESC, u.created_at ASC`
    : sql`agg.earned DESC, agg.tasks DESC, u.created_at ASC`
  const must = metric === 'tasks' ? sql`agg.tasks > 0` : sql`agg.earned > 0`

  const pay = metric === 'creators'
    ? sql`
      SELECT t.creator_id AS uid, t.reward AS amt, 1 AS task, COALESCE(s.status_at, s.reviewed_at, s.created_at) AS at
      FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.status = 'approved'
      UNION ALL
      SELECT k.creator_id, e.prize_amount, 0, e.created_at
      FROM contest_entries e JOIN contests k ON k.id = e.contest_id WHERE e.status = 'winner' AND e.prize_amount IS NOT NULL`
    : sql`
      SELECT s.worker_id AS uid, t.reward AS amt, 1 AS task, COALESCE(s.status_at, s.reviewed_at, s.created_at) AS at
      FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.status = 'approved'
      UNION ALL
      SELECT e.user_id, e.prize_amount, 0, e.created_at
      FROM contest_entries e WHERE e.status = 'winner' AND e.prize_amount IS NOT NULL`

  const list = await rows<Ranked>(sql`
    WITH pay AS (${pay}),
    agg AS (SELECT uid, sum(amt) AS earned, sum(task) AS tasks FROM pay WHERE ${since} GROUP BY uid),
    ranked AS (
      SELECT u.id, u.username, u.display_name, u.created_at, u.x_handle, u.telegram_handle, u.show_links,
             agg.earned::text AS earned, agg.tasks::int AS tasks,
             row_number() OVER (ORDER BY ${order}) AS rank
      FROM agg JOIN users u ON u.id = agg.uid
      WHERE u.status = 'active' AND u.leaderboard_visible AND ${must})
    SELECT * FROM ranked ORDER BY rank LIMIT 1000`)

  const view = (r: Ranked) => ({
    rank: Number(r.rank),
    username: r.username,
    avatar: r.display_name.replace(/^0x/i, '').slice(0, 2).toUpperCase(),
    earned: r.earned,
    tasks: Number(r.tasks),
    memberSince: r.created_at,
    isMe: r.id === me.id,
    links: r.show_links && (r.x_handle || r.telegram_handle) ? { x: r.x_handle, telegram: r.telegram_handle } : null,
  })
  const mine = list.find((r) => r.id === me.id)
  return { metric, period, total: list.length, items: list.slice(0, 50).map(view), me: mine ? view(mine) : null }
})

// ── Liens sociaux et visibilité ──────────────────────────────

/** @handle ou lien x.com / twitter.com vers un nom X valide ; chaîne vide = effacer. */
function normX(v: unknown): string | null {
  const raw = String(v ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/i)
  const h = m ? (m[1] as string) : raw.replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) throw new HttpError(400, 'Invalid X handle: use letters, numbers and underscores, up to 15 characters.')
  return h
}

/** @handle ou lien t.me vers un nom Telegram valide ; chaîne vide = effacer. */
function normTelegram(v: unknown): string | null {
  const raw = String(v ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/@?([A-Za-z][A-Za-z0-9_]{4,31})\/?(?:\?.*)?$/i)
  const h = m ? (m[1] as string) : raw.replace(/^@/, '')
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(h)) throw new HttpError(400, 'Invalid Telegram username: 5 to 32 characters, starting with a letter, using letters, numbers and underscores.')
  return h
}

route('POST', '/me/social', 'user', async (c) => {
  const me = c.user as AuthUser
  const b = await c.json()
  rateLimit(`social:${me.id}`, 30, 3_600_000)
  const next = {
    x: 'xHandle' in b ? normX(b.xHandle) : (me.x_handle ?? null),
    tg: 'telegramHandle' in b ? normTelegram(b.telegramHandle) : (me.telegram_handle ?? null),
    visible: 'leaderboardVisible' in b ? b.leaderboardVisible : (me.leaderboard_visible ?? true),
    links: 'showLinks' in b ? b.showLinks : (me.show_links ?? false),
  }
  if (typeof next.visible !== 'boolean' || typeof next.links !== 'boolean') throw new HttpError(400, 'Invalid settings.')
  await sql`UPDATE users SET x_handle = ${next.x}, telegram_handle = ${next.tg}, leaderboard_visible = ${next.visible}, show_links = ${next.links} WHERE id = ${me.id}`
  await audit(me.id, 'profile.social', me.id, { x: !!next.x, telegram: !!next.tg, visible: next.visible, links: next.links })
  return { ok: true, xHandle: next.x, telegramHandle: next.tg, leaderboardVisible: next.visible, showLinks: next.links }
})

/** Ajoute une adresse e-mail à un compte qui n'en a pas (compte portefeuille). L'adresse n'est enregistrée qu'après clic sur le lien reçu. */
route('POST', '/me/email', 'user', async (c) => {
  const me = c.user as AuthUser
  if (me.email) throw new HttpError(400, 'This account already has an email address.')
  const b = await c.json()
  const email = String(b.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.')
  rateLimit(`link-email:${me.id}`, 3, 3_600_000)
  if (!emailEnabled() && process.env.NODE_ENV === 'production') throw new HttpError(503, 'Email sending is not configured yet.')
  const taken = await one<{ id: string }>(sql`SELECT id FROM users WHERE email = ${email}`)
  if (!taken) {
    try { await sendEmailLink(me.id, email, baseUrl(c)) } catch (e) {
      console.error('[email] link failed:', e instanceof Error ? e.message : e)
      throw new HttpError(502, 'Could not send the email right now. Try again later.')
    }
  }
  // même réponse que l'adresse soit libre ou déjà prise
  return { ok: true, message: 'If this address can be used, a confirmation link is on its way.' }
})

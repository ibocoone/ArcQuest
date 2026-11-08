import { one, sql } from '../db'
import { HttpError, audit, baseUrl, rateLimit, route, str, type AuthUser } from '../http'
import { consumeToken, sendPasswordReset, sendVerification } from '../email'

const GENERIC = { ok: true, message: 'If an account exists for this address, an email is on its way.' }

/** Mot de passe oublié : la réponse est toujours la même, que l'adresse existe ou non. */
route('POST', '/auth/forgot', 'none', async (c) => {
  const email = str((await c.json()).email, 5, 254, 'Email').toLowerCase()
  rateLimit(`forgot:${email}`, 3, 3_600_000)
  rateLimit('forgot:all', 200, 3_600_000)
  const u = await one<{ id: string }>(sql`SELECT id FROM users WHERE email = ${email} AND status = 'active'`)
  if (u) {
    try { await sendPasswordReset(u.id, email, baseUrl(c)) } catch (e) { console.error('[email] reset failed:', e instanceof Error ? e.message : e) }
  }
  return GENERIC
})

/** Choisir un nouveau mot de passe avec le lien reçu par e-mail (usage unique, 1 heure). Déconnecte toutes les sessions. */
route('POST', '/auth/reset', 'none', async (c) => {
  const b = await c.json()
  rateLimit('reset:all', 100, 3_600_000)
  const password = str(b.password, 8, 128, 'Password')
  const t = await consumeToken(typeof b.token === 'string' ? b.token : '', 'reset')
  if (!t) throw new HttpError(400, 'This link is invalid or has expired. Ask for a new one.')
  const hash = await Bun.password.hash(password)
  // utiliser le lien prouve aussi que l'adresse est bien celle de la personne
  await sql`UPDATE users SET password_hash = ${hash}, email_verified_at = coalesce(email_verified_at, now()) WHERE id = ${t.userId}`
  await sql`DELETE FROM sessions WHERE user_id = ${t.userId}`
  await audit(t.userId, 'password.reset', t.userId, {})
  return { ok: true }
})

route('POST', '/auth/verify', 'none', async (c) => {
  rateLimit('verify:all', 300, 3_600_000)
  const b = await c.json()
  const t = await consumeToken(typeof b.token === 'string' ? b.token : '', 'verify')
  if (!t) throw new HttpError(400, 'This link is invalid or has expired. Request a new confirmation email from Settings.')
  await sql`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = ${t.userId} AND email = ${t.email}`
  return { ok: true }
})

route('POST', '/auth/resend-verification', 'user', async (c) => {
  const me = c.user as AuthUser
  if (!me.email) throw new HttpError(400, 'This account has no email address.')
  if (me.email_verified_at) return { ok: true, alreadyVerified: true }
  rateLimit(`resend:${me.id}`, 3, 3_600_000)
  try { await sendVerification(me.id, me.email, baseUrl(c)) } catch (e) {
    console.error('[email] verification failed:', e instanceof Error ? e.message : e)
    throw new HttpError(502, 'Could not send the email right now. Try again later.')
  }
  return { ok: true }
})

route('POST', '/me/settings', 'user', async (c) => {
  const me = c.user as AuthUser
  const b = await c.json()
  if (typeof b.emailNotifications !== 'boolean') throw new HttpError(400, 'Invalid settings.')
  await sql`UPDATE users SET email_notifications = ${b.emailNotifications} WHERE id = ${me.id}`
  return { ok: true }
})

import { one, rows, sql } from './db'

/** Fournisseur d'e-mails (Brevo). Sans clé, rien n'est envoyé : hors production, les messages vont dans une boîte d'envoi locale. */
export const emailEnabled = (): boolean => !!process.env.BREVO_API_KEY && !!process.env.EMAIL_FROM

/** La confirmation d'adresse n'est exigée que si l'on peut réellement envoyer des e-mails (sinon personne ne pourrait la faire). */
export const verificationRequired = (): boolean => emailEnabled() || process.env.REQUIRE_EMAIL_VERIFICATION === '1'

export const publicBase = (): string => (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '')

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

function html(title: string, lines: string[], button?: { label: string; url: string }, footer?: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f1c35">
<h2 style="margin:0 0 16px">${esc(title)}</h2>
${lines.map((l) => `<p style="line-height:1.5;margin:0 0 12px">${esc(l)}</p>`).join('\n')}
${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#1a2f6e;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">${esc(button.url)}</p>` : ''}
${footer ? `<p style="font-size:12px;color:#6b7280;margin-top:24px">${esc(footer)}</p>` : ''}
</div>`
}

/** Dernières erreurs d'envoi (en mémoire), visibles par les administrateurs pour diagnostiquer le fournisseur. */
const recentErrors: { at: string; message: string }[] = []
export const recentEmailErrors = () => [...recentErrors]
function recordEmailError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e)
  recentErrors.unshift({ at: new Date().toISOString(), message })
  recentErrors.length = Math.min(recentErrors.length, 20)
  console.error('[email] send failed:', message)
}

export async function sendEmail(to: string, subject: string, text: string, htmlBody: string): Promise<void> {
  if (emailEnabled()) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY as string, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: process.env.EMAIL_FROM_NAME ?? 'ArcQuest', email: process.env.EMAIL_FROM },
          to: [{ email: to }], subject, textContent: text, htmlContent: htmlBody,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
        throw new Error(`Email provider error ${res.status}: ${detail}`)
      }
    } catch (e) {
      recordEmailError(e)
      throw e
    }
    return
  }
  if (process.env.NODE_ENV !== 'production') {
    await sql`INSERT INTO email_outbox (to_email, subject, body) VALUES (${to}, ${subject}, ${text})`
    return
  }
  console.warn('[email] no provider configured: message not sent')
}

// ── Jetons à usage unique ────────────────────────────────────────────────────

const hash = (t: string) => new Bun.CryptoHasher('sha256').update(t).digest('hex')
const TTL = { verify: 24 * 3_600_000, reset: 3_600_000, link: 24 * 3_600_000 } as const
type TokenKind = keyof typeof TTL

export async function createToken(userId: string, kind: TokenKind, email: string): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
  // un seul jeton valide à la fois par utilisateur et par usage
  await sql`UPDATE email_tokens SET used_at = now() WHERE user_id = ${userId} AND kind = ${kind} AND used_at IS NULL`
  await sql`INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at) VALUES (${hash(token)}, ${userId}, ${kind}, ${email}, ${new Date(Date.now() + TTL[kind]).toISOString()})`
  return token
}

/** Consomme le jeton (une seule fois). Retourne l'utilisateur et l'adresse concernés, ou null s'il est inconnu, expiré ou déjà utilisé. */
export async function consumeToken(token: string, kind: TokenKind): Promise<{ userId: string; email: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const r = await one<{ user_id: string; email: string }>(sql`
    UPDATE email_tokens SET used_at = now()
    WHERE token_hash = ${hash(token)} AND kind = ${kind} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id, email`)
  return r ? { userId: r.user_id, email: r.email } : null
}

// ── Messages ────────────────────────────────────────────────────────────────

export async function sendVerification(userId: string, email: string, base = publicBase()): Promise<void> {
  const url = `${base}/?verify=${await createToken(userId, 'verify', email)}`
  const text = `Confirm your email address to publish tasks and send submissions on ArcQuest:\n${url}\n\nThis link expires in 24 hours. If you did not create an account, ignore this message.`
  await sendEmail(email, 'Confirm your email for ArcQuest', text,
    html('Confirm your email', ['Confirm your email address to publish tasks and send submissions on ArcQuest.', 'This link expires in 24 hours.'], { label: 'Confirm my email', url }, 'If you did not create an account, ignore this message.'))
}

/** Ajout d'une adresse e-mail à un compte qui n'en a pas (par exemple un compte portefeuille). Le lien prouve que l'adresse est bien à la personne. */
export async function sendEmailLink(userId: string, email: string, base = publicBase()): Promise<void> {
  const url = `${base}/?verify=${await createToken(userId, 'link', email)}`
  const text = `Add this email address to your ArcQuest account:\n${url}\n\nThis link expires in 24 hours. If you did not ask for this, ignore this message.`
  await sendEmail(email, 'Add your email to ArcQuest', text,
    html('Add your email', ['Use the button below to add this email address to your ArcQuest account.', 'This link expires in 24 hours.'], { label: 'Add my email', url }, 'If you did not ask for this, ignore this message.'))
}

export async function sendPasswordReset(userId: string, email: string, base = publicBase()): Promise<void> {
  const url = `${base}/?reset=${await createToken(userId, 'reset', email)}`
  const text = `Reset your ArcQuest password:\n${url}\n\nThis link expires in 1 hour and works once. If you did not ask for this, ignore this message: your password is unchanged.`
  await sendEmail(email, 'Reset your ArcQuest password', text,
    html('Reset your password', ['Use the button below to choose a new password.', 'This link expires in 1 hour and works once.'], { label: 'Choose a new password', url }, 'If you did not ask for this, ignore this message: your password is unchanged.'))
}

const EMAIL_KINDS = new Set(['submission', 'paid', 'rejected', 'dispute', 'refunded', 'split'])

/** E-mail de notification, seulement pour les adresses confirmées qui n'ont pas désactivé l'option. N'échoue jamais. */
export async function emailNotification(userId: string, kind: string, title: string, body: string): Promise<void> {
  if (!EMAIL_KINDS.has(kind) || (!emailEnabled() && process.env.NODE_ENV === 'production')) return
  try {
    const u = await one<{ email: string | null; email_verified_at: Date | null; email_notifications: boolean }>(sql`SELECT email, email_verified_at, email_notifications FROM users WHERE id = ${userId}`)
    if (!u?.email || !u.email_verified_at || !u.email_notifications) return
    const base = publicBase()
    const text = `${body}\n\nOpen ArcQuest: ${base || ''}/\n\nYou receive this because email notifications are on. You can turn them off in Settings.`
    await sendEmail(u.email, title, text, html(title, [body], base ? { label: 'Open ArcQuest', url: `${base}/` } : undefined, 'You receive this because email notifications are on. You can turn them off in Settings.'))
  } catch (e) {
    console.error('[email] notification failed:', e instanceof Error ? e.message : e)
  }
}

export async function outboxFor(email: string): Promise<{ subject: string; body: string }[]> {
  return rows(sql`SELECT subject, body FROM email_outbox WHERE to_email = ${email} ORDER BY id ASC`)
}

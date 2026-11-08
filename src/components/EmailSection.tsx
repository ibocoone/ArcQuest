import { useState } from 'react'
import { BadgeCheck, MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { Card } from '../ui'

/** Confirmation de l'adresse e-mail et notifications par e-mail (comptes e-mail uniquement). */
export default function EmailSection() {
  const { user, refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!user?.email) return null

  const resend = async () => {
    setBusy(true)
    try {
      await api('/auth/resend-verification', { body: {} })
      toast.success('Confirmation email sent. Check your inbox and spam folder.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send the email.') } finally { setBusy(false) }
  }
  const toggle = async () => {
    setBusy(true)
    try {
      await api('/me/settings', { body: { emailNotifications: !user.emailNotifications } })
      await refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>Email</h2>
      <div className="flex items-start gap-3 text-sm">
        {user.emailVerified ? <BadgeCheck size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--success)' }} /> : <MailWarning size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#a0700a' }} />}
        <div className="flex-1 min-w-0 text-pretty" style={{ color: 'var(--ink-2)' }}>
          {user.emailVerified
            ? 'Your email address is confirmed.'
            : 'Your email address is not confirmed yet. Confirming it protects your account and lets you reset your password.'}
        </div>
        {!user.emailVerified && (
          <button onClick={() => void resend()} disabled={busy} className="min-h-[44px] px-3 rounded-lg text-sm font-semibold flex-shrink-0" style={{ background: 'rgba(26,47,110,0.08)', color: 'var(--accent)' }}>
            {busy ? 'Sending…' : 'Resend email'}
          </button>
        )}
      </div>
      <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
        <input type="checkbox" className="w-5 h-5" checked={user.emailNotifications} disabled={busy || !user.emailVerified} onChange={() => void toggle()} />
        <span className="text-sm" style={{ color: 'var(--ink)' }}>
          Email me about payments, reviews and disputes
          {!user.emailVerified && <span style={{ color: 'var(--muted)' }}> (confirm your address first)</span>}
        </span>
      </label>
    </Card>
  )
}

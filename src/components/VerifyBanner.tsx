import { useState } from 'react'
import { MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

/** Rappel affiché aux comptes e-mail dont l'adresse n'est pas encore confirmée (quand l'envoi d'e-mails est actif). */
export default function VerifyBanner() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  if (!user || user.emailVerified !== false || !user.verificationRequired) return null

  const resend = async () => {
    setBusy(true)
    try {
      await api('/auth/resend-verification', { body: {} })
      setSent(true)
      toast.success('Confirmation email sent. Check your inbox and spam folder.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the email.')
    } finally { setBusy(false) }
  }

  return (
    <div className="mb-4 rounded-xl px-4 py-3 flex items-start gap-3 text-sm" style={{ background: 'rgba(255,205,131,0.25)', color: 'var(--ink)' }}>
      <MailWarning size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#a0700a' }} />
      <div className="flex-1 min-w-0 text-pretty">
        Confirm <strong className="break-all">{user.email}</strong> to publish tasks and send submissions. {sent ? 'Email sent.' : 'We sent you a link when you signed up.'}
      </div>
      <button onClick={() => void resend()} disabled={busy || sent} className="min-h-[44px] px-3 rounded-lg text-sm font-semibold flex-shrink-0" style={{ background: 'white', color: 'var(--accent)', opacity: busy || sent ? 0.6 : 1 }}>
        {busy ? 'Sending…' : 'Resend'}
      </button>
    </div>
  )
}

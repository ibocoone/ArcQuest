import { useState } from 'react'
import { ArrowLeft, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { inputStyle } from '../ui'

const labelCls = 'text-xs font-semibold uppercase tracking-wider block mb-1.5'

/** « Mot de passe oublié » : la réponse est la même que l'adresse existe ou non. */
export default function ForgotForm({ email, setEmail, onBack }: { email: string; setEmail: (v: string) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/auth/forgot', { body: { email } })
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the email.')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 min-h-[44px] text-sm font-medium" style={{ color: '#1a2f6e' }}>
        <ArrowLeft size={15} /> Back to sign in
      </button>
      {sent ? (
        <div className="rounded-xl p-4 text-sm text-pretty" style={{ background: 'rgba(26,128,71,0.08)', color: '#0f1c35' }}>
          If an account exists for <strong>{email}</strong>, we sent a link to choose a new password. It works once and expires in 1 hour. Check your spam folder too.
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <p className="text-sm text-pretty" style={{ color: '#6b6580' }}>Enter your email address and we will send you a link to choose a new password.</p>
          <div>
            <label className={labelCls} style={{ color: '#6b6580' }}>Email address</label>
            <input style={inputStyle} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <button type="submit" disabled={busy || !email} className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl font-semibold text-sm text-white"
            style={{ background: '#1a2f6e', opacity: busy || !email ? 0.7 : 1 }}>
            <Mail size={16} /> {busy ? 'Sending…' : 'Send the link'}
          </button>
        </form>
      )}
    </div>
  )
}

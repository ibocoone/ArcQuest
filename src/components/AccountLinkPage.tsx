import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../api'
import { clearLink } from '../lib/deeplink'
import { Loading, inputStyle } from '../ui'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-8" style={{ background: 'linear-gradient(180deg,#f4f6ff 0%,#fffcf7 52%,#f8f4ff 100%)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 12px 40px rgba(26,47,110,0.12)' }}>
        <div className="font-bold text-xl" style={{ color: '#0f1c35' }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

const ctaStyle = { background: '#1a2f6e', color: 'white' }

/** Choisir un nouveau mot de passe avec le lien reçu par e-mail. */
export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Your password must have at least 8 characters.')
    if (password !== confirm) return setError('The two passwords are not the same.')
    setBusy(true)
    try {
      await api('/auth/reset', { body: { token, password } })
      clearLink('reset')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.')
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <Shell title="Password changed">
        <div className="flex items-start gap-2 text-sm" style={{ color: '#0f1c35' }}><CheckCircle2 size={18} style={{ color: '#1a8047' }} className="mt-0.5 flex-shrink-0" /> You can now sign in with your new password. You were signed out everywhere for your safety.</div>
        <button onClick={onDone} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={ctaStyle}>Sign in</button>
      </Shell>
    )
  }
  return (
    <Shell title="Choose a new password">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <input style={inputStyle} type="password" autoComplete="new-password" placeholder="New password (8 characters minimum)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <input style={inputStyle} type="password" autoComplete="new-password" placeholder="Repeat the new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <p className="text-sm" style={{ color: '#ba2b4c' }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={{ ...ctaStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Change my password'}</button>
        <button type="button" onClick={() => { clearLink('reset'); onDone() }} className="w-full min-h-[44px] text-sm font-medium" style={{ color: '#1a2f6e' }}>Cancel</button>
      </form>
    </Shell>
  )
}

/** Confirmer l'adresse e-mail avec le lien reçu. */
export function VerifyEmailPage({ token, onDone }: { token: string; onDone: () => void }) {
  const qc = useQueryClient()
  const { isLoading, error } = useQuery({
    queryKey: ['verify-email', token],
    queryFn: async () => {
      const r = await api<{ ok: boolean }>('/auth/verify', { body: { token } })
      await qc.invalidateQueries({ queryKey: ['me'] })
      return r
    },
    retry: false, staleTime: Infinity,
  })
  const leave = () => { clearLink('verify'); toast.dismiss(); onDone() }

  return (
    <Shell title="Email confirmation">
      {isLoading ? <Loading /> : error ? (
        <>
          <div className="flex items-start gap-2 text-sm" style={{ color: '#0f1c35' }}><XCircle size={18} style={{ color: '#ba2b4c' }} className="mt-0.5 flex-shrink-0" /> {error.message}</div>
          <button onClick={leave} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={ctaStyle}>Continue</button>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2 text-sm" style={{ color: '#0f1c35' }}><CheckCircle2 size={18} style={{ color: '#1a8047' }} className="mt-0.5 flex-shrink-0" /> Your email address is confirmed. You can now publish tasks and send submissions.</div>
          <button onClick={leave} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={ctaStyle}>Continue</button>
        </>
      )}
    </Shell>
  )
}

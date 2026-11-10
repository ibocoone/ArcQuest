import { useState } from 'react'
import { Fingerprint, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { usePasskey } from '../passkey/PasskeyContext'
import { inputStyle } from '../ui'

/** Crée ou retrouve un portefeuille protégé par l'empreinte, le visage ou le code de l'appareil, sans extension ni frais de réseau. */
export default function PasskeyBox({ compact = false }: { compact?: boolean }) {
  const pk = usePasskey()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'register' | 'login' | null>(null)

  const run = async (mode: 'register' | 'login') => {
    setBusy(mode)
    try {
      if (mode === 'register') await pk.signUp(name.trim() || 'ArcQuest user')
      else await pk.signIn()
    } catch (err) {
      const msg = err instanceof Error ? `${err.name} ${err.message}` : ''
      if (/NotAllowed|cancel/i.test(msg)) toast.error('Passkey cancelled.')
      else if (/Security/i.test(msg)) toast.error('Passkeys are not available on this address.')
      else if (/InvalidState/i.test(msg)) toast.error('A passkey already exists here. Use "Use my passkey".')
      else toast.error(err instanceof Error && err.message ? err.message : 'Passkey wallet failed.')
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3 rounded-2xl p-4" style={{ background: 'rgba(26,47,110,0.05)' }}>
      {!compact && (
        <p className="text-sm text-pretty" style={{ color: '#0f1c35' }}>
          <strong>No wallet extension?</strong> Create a wallet protected by your fingerprint, face or device code. Network fees are covered.
        </p>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (shown on your passkey)" maxLength={40} style={inputStyle} />
      <button type="button" onClick={() => void run('register')} disabled={busy !== null}
        className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl font-semibold text-sm text-white"
        style={{ background: busy ? '#9aa3b9' : '#1a2f6e' }}>
        <Fingerprint size={16} /> {busy === 'register' ? 'Waiting for your device…' : 'Create my wallet'}
      </button>
      <button type="button" onClick={() => void run('login')} disabled={busy !== null}
        className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
        style={{ background: 'white', color: '#1a2f6e', border: '1px solid rgba(26,47,110,0.2)' }}>
        <KeyRound size={16} /> {busy === 'login' ? 'Waiting for your device…' : 'Use my passkey'}
      </button>
    </div>
  )
}

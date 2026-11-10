import EmailSection from './EmailSection'
import { useState } from 'react'
import { CheckCircle2, LogOut, Wallet } from 'lucide-react'
import { useWallet } from '../hooks/useWallet'
import { ConnectKitButton } from 'connectkit'
import PasskeyBox from './PasskeyBox'
import { toast } from 'sonner'
import { api, fmtDate, walletMessage } from '../api'
import { useAuth } from '../context/AuthContext'
import { Card, ErrorBox, Label, PageTitle, inputStyle, primaryBtn } from '../ui'

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className={`text-sm mt-0.5 break-all ${mono ? 'mono' : ''}`} style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function WalletSection() {
  const { user, refresh } = useAuth()
  const { address, isConnected, signMessage, disconnect, passkeyEnabled } = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const link = async () => {
    if (!address) return
    setBusy(true); setError('')
    try {
      const { nonce } = await api<{ nonce: string }>('/auth/nonce')
      const message = walletMessage(address, nonce)
      const signature = await signMessage(message)
      await api('/me/wallet', { body: { address, message, signature } })
      await refresh()
      toast.success('Wallet linked to your account.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(/rejected|denied/i.test(msg) ? 'Signature cancelled.' : msg || 'Could not link wallet.')
    } finally { setBusy(false) }
  }

  const linked = user?.walletAddress
  const mismatch = !!linked && isConnected && !!address && linked.toLowerCase() !== address.toLowerCase()

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-sm" style={{ color: 'var(--ink)' }}><Wallet size={16} /> Wallet</div>
      {linked ? (
        <>
          <Row label="Wallet linked to this account" value={linked} mono />
          <div className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5" style={{ background: 'rgba(26,128,71,0.07)', color: 'var(--success)' }}>
            <CheckCircle2 size={13} /> Your payments and publications use this wallet.
          </div>
          {mismatch && <ErrorBox message="The connected wallet is different from the one linked to your account. Switch accounts in your wallet to deposit, withdraw or publish." />}
          {!isConnected && (
            <div className="space-y-3">
              {passkeyEnabled && <PasskeyBox compact />}
              <ConnectKitButton />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            Link a wallet to get paid, publish tasks and use your balance. You sign a free message to prove the wallet is yours.
          </p>
          {isConnected && address ? (
            <button onClick={() => void link()} disabled={busy} className="w-full min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(busy)}>
              {busy ? 'Signing…' : `Link ${address.slice(0, 6)}…${address.slice(-4)}`}
            </button>
          ) : (
            <div className="space-y-3">
              {passkeyEnabled && <PasskeyBox compact />}
              <ConnectKitButton label="Connect a wallet" />
            </div>
          )}
          {error && <ErrorBox message={error} />}
        </>
      )}
      {isConnected && address && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(15,28,53,0.04)' }}>
          <div className="min-w-0">
            <div className="text-xs" style={{ color: 'var(--muted)' }}>Connected wallet</div>
            <div className="mono text-xs truncate" style={{ color: 'var(--ink)' }}>{address}</div>
          </div>
          <button onClick={() => disconnect()} className="flex-shrink-0 min-h-[40px] px-3 rounded-xl text-xs font-semibold" style={{ background: 'rgba(224,59,79,0.08)', color: 'var(--danger, #e03b4f)' }}>
            Disconnect
          </button>
        </div>
      )}
    </Card>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true); setError('')
    try {
      await api('/me/password', { body: { current, next } })
      setCurrent(''); setNext('')
      toast.success('Password updated.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') } finally { setBusy(false) }
  }
  const disabled = busy || !current || next.length < 8

  return (
    <Card className="p-5 space-y-3">
      <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Password</div>
      <div><Label>Current password</Label><input type="password" autoComplete="current-password" style={inputStyle} value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      <div><Label>New password (8 characters minimum)</Label><input type="password" autoComplete="new-password" style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} /></div>
      {error && <ErrorBox message={error} />}
      <button onClick={() => void save()} disabled={disabled} className="w-full min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(disabled)}>Update</button>
    </Card>
  )
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="max-w-2xl space-y-5">
      <PageTitle title="Settings" />
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white flex-shrink-0" style={{ background: 'var(--accent)' }}>{user.avatar}</div>
          <div className="min-w-0">
            <div className="display font-bold text-lg truncate" style={{ color: 'var(--ink)' }}>{user.fullName}</div>
            <div className="text-xs" style={{ color: 'var(--subtle)' }}>Member since {fmtDate(user.createdAt)}</div>
          </div>
        </div>
        {user.email && <Row label="Email address" value={user.email} />}
        <Row label="Public name" value={`@${user.username}`} />
        <Row label="Referral code" value={user.referralCode} mono />
      </Card>
      <WalletSection />
      <EmailSection />
      {user.email && <PasswordSection />}
      <button onClick={() => void logout()} className="w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
        style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
        <LogOut size={16} /> Sign out
      </button>
    </div>
  )
}

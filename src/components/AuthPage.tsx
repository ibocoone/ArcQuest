import { useState } from 'react'
import { Eye, EyeOff, LogIn, UserPlus, Mail, Wallet } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useAccount, useSignMessage } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { api, walletMessage } from '../api'
import { useAuth } from '../context/AuthContext'
import { inputStyle } from '../ui'

type Method = 'email' | 'wallet'
type Mode = 'login' | 'register'

const labelCls = 'text-xs font-semibold uppercase tracking-wider block mb-1.5'

function initialRef(): string {
  return (new URLSearchParams(window.location.search).get('ref') ?? '').toUpperCase()
}

export default function AuthPage({ onOpenLegal }: { onOpenLegal: (p: 'terms' | 'privacy') => void }) {
  const { refresh } = useAuth()
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [method, setMethod] = useState<Method>('email')
  const [mode, setMode] = useState<Mode>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [referral, setReferral] = useState(initialRef)
  const [busy, setBusy] = useState(false)

  const isRegister = mode === 'register'
  const fail = (err: unknown, fallback: string) => toast.error(err instanceof Error ? err.message : fallback)

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api(isRegister ? '/auth/register' : '/auth/login', {
        body: isRegister ? { email, password, referralCode: referral || undefined } : { email, password },
      })
      await refresh()
    } catch (err) { fail(err, 'Something went wrong.') } finally { setBusy(false) }
  }

  const submitWallet = async () => {
    if (!address) return
    setBusy(true)
    try {
      const { nonce } = await api<{ nonce: string }>('/auth/nonce')
      const message = walletMessage(address, nonce)
      const signature = await signMessageAsync({ message })
      await api('/auth/wallet', { body: { address, message, signature, referralCode: referral || undefined } })
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      toast.error(/rejected|denied/i.test(msg) ? 'Signature cancelled.' : msg || 'Wallet sign-in failed.')
    } finally { setBusy(false) }
  }

  const tabBtn = (m: Method, label: string, Icon: React.ElementType) => (
    <button type="button" onClick={() => setMethod(m)}
      className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all"
      style={{ background: method === m ? 'white' : 'transparent', color: method === m ? '#1a2f6e' : '#6b6580', boxShadow: method === m ? '0 1px 4px rgba(15,28,53,0.10)' : 'none' }}>
      <Icon size={15} /> {label}
    </button>
  )

  const referralField = (
    <div>
      <label className={labelCls} style={{ color: '#6b6580' }}>Referral code <span style={{ fontWeight: 400 }}>(optional)</span></label>
      <input style={inputStyle} placeholder="CODE123" value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} />
    </div>
  )

  const cta = (disabled: boolean): React.CSSProperties => ({ background: '#1a2f6e', boxShadow: '0 4px 16px rgba(26,47,110,0.28)', opacity: disabled ? 0.7 : 1, cursor: disabled ? 'not-allowed' : 'pointer' })

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-8" style={{ background: 'linear-gradient(180deg,#f4f6ff 0%,#fffcf7 52%,#f8f4ff 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-lg" style={{ background: '#1a2f6e' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </div>
          <h1 className="display text-2xl font-bold" style={{ color: '#0f1c35' }}>ArcQuest</h1>
          <p className="text-sm mt-1" style={{ color: '#6b6580' }}>
            {method === 'wallet' ? 'Sign in with your wallet' : isRegister ? 'Create your account' : 'Sign in to your account'}
          </p>
        </div>

        <div className="rounded-2xl p-6 space-y-4 shadow-xl" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.70)' }}>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(15,28,53,0.06)' }}>
            {tabBtn('email', 'Email', Mail)}
            {tabBtn('wallet', 'Wallet', Wallet)}
          </div>

          {method === 'email' ? (
            <form onSubmit={(e) => void submitEmail(e)} className="space-y-4">
              <div>
                <label className={labelCls} style={{ color: '#6b6580' }}>Email address</label>
                <input style={inputStyle} type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <label className={labelCls} style={{ color: '#6b6580' }}>Password</label>
                <div className="relative">
                  <input style={{ ...inputStyle, paddingRight: 44 }} type={showPwd ? 'text' : 'password'}
                    placeholder={isRegister ? 'At least 8 characters' : '••••••••'} autoComplete={isRegister ? 'new-password' : 'current-password'}
                    value={password} onChange={(e) => setPassword(e.target.value)} required minLength={isRegister ? 8 : undefined} />
                  <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#8a849c' }}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}>
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {isRegister && referralField}
              <button type="submit" disabled={busy} className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl font-semibold text-sm text-white active:scale-[0.98]" style={cta(busy)}>
                {isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
                {busy ? 'Please wait…' : isRegister ? 'Create my account' : 'Sign in'}
              </button>
              <button type="button" onClick={() => setMode(isRegister ? 'login' : 'register')} className="w-full min-h-[44px] text-sm font-medium" style={{ color: '#1a2f6e' }}>
                {isRegister ? 'Already have an account? Sign in' : 'New to ArcQuest? Create an account'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-pretty" style={{ color: '#6b6580' }}>
                Connect your wallet and sign a message to prove you own it. No transaction and no fees. An account is created the first time you sign in.
              </p>
              {!isConnected ? (
                <div className="flex justify-center"><ConnectKitButton label="Connect wallet" /></div>
              ) : (
                <>
                  <div className="mono text-xs rounded-xl px-3 py-2.5 truncate" style={{ background: 'rgba(26,47,110,0.05)', color: '#0f1c35' }}>{address}</div>
                  {referralField}
                  <button onClick={() => void submitWallet()} disabled={busy} className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl font-semibold text-sm text-white active:scale-[0.98]" style={cta(busy)}>
                    <Wallet size={16} /> {busy ? 'Signing…' : 'Sign and continue'}
                  </button>
                </>
              )}
            </div>
          )}

          <p className="text-xs text-center text-pretty" style={{ color: '#8a849c' }}>
            By continuing, you accept the{' '}
            <button type="button" className="underline" onClick={() => onOpenLegal('terms')}>terms of use</button> and the{' '}
            <button type="button" className="underline" onClick={() => onOpenLegal('privacy')}>privacy policy</button>.
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-6">
          <TokenUSDC variant="branded" size={14} />
          <span className="text-xs" style={{ color: '#8a849c' }}>Payments in USDC on Arc</span>
        </div>
      </div>
    </div>
  )
}

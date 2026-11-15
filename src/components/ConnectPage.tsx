import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Mail, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { Card, PageTitle, inputStyle, primaryBtn, ghostBtn } from '../ui'

function XMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
}

const NOT_VERIFIED = (
  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--muted)' }}>Not verified</span>
)

function Section({ icon, title, children, status }: { icon: React.ReactNode; title: string; children: React.ReactNode; status?: React.ReactNode }) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--ink)' }}>
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(26,47,110,0.08)', color: 'var(--accent)' }}>{icon}</span>
          {title}
        </div>
        {status}
      </div>
      {children}
    </Card>
  )
}

/** Un nom de réseau social : saisie, enregistrement et suppression. Le nom n'est pas vérifié. */
function Handle({ field, label, prefix, current, placeholder, href }: {
  field: 'xHandle' | 'telegramHandle'; label: string; prefix: string; current: string | null; placeholder: string; href: (h: string) => string
}) {
  const { refresh } = useAuth()
  const qc = useQueryClient()
  const [value, setValue] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const save = async (next: string) => {
    setBusy(true)
    try {
      await api('/me/social', { body: { [field]: next } })
      await refresh()
      await qc.invalidateQueries({ queryKey: ['leaderboard'] })
      if (!next) setValue('')
      toast.success(next ? `${label} saved.` : `${label} removed.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      {current && (
        <a href={href(current)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{prefix}{current}</a>
      )}
      <div className="flex gap-2 flex-wrap">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label={label} maxLength={80}
          style={{ ...inputStyle, flex: '1 1 180px' }} />
        <button onClick={() => void save(value.trim())} disabled={busy || value.trim() === (current ?? '')}
          className="px-4 rounded-xl text-sm font-semibold min-h-[40px]" style={primaryBtn(busy || value.trim() === (current ?? ''))}>
          {busy ? 'Saving…' : current ? 'Update' : 'Connect'}
        </button>
        {current && (
          <button onClick={() => void save('')} disabled={busy} aria-label={`Remove ${label}`}
            className="px-3 rounded-xl text-sm font-semibold min-h-[40px] flex items-center gap-1" style={ghostBtn}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  )
}

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span>
        <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>{label}</span>
        <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-5 h-5 shrink-0" style={{ accentColor: 'var(--accent)' }} />
    </label>
  )
}

function EmailBox() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  if (!user) return null
  if (user.email) {
    return (
      <Section icon={<Mail size={16} />} title="Email"
        status={user.emailVerified ? <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--success)' }}><BadgeCheck size={14} /> Confirmed</span> : <span className="text-xs font-semibold" style={{ color: '#b7791f' }}>Not confirmed yet</span>}>
        <p className="text-sm" style={{ color: 'var(--ink)' }}>{user.email}</p>
        {!user.emailVerified && <p className="text-xs" style={{ color: 'var(--muted)' }}>Confirm it from the banner at the top or from Settings.</p>}
      </Section>
    )
  }
  const send = async () => {
    setBusy(true)
    try {
      await api('/me/email', { body: { email: email.trim() } })
      setSent(true)
      toast.success('Check your inbox and spam folder for the confirmation link.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send the email.') } finally { setBusy(false) }
  }
  return (
    <Section icon={<Mail size={16} />} title="Email">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>Add an email to get notifications and to reset your access. It is saved only after you click the link we send.</p>
      {sent ? (
        <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Link sent to {email.trim()}. Open it on this device to finish.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email address" style={{ ...inputStyle, flex: '1 1 200px' }} />
          <button onClick={() => void send()} disabled={busy || !email.includes('@')} className="px-4 rounded-xl text-sm font-semibold min-h-[40px]" style={primaryBtn(busy || !email.includes('@'))}>
            {busy ? 'Sending…' : 'Send link'}
          </button>
        </div>
      )}
    </Section>
  )
}

export default function ConnectPage() {
  const { user, refresh } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const setFlag = async (key: 'leaderboardVisible' | 'showLinks', value: boolean) => {
    setBusy(true)
    try {
      await api('/me/social', { body: { [key]: value } })
      await refresh()
      await qc.invalidateQueries({ queryKey: ['leaderboard'] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Connect" sub="Add your email, X and Telegram so people can find you." />
      <EmailBox />
      <Section icon={<XMark />} title="X" status={user.xHandle ? NOT_VERIFIED : undefined}>
        <Handle key={`x-${user.xHandle ?? ''}`} field="xHandle" label="X handle" prefix="@" current={user.xHandle} placeholder="@yourhandle" href={(h) => `https://x.com/${h}`} />
      </Section>
      <Section icon={<Send size={16} />} title="Telegram" status={user.telegramHandle ? NOT_VERIFIED : undefined}>
        <Handle key={`tg-${user.telegramHandle ?? ''}`} field="telegramHandle" label="Telegram username" prefix="@" current={user.telegramHandle} placeholder="@yourusername" href={(h) => `https://t.me/${h}`} />
      </Section>
      <Card className="p-5 space-y-4">
        <div className="font-semibold" style={{ color: 'var(--ink)' }}>Visibility</div>
        <Switch checked={user.leaderboardVisible} disabled={busy} onChange={(v) => void setFlag('leaderboardVisible', v)}
          label="Show me on the leaderboard" hint="Only your username and results appear. Your wallet and email are never shown." />
        <Switch checked={user.showLinks} disabled={busy || !user.leaderboardVisible} onChange={(v) => void setFlag('showLinks', v)}
          label="Show my X and Telegram on the leaderboard" hint="Off by default. Turn it on to let people reach you." />
      </Card>
      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        X and Telegram names are added by you and are not verified yet, so anyone could type any name. Never share your password or recovery phrase with anyone who contacts you.
      </p>
    </div>
  )
}

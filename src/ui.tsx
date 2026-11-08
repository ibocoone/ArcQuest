import type { CSSProperties, ReactNode } from 'react'
import { ExternalLink, Inbox, Loader2 } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'

export const ARC_ID = 5042002

export const glass: CSSProperties = {
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.68)',
  boxShadow: '0 8px 32px rgba(15,28,53,0.07), inset 0 1px 0 rgba(255,255,255,0.55)',
}

export const inputStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.60)',
  border: '1px solid rgba(15,28,53,0.12)',
  borderRadius: 12,
  padding: '10px 14px',
  fontSize: 13,
  color: 'var(--ink)',
  outline: 'none',
}

export const primaryBtn = (disabled = false): CSSProperties => ({
  background: disabled ? 'var(--subtle)' : 'var(--accent)',
  color: 'white',
  boxShadow: disabled ? 'none' : '0 4px 16px rgba(26,47,110,0.22)',
  cursor: disabled ? 'not-allowed' : 'pointer',
})

export const ghostBtn: CSSProperties = {
  background: 'rgba(26,47,110,0.07)',
  border: '1px solid rgba(26,47,110,0.12)',
  color: 'var(--accent)',
}

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`rounded-2xl overflow-hidden ${className}`} style={{ ...glass, ...style }}>{children}</div>
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <h1 className="display font-bold text-2xl text-balance" style={{ color: 'var(--ink)' }}>{title}</h1>
        {sub && <p className="text-sm mt-1 text-pretty" style={{ color: 'var(--muted)' }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--muted)' }}>{children}</label>
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-4" style={{ color: 'var(--muted)' }}>
      <Inbox size={28} className="mx-auto mb-2 opacity-25" />
      <div className="text-sm font-medium">{title}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex justify-center py-12" style={{ color: 'var(--subtle)' }}>
      <Loader2 className="animate-spin" size={22} />
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
      {message}
    </div>
  )
}

const PILLS: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending', color: '#a0700a', bg: 'rgba(255,205,131,0.25)' },
  approved:  { label: 'Approved', color: 'var(--success)', bg: 'rgba(26,128,71,0.10)' },
  rejected:  { label: 'Rejected', color: 'var(--danger)', bg: 'rgba(186,43,76,0.09)' },
  winner:    { label: 'Winner', color: 'var(--success)', bg: 'rgba(26,128,71,0.10)' },
  open:      { label: 'Open', color: 'var(--accent)', bg: 'rgba(26,47,110,0.08)' },
  closed:    { label: 'Closed', color: 'var(--muted)', bg: 'rgba(15,28,53,0.07)' },
  removed:   { label: 'Removed', color: 'var(--danger)', bg: 'rgba(186,43,76,0.09)' },
  draft:     { label: 'Not sent', color: 'var(--muted)', bg: 'rgba(15,28,53,0.07)' },
  disputed:  { label: 'Disputed', color: '#a0700a', bg: 'rgba(255,205,131,0.25)' },
  refunded:  { label: 'Returned to creator', color: 'var(--muted)', bg: 'rgba(15,28,53,0.07)' },
  split:     { label: 'Split 50/50', color: 'var(--accent)', bg: 'rgba(26,47,110,0.08)' },
}

export function Pill({ status }: { status: string }) {
  const p = PILLS[status] ?? { label: status, color: 'var(--muted)', bg: 'rgba(15,28,53,0.07)' }
  return <span className="text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: p.bg, color: p.color }}>{p.label}</span>
}

export function TxLink({ hash, label = 'View transaction' }: { hash: string; label?: string }) {
  return (
    <a href={buildTxExplorerUrl(ARC_ID, hash)} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
      {label} <ExternalLink size={11} />
    </a>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (id: T) => void
}) {
  return (
    <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'rgba(15,28,53,0.06)' }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className="flex-1 min-h-[40px] px-3 rounded-lg text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-1.5"
          style={{ background: value === t.id ? 'white' : 'transparent', color: value === t.id ? 'var(--accent)' : 'var(--muted)', boxShadow: value === t.id ? '0 1px 4px rgba(15,28,53,0.10)' : 'none' }}>
          {t.label}
          {!!t.badge && <span className="text-xs px-1.5 rounded-full text-white" style={{ background: 'var(--accent)' }}>{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}

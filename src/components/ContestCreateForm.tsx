import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatUnits } from 'viem'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { toRawUsdc, useTxGate, useVaultActions, useVaultBalance } from '../hooks/useVault'
import { Card, ErrorBox, Label, inputStyle, primaryBtn } from '../ui'

export const CONTEST_TYPES = [
  { id: 'meme', label: 'Meme' }, { id: 'contenu', label: 'Content' }, { id: 'referral', label: 'Referrals' },
  { id: 'video', label: 'Video' }, { id: 'autre', label: 'Other' },
]
const DAY = 86_400
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
const inDays = (d: number) => new Date(Date.now() + d * DAY * 1000).toISOString().slice(0, 16)

export default function ContestCreateForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const { balance } = useVaultBalance()
  const { fundTask } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null)
  const [f, setF] = useState({ title: '', description: '', prompt: '', type: 'meme', endsAt: inDays(14), slots: '100' })
  const [prizes, setPrizes] = useState([{ place: '1st', amount: '' }])
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const valid = prizes.every((p) => /^\d+(\.\d{1,6})?$/.test(p.amount) && Number(p.amount) > 0)
  const poolRaw = valid ? prizes.reduce((s, p) => s + toRawUsdc(p.amount), 0n) : 0n
  const pool = Number(formatUnits(poolRaw, 6))
  const enough = pool <= balance

  const register = async (payload: Record<string, unknown>) => {
    await api('/contests', { body: payload })
    setRetry(null)
    toast.success('Contest published. The prize pool is reserved in the contract.')
    await qc.invalidateQueries({ queryKey: ['contests'] })
    await qc.invalidateQueries({ queryKey: ['my-contests'] })
    onClose()
  }

  const submit = async () => {
    if (retry) {
      setBusy(true)
      try { await register(retry) } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
      return
    }
    if (f.title.trim().length < 3) return void toast.error('The title is too short.')
    if (f.description.trim().length < 10) return void toast.error('The description is too short (10 characters min.).')
    if (f.prompt.trim().length < 10) return void toast.error('The instructions are too short (10 characters min.).')
    if (!valid) return void toast.error('Each prize must have a valid amount.')
    const slots = Number(f.slots)
    if (!Number.isInteger(slots) || slots < 1) return void toast.error('Invalid number of places.')
    const ends = new Date(f.endsAt)
    if (!(ends.getTime() > Date.now() + 3_600_000)) return void toast.error('The end date must be more than one hour away.')
    if (!enough) return void toast.error(`Insufficient balance: you need $${pool.toFixed(2)}, you have $${balance.toFixed(2)}.`)

    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const refundableAfter = Math.min(Math.floor(ends.getTime() / 1000) + 7 * DAY, now + 360 * DAY)
    setBusy(true)
    let hash: string
    try { hash = await fundTask(id, poolRaw, refundableAfter) } catch (e) {
      setBusy(false)
      const m = e instanceof Error ? e.message : ''
      return void toast.error(/rejected|denied/i.test(m) ? 'Transaction cancelled.' : 'Funding failed. Please try again.')
    }
    const payload = { id, title: f.title.trim(), description: f.description.trim(), prompt: f.prompt.trim(), type: f.type, endsAt: ends.toISOString(), slots, prizes, fundTx: hash }
    try { await register(payload) } catch (e) {
      setRetry(payload)
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Create a contest</span>
        <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center" style={{ color: 'var(--muted)' }}><X size={16} /></button>
      </div>
      <div className="p-5 space-y-4">
        {gate.message && <ErrorBox message={gate.message} />}
        <div><Label>Title *</Label><input style={inputStyle} maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div><Label>Description *</Label><textarea style={{ ...inputStyle, minHeight: 64 }} maxLength={1000} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div><Label>What participants must submit *</Label><textarea style={{ ...inputStyle, minHeight: 64 }} maxLength={2000} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Type</Label>
            <select style={inputStyle} value={f.type} onChange={(e) => set('type', e.target.value)}>{CONTEST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <div><Label>Max participants</Label><input style={inputStyle} inputMode="numeric" value={f.slots} onChange={(e) => set('slots', e.target.value)} /></div>
        </div>
        <div><Label>End date *</Label><input type="datetime-local" style={inputStyle} value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></div>

        <div>
          <Label>Prizes (USDC) *</Label>
          <div className="space-y-2">
            {prizes.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input style={{ ...inputStyle, width: 90 }} value={p.place} maxLength={20} aria-label="Rank" onChange={(e) => setPrizes((a) => a.map((x, j) => j === i ? { ...x, place: e.target.value } : x))} />
                <input style={inputStyle} inputMode="decimal" placeholder="Amount" aria-label="Amount" value={p.amount} onChange={(e) => setPrizes((a) => a.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                {prizes.length > 1 && <button onClick={() => setPrizes((a) => a.filter((_, j) => j !== i))} aria-label="Remove this prize" className="w-11 h-11 flex-shrink-0 flex items-center justify-center" style={{ color: 'var(--danger)' }}><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
          {prizes.length < 10 && (
            <button onClick={() => setPrizes((a) => [...a, { place: ORD[a.length] ?? `${a.length + 1}th`, amount: '' }])} className="min-h-[44px] mt-1 inline-flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              <Plus size={14} /> Add a prize
            </button>
          )}
        </div>

        {poolRaw > 0n && (
          <div className="rounded-xl px-4 py-3 flex items-center text-sm" style={{ background: enough ? 'rgba(26,128,71,0.07)' : 'rgba(186,43,76,0.07)' }}>
            <span className="flex-1" style={{ color: 'var(--ink)' }}>Prize pool to reserve <strong className="tabular-nums" style={{ color: enough ? 'var(--success)' : 'var(--danger)' }}>${pool.toFixed(2)}</strong></span>
            <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>Balance: ${balance.toFixed(2)}</span>
          </div>
        )}
        {retry && <ErrorBox message="Funds are reserved but the contest is not registered. Tap to retry (no new transaction)." />}
        <button onClick={() => void submit()} disabled={busy || !gate.ok} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn(busy || !gate.ok)}>
          {busy ? 'In progress…' : retry ? 'Retry registration' : 'Reserve the prize pool and publish'}
        </button>
      </div>
    </Card>
  )
}

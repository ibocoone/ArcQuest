import { useState } from 'react'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { formatUnits } from 'viem'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { toRawUsdc, useTxGate, useVaultActions, useVaultBalance } from '../hooks/useVault'
import { Card, ErrorBox, Label, inputStyle, primaryBtn } from '../ui'
import { TASK_TYPES } from './TaskOffers'

const DAY = 86_400
const inDays = (d: number) => new Date(Date.now() + d * DAY * 1000).toISOString().slice(0, 16)

export default function TaskCreateForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const { balance } = useVaultBalance()
  const { createJob } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null)
  const [f, setF] = useState({ title: '', description: '', instructions: '', type: 'social', platform: '', url: '', reward: '', slots: '', deadline: inDays(7), reviewDays: '3' })
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const rewardOk = /^\d+(\.\d{1,6})?$/.test(f.reward) && Number(f.reward) > 0
  const slotsN = Number(f.slots)
  const slotsOk = Number.isInteger(slotsN) && slotsN >= 1
  const costRaw = rewardOk && slotsOk ? toRawUsdc(f.reward) * BigInt(slotsN) : 0n
  const cost = Number(formatUnits(costRaw, 6))
  const enough = cost <= balance

  const register = async (payload: Record<string, unknown>) => {
    await api('/tasks', { body: payload })
    setRetry(null)
    toast.success('Task published. Funds are reserved in the contract.')
    await qc.invalidateQueries({ queryKey: ['tasks'] })
    await qc.invalidateQueries({ queryKey: ['my-tasks'] })
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
    if (f.instructions.trim().length < 10) return void toast.error('The instructions are too short (10 characters min.).')
    if (!rewardOk) return void toast.error('Invalid reward (6 decimals max).')
    if (!slotsOk) return void toast.error('Invalid number of places.')
    const deadline = new Date(f.deadline)
    if (!(deadline.getTime() > Date.now() + 3_600_000)) return void toast.error('The deadline must be more than one hour away.')
    if (!enough) return void toast.error(`Insufficient balance: you need $${cost.toFixed(2)}, you have $${balance.toFixed(2)}. Make a deposit first.`)

    const id = crypto.randomUUID()
    const deadlineSec = Math.floor(deadline.getTime() / 1000)
    setBusy(true)
    let hash: string
    try {
      hash = await createJob(id, toRawUsdc(f.reward), slotsN, deadlineSec, Number(f.reviewDays))
    } catch (e) {
      setBusy(false)
      const msg = e instanceof Error ? e.message : ''
      return void toast.error(/rejected|denied/i.test(msg) ? 'Transaction cancelled.' : 'Funding failed. Please try again.')
    }
    const payload = {
      id, title: f.title.trim(), description: f.description.trim(), instructions: f.instructions.trim(), type: f.type,
      platform: f.platform.trim() || undefined, url: f.url.trim() || undefined, reward: f.reward, slots: slotsN,
      deadline: deadline.toISOString(), reviewDays: Number(f.reviewDays), fundTx: hash,
    }
    try { await register(payload) } catch (e) {
      setRetry(payload)
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Publish a task</span>
        <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center" style={{ color: 'var(--muted)' }}><X size={16} /></button>
      </div>
      <div className="p-5 space-y-4">
        {gate.message && <ErrorBox message={gate.message} />}
        <div><Label>Title *</Label><input style={inputStyle} maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Follow the account and comment" /></div>
        <div><Label>Description *</Label><textarea style={{ ...inputStyle, minHeight: 64 }} maxLength={1000} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div><Label>Detailed instructions *</Label><textarea style={{ ...inputStyle, minHeight: 88 }} maxLength={2000} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Steps to follow and expected proof" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Type</Label>
            <select style={inputStyle} value={f.type} onChange={(e) => set('type', e.target.value)}>
              {TASK_TYPES.filter((t) => t.id).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select></div>
          <div><Label>Platform</Label><input style={inputStyle} maxLength={60} value={f.platform} onChange={(e) => set('platform', e.target.value)} placeholder="X, YouTube…" /></div>
        </div>
        <div><Label>Task link</Label><input style={inputStyle} value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Reward (USDC) *</Label><input style={inputStyle} inputMode="decimal" value={f.reward} onChange={(e) => set('reward', e.target.value)} placeholder="0.50" /></div>
          <div><Label>Places *</Label><input style={inputStyle} inputMode="numeric" value={f.slots} onChange={(e) => set('slots', e.target.value)} placeholder="10" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Deadline *</Label><input type="datetime-local" style={inputStyle} value={f.deadline} onChange={(e) => set('deadline', e.target.value)} /></div>
          <div><Label>Review time</Label>
            <select style={inputStyle} value={f.reviewDays} onChange={(e) => set('reviewDays', e.target.value)}>
              {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
            </select></div>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          After a worker submits, you have this long to approve or reject. If you do nothing, the worker is paid automatically from the funds you reserved.
        </p>

        {costRaw > 0n && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm" style={{ background: enough ? 'rgba(26,128,71,0.07)' : 'rgba(186,43,76,0.07)' }}>
            <TokenUSDC variant="branded" size={16} />
            <span className="flex-1" style={{ color: 'var(--ink)' }}>Total cost <strong className="tabular-nums" style={{ color: enough ? 'var(--success)' : 'var(--danger)' }}>${cost.toFixed(2)}</strong></span>
            <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>Balance: ${balance.toFixed(2)}</span>
          </div>
        )}
        {retry && <ErrorBox message="Funds are reserved but the task is not registered. Tap to retry (do not send another transaction)." />}
        <button onClick={() => void submit()} disabled={busy || !gate.ok} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn(busy || !gate.ok)}>
          {busy ? 'In progress…' : retry ? 'Retry registration' : 'Reserve funds and publish'}
        </button>
      </div>
    </Card>
  )
}

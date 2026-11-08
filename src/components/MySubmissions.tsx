import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { ARBITER_TIMEOUT_SECONDS, DISPUTE_WINDOW_SECONDS } from '@/contracts/vault'
import { useTxGate, useVaultActions } from '../hooks/useVault'
import { DAY_SECONDS, formatLeft, nowSec, toSec } from '../lib/time'
import { Card, Empty, ErrorBox, Loading, Pill, primaryBtn } from '../ui'

interface Item {
  id: string; status: string; rejectReason: string | null; createdAt: string; claimAt: string | null; statusAt: string | null
  taskId: string; title: string; reward: string; reviewDays: number
}

function Row({ s }: { s: Item }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const { finalizeClaim, disputeClaim, expireDispute } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const worker = user?.walletAddress as `0x${string}` | undefined

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await api(`/submissions/${s.id}/sync`, { body: {} })
      await Promise.all(['my-submissions', 'stats', 'activity'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.success(label)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(/rejected|denied/i.test(msg) ? 'Transaction cancelled.' : 'The action failed. Please try again.')
    } finally { setBusy(false) }
  }

  const refresh = async () => {
    setBusy(true)
    try {
      await api(`/submissions/${s.id}/sync`, { body: {} })
      await qc.invalidateQueries({ queryKey: ['my-submissions'] })
    } catch { toast.error('Could not refresh. Try again in a moment.') } finally { setBusy(false) }
  }

  const now = nowSec()
  const reviewEnds = toSec(s.claimAt) + s.reviewDays * DAY_SECONDS
  const disputeEnds = toSec(s.statusAt) + DISPUTE_WINDOW_SECONDS
  const arbiterEnds = toSec(s.statusAt) + ARBITER_TIMEOUT_SECONDS
  const final = ['approved', 'refunded', 'split'].includes(s.status)

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{s.title}</span>
            <Pill status={s.status} />
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>Sent {fmtDate(s.createdAt)}</div>
        </div>
        <span className="font-bold tabular-nums text-sm" style={{ color: s.status === 'approved' ? 'var(--success)' : 'var(--muted)' }}>{usdc(s.reward)}</span>
      </div>

      {s.status === 'pending' && (
        <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
          {now < reviewEnds
            ? `The creator has ${formatLeft(reviewEnds - now)} left to review. If they do nothing, you are paid automatically.`
            : 'The review time is over. You can collect your payment now.'}
        </p>
      )}
      {s.status === 'rejected' && (
        <div className="space-y-1 text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
          <p style={{ color: 'var(--danger)' }}>{s.rejectReason ? `Reason: ${s.rejectReason}` : 'The creator rejected this submission.'}</p>
          <p>{now <= disputeEnds
            ? `You can dispute this for ${formatLeft(disputeEnds - now)}. An arbiter will then decide. If you do nothing, the reward goes back to the creator.`
            : 'The dispute period is over. The reward goes back to the creator.'}</p>
        </div>
      )}
      {s.status === 'disputed' && (
        <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
          {now < arbiterEnds
            ? `Waiting for the arbiter. If there is no decision within ${formatLeft(arbiterEnds - now)}, the reward is split 50/50.`
            : 'The arbiter did not decide in time. Anyone can now split the reward 50/50.'}
        </p>
      )}
      {s.status === 'approved' && <p className="text-sm" style={{ color: 'var(--success)' }}>Paid. The reward is in your ArcQuest balance.</p>}
      {s.status === 'refunded' && <p className="text-sm" style={{ color: 'var(--muted)' }}>The reward went back to the creator.</p>}
      {s.status === 'split' && <p className="text-sm" style={{ color: 'var(--muted)' }}>The reward was split 50/50 between you and the creator.</p>}

      {!gate.ok && !final && gate.message && <ErrorBox message={gate.message} />}

      <div className="flex gap-2 flex-wrap">
        {s.status === 'pending' && now >= reviewEnds && worker && (
          <button disabled={busy || !gate.ok} onClick={() => void run('Payment collected.', () => finalizeClaim(s.taskId, worker))}
            className="px-4 min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>Collect payment</button>
        )}
        {s.status === 'rejected' && now <= disputeEnds && (
          <button disabled={busy || !gate.ok} onClick={() => void run('Dispute sent to the arbiter.', () => disputeClaim(s.taskId))}
            className="px-4 min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>Dispute</button>
        )}
        {s.status === 'disputed' && now >= arbiterEnds && worker && (
          <button disabled={busy || !gate.ok} onClick={() => void run('Reward split 50/50.', () => expireDispute(s.taskId, worker))}
            className="px-4 min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>Split 50/50</button>
        )}
        {!final && (
          <button disabled={busy} onClick={() => void refresh()} className="px-3 min-h-[44px] rounded-xl text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
            <RefreshCw size={14} /> Check status
          </button>
        )}
      </div>
    </Card>
  )
}

export default function MySubmissions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-submissions'], queryFn: () => api<{ items: Item[] }>('/me/submissions'), refetchInterval: 30_000,
  })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="No submissions" sub="Pick a task in the Offers tab and send your proof." /></Card>
  return <div className="space-y-3">{data.items.map((s) => <Row key={s.id} s={s} />)}</div>
}

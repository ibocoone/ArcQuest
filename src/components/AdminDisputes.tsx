import { useState } from 'react'
import { ExternalLink, Gavel } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { api, fmtDate, uploadUrl, usdc } from '../api'
import { ARBITER_TIMEOUT_SECONDS } from '@/contracts/vault'
import { useArbiter, useVaultActions } from '../hooks/useVault'
import { formatLeft, nowSec, toSec } from '../lib/time'
import { Card, Empty, ErrorBox, Loading, primaryBtn } from '../ui'

interface Dispute {
  id: string; taskId: string; title: string; reward: string; reviewDays: number
  proofUrl: string | null; proofFile: string | null; note: string | null; rejectReason: string | null
  disputedAt: string | null; worker: string; workerWallet: string | null; creator: string; creatorWallet: string | null
}

function Item({ d, isArbiter }: { d: Dispute; isArbiter: boolean }) {
  const qc = useQueryClient()
  const { resolveDispute, expireDispute } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const wallet = d.workerWallet as `0x${string}` | null
  const deadline = toSec(d.disputedAt) + ARBITER_TIMEOUT_SECONDS
  const now = nowSec()
  const expired = now >= deadline

  const run = async (okText: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await api(`/submissions/${d.id}/sync`, { body: {} })
      toast.success(okText)
      await Promise.all(['admin-disputes', 'admin-overview'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast.error(/rejected|denied/i.test(m) ? 'Transaction cancelled.' : 'The action failed. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{d.title}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
            Worker @{d.worker} · Creator @{d.creator} · disputed {d.disputedAt ? fmtDate(d.disputedAt) : ''}
          </div>
        </div>
        <span className="font-bold tabular-nums text-sm" style={{ color: 'var(--ink)' }}>{usdc(d.reward)}</span>
      </div>
      <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(26,47,110,0.05)' }}>
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Worker's proof</div>
        {d.proofUrl && <a href={d.proofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm break-all" style={{ color: 'var(--accent)' }}>{d.proofUrl} <ExternalLink size={12} /></a>}
        {d.proofFile && <a href={uploadUrl(d.proofFile)} target="_blank" rel="noopener noreferrer"><img src={uploadUrl(d.proofFile)} alt="Screenshot provided" className="max-h-56 rounded-lg border" style={{ borderColor: 'var(--border)' }} /></a>}
        {d.note && <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{d.note}</p>}
        <div className="text-xs font-semibold uppercase tracking-wider pt-1" style={{ color: 'var(--muted)' }}>Creator's reason for rejecting</div>
        <p className="text-sm text-pretty" style={{ color: d.rejectReason ? 'var(--danger)' : 'var(--muted)' }}>{d.rejectReason ?? 'No reason given.'}</p>
      </div>

      {expired ? (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>The decision time is over. The reward can only be split 50/50 now.</p>
          {wallet && <button disabled={busy} onClick={() => void run('Reward split 50/50.', () => expireDispute(d.taskId, wallet))} className="px-4 min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(busy)}>Split 50/50</button>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{formatLeft(deadline - now)} left to decide. After that the reward is split 50/50.</p>
          {!isArbiter && <ErrorBox message="Connect the arbiter wallet to decide this dispute." />}
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy || !isArbiter || !wallet} onClick={() => wallet && void run('Worker paid.', () => resolveDispute(d.taskId, wallet, true))}
              className="px-4 min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn(busy || !isArbiter || !wallet)}>Pay the worker</button>
            <button disabled={busy || !isArbiter || !wallet} onClick={() => wallet && void run('Reward returned to the creator.', () => resolveDispute(d.taskId, wallet, false))}
              className="px-4 min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: busy || !isArbiter ? 'var(--subtle)' : 'rgba(186,43,76,0.10)', color: busy || !isArbiter ? 'white' : 'var(--danger)' }}>Refund the creator</button>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function AdminDisputes() {
  const arbiter = useArbiter()
  const { address } = useAccount()
  const isArbiter = !!arbiter && !!address && arbiter.toLowerCase() === address.toLowerCase()
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-disputes'], queryFn: () => api<{ items: Dispute[] }>('/admin/disputes'), refetchInterval: 30_000 })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
        <Gavel size={14} className="mt-0.5 flex-shrink-0" />
        <span>The arbiter can only pay the worker or refund the creator. Decisions are made onchain from the arbiter wallet{arbiter ? ` (${arbiter.slice(0, 6)}…${arbiter.slice(-4)})` : ''}.</span>
      </div>
      {!data?.items.length ? <Card><Empty title="No open disputes" sub="Disputed rejections appear here." /></Card> : data.items.map((d) => <Item key={d.id} d={d} isArbiter={isArbiter} />)}
    </div>
  )
}

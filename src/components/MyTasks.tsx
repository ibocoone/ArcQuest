import { useState } from 'react'
import { Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, uploadUrl, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { DISPUTE_WINDOW_SECONDS, ARBITER_TIMEOUT_SECONDS } from '@/contracts/vault'
import { useJob, useTxGate, useVaultActions } from '../hooks/useVault'
import { DAY_SECONDS, formatLeft, nowSec, toSec } from '../lib/time'
import { Card, Empty, ErrorBox, Loading, Pill, inputStyle, primaryBtn } from '../ui'

interface MyTask {
  id: string; title: string; reward: string; slots: number; taken: number; pending: number; disputed: number
  deadline: string; status: string; reviewDays: number; protocol: number
}
interface Sub {
  id: string; status: string; proofUrl: string | null; proofFile: string | null; note: string | null
  rejectReason: string | null; createdAt: string; claimAt: string | null; statusAt: string | null; worker: string; workerWallet: string | null
}

const errText = (e: unknown, fb: string) => {
  const m = e instanceof Error ? e.message : ''
  return /rejected|denied/i.test(m) ? 'Transaction cancelled.' : m || fb
}

function SubmissionRow({ task, s }: { task: MyTask; s: Sub }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const job = useJob(task.id)
  const { approveClaim, rejectClaim, releaseRejected, expireDispute } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const wallet = s.workerWallet as `0x${string}` | null

  const refresh = async () => {
    await Promise.all(['task-subs', 'my-tasks', 'stats', 'tasks', 'activity'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    await job.refetch()
  }
  const run = async (okText: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await api(`/submissions/${s.id}/sync`, { body: {} })
      toast.success(okText)
      await refresh()
    } catch (e) { toast.error(errText(e, 'Action failed.')) } finally { setBusy(false) }
  }

  const reject = async () => {
    if (!wallet) return
    setBusy(true)
    try {
      await rejectClaim(task.id, wallet)
      await api(`/submissions/${s.id}/sync`, { body: {} })
      await api(`/submissions/${s.id}/reject-reason`, { body: { reason: reason.trim() } })
      toast.success('Submission rejected. The worker can dispute it within 7 days.')
      setRejecting(false)
      await refresh()
    } catch (e) { toast.error(errText(e, 'Action failed.')) } finally { setBusy(false) }
  }

  const now = nowSec()
  const reviewEnds = toSec(s.claimAt) + task.reviewDays * DAY_SECONDS
  const disputeEnds = toSec(s.statusAt) + DISPUTE_WINDOW_SECONDS
  const arbiterEnds = toSec(s.statusAt) + ARBITER_TIMEOUT_SECONDS

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,28,53,0.08)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>@{s.worker}</span>
        <Pill status={s.status} />
        <span className="text-xs ml-auto" style={{ color: 'var(--subtle)' }}>{fmtDate(s.createdAt)}</span>
      </div>
      {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm break-all" style={{ color: 'var(--accent)' }}>{s.proofUrl} <ExternalLink size={12} /></a>}
      {s.proofFile && <a href={uploadUrl(s.proofFile)} target="_blank" rel="noopener noreferrer"><img src={uploadUrl(s.proofFile)} alt="Screenshot provided" className="max-h-56 rounded-lg border" style={{ borderColor: 'var(--border)' }} /></a>}
      {s.note && <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{s.note}</p>}
      {s.rejectReason && <p className="text-xs" style={{ color: 'var(--danger)' }}>Reason: {s.rejectReason}</p>}
      {!wallet && <p className="text-xs" style={{ color: 'var(--danger)' }}>This participant has no linked wallet.</p>}
      {gate.message && s.status !== 'approved' && <p className="text-xs" style={{ color: 'var(--danger)' }}>{gate.message}</p>}

      {s.status === 'pending' && (
        <>
          <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            {now < reviewEnds
              ? `You have ${formatLeft(reviewEnds - now)} left to approve or reject. After that the worker is paid automatically.`
              : 'The review time is over: the worker can now collect the payment automatically.'}
          </p>
          {rejecting ? (
            <div className="space-y-2">
              <input style={inputStyle} maxLength={300} placeholder="Reason for rejection (visible to the participant)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => setRejecting(false)} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--muted)' }}>Cancel</button>
                <button onClick={() => void reject()} disabled={reason.trim().length < 3 || busy || !gate.ok} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white"
                  style={{ background: reason.trim().length < 3 || busy || !gate.ok ? 'var(--subtle)' : 'var(--danger)' }}>{busy ? 'Working…' : 'Confirm rejection'}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {now < reviewEnds && (
                <button onClick={() => setRejecting(true)} disabled={busy} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}><X size={15} /> Reject</button>
              )}
              <button onClick={() => wallet && void run(`${usdc(task.reward)} paid to @${s.worker}.`, () => approveClaim(task.id, wallet))} disabled={busy || !gate.ok || !wallet}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5" style={primaryBtn(busy || !gate.ok || !wallet)}>
                <Check size={15} /> {busy ? 'Paying…' : `Approve and pay ${usdc(task.reward)}`}
              </button>
            </div>
          )}
        </>
      )}

      {s.status === 'rejected' && (
        <>
          <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            {now <= disputeEnds
              ? `The worker can dispute for ${formatLeft(disputeEnds - now)}. If they do not, you can release the funds back to your task.`
              : 'The dispute period is over. Release the funds so they return to your task.'}
          </p>
          {now > disputeEnds && wallet && (
            <button onClick={() => void run('Funds released back to your task.', () => releaseRejected(task.id, wallet))} disabled={busy || !gate.ok}
              className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>{busy ? 'Working…' : 'Release funds'}</button>
          )}
        </>
      )}

      {s.status === 'disputed' && (
        <>
          <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            {now < arbiterEnds
              ? `Disputed by the worker. The arbiter decides. If there is no decision within ${formatLeft(arbiterEnds - now)}, the reward is split 50/50.`
              : 'The arbiter did not decide in time. You can now split the reward 50/50.'}
          </p>
          {now >= arbiterEnds && wallet && (
            <button onClick={() => void run('Reward split 50/50.', () => expireDispute(task.id, wallet))} disabled={busy || !gate.ok}
              className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>{busy ? 'Working…' : 'Split 50/50'}</button>
          )}
        </>
      )}
      {s.status === 'refunded' && <p className="text-xs" style={{ color: 'var(--muted)' }}>The reward went back to your task funds.</p>}
      {s.status === 'split' && <p className="text-xs" style={{ color: 'var(--muted)' }}>The reward was split 50/50.</p>}
    </div>
  )
}

function TaskReview({ task }: { task: MyTask }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const job = useJob(task.id)
  const { reclaimJob } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['task-subs', task.id], queryFn: () => api<{ items: Sub[] }>(`/tasks/${task.id}/submissions`), refetchInterval: 30_000 })
  const deadlinePassed = nowSec() > toSec(task.deadline)

  const close = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/close`, { body: {} }),
    onSuccess: async () => { toast.success('Task closed to new submissions.'); await qc.invalidateQueries({ queryKey: ['my-tasks'] }); await qc.invalidateQueries({ queryKey: ['tasks'] }) },
  })
  const reclaim = async () => {
    setBusy(true)
    try {
      await reclaimJob(task.id)
      toast.success(`${usdc(job.escrow)} recovered to your balance.`)
      await job.refetch()
      await qc.invalidateQueries({ queryKey: ['activity'] })
    } catch (e) { toast.error(errText(e, 'Refund failed.')) } finally { setBusy(false) }
  }

  if (task.protocol !== 2) {
    return <div className="px-4 pb-4 text-sm" style={{ color: 'var(--muted)' }}>This task was created with an earlier version of the contract and is closed.</div>
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs" style={{ color: 'var(--muted)' }}>
        <span>Free funds: <strong className="tabular-nums" style={{ color: 'var(--ink)' }}>{usdc(job.escrow)}</strong></span>
        <span>Locked for pending claims: <strong className="tabular-nums" style={{ color: 'var(--ink)' }}>{usdc(job.locked)}</strong></span>
        <span>Review time: {task.reviewDays} day{task.reviewDays > 1 ? 's' : ''}</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {task.status === 'open' && <button onClick={() => close.mutate()} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--ink-2)' }}>Close to new submissions</button>}
        {deadlinePassed && job.escrow > 0 && (
          <button onClick={() => void reclaim()} disabled={busy || !gate.ok} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>
            {busy ? 'Refunding…' : `Recover ${usdc(job.escrow)}`}
          </button>
        )}
      </div>
      {!deadlinePassed && <p className="text-xs" style={{ color: 'var(--muted)' }}>Unused funds can be recovered after the deadline ({fmtDate(task.deadline)}).</p>}
      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : (data?.items.length ?? 0) === 0
        ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No submissions yet.</p>
        : <div className="space-y-2">{data?.items.map((s) => <SubmissionRow key={s.id} task={task} s={s} />)}</div>}
    </div>
  )
}

export default function MyTasks() {
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['my-tasks'], queryFn: () => api<{ items: MyTask[] }>('/me/tasks'), refetchInterval: 30_000 })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="You have not published any task" sub={'Use "Publish a task" to fund and launch your first one.'} /></Card>

  return (
    <div className="space-y-3">
      {data.items.map((t) => (
        <Card key={t.id}>
          <button className="w-full text-left p-4 flex items-center gap-3" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{t.title}</span>
                <Pill status={t.status} />
                {t.pending > 0 && <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: 'var(--accent)' }}>{t.pending} to review</span>}
                {t.disputed > 0 && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,205,131,0.35)', color: '#a0700a' }}>{t.disputed} disputed</span>}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{usdc(t.reward)} · {t.taken}/{t.slots} places · deadline {fmtDate(t.deadline)}</div>
            </div>
            <ChevronDown size={16} style={{ color: 'var(--subtle)', transform: open === t.id ? 'rotate(180deg)' : 'none' }} />
          </button>
          {open === t.id && <TaskReview task={t} />}
        </Card>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, uploadUrl, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { useEscrow, useTxGate, useVaultActions } from '../hooks/useVault'
import { Card, Empty, ErrorBox, Loading, Pill, TxLink, inputStyle, primaryBtn } from '../ui'

interface MyTask { id: string; title: string; reward: string; slots: number; taken: number; pending: number; deadline: string; status: string }
interface Sub {
  id: string; status: string; proofUrl: string | null; proofFile: string | null; note: string | null
  rejectReason: string | null; payTx: string | null; createdAt: string; worker: string; workerWallet: string | null
}

const nowSec = () => Math.floor(Date.now() / 1000)
const errText = (e: unknown, fb: string) => {
  const m = e instanceof Error ? e.message : ''
  return /rejected|denied/i.test(m) ? 'Transaction cancelled.' : m || fb
}

function SubmissionRow({ task, s }: { task: MyTask; s: Sub }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const escrow = useEscrow(task.id)
  const { releaseReward } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const refresh = async () => {
    await Promise.all(['task-subs', 'my-tasks', 'stats', 'tasks'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    await escrow.refetch()
  }

  const pendingKey = `pay:${s.id}`
  const hasPendingTx = !!localStorage.getItem(pendingKey)
  const rewardNum = Number(task.reward)
  const canPay = gate.ok && !!s.workerWallet && (escrow.amount >= rewardNum || hasPendingTx)

  const approve = async () => {
    if (!s.workerWallet) return
    setBusy(true)
    try {
      // si un paiement a déjà été envoyé mais pas enregistré, on le réutilise : jamais deux paiements
      let hash = localStorage.getItem(pendingKey)
      if (!hash) {
        hash = await releaseReward(task.id, s.workerWallet as `0x${string}`, task.reward)
        localStorage.setItem(pendingKey, hash)
      }
      await api(`/submissions/${s.id}/approve`, { body: { txHash: hash } })
      localStorage.removeItem(pendingKey)
      toast.success(`${usdc(task.reward)} paid to @${s.worker}.`)
      await refresh()
    } catch (e) { toast.error(errText(e, 'Payment failed.')) } finally { setBusy(false) }
  }

  const reject = useMutation({
    mutationFn: () => api(`/submissions/${s.id}/reject`, { body: { reason } }),
    onSuccess: async () => { toast.success('Submission rejected.'); setRejecting(false); await refresh() },
    onError: (e) => toast.error(errText(e, 'Action failed.')),
  })

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
      {s.payTx && <TxLink hash={s.payTx} label="Payment" />}

      {s.status === 'pending' && (
        rejecting ? (
          <div className="space-y-2">
            <input style={inputStyle} maxLength={300} placeholder="Reason for rejection (visible to the participant)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setRejecting(false)} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--muted)' }}>Cancel</button>
              <button onClick={() => reject.mutate()} disabled={reason.trim().length < 3 || reject.isPending} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white"
                style={{ background: reason.trim().length < 3 ? 'var(--subtle)' : 'var(--danger)' }}>Confirm rejection</button>
            </div>
          </div>
        ) : (
          <>
            {!s.workerWallet && <p className="text-xs" style={{ color: 'var(--danger)' }}>This participant has no linked wallet.</p>}
            {gate.message && <p className="text-xs" style={{ color: 'var(--danger)' }}>{gate.message}</p>}
            {gate.ok && escrow.amount < rewardNum && !hasPendingTx && <p className="text-xs" style={{ color: 'var(--danger)' }}>Not enough reserve in the contract.</p>}
            <div className="flex gap-2">
              <button onClick={() => setRejecting(true)} disabled={busy} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}><X size={15} /> Reject</button>
              <button onClick={() => void approve()} disabled={busy || !canPay} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5" style={primaryBtn(busy || !canPay)}>
                <Check size={15} /> {busy ? 'Paying…' : hasPendingTx ? 'Finalize payment' : `Approve and pay ${usdc(task.reward)}`}
              </button>
            </div>
          </>
        )
      )}
    </div>
  )
}

function TaskReview({ task }: { task: MyTask }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const escrow = useEscrow(task.id)
  const { refundTask } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['task-subs', task.id], queryFn: () => api<{ items: Sub[] }>(`/tasks/${task.id}/submissions`) })
  const unlocked = escrow.refundableAfter > 0 && nowSec() >= escrow.refundableAfter

  const close = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/close`, { body: {} }),
    onSuccess: async () => { toast.success('Task closed to new submissions.'); await qc.invalidateQueries({ queryKey: ['my-tasks'] }); await qc.invalidateQueries({ queryKey: ['tasks'] }) },
  })
  const refund = async () => {
    setBusy(true)
    try {
      await refundTask(task.id, escrow.raw)
      toast.success(`${usdc(escrow.amount)} recovered to your balance.`)
      await escrow.refetch()
    } catch (e) { toast.error(errText(e, 'Refund failed.')) } finally { setBusy(false) }
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--muted)' }}>
        <span>Remaining reserve : <strong className="tabular-nums" style={{ color: 'var(--ink)' }}>{usdc(escrow.amount)}</strong></span>
        {escrow.refundableAfter > 0 && !unlocked && <span>· recoverable from {fmtDate(new Date(escrow.refundableAfter * 1000))}</span>}
      </div>
      <div className="flex gap-2 flex-wrap">
        {task.status === 'open' && <button onClick={() => close.mutate()} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--ink-2)' }}>Close to new submissions</button>}
        {unlocked && escrow.amount > 0 && (
          <button onClick={() => void refund()} disabled={busy || !gate.ok} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>
            {busy ? 'Refunding…' : `Recover ${usdc(escrow.amount)}`}
          </button>
        )}
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : (data?.items.length ?? 0) === 0
        ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No submissions yet.</p>
        : <div className="space-y-2">{data?.items.map((s) => <SubmissionRow key={s.id} task={task} s={s} />)}</div>}
    </div>
  )
}

export default function MyTasks() {
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['my-tasks'], queryFn: () => api<{ items: MyTask[] }>('/me/tasks') })
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
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{usdc(t.reward)} · {t.taken}/{t.slots} places · limite {fmtDate(t.deadline)}</div>
            </div>
            <ChevronDown size={16} style={{ color: 'var(--subtle)', transform: open === t.id ? 'rotate(180deg)' : 'none' }} />
          </button>
          {open === t.id && <TaskReview task={t} />}
        </Card>
      ))}
    </div>
  )
}

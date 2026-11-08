import { useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, Link2, Search, Users } from 'lucide-react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { useTxGate, useVaultActions } from '../hooks/useVault'
import { Card, Empty, ErrorBox, Loading, Pill, inputStyle, primaryBtn } from '../ui'
import ProofFields, { buildProof, emptyProof, type ProofValue } from './ProofFields'
import { buildShareLink } from '../lib/share'
import { nowSec, toSec } from '../lib/time'
import ReportButton from './ReportButton'

export const TASK_TYPES = [
  { id: '', label: 'All' }, { id: 'social', label: 'Social' }, { id: 'video', label: 'Video' },
  { id: 'community', label: 'Community' }, { id: 'manuel', label: 'Manual' }, { id: 'autre', label: 'Other' },
]

interface Task {
  id: string; title: string; description: string; instructions?: string; type: string; platform: string | null
  url: string | null; reward: string; slots: number; taken: number; deadline: string; creator: string
  creatorId: string; myStatus: string | null; reviewDays: number; status: string
}

const STEP_TEXT = {
  permit: 'Checking your submission…',
  wallet: 'Confirm in your wallet…',
  chain: 'Waiting for confirmation…',
} as const

function SubmitForm({ task }: { task: Task }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const { submitClaim } = useVaultActions()
  const [proof, setProof] = useState<ProofValue>(emptyProof)
  const [step, setStep] = useState<keyof typeof STEP_TEXT | null>(null)

  const send = async () => {
    setStep('permit')
    try {
      // 1) le serveur vérifie la preuve et remet une autorisation signée
      const permit = await api<{ submissionId: string; expiry: number; signature: `0x${string}` }>(`/tasks/${task.id}/claim-permit`, { body: await buildProof(proof) })
      // 2) le travailleur enregistre sa soumission dans le contrat (petits frais de réseau)
      setStep('wallet')
      await submitClaim(task.id, permit.expiry, permit.signature)
      // 3) le serveur relit l'état du contrat
      setStep('chain')
      await api(`/submissions/${permit.submissionId}/sync`, { body: {} })
      toast.success(`Submission sent. The creator has ${task.reviewDays} day${task.reviewDays > 1 ? 's' : ''} to review it, otherwise you are paid automatically.`)
      setProof(emptyProof)
      await Promise.all(['tasks', 'my-submissions', 'stats'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(/rejected|denied/i.test(msg) ? 'Transaction cancelled. Your proof is saved: tap Send again to continue.' : msg || 'Could not send.')
    } finally {
      setStep(null)
    }
  }

  const noWallet = !user?.walletAddress
  const empty = !proof.url.trim() && !proof.file
  const busy = step !== null
  const blocked = busy || noWallet || empty || !gate.ok

  return (
    <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      {noWallet ? <ErrorBox message="Link a wallet to your account (Settings) to receive your payment." /> : gate.message && <ErrorBox message={gate.message} />}
      <ProofFields value={proof} onChange={setProof} />
      <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
        Your submission is registered in the contract (small network fee). The creator has {task.reviewDays} day{task.reviewDays > 1 ? 's' : ''} to approve or reject it. If they do nothing, you are paid automatically.
      </p>
      <button onClick={() => void send()} disabled={blocked}
        className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn(blocked)}>
        {step ? STEP_TEXT[step] : 'Send my proof'}
      </button>
    </div>
  )
}

function CopyLink({ id }: { id: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await buildShareLink(`/?task=${id}`))
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch { toast.error('Could not copy the link.') }
  }
  return (
    <button onClick={() => void copy()} className="inline-flex items-center gap-1.5 min-h-[44px] px-1 text-sm font-medium" style={{ color: 'var(--accent)' }}>
      {done ? <Check size={14} /> : <Link2 size={14} />} {done ? 'Link copied' : 'Copy link'}
    </button>
  )
}

function TaskCard({ task, defaultOpen = false }: { task: Task; defaultOpen?: boolean }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(defaultOpen)
  const left = task.slots - task.taken
  const mine = task.creatorId === user?.id
  const available = task.status === 'open' && toSec(task.deadline) > nowSec()
  const canSubmit = available && !mine && (!task.myStatus || task.myStatus === 'draft') && left > 0

  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left p-4 flex items-start gap-3" aria-expanded={open}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{task.title}</span>
            {task.myStatus && task.myStatus !== 'draft' && <Pill status={task.myStatus} />}
            {mine && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,47,110,0.08)', color: 'var(--accent)' }}>Your task</span>}
          </div>
          <p className="text-xs mt-1 line-clamp-2 text-pretty" style={{ color: 'var(--muted)' }}>{task.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--subtle)' }}>
            <span className="flex items-center gap-1"><Users size={12} /> {left > 0 ? `${left} place${left > 1 ? 's' : ''}` : 'Full'}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> before {fmtDate(task.deadline)}</span>
            <span>by @{task.creator}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="flex items-center gap-1 font-bold tabular-nums text-sm" style={{ color: 'var(--success)' }}>
            <TokenUSDC variant="branded" size={14} /> {usdc(task.reward)}
          </span>
          <ChevronDown size={16} style={{ color: 'var(--subtle)', transform: open ? 'rotate(180deg)' : 'none' }} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="rounded-xl p-3 text-sm text-pretty whitespace-pre-wrap" style={{ background: 'rgba(26,47,110,0.05)', color: 'var(--ink-2)' }}>{task.instructions}</div>
          {task.url && (
            <a href={task.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              Open the task link <ExternalLink size={13} />
            </a>
          )}
          {canSubmit && <SubmitForm task={task} />}
          {!canSubmit && !mine && !task.myStatus && !available && <p className="text-sm" style={{ color: 'var(--muted)' }}>This task is closed.</p>}
          {!canSubmit && !mine && !task.myStatus && available && left <= 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>All places are taken.</p>}
          <div className="flex items-center gap-4 flex-wrap">
            <CopyLink id={task.id} />
            {!mine && <ReportButton type="task" id={task.id} />}
          </div>
        </div>
      )}
    </Card>
  )
}

function SharedTask({ id, onDismiss }: { id: string; onDismiss?: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['task', id], queryFn: () => api<Task>(`/tasks/${id}`) })
  if (isLoading) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Shared with you</span>
        <button onClick={onDismiss} className="min-h-[44px] px-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>Hide</button>
      </div>
      {error ? <ErrorBox message="This task is no longer available." /> : data && <TaskCard task={data} defaultOpen />}
    </div>
  )
}

export default function TaskOffers({ sharedTask, onDismissShared }: { sharedTask?: string | null; onDismissShared?: () => void }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tasks', q, type, page],
    queryFn: () => api<{ items: Task[]; total: number; pageSize: number }>(`/tasks?q=${encodeURIComponent(q)}&type=${type}&page=${page}&pageSize=10`),
    placeholderData: keepPreviousData,
    // Les tâches publiées par les autres comptes apparaissent sans recharger la page
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  })
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 10)))

  return (
    <div className="space-y-3">
      {sharedTask && <SharedTask id={sharedTask} onDismiss={onDismissShared} />}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
          <input style={{ ...inputStyle, paddingLeft: 38, minHeight: 44 }} placeholder="Search for a task" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </div>
        <button onClick={() => void refetch()} disabled={isFetching} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex-shrink-0"
          style={{ background: 'rgba(26,47,110,0.07)', color: 'var(--accent)', opacity: isFetching ? 0.6 : 1 }}>
          {isFetching ? 'Updating…' : 'Refresh'}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TASK_TYPES.map((t) => (
          <button key={t.id} onClick={() => { setType(t.id); setPage(1) }} className="min-h-[40px] px-3.5 rounded-full text-sm font-medium whitespace-nowrap"
            style={{ background: type === t.id ? 'var(--accent)' : 'rgba(26,47,110,0.07)', color: type === t.id ? 'white' : 'var(--accent)' }}>{t.label}</button>
        ))}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : (data?.items.length ?? 0) === 0 ? (
        <Card><Empty title="No tasks available" sub={q || type ? 'Try another filter.' : 'Publish the first task with the button at the top of the page.'} /></Card>
      ) : (
        <div className="space-y-3">{data?.items.map((t) => <TaskCard key={t.id} task={t} />)}</div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page" className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(26,47,110,0.07)', opacity: page === 1 ? 0.4 : 1 }}><ChevronLeft size={18} /></button>
          <span className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>Page {page} / {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} aria-label="Next page" className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(26,47,110,0.07)', opacity: page === pages ? 0.4 : 1 }}><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  )
}

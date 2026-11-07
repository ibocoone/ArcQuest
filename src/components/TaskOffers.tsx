import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, Search, Users } from 'lucide-react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { Card, Empty, ErrorBox, Loading, Pill, inputStyle, primaryBtn } from '../ui'
import ProofFields, { buildProof, emptyProof, type ProofValue } from './ProofFields'
import ReportButton from './ReportButton'

export const TASK_TYPES = [
  { id: '', label: 'Tout' }, { id: 'social', label: 'Social' }, { id: 'video', label: 'Vidéo' },
  { id: 'community', label: 'Communauté' }, { id: 'manuel', label: 'Manuel' }, { id: 'autre', label: 'Autre' },
]

interface Task {
  id: string; title: string; description: string; instructions?: string; type: string; platform: string | null
  url: string | null; reward: string; slots: number; taken: number; deadline: string; creator: string
  creatorId: string; myStatus: string | null
}

function SubmitForm({ task }: { task: Task }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [proof, setProof] = useState<ProofValue>(emptyProof)
  const mut = useMutation({
    mutationFn: async () => api(`/tasks/${task.id}/submissions`, { body: await buildProof(proof) }),
    onSuccess: async () => {
      toast.success("Soumission envoyée. Le créateur va l'examiner.")
      setProof(emptyProof)
      await Promise.all(['tasks', 'my-submissions', 'stats'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Envoi impossible.'),
  })
  const noWallet = !user?.walletAddress
  const empty = !proof.url.trim() && !proof.file

  return (
    <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      {noWallet && <ErrorBox message="Liez un portefeuille à votre compte (Paramètres) pour recevoir votre paiement." />}
      <ProofFields value={proof} onChange={setProof} />
      <button onClick={() => mut.mutate()} disabled={mut.isPending || noWallet || empty}
        className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn(mut.isPending || noWallet || empty)}>
        {mut.isPending ? 'Envoi…' : 'Envoyer ma preuve'}
      </button>
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const left = task.slots - task.taken
  const mine = task.creatorId === user?.id
  const canSubmit = !mine && !task.myStatus && left > 0

  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left p-4 flex items-start gap-3" aria-expanded={open}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{task.title}</span>
            {task.myStatus && <Pill status={task.myStatus} />}
            {mine && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,47,110,0.08)', color: 'var(--accent)' }}>Votre tâche</span>}
          </div>
          <p className="text-xs mt-1 line-clamp-2 text-pretty" style={{ color: 'var(--muted)' }}>{task.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--subtle)' }}>
            <span className="flex items-center gap-1"><Users size={12} /> {left > 0 ? `${left} place${left > 1 ? 's' : ''}` : 'Complet'}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> avant le {fmtDate(task.deadline)}</span>
            <span>par @{task.creator}</span>
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
              Ouvrir le lien de la tâche <ExternalLink size={13} />
            </a>
          )}
          {canSubmit && <SubmitForm task={task} />}
          {!canSubmit && !mine && !task.myStatus && left <= 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>Toutes les places sont prises.</p>}
          {!mine && <ReportButton type="task" id={task.id} />}
        </div>
      )}
    </Card>
  )
}

export default function TaskOffers() {
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
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
          <input style={{ ...inputStyle, paddingLeft: 38, minHeight: 44 }} placeholder="Rechercher une tâche" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </div>
        <button onClick={() => void refetch()} disabled={isFetching} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex-shrink-0"
          style={{ background: 'rgba(26,47,110,0.07)', color: 'var(--accent)', opacity: isFetching ? 0.6 : 1 }}>
          {isFetching ? 'Mise à jour…' : 'Actualiser'}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TASK_TYPES.map((t) => (
          <button key={t.id} onClick={() => { setType(t.id); setPage(1) }} className="min-h-[40px] px-3.5 rounded-full text-sm font-medium whitespace-nowrap"
            style={{ background: type === t.id ? 'var(--accent)' : 'rgba(26,47,110,0.07)', color: type === t.id ? 'white' : 'var(--accent)' }}>{t.label}</button>
        ))}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : (data?.items.length ?? 0) === 0 ? (
        <Card><Empty title="Aucune tâche disponible" sub={q || type ? 'Essayez un autre filtre.' : 'Publiez la première tâche depuis le bouton en haut de la page.'} /></Card>
      ) : (
        <div className="space-y-3">{data?.items.map((t) => <TaskCard key={t.id} task={t} />)}</div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Page précédente" className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(26,47,110,0.07)', opacity: page === 1 ? 0.4 : 1 }}><ChevronLeft size={18} /></button>
          <span className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>Page {page} / {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} aria-label="Page suivante" className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(26,47,110,0.07)', opacity: page === pages ? 0.4 : 1 }}><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { ChevronDown, Clock, Plus, Users } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { Card, Empty, ErrorBox, Loading, PageTitle, Pill, Tabs, TxLink, primaryBtn } from '../ui'
import ContestCreateForm from './ContestCreateForm'
import MyContests from './MyContests'
import ProofFields, { buildProof, emptyProof, type ProofValue } from './ProofFields'
import ReportButton from './ReportButton'

interface Contest {
  id: string; title: string; description: string; prompt: string; endsAt: string; slots: number
  prizes: { place: string; amount: string }[]; prizePool: string; creator: string; creatorId: string; entries: number; myStatus: string | null
}
interface MyEntry { id: string; status: string; prizePlace: string | null; prizeAmount: string | null; payTx: string | null; createdAt: string; title: string }

type Tab = 'open' | 'entries' | 'mine'

function EntryForm({ contest }: { contest: Contest }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [proof, setProof] = useState<ProofValue>(emptyProof)
  const empty = !proof.url.trim() && !proof.file && !proof.note.trim()
  const mut = useMutation({
    mutationFn: async () => api(`/contests/${contest.id}/entries`, { body: await buildProof(proof) }),
    onSuccess: async () => {
      toast.success('Participation envoyée.')
      setProof(emptyProof)
      await Promise.all(['contests', 'my-entries'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Envoi impossible.'),
  })
  const noWallet = !user?.walletAddress
  return (
    <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      {noWallet && <ErrorBox message="Liez un portefeuille à votre compte (Paramètres) pour recevoir un prix." />}
      <ProofFields value={proof} onChange={setProof} />
      <button onClick={() => mut.mutate()} disabled={mut.isPending || noWallet || empty} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn(mut.isPending || noWallet || empty)}>
        {mut.isPending ? 'Envoi…' : 'Participer'}
      </button>
    </div>
  )
}

function ContestCard({ c }: { c: Contest }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const mine = c.creatorId === user?.id
  const full = c.entries >= c.slots
  return (
    <Card>
      <button className="w-full text-left p-4 flex items-start gap-3" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{c.title}</span>
            {c.myStatus && <Pill status={c.myStatus} />}
          </div>
          <p className="text-xs mt-1 line-clamp-2 text-pretty" style={{ color: 'var(--muted)' }}>{c.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--subtle)' }}>
            <span className="flex items-center gap-1"><Users size={12} /> {c.entries}/{c.slots}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> fin le {fmtDate(c.endsAt)}</span>
            <span>par @{c.creator}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="flex items-center gap-1 font-bold tabular-nums text-sm" style={{ color: 'var(--success)' }}><TokenUSDC variant="branded" size={14} /> {usdc(c.prizePool)}</span>
          <ChevronDown size={16} style={{ color: 'var(--subtle)', transform: open ? 'rotate(180deg)' : 'none' }} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="rounded-xl p-3 text-sm whitespace-pre-wrap text-pretty" style={{ background: 'rgba(26,47,110,0.05)', color: 'var(--ink-2)' }}>{c.prompt}</div>
          <div className="flex gap-2 flex-wrap">
            {c.prizes.map((p) => <span key={p.place} className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}>{p.place} : {usdc(p.amount)}</span>)}
          </div>
          {!mine && !c.myStatus && !full && <EntryForm contest={c} />}
          {!mine && !c.myStatus && full && <p className="text-sm" style={{ color: 'var(--muted)' }}>Toutes les places sont prises.</p>}
          {!mine && <ReportButton type="contest" id={c.id} />}
        </div>
      )}
    </Card>
  )
}

function OpenContests() {
  const { data, isLoading, error } = useQuery({ queryKey: ['contests'], queryFn: () => api<{ items: Contest[] }>('/contests') })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="Aucun concours en cours" sub="Créez le premier avec le bouton en haut de la page." /></Card>
  return <div className="space-y-3">{data.items.map((c) => <ContestCard key={c.id} c={c} />)}</div>
}

function MyEntries() {
  const { data, isLoading, error } = useQuery({ queryKey: ['my-entries'], queryFn: () => api<{ items: MyEntry[] }>('/me/entries') })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="Aucune participation" /></Card>
  return (
    <div className="space-y-3">
      {data.items.map((e) => (
        <Card key={e.id} className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{e.title}</span><Pill status={e.status} /></div>
              <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>Envoyée le {fmtDate(e.createdAt)}</div>
              {e.payTx && <TxLink hash={e.payTx} label="Voir le paiement" />}
            </div>
            {e.prizeAmount && <span className="font-bold tabular-nums text-sm" style={{ color: 'var(--success)' }}>{e.prizePlace} · {usdc(e.prizeAmount)}</span>}
          </div>
        </Card>
      ))}
    </div>
  )
}

export default function ContestsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(['open', 'entries', 'mine'].includes(initialTab ?? '') ? (initialTab as Tab) : 'open')
  const [creating, setCreating] = useState(false)
  return (
    <div className="space-y-4">
      <PageTitle title="Concours" sub="Participez pour gagner des prix en USDC, ou lancez le vôtre."
        action={!creating && <button onClick={() => { setCreating(true); setTab('mine') }} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5 flex-shrink-0" style={primaryBtn()}><Plus size={16} /> Créer</button>} />
      {creating && <ContestCreateForm onClose={() => setCreating(false)} />}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'open', label: 'En cours' }, { id: 'entries', label: 'Mes participations' }, { id: 'mine', label: 'Mes concours' }]} />
      {tab === 'open' && <OpenContests />}
      {tab === 'entries' && <MyEntries />}
      {tab === 'mine' && <MyContests />}
    </div>
  )
}

import { useState } from 'react'
import { Award, ChevronDown, ExternalLink, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, uploadUrl, usdc } from '../api'
import { useAuth } from '../context/AuthContext'
import { useEscrow, useTxGate, useVaultActions } from '../hooks/useVault'
import { Card, Empty, ErrorBox, Loading, Pill, TxLink, inputStyle, primaryBtn } from '../ui'

interface Prize { place: string; amount: string }
export interface MyContest { id: string; title: string; endsAt: string; prizes: Prize[]; prizePool: string; status: string; entries: number }
interface Entry {
  id: string; status: string; proofUrl: string | null; proofFile: string | null; note: string | null
  prizePlace: string | null; payTx: string | null; createdAt: string; user: string; userWallet: string | null
}

const nowSec = () => Math.floor(Date.now() / 1000)
const errText = (e: unknown, fb: string) => {
  const m = e instanceof Error ? e.message : ''
  return /rejected|denied/i.test(m) ? 'Transaction cancelled.' : m || fb
}

function EntryRow({ contest, e, free }: { contest: MyContest; e: Entry; free: Prize[] }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const { releaseReward } = useVaultActions()
  const [place, setPlace] = useState(free[0]?.place ?? '')
  const [busy, setBusy] = useState(false)
  const refresh = async () => { await Promise.all(['contest-entries', 'my-contests', 'stats'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) }
  const prize = free.find((p) => p.place === place)
  const pendingKey = `award:${e.id}:${place}`
  const hasPending = !!localStorage.getItem(pendingKey)

  const award = async () => {
    if (!prize || !e.userWallet) return
    setBusy(true)
    try {
      let hash = localStorage.getItem(pendingKey)
      if (!hash) {
        hash = await releaseReward(contest.id, e.userWallet as `0x${string}`, prize.amount)
        localStorage.setItem(pendingKey, hash)
      }
      await api(`/entries/${e.id}/award`, { body: { prizePlace: place, txHash: hash } })
      localStorage.removeItem(pendingKey)
      toast.success(`${usdc(prize.amount)} paid to @${e.user}.`)
      await refresh()
    } catch (err) { toast.error(errText(err, 'Payment failed.')) } finally { setBusy(false) }
  }
  const reject = useMutation({
    mutationFn: () => api(`/entries/${e.id}/reject`, { body: {} }),
    onSuccess: refresh,
    onError: (err) => toast.error(errText(err, 'Action failed.')),
  })

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(15,28,53,0.08)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>@{e.user}</span>
        <Pill status={e.status} />
        {e.prizePlace && <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>{e.prizePlace}</span>}
        <span className="text-xs ml-auto" style={{ color: 'var(--subtle)' }}>{fmtDate(e.createdAt)}</span>
      </div>
      {e.proofUrl && <a href={e.proofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm break-all" style={{ color: 'var(--accent)' }}>{e.proofUrl} <ExternalLink size={12} /></a>}
      {e.proofFile && <a href={uploadUrl(e.proofFile)} target="_blank" rel="noopener noreferrer"><img src={uploadUrl(e.proofFile)} alt="Entry image" className="max-h-56 rounded-lg border" style={{ borderColor: 'var(--border)' }} /></a>}
      {e.note && <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{e.note}</p>}
      {e.payTx && <TxLink hash={e.payTx} label="Prize payment" />}
      {e.status === 'pending' && (
        <div className="space-y-2">
          {gate.message && <p className="text-xs" style={{ color: 'var(--danger)' }}>{gate.message}</p>}
          {!e.userWallet && <p className="text-xs" style={{ color: 'var(--danger)' }}>This participant has no linked wallet.</p>}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => reject.mutate()} disabled={busy} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}><X size={15} /> Dismiss</button>
            {free.length > 0 ? (
              <>
                <select style={{ ...inputStyle, width: 'auto', minHeight: 44 }} value={place} onChange={(ev) => setPlace(ev.target.value)} aria-label="Prize to award">
                  {free.map((p) => <option key={p.place} value={p.place}>{p.place} · {usdc(p.amount)}</option>)}
                </select>
                <button onClick={() => void award()} disabled={busy || !gate.ok || !e.userWallet || !prize} className="flex-1 min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5" style={primaryBtn(busy || !gate.ok || !e.userWallet)}>
                  <Award size={15} /> {busy ? 'Paying…' : hasPending ? 'Finalize payment' : 'Award and pay'}
                </button>
              </>
            ) : <span className="text-xs self-center" style={{ color: 'var(--muted)' }}>All prizes are awarded.</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function ContestReview({ contest }: { contest: MyContest }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const gate = useTxGate(user?.walletAddress)
  const escrow = useEscrow(contest.id)
  const { refundTask } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['contest-entries', contest.id], queryFn: () => api<{ items: Entry[] }>(`/contests/${contest.id}/entries`) })
  const used = new Set((data?.items ?? []).map((e) => e.prizePlace).filter(Boolean))
  const free = contest.prizes.filter((p) => !used.has(p.place))
  const unlocked = escrow.refundableAfter > 0 && nowSec() >= escrow.refundableAfter

  const close = useMutation({
    mutationFn: () => api(`/contests/${contest.id}/close`, { body: {} }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['my-contests'] }); await qc.invalidateQueries({ queryKey: ['contests'] }) },
  })
  const refund = async () => {
    setBusy(true)
    try { await refundTask(contest.id, escrow.raw); toast.success(`${usdc(escrow.amount)} recovered.`); await escrow.refetch() }
    catch (e) { toast.error(errText(e, 'Refund failed.')) } finally { setBusy(false) }
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="text-xs" style={{ color: 'var(--muted)' }}>Remaining reserve : <strong className="tabular-nums" style={{ color: 'var(--ink)' }}>{usdc(escrow.amount)}</strong>
        {escrow.refundableAfter > 0 && !unlocked && <> · recoverable from {fmtDate(new Date(escrow.refundableAfter * 1000))}</>}</div>
      <div className="flex gap-2 flex-wrap">
        {contest.status === 'open' && <button onClick={() => close.mutate()} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--ink-2)' }}>Close to new entries</button>}
        {unlocked && escrow.amount > 0 && <button onClick={() => void refund()} disabled={busy || !gate.ok} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={primaryBtn(busy || !gate.ok)}>{busy ? 'Refunding…' : `Recover ${usdc(escrow.amount)}`}</button>}
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : (data?.items.length ?? 0) === 0
        ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No entries yet.</p>
        : <div className="space-y-2">{data?.items.map((e) => <EntryRow key={e.id} contest={contest} e={e} free={free} />)}</div>}
    </div>
  )
}

export default function MyContests() {
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['my-contests'], queryFn: () => api<{ items: MyContest[] }>('/me/contests') })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="You have not created any contest" /></Card>
  return (
    <div className="space-y-3">
      {data.items.map((k) => (
        <Card key={k.id}>
          <button className="w-full text-left p-4 flex items-center gap-3" aria-expanded={open === k.id} onClick={() => setOpen(open === k.id ? null : k.id)}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{k.title}</span><Pill status={k.status} /></div>
              <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>Prize pool {usdc(k.prizePool)} · {k.entries} entries · ends {fmtDate(k.endsAt)}</div>
            </div>
            <ChevronDown size={16} style={{ color: 'var(--subtle)', transform: open === k.id ? 'rotate(180deg)' : 'none' }} />
          </button>
          {open === k.id && <ContestReview contest={k} />}
        </Card>
      ))}
    </div>
  )
}

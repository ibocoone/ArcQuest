import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { Card, Empty, ErrorBox, Loading, Pill, Tabs, TxLink, inputStyle } from '../ui'

type Kind = 'task' | 'contest'
interface Item { id: string; title: string; status: string; amount: string; slots: number; ends: string; fund_tx: string; created_at: string; creator: string; participants: number }
interface Entry { id: string; status: string; proofUrl: string | null; proofFile: string | null; note: string | null; reason: string | null; tx: string | null; createdAt: string; author: string }

const STATUS_LABEL: Record<string, string> = { open: 'En ligne', closed: 'Fermé', removed: 'Retiré' }

function Entries({ kind, id }: { kind: Kind; id: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-entries', kind, id], queryFn: () => api<{ items: Entry[] }>(`/admin/items/${kind}/${id}/entries`) })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <p className="text-sm py-2" style={{ color: 'var(--muted)' }}>Aucune participation.</p>
  return (
    <div className="space-y-2 pt-2">
      {data.items.map((e) => (
        <div key={e.id} className="rounded-xl p-3 space-y-1.5" style={{ background: 'rgba(15,28,53,0.04)' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>@{e.author}</span>
            <Pill status={e.status === 'winner' ? 'approved' : e.status} />
          </div>
          {e.note && <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{e.note}</p>}
          <div className="flex flex-wrap gap-3 text-xs">
            {e.proofUrl && <a href={e.proofUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>Ouvrir le lien de preuve</a>}
            {e.proofFile && <a href={`/api/uploads/${e.proofFile}`} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>Voir la capture</a>}
            {e.tx && <TxLink hash={e.tx} label="Paiement" />}
          </div>
          {e.reason && <p className="text-xs" style={{ color: 'var(--danger)' }}>Motif du refus : {e.reason}</p>}
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>{fmtDate(e.createdAt)}</div>
        </div>
      ))}
    </div>
  )
}

export default function AdminItems() {
  const qc = useQueryClient()
  const [kind, setKind] = useState<Kind>('task')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-items', kind, q], queryFn: () => api<{ items: Item[] }>(`/admin/items?kind=${kind}&q=${encodeURIComponent(q)}`) })
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(`/admin/items/${kind}/${v.id}/status`, { body: { status: v.status } }),
    onSuccess: () => { toast.success('Statut mis à jour.'); void qc.invalidateQueries({ queryKey: ['admin-items'] }); void qc.invalidateQueries({ queryKey: ['admin-overview'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3">
      <Tabs<Kind> value={kind} onChange={(k) => { setKind(k); setOpen(null) }} tabs={[{ id: 'task', label: 'Tâches' }, { id: 'contest', label: 'Concours' }]} />
      <input style={inputStyle} placeholder="Rechercher par titre" value={q} onChange={(e) => setQ(e.target.value)} />
      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : !data?.items.length ? <Card><Empty title="Aucun élément" /></Card> : (
        <div className="space-y-3">
          {data.items.map((it) => (
            <Card key={it.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-balance" style={{ color: 'var(--ink)' }}>{it.title}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    par @{it.creator} · {kind === 'task' ? 'récompense' : 'cagnotte'} ${usdc(it.amount)} · {it.participants}/{it.slots} participations
                  </div>
                  <div className="text-xs" style={{ color: 'var(--subtle)' }}>Jusqu'au {fmtDate(it.ends)}</div>
                </div>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: it.status === 'open' ? 'var(--success)' : 'var(--danger)' }}>{STATUS_LABEL[it.status] ?? it.status}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setOpen(open === it.id ? null : it.id)} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--ink)' }}>
                  {open === it.id ? 'Masquer' : 'Voir les participations'}
                </button>
                {it.status !== 'removed' ? (
                  <button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: it.id, status: 'removed' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}>Retirer</button>
                ) : (
                  <button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: it.id, status: 'open' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}>Remettre en ligne</button>
                )}
                <TxLink hash={it.fund_tx} label="Financement" />
              </div>
              {open === it.id && <Entries kind={kind} id={it.id} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

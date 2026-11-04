import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api, fmtDate, usdc } from '../api'
import { Card, Empty, ErrorBox, Loading, TxLink } from '../ui'

interface Payment { kind: 'task' | 'contest'; title: string; worker: string; creator: string; amount: string; tx: string; at: string }

/** Télécharge un fichier CSV construit dans le navigateur. Les cellules commençant par = + - @ sont neutralisées. */
export function downloadCsv(name: string, header: string[], lines: string[][]) {
  const cell = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v
    return `"${safe.replace(/"/g, '""')}"`
  }
  const body = [header, ...lines].map((r) => r.map(cell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function AdminPayments() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-payments'], queryFn: () => api<{ items: Payment[] }>('/admin/payments') })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="Aucun paiement confirmé" sub="Les paiements apparaissent ici dès qu'un créateur approuve une soumission." /></Card>

  const exportCsv = () => downloadCsv('paiements.csv', ['Date', 'Type', 'Titre', 'Payeur', 'Bénéficiaire', 'Montant USDC', 'Transaction'],
    data.items.map((p) => [p.at, p.kind === 'task' ? 'Tâche' : 'Concours', p.title, p.creator, p.worker, p.amount, p.tx]))

  return (
    <div className="space-y-3">
      <button onClick={exportCsv} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--ink)' }}>
        <Download size={15} /> Exporter en CSV
      </button>
      <Card className="divide-y">
        {data.items.map((p) => (
          <div key={p.tx} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{p.title}</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>@{p.creator} → @{p.worker} · {p.kind === 'task' ? 'Tâche' : 'Concours'}</div>
              <div className="text-xs" style={{ color: 'var(--subtle)' }}>{fmtDate(p.at)}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-semibold tabular-nums text-sm" style={{ color: 'var(--ink)' }}>${usdc(p.amount)}</div>
              <TxLink hash={p.tx} label="Transaction" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

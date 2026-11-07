import { useQuery } from '@tanstack/react-query'
import { api, fmtDate, usdc } from '../api'
import { Card, Empty, ErrorBox, Loading, Pill, TxLink } from '../ui'

interface Item { id: string; status: string; rejectReason: string | null; payTx: string | null; createdAt: string; title: string; reward: string }

export default function MySubmissions() {
  const { data, isLoading, error } = useQuery({ queryKey: ['my-submissions'], queryFn: () => api<{ items: Item[] }>('/me/submissions') })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="No submissions" sub="Pick a task in the Offers tab and send your proof." /></Card>
  return (
    <div className="space-y-3">
      {data.items.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{s.title}</span>
                <Pill status={s.status} />
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>Sent {fmtDate(s.createdAt)}</div>
              {s.rejectReason && <p className="text-sm mt-2 text-pretty" style={{ color: 'var(--danger)' }}>Reason for rejection: {s.rejectReason}</p>}
              {s.payTx && <div className="mt-1"><TxLink hash={s.payTx} label="View payment" /></div>}
            </div>
            <span className="font-bold tabular-nums text-sm" style={{ color: s.status === 'approved' ? 'var(--success)' : 'var(--muted)' }}>{usdc(s.reward)}</span>
          </div>
        </Card>
      ))}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { api, usdc } from '../api'
import { Card, ErrorBox, Loading } from '../ui'

interface Finance {
  vaultUsdc: string | null
  taskPaid: { count: number; total: string }
  contestPaid: { count: number; total: string }
  funded: { tasks: string; contests: string }
  daily: { day: string; users: number; submissions: number; tasks: number }[]
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--ink)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{sub}</div>}
    </Card>
  )
}

export default function AdminFinance() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-finance'], queryFn: () => api<Finance>('/admin/finance'), refetchInterval: 30_000 })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data) return null

  const paid = Number(data.taskPaid.total) + Number(data.contestPaid.total)
  const funded = Number(data.funded.tasks) + Number(data.funded.contests)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="USDC détenu par le contrat" value={data.vaultUsdc === null ? 'Indisponible' : `$${usdc(data.vaultUsdc)}`} sub="Lu directement sur Arc Testnet" />
        <Metric label="Total payé aux participants" value={`$${usdc(paid)}`} sub={`${data.taskPaid.count + data.contestPaid.count} paiements confirmés`} />
        <Metric label="Financé pour des tâches" value={`$${usdc(data.funded.tasks)}`} />
        <Metric label="Financé pour des concours" value={`$${usdc(data.funded.contests)}`} sub={`Total financé : $${usdc(funded)}`} />
      </div>
      <Card className="p-4">
        <div className="font-semibold text-sm mb-3" style={{ color: 'var(--ink)' }}>7 derniers jours</div>
        <div className="grid grid-cols-4 gap-2 text-xs font-semibold uppercase tracking-wider pb-2" style={{ color: 'var(--muted)' }}>
          <span>Jour</span><span className="text-right">Inscrits</span><span className="text-right">Tâches</span><span className="text-right">Soumissions</span>
        </div>
        {data.daily.map((d) => (
          <div key={d.day} className="grid grid-cols-4 gap-2 py-1.5 text-sm tabular-nums" style={{ color: 'var(--ink)', borderTop: '1px solid var(--border)' }}>
            <span>{d.day.slice(5)}</span><span className="text-right">{d.users}</span><span className="text-right">{d.tasks}</span><span className="text-right">{d.submissions}</span>
          </div>
        ))}
      </Card>
      <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
        Les fonds appartiennent aux utilisateurs : le contrat n'a pas d'administrateur et personne, vous compris, ne peut les déplacer. Ces chiffres servent au suivi.
      </p>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { Card, Empty, ErrorBox, Loading, PageTitle, Tabs, inputStyle } from '../ui'
import AdminFinance from './AdminFinance'
import AdminItems from './AdminItems'
import AdminPayments, { downloadCsv } from './AdminPayments'

type Tab = 'finance' | 'reports' | 'items' | 'payments' | 'users' | 'audit'
interface Overview { users: number; suspended: number; tasks: number; contests: number; pending_submissions: number; open_reports: number }
interface Report { id: string; targetType: string; targetLabel: string | null; reason: string; reporter: string; createdAt: string }
interface AdminUser {
  id: string; username: string; email: string | null; wallet: string | null; role: string; status: string; createdAt: string
  referralCode: string; referredBy: string | null; tasksCreated: number; submissions: number; approved: number; earned: string
}
interface AuditItem { id: string; action: string; target: string | null; actor: string | null; createdAt: string }

const btn = (bg: string, color: string) => ({ background: bg, color }) as const

function Reports() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-reports'], queryFn: () => api<{ items: Report[] }>('/admin/reports') })
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: string }) => api(`/admin/reports/${v.id}/resolve`, { body: { action: v.action } }),
    onSuccess: () => { toast.success('Signalement traité.'); void qc.invalidateQueries({ queryKey: ['admin-reports'] }); void qc.invalidateQueries({ queryKey: ['admin-overview'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="Aucun signalement ouvert" /></Card>
  return (
    <div className="space-y-3">
      {data.items.map((r) => (
        <Card key={r.id} className="p-4 space-y-2">
          <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{r.targetType === 'task' ? 'Tâche' : r.targetType === 'contest' ? 'Concours' : 'Utilisateur'} : {r.targetLabel ?? 'introuvable'}</div>
          <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{r.reason}</p>
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>Signalé par @{r.reporter} le {fmtDate(r.createdAt)}</div>
          <div className="flex gap-2 flex-wrap">
            {r.targetType !== 'user' && <button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'remove' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={btn('rgba(186,43,76,0.10)', 'var(--danger)')}>Retirer</button>}
            <button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'suspend' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={btn('rgba(186,43,76,0.10)', 'var(--danger)')}>Suspendre l'auteur</button>
            <button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'dismiss' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={btn('rgba(15,28,53,0.07)', 'var(--muted)')}>Ignorer</button>
          </div>
        </Card>
      ))}
    </div>
  )
}

function Users() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-users', q], queryFn: () => api<{ items: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`) })
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(`/admin/users/${v.id}/status`, { body: { status: v.status } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-users'] }); void qc.invalidateQueries({ queryKey: ['admin-overview'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input style={inputStyle} placeholder="Rechercher (nom, e-mail, portefeuille)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          disabled={!data?.items.length}
          onClick={() => data && downloadCsv('comptes.csv', ['Inscription', 'Nom', 'E-mail', 'Portefeuille', 'Statut', 'Rôle', 'Tâches publiées', 'Soumissions', 'Approuvées', 'Gagné USDC', 'Parrain'],
            data.items.map((u) => [u.createdAt, u.username, u.email ?? '', u.wallet ?? '', u.status, u.role, String(u.tasksCreated), String(u.submissions), String(u.approved), u.earned, u.referredBy ?? '']))}
          className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex-shrink-0" style={btn('rgba(15,28,53,0.07)', 'var(--ink)')}>
          CSV
        </button>
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : !data?.items.length ? <Card><Empty title="Aucun utilisateur" /></Card> : (
        <Card className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {data.items.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>@{u.username}{u.role === 'admin' ? ' (admin)' : ''}{u.status === 'suspended' ? ' (suspendu)' : ''}</div>
                <div className="text-xs truncate" style={{ color: 'var(--subtle)' }}>{u.email ?? '—'}{u.wallet ? ` · ${u.wallet}` : ''}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {u.tasksCreated} publiée(s) · {u.approved}/{u.submissions} approuvée(s) · gagné ${usdc(u.earned)}{u.referredBy ? ` · parrain @${u.referredBy}` : ''}
                </div>
                <div className="text-xs" style={{ color: 'var(--subtle)' }}>Inscrit le {fmtDate(u.createdAt)} · code {u.referralCode}</div>
              </div>
              {u.role !== 'admin' && (
                <button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}
                  className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={u.status === 'active' ? btn('rgba(186,43,76,0.10)', 'var(--danger)') : btn('rgba(26,128,71,0.10)', 'var(--success)')}>
                  {u.status === 'active' ? 'Suspendre' : 'Réactiver'}
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Audit() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<{ items: AuditItem[] }>('/admin/audit') })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="Aucune action enregistrée" /></Card>
  return (
    <Card className="divide-y">
      {data.items.map((a) => (
        <div key={a.id} className="px-4 py-3 text-sm">
          <span className="font-medium" style={{ color: 'var(--ink)' }}>{a.action}</span>
          <span style={{ color: 'var(--muted)' }}> par @{a.actor ?? 'système'}</span>
          <div className="text-xs mono truncate" style={{ color: 'var(--subtle)' }}>{a.target} · {fmtDate(a.createdAt)}</div>
        </div>
      ))}
    </Card>
  )
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('finance')
  const { data } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview') })
  const kpi = [
    ['Utilisateurs', data?.users], ['Suspendus', data?.suspended], ['Tâches ouvertes', data?.tasks],
    ['Concours ouverts', data?.contests], ['Soumissions en attente', data?.pending_submissions], ['Signalements', data?.open_reports],
  ] as const
  return (
    <div className="max-w-3xl space-y-4">
      <PageTitle title="Administration" sub="Finances, modération, comptes, paiements et journal des actions." />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {kpi.map(([label, v]) => (
          <Card key={label} className="p-4"><div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div><div className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--ink)' }}>{v ?? '—'}</div></Card>
        ))}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'finance', label: 'Finances' }, { id: 'reports', label: 'Signalements', badge: data?.open_reports },
        { id: 'items', label: 'Contenu' }, { id: 'payments', label: 'Paiements' }, { id: 'users', label: 'Comptes' }, { id: 'audit', label: 'Journal' },
      ]} />
      {tab === 'finance' && <AdminFinance />}
      {tab === 'items' && <AdminItems />}
      {tab === 'payments' && <AdminPayments />}
      {tab === 'reports' && <Reports />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}

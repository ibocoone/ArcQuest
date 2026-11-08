import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, fmtDate, usdc } from '../api'
import { Card, Empty, ErrorBox, Loading, PageTitle, Tabs, inputStyle } from '../ui'
import AdminFinance from './AdminFinance'
import AdminDisputes from './AdminDisputes'
import AdminItems from './AdminItems'
import AdminPayments, { downloadCsv } from './AdminPayments'

type Tab = 'finance' | 'disputes' | 'reports' | 'items' | 'payments' | 'users' | 'audit'
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
    onSuccess: () => { toast.success('Report handled.'); void qc.invalidateQueries({ queryKey: ['admin-reports'] }); void qc.invalidateQueries({ queryKey: ['admin-overview'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  if (isLoading) return <Loading />
  if (error) return <ErrorBox message={error.message} />
  if (!data?.items.length) return <Card><Empty title="No open reports" /></Card>
  return (
    <div className="space-y-3">
      {data.items.map((r) => (
        <Card key={r.id} className="p-4 space-y-2">
          <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{r.targetType === 'task' ? 'Task' : r.targetType === 'contest' ? 'Contest' : 'User'} : {r.targetLabel ?? 'introuvable'}</div>
          <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{r.reason}</p>
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>Reported by @{r.reporter} on {fmtDate(r.createdAt)}</div>
          <div className="flex gap-2 flex-wrap">
            {r.targetType !== 'user' && <button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'remove' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={btn('rgba(186,43,76,0.10)', 'var(--danger)')}>Remove</button>}
            <button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'suspend' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={btn('rgba(186,43,76,0.10)', 'var(--danger)')}>Suspend the author</button>
            <button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: 'dismiss' })} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={btn('rgba(15,28,53,0.07)', 'var(--muted)')}>Dismiss</button>
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
        <input style={inputStyle} placeholder="Search (name, email, wallet)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          disabled={!data?.items.length}
          onClick={() => data && downloadCsv('accounts.csv', ['Joined', 'Name', 'Email', 'Wallet', 'Status', 'Role', 'Tasks published', 'Submissions', 'Approved', 'Earned USDC', 'Referrer'],
            data.items.map((u) => [u.createdAt, u.username, u.email ?? '', u.wallet ?? '', u.status, u.role, String(u.tasksCreated), String(u.submissions), String(u.approved), u.earned, u.referredBy ?? '']))}
          className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex-shrink-0" style={btn('rgba(15,28,53,0.07)', 'var(--ink)')}>
          CSV
        </button>
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox message={error.message} /> : !data?.items.length ? <Card><Empty title="No users" /></Card> : (
        <Card className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {data.items.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>@{u.username}{u.role === 'admin' ? ' (admin)' : ''}{u.status === 'suspended' ? ' (suspendu)' : ''}</div>
                <div className="text-xs truncate" style={{ color: 'var(--subtle)' }}>{u.email ?? '—'}{u.wallet ? ` · ${u.wallet}` : ''}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {u.tasksCreated} published · {u.approved}/{u.submissions} approved · earned {usdc(u.earned)}{u.referredBy ? ` · referrer @${u.referredBy}` : ''}
                </div>
                <div className="text-xs" style={{ color: 'var(--subtle)' }}>Joined {fmtDate(u.createdAt)} · code {u.referralCode}</div>
              </div>
              {u.role !== 'admin' && (
                <button disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}
                  className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={u.status === 'active' ? btn('rgba(186,43,76,0.10)', 'var(--danger)') : btn('rgba(26,128,71,0.10)', 'var(--success)')}>
                  {u.status === 'active' ? 'Suspend' : 'Reactivate'}
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
  if (!data?.items.length) return <Card><Empty title="No actions recorded" /></Card>
  return (
    <Card className="divide-y">
      {data.items.map((a) => (
        <div key={a.id} className="px-4 py-3 text-sm">
          <span className="font-medium" style={{ color: 'var(--ink)' }}>{a.action}</span>
          <span style={{ color: 'var(--muted)' }}> by @{a.actor ?? 'system'}</span>
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
    ['Users', data?.users], ['Suspended', data?.suspended], ['Open tasks', data?.tasks],
    ['Open contests', data?.contests], ['Pending submissions', data?.pending_submissions], ['Reports', data?.open_reports],
  ] as const
  return (
    <div className="max-w-3xl space-y-4">
      <PageTitle title="Administration" sub="Finances, moderation, accounts, payments and action log." />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {kpi.map(([label, v]) => (
          <Card key={label} className="p-4"><div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div><div className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--ink)' }}>{v ?? '—'}</div></Card>
        ))}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'finance', label: 'Finances' }, { id: 'disputes', label: 'Disputes' }, { id: 'reports', label: 'Reports', badge: data?.open_reports },
        { id: 'items', label: 'Content' }, { id: 'payments', label: 'Payments' }, { id: 'users', label: 'Accounts' }, { id: 'audit', label: 'Log' },
      ]} />
      {tab === 'finance' && <AdminFinance />}
      {tab === 'disputes' && <AdminDisputes />}
      {tab === 'items' && <AdminItems />}
      {tab === 'payments' && <AdminPayments />}
      {tab === 'reports' && <Reports />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}

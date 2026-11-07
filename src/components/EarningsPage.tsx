import { ArrowDownLeft, TrendingUp } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useQuery } from '@tanstack/react-query'
import { api, fmtDate, usdc } from '../api'
import { useVaultBalance } from '../hooks/useVault'
import { Card, Empty, ErrorBox, Loading, PageTitle, TxLink, primaryBtn } from '../ui'

interface Earning { kind: 'task' | 'contest'; title: string; amount: string; tx: string | null; at: string }

export default function EarningsPage({ onNavigate }: { onNavigate: (target: string) => void }) {
  const { balance } = useVaultBalance()
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<{ earned: string; tasksDone: number; contestWins: number }>('/me/stats') })
  const list = useQuery({ queryKey: ['earnings'], queryFn: () => api<{ items: Earning[] }>('/me/earnings') })

  return (
    <div className="max-w-2xl space-y-5">
      <PageTitle title="Earnings" sub="Every earning is a payment confirmed on the blockchain." />

      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--accent)', boxShadow: '0 12px 40px rgba(26,47,110,0.25)' }}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white opacity-60 uppercase tracking-wider"><TokenUSDC variant="branded" size={14} /> Vault balance</div>
            <div className="display font-bold text-3xl tabular-nums text-white mt-1">${balance.toFixed(2)}</div>
            <div className="text-xs text-white opacity-50 mt-0.5">Withdrawable at any time</div>
          </div>
          <div className="border-l border-white/20 pl-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white opacity-60 uppercase tracking-wider"><TrendingUp size={14} /> Total earned</div>
            <div className="display font-bold text-3xl tabular-nums text-white mt-1">${Number(stats.data?.earned ?? 0).toFixed(2)}</div>
            <div className="text-xs text-white opacity-50 mt-0.5">{stats.data?.tasksDone ?? 0} tasks, {stats.data?.contestWins ?? 0} contests</div>
          </div>
        </div>
        <button onClick={() => onNavigate('wallet:withdraw')} className="w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
          style={{ background: 'white', color: 'var(--accent)' }}>
          <ArrowDownLeft size={15} /> Withdraw to my wallet
        </button>
      </div>

      <Card>
        <div className="px-5 py-4 border-b font-semibold text-sm" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>Payments received</div>
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox message={list.error.message} /></div>
          : !list.data?.items.length ? <Empty title="No earnings yet" sub="Your payments will appear here as soon as a task is approved." action={
              <button onClick={() => onNavigate('jobs')} className="min-h-[44px] px-5 rounded-xl text-sm font-semibold" style={primaryBtn()}>See tasks</button>} />
          : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {list.data.items.map((e, i) => (
                <div key={`${e.tx}-${i}`} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{e.title}</div>
                    <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--subtle)' }}>
                      <span>{e.kind === 'contest' ? 'Contests' : 'Task'} · {fmtDate(e.at)}</span>
                      {e.tx && <TxLink hash={e.tx} label="Payment" />}
                    </div>
                  </div>
                  <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--success)' }}>+{usdc(e.amount)}</div>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  )
}

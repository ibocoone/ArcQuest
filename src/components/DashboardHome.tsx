import { ArrowRight, Briefcase, Clock, Trophy, Users, Wallet } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useVaultBalance } from '../hooks/useVault'
import { Card, Loading, PageTitle, primaryBtn } from '../ui'

interface Stats {
  tasksDone: number; pendingSubmissions: number; contestWins: number; earned: string
  myOpenTasks: number; toReview: number; referrals: number; activeReferrals: number
}

function hello(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Hello' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Stat({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}><Icon size={14} /> {label}</div>
      <div className="display font-bold text-2xl tabular-nums mt-1" style={{ color: 'var(--ink)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{sub}</div>}
    </Card>
  )
}

export default function DashboardHome({ onNavigate }: { onNavigate: (target: string) => void }) {
  const { user } = useAuth()
  const { isConnected } = useAccount()
  const { balance } = useVaultBalance()
  const { data: s, isLoading } = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/me/stats') })

  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle title={`${hello()}, ${user?.fullName ?? ''}`} sub="Here is the real status of your activity on ArcQuest." />

      <div className="rounded-2xl p-5" style={{ background: 'var(--accent)', boxShadow: '0 12px 40px rgba(26,47,110,0.25)' }}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white opacity-60 uppercase tracking-wider"><TokenUSDC variant="branded" size={14} /> ArcQuest balance</div>
        <div className="display font-bold text-4xl tabular-nums text-white mt-1">{isConnected ? `$${balance.toFixed(2)}` : '—'}</div>
        <div className="text-xs text-white opacity-50 mt-0.5">{isConnected ? 'USDC in the vault, withdrawable at any time' : 'Connect your wallet to see your balance'}</div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onNavigate('wallet')} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: 'white', color: 'var(--accent)' }}>
            <Wallet size={15} /> Deposit or withdraw
          </button>
        </div>
      </div>

      {!!s?.toReview && (
        <button onClick={() => onNavigate('jobs:mine')} className="w-full min-h-[44px] rounded-2xl px-4 py-3 flex items-center gap-3 text-left"
          style={{ background: 'rgba(255,205,131,0.25)', border: '1px solid rgba(160,112,10,0.25)' }}>
          <Clock size={18} style={{ color: '#a0700a' }} />
          <span className="flex-1 text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {s.toReview} submission{s.toReview > 1 ? 's' : ''} to review on your tasks
          </span>
          <ArrowRight size={16} style={{ color: '#a0700a' }} />
        </button>
      )}

      {isLoading ? <Loading /> : (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={TokenUSDC as React.ElementType} label="Total earned" value={`$${Number(s?.earned ?? 0).toFixed(2)}`} />
          <Stat icon={Briefcase} label="Approved tasks" value={String(s?.tasksDone ?? 0)} sub={s?.pendingSubmissions ? `${s.pendingSubmissions} awaiting approval` : undefined} />
          <Stat icon={Trophy} label="Contests won" value={String(s?.contestWins ?? 0)} />
          <Stat icon={Users} label="Active referrals" value={`${s?.activeReferrals ?? 0}/${s?.referrals ?? 0}`} />
        </div>
      )}

      <Card className="p-5">
        <div className="font-semibold text-sm mb-3" style={{ color: 'var(--ink)' }}>What would you like to do?</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <button onClick={() => onNavigate('jobs')} className="min-h-[44px] rounded-xl text-sm font-semibold" style={primaryBtn()}>Find a task</button>
          <button onClick={() => onNavigate('jobs:mine')} className="min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: 'rgba(26,47,110,0.07)', color: 'var(--accent)' }}>My published tasks</button>
          <button onClick={() => onNavigate('contests')} className="min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: 'rgba(26,47,110,0.07)', color: 'var(--accent)' }}>See contests</button>
        </div>
      </Card>
    </div>
  )
}

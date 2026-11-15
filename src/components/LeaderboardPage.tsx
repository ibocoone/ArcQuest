import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Medal, Send } from 'lucide-react'
import { api, fmtDate, usdc } from '../api'
import { Card, Empty, ErrorBox, Loading, PageTitle, Tabs } from '../ui'

type Metric = 'earned' | 'tasks' | 'creators'
type Period = 'all' | '30d'

interface Row {
  rank: number
  username: string
  avatar: string
  earned: string
  tasks: number
  memberSince: string
  isMe: boolean
  links: { x: string | null; telegram: string | null } | null
}
interface Board { metric: Metric; period: Period; total: number; items: Row[]; me: Row | null }

const MEDAL: Record<number, { color: string; bg: string }> = {
  1: { color: '#b7791f', bg: 'rgba(214,158,46,0.18)' },
  2: { color: '#5f6b7a', bg: 'rgba(113,128,150,0.18)' },
  3: { color: '#a0522d', bg: 'rgba(192,112,64,0.18)' },
}

const VALUE_LABEL: Record<Metric, string> = { earned: 'earned', tasks: 'tasks done', creators: 'paid out' }

function XMark({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
}

function Links({ links }: { links: Row['links'] }) {
  if (!links) return null
  return (
    <span className="inline-flex items-center gap-2">
      {links.x && (
        <a href={`https://x.com/${links.x}`} target="_blank" rel="noopener noreferrer" aria-label={`X: @${links.x}`}
          className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
          <XMark /> @{links.x}
        </a>
      )}
      {links.telegram && (
        <a href={`https://t.me/${links.telegram}`} target="_blank" rel="noopener noreferrer" aria-label={`Telegram: @${links.telegram}`}
          className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
          <Send size={12} /> @{links.telegram}
        </a>
      )}
    </span>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const m = MEDAL[rank]
  return (
    <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
      style={{ background: m?.bg ?? 'rgba(15,28,53,0.06)', color: m?.color ?? 'var(--muted)' }}>
      {m ? <Medal size={18} /> : rank}
    </span>
  )
}

function Line({ row, metric }: { row: Row; metric: Metric }) {
  const main = metric === 'tasks' ? String(row.tasks) : usdc(row.earned)
  return (
    <li className="flex items-center gap-3 px-4 py-3" style={{ background: row.isMe ? 'rgba(26,47,110,0.06)' : 'transparent' }}>
      <RankBadge rank={row.rank} />
      <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: 'var(--accent)' }}>{row.avatar}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>@{row.username}</span>
          {row.isMe && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(26,47,110,0.12)', color: 'var(--accent)' }}>You</span>}
        </div>
        <div className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: 'var(--subtle)' }}>
          <span>{metric === 'tasks' ? usdc(row.earned) + ' earned' : `${row.tasks} task${row.tasks === 1 ? '' : 's'} done`}</span>
          <span>Member since {fmtDate(row.memberSince).split(',').slice(0, 2).join(',')}</span>
          <Links links={row.links} />
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-base font-bold" style={{ color: 'var(--ink)' }}>{main}</div>
        <div className="text-xs" style={{ color: 'var(--subtle)' }}>{VALUE_LABEL[metric]}</div>
      </div>
    </li>
  )
}

export default function LeaderboardPage({ onNavigate }: { onNavigate: (target: string) => void }) {
  const [metric, setMetric] = useState<Metric>('earned')
  const [period, setPeriod] = useState<Period>('all')
  const q = useQuery({
    queryKey: ['leaderboard', metric, period],
    queryFn: () => api<Board>(`/leaderboard?metric=${metric}&period=${period}`),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-5">
      <PageTitle title="Leaderboard" sub="Top members, from first to last. Only approved and paid work counts." />
      <Tabs<Metric> value={metric} onChange={setMetric} tabs={[
        { id: 'earned', label: 'Top earners' },
        { id: 'tasks', label: 'Most tasks' },
        { id: 'creators', label: 'Top creators' },
      ]} />
      <Tabs<Period> value={period} onChange={setPeriod} tabs={[
        { id: 'all', label: 'All time' },
        { id: '30d', label: 'Last 30 days' },
      ]} />

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={q.error instanceof Error ? q.error.message : 'Could not load the leaderboard.'} />}

      {q.data && (
        <>
          {q.data.me ? (
            <Card className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Your rank</div>
                <div className="text-2xl font-bold" style={{ color: 'var(--ink)', fontFamily: 'Space Grotesk, sans-serif' }}>#{q.data.me.rank} <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>of {q.data.total}</span></div>
              </div>
              <div className="text-right text-sm" style={{ color: 'var(--muted)' }}>
                {metric === 'tasks' ? `${q.data.me.tasks} tasks done` : `${usdc(q.data.me.earned)} ${VALUE_LABEL[metric]}`}
              </div>
            </Card>
          ) : (
            <Card className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
              You are not ranked yet. Get a task approved to appear here, or check your visibility in{' '}
              <button className="font-semibold underline" style={{ color: 'var(--accent)' }} onClick={() => onNavigate('connect')}>Connect</button>.
            </Card>
          )}

          {q.data.items.length === 0 ? (
            <Empty title="Nobody is ranked yet" sub="Rankings fill up as soon as the first payments are approved." />
          ) : (
            <Card>
              <ol className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {q.data.items.map((r) => <Line key={r.rank + r.username} row={r} metric={metric} />)}
              </ol>
            </Card>
          )}
          {q.data.total > q.data.items.length && (
            <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Showing the top {q.data.items.length} of {q.data.total}.</p>
          )}
        </>
      )}
    </div>
  )
}

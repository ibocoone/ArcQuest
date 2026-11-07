import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { PageTitle, Tabs, primaryBtn } from '../ui'
import MySubmissions from './MySubmissions'
import MyTasks from './MyTasks'
import TaskCreateForm from './TaskCreateForm'
import TaskOffers from './TaskOffers'

type Tab = 'offers' | 'submissions' | 'mine'
const VALID: Tab[] = ['offers', 'submissions', 'mine']

export default function JobsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(VALID.includes(initialTab as Tab) ? (initialTab as Tab) : 'offers')
  const [creating, setCreating] = useState(false)
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<{ toReview: number }>('/me/stats') })

  return (
    <div className="space-y-4">
      <PageTitle title="Tasks" sub="Complete tasks to earn USDC, or publish your own."
        action={!creating && (
          <button onClick={() => { setCreating(true); setTab('mine') }} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5 flex-shrink-0" style={primaryBtn()}>
            <Plus size={16} /> Publish
          </button>
        )} />
      {creating && <TaskCreateForm onClose={() => setCreating(false)} />}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'offers', label: 'Offers' },
        { id: 'submissions', label: 'My submissions' },
        { id: 'mine', label: 'My tasks', badge: stats.data?.toReview },
      ]} />
      {tab === 'offers' && <TaskOffers />}
      {tab === 'submissions' && <MySubmissions />}
      {tab === 'mine' && <MyTasks />}
    </div>
  )
}

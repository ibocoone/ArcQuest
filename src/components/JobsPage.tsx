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
      <PageTitle title="Tâches" sub="Réalisez des tâches pour gagner du USDC, ou publiez les vôtres."
        action={!creating && (
          <button onClick={() => { setCreating(true); setTab('mine') }} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5 flex-shrink-0" style={primaryBtn()}>
            <Plus size={16} /> Publier
          </button>
        )} />
      {creating && <TaskCreateForm onClose={() => setCreating(false)} />}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'offers', label: 'Offres' },
        { id: 'submissions', label: 'Mes soumissions' },
        { id: 'mine', label: 'Mes tâches', badge: stats.data?.toReview },
      ]} />
      {tab === 'offers' && <TaskOffers />}
      {tab === 'submissions' && <MySubmissions />}
      {tab === 'mine' && <MyTasks />}
    </div>
  )
}

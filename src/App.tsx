import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout, { type Page } from './components/Layout'
import AuthPage from './components/AuthPage'
import LegalPage from './components/LegalPage'
import DashboardHome from './components/DashboardHome'
import JobsPage from './components/JobsPage'
import WalletPage from './components/WalletPage'
import EarningsPage from './components/EarningsPage'
import ReferralsPage from './components/ReferralsPage'
import ContestsPage from './components/ContestsPage'
import SettingsPage from './components/SettingsPage'
import SupportPage from './components/SupportPage'
import AdminPage from './components/AdminPage'
import { Loading } from './ui'

type Legal = 'terms' | 'privacy'
const PAGES: Page[] = ['dashboard', 'jobs', 'wallet', 'earnings', 'referrals', 'contests', 'support', 'settings', 'admin']

function AppShell() {
  const { user, isLoading } = useAuth()
  const [page, setPage] = useState<Page>('dashboard')
  const [tab, setTab] = useState<string | undefined>()
  const [legal, setLegal] = useState<Legal | null>(null)

  if (legal) return <LegalPage kind={legal} onBack={() => setLegal(null)} />
  if (isLoading) return <div className="min-h-dvh flex items-center justify-center"><Loading /></div>
  if (!user) return <AuthPage onOpenLegal={setLegal} />

  // "jobs:mine" ouvre la page Tasks sur l'onglet "mine"
  const navigate = (target: string) => {
    const [p, t] = target.split(':')
    if (PAGES.includes(p as Page)) { setPage(p as Page); setTab(t) }
  }

  const content = () => {
    switch (page) {
      case 'jobs': return <JobsPage initialTab={tab} />
      case 'contests': return <ContestsPage initialTab={tab} />
      case 'wallet': return <WalletPage initialTab={tab} />
      case 'earnings': return <EarningsPage onNavigate={navigate} />
      case 'referrals': return <ReferralsPage />
      case 'support': return <SupportPage />
      case 'settings': return <SettingsPage />
      case 'admin': return user.role === 'admin' ? <AdminPage /> : <DashboardHome onNavigate={navigate} />
      default: return <DashboardHome onNavigate={navigate} />
    }
  }

  return (
    <Layout currentPage={page} onNavigate={navigate} onOpenLegal={setLegal}>
      {content()}
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

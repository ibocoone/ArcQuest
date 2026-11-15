import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout, { type Page } from './components/Layout'
import AuthPage from './components/AuthPage'
import LegalPage from './components/LegalPage'
import PublicHelp from './components/PublicHelp'
import DashboardHome from './components/DashboardHome'
import JobsPage from './components/JobsPage'
import WalletPage from './components/WalletPage'
import EarningsPage from './components/EarningsPage'
import ReferralsPage from './components/ReferralsPage'
import LeaderboardPage from './components/LeaderboardPage'
import ConnectPage from './components/ConnectPage'
import ContestsPage from './components/ContestsPage'
import SettingsPage from './components/SettingsPage'
import HelpPage from './components/HelpPage'
import SupportPage from './components/SupportPage'
import { clearLink, clearSharedTask, getLink, getSharedTask } from './lib/deeplink'
import { ResetPasswordPage, VerifyEmailPage } from './components/AccountLinkPage'
import VerifyBanner from './components/VerifyBanner'
import AdminPage from './components/AdminPage'
import { Loading } from './ui'

type Legal = 'terms' | 'privacy'
const PAGES: Page[] = ['dashboard', 'jobs', 'wallet', 'earnings', 'referrals', 'leaderboard', 'connect', 'contests', 'help', 'support', 'settings', 'admin']

function AppShell() {
  const { user, isLoading } = useAuth()
  const [shared, setShared] = useState<string | null>(() => getSharedTask())
  const [publicHelp, setPublicHelp] = useState(() => getLink('page') === 'help')
  const [page, setPage] = useState<Page>(() => (getSharedTask() ? 'jobs' : getLink('page') === 'help' ? 'help' : 'dashboard'))
  const [tab, setTab] = useState<string | undefined>()
  const [legal, setLegal] = useState<Legal | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(() => getLink('reset'))
  const [verifyToken, setVerifyToken] = useState<string | null>(() => getLink('verify'))
  const [afterReset, setAfterReset] = useState(false)

  if (resetToken) return <ResetPasswordPage token={resetToken} onDone={() => { setResetToken(null); setAfterReset(true) }} />
  if (verifyToken) return <VerifyEmailPage token={verifyToken} onDone={() => setVerifyToken(null)} />
  if (legal) return <LegalPage kind={legal} onBack={() => setLegal(null)} />
  if (isLoading) return <div className="min-h-dvh flex items-center justify-center"><Loading /></div>
  if (!user && publicHelp) return <PublicHelp onSignIn={() => { clearLink('page'); setPublicHelp(false); setPage('dashboard') }} />
  if (!user) return <AuthPage onOpenLegal={setLegal} startMode={afterReset ? 'login' : 'register'} />

  // "jobs:mine" ouvre la page Tasks sur l'onglet "mine"
  const navigate = (target: string) => {
    const [p, t] = target.split(':')
    if (PAGES.includes(p as Page)) { setPage(p as Page); setTab(t) }
  }

  const content = () => {
    switch (page) {
      case 'jobs': return <JobsPage initialTab={tab} sharedTask={shared} onDismissShared={() => { clearSharedTask(); setShared(null) }} />
      case 'contests': return <ContestsPage initialTab={tab} />
      case 'wallet': return <WalletPage initialTab={tab} />
      case 'earnings': return <EarningsPage onNavigate={navigate} />
      case 'referrals': return <ReferralsPage />
      case 'leaderboard': return <LeaderboardPage onNavigate={navigate} />
      case 'connect': return <ConnectPage />
      case 'help': return <HelpPage onNavigate={navigate} />
      case 'support': return <SupportPage />
      case 'settings': return <SettingsPage />
      case 'admin': return user.role === 'admin' ? <AdminPage /> : <DashboardHome onNavigate={navigate} />
      default: return <DashboardHome onNavigate={navigate} />
    }
  }

  return (
    <Layout currentPage={page} onNavigate={navigate} onOpenLegal={setLegal}>
      <VerifyBanner />
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

import { useState } from 'react'
import {
  LayoutDashboard, Briefcase, Wallet, TrendingUp, Users, Trophy, Settings, Menu, X, LogOut, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import NotificationsBell from './NotificationsBell'

export type Page = 'dashboard' | 'jobs' | 'wallet' | 'earnings' | 'referrals' | 'contests' | 'settings' | 'admin'

const NAV: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'jobs', label: 'Tâches', icon: Briefcase },
  { id: 'contests', label: 'Concours', icon: Trophy },
  { id: 'wallet', label: 'Portefeuille', icon: Wallet },
  { id: 'earnings', label: 'Gains', icon: TrendingUp },
  { id: 'referrals', label: 'Parrainages', icon: Users },
  { id: 'settings', label: 'Paramètres', icon: Settings },
]

export default function Layout({ currentPage, onNavigate, onOpenLegal, children }: {
  currentPage: Page
  onNavigate: (target: string) => void
  onOpenLegal: (p: 'terms' | 'privacy') => void
  children: React.ReactNode
}) {
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = user?.role === 'admin' ? [...NAV, { id: 'admin' as Page, label: 'Administration', icon: ShieldCheck }] : NAV

  const go = (p: string) => { onNavigate(p); setMobileOpen(false) }

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#1a2f6e' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
        </div>
        <span className="display font-bold text-lg" style={{ color: '#0f1c35' }}>ArcQuest</span>
      </div>

      {user && (
        <div className="mx-3 mb-4 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(26,47,110,0.06)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: '#1a2f6e' }}>{user.avatar}</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: '#0f1c35' }}>{user.fullName}</div>
              <div className="text-xs truncate" style={{ color: '#6b6580' }}>{user.email ?? 'Compte portefeuille'}</div>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {items.map(({ id, label, icon: Icon }) => {
          const active = currentPage === id
          return (
            <button key={id} onClick={() => go(id)} className="w-full min-h-[44px] flex items-center gap-3 px-3 rounded-xl text-sm font-medium transition-colors"
              style={{ background: active ? '#1a2f6e' : 'transparent', color: active ? 'white' : '#334155' }}>
              <Icon size={17} /> <span className="flex-1 text-left">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="p-3 space-y-2">
        <div className="flex gap-3 px-1 text-xs" style={{ color: '#8a849c' }}>
          <button onClick={() => onOpenLegal('terms')} className="underline">Conditions</button>
          <button onClick={() => onOpenLegal('privacy')} className="underline">Confidentialité</button>
        </div>
        <button onClick={() => void logout()} className="w-full min-h-[44px] flex items-center gap-3 px-3 rounded-xl text-sm font-medium" style={{ color: '#ba2b4c', background: 'rgba(186,43,76,0.06)' }}>
          <LogOut size={17} /> Se déconnecter
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-dvh" style={{ background: 'linear-gradient(180deg,#f4f6ff 0%,#fffcf7 52%,#f8f4ff 100%)' }}>
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 sticky top-0 h-dvh overflow-y-auto" style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(15,28,53,0.08)' }}>
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 flex flex-col h-full z-10" style={{ background: 'rgba(255,255,255,0.97)' }}>
            <button onClick={() => setMobileOpen(false)} aria-label="Fermer" className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-lg" style={{ color: '#6b6580' }}><X size={20} /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2 px-4 py-2 sticky top-0 z-30" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(15,28,53,0.08)' }}>
          <button onClick={() => setMobileOpen(true)} aria-label="Menu" className="lg:hidden w-11 h-11 flex items-center justify-center rounded-lg" style={{ color: '#334155' }}><Menu size={22} /></button>
          <span className="lg:hidden display font-bold" style={{ color: '#0f1c35' }}>ArcQuest</span>
          <div className="flex-1" />
          <NotificationsBell onNavigate={go} />
        </header>
        <div className="flex-1 p-4 lg:p-6 max-w-4xl w-full mx-auto">{children}</div>
      </main>
    </div>
  )
}

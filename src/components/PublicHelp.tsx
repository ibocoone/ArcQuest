import { Zap } from 'lucide-react'
import HelpPage from './HelpPage'

/** La page « How it works » et sa FAQ, ouvertes sans compte (lien partagé sur les réseaux sociaux). */
export default function PublicHelp({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="min-h-dvh px-4 py-6 sm:py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}><Zap size={18} color="white" /></div>
            <span className="display font-bold text-lg">ArcQuest</span>
          </div>
          <button onClick={onSignIn} className="min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>Sign in or create an account</button>
        </div>
        <HelpPage onNavigate={() => onSignIn()} />
      </div>
    </div>
  )
}

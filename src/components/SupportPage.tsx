import { ExternalLink, LifeBuoy, Send, ShieldAlert } from 'lucide-react'
import { Card, PageTitle } from '../ui'
import { SUPPORT } from '../support'

function XLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function Channel({ icon, name, handle, url, hint }: { icon: React.ReactNode; name: string; handle: string; url: string; hint: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl px-4 py-3.5 transition-all active:scale-[0.99]"
      style={{ background: 'rgba(255,255,255,0.70)', border: '1px solid rgba(15,28,53,0.12)', color: 'var(--ink)' }}
    >
      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent)', color: 'white' }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{name}</span>
        <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{handle} · {hint}</span>
      </span>
      <ExternalLink size={15} style={{ color: 'var(--muted)' }} />
    </a>
  )
}

export default function SupportPage() {
  return (
    <div className="space-y-5 max-w-2xl">
      <PageTitle title="Support" sub="Need help? Reach the ArcQuest team directly." />

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <LifeBuoy size={17} style={{ color: 'var(--accent)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>Support service</h2>
        </div>
        <div className="space-y-2.5">
          <Channel icon={<Send size={18} />} name="Telegram" handle={SUPPORT.telegram.handle} url={SUPPORT.telegram.url} hint="fastest reply" />
          <Channel icon={<XLogo />} name="X" handle={SUPPORT.x.handle} url={SUPPORT.x.url} hint="news" />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>To get help faster, tell us</h2>
        <ul className="text-sm space-y-1.5 list-disc pl-5" style={{ color: 'var(--ink-2)' }}>
          <li>Your username (shown in the menu) or the wallet address you use on ArcQuest.</li>
          <li>What you were trying to do and the exact message you saw.</li>
          <li>For a payment, deposit or withdrawal: the transaction link from your wallet or from the History tab.</li>
        </ul>
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
          <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
          <span>We will never ask for your seed phrase, private key or password. Never share them with anyone, even someone claiming to be support.</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          To report a task, a contest or a user, use the Report button on the item itself.
        </p>
      </Card>
    </div>
  )
}

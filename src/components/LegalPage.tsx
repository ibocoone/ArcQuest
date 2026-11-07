import { ArrowLeft } from 'lucide-react'
import { Card } from '../ui'

const TERMS: [string, string][] = [
  ['1. The service', "ArcQuest connects creators, who publish tasks and contests funded in USDC, with participants who complete them. The service currently runs on Arc Testnet: the amounts have no real value."],
  ['2. Account', "You can create an account with an email address and a password, or with a wallet. You are responsible for keeping your credentials and your wallet confidential. An account is personal."],
  ['3. Funds and contract', "Deposits are held in a smart contract. ArcQuest does not hold your funds: you withdraw them at any time from your wallet. Blockchain transactions are irreversible."],
  ['4. Tasks and payments', "A task creator reserves the full rewards before publishing. The creator approves or rejects each submission and gives a reason for any rejection. An approval triggers an onchain payment to the participant's wallet. Unused funds can be recovered by the creator after the set delay."],
  ['5. Prohibited conduct', "The following are prohibited: fake proof, multiple accounts, illegal, misleading or hateful content, and any attempt at fraud, circumvention or attack against the service. ArcQuest may remove content and suspend an account."],
  ['6. Referrals', "Referrals are used to track where sign-ups come from. A referral is called active after its first payment received. Any manipulation of referrals leads to account suspension."],
  ['7. Liability', "The service is provided as is, without any guarantee of availability. ArcQuest is not responsible for disputes between creators and participants, nor for losses related to the blockchain, a wallet or an input error."],
  ['8. Changes', "These terms may change. Important changes are announced in the app."],
]

const PRIVACY: [string, string][] = [
  ['1. Data collected', "Email address (if you choose that method), wallet address, username, submissions and proof sent (links, images, notes), reports, notifications. Passwords are stored hashed, never in plain text."],
  ['2. Use', "This data is used to run the service: authentication, publishing and reviewing tasks, payments, moderation and fraud prevention."],
  ['3. Public data', "Blockchain transactions are public and permanent. Your username is visible to other members; proof is visible only to the relevant creator and to moderation."],
  ['4. Cookies', "A single technical session cookie is used to keep you signed in. No advertising cookies."],
  ['5. Retention', "Account data is kept as long as the account exists. Sessions expire after 30 days."],
  ['6. Your rights', "You can ask for access to, correction of or deletion of your data. Data written on the blockchain cannot be erased."],
  ['7. Contact', "[Contact address to be provided by the operator of the service.]"],
]

export default function LegalPage({ kind, onBack }: { kind: 'terms' | 'privacy'; onBack: () => void }) {
  const sections = kind === 'terms' ? TERMS : PRIVACY
  return (
    <div className="min-h-dvh px-4 py-6" style={{ background: 'linear-gradient(180deg,#f4f6ff 0%,#fffcf7 52%,#f8f4ff 100%)' }}>
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={onBack} className="min-h-[44px] inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="display font-bold text-3xl text-balance" style={{ color: 'var(--ink)' }}>
          {kind === 'terms' ? 'Terms of Use' : 'Privacy Policy'}
        </h1>
        <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(255,205,131,0.25)', color: '#7a5608' }}>
          Template text. Have a lawyer review and adapt it before opening the service to the public or using real money.
        </div>
        <Card className="p-5 space-y-5">
          {sections.map(([title, text]) => (
            <section key={title}>
              <h2 className="font-semibold text-sm mb-1" style={{ color: 'var(--ink)' }}>{title}</h2>
              <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{text}</p>
            </section>
          ))}
        </Card>
      </div>
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, PlusCircle } from 'lucide-react'
import { useSwitchChain } from 'wagmi'
import { useWallet } from '../hooks/useWallet'
import { toast } from 'sonner'
import { getChain } from '@/onchain-facts'
import { ARC_TESTNET_ID } from '@/contracts/vault'
import { useAuth } from '../context/AuthContext'
import { Card, PageTitle, primaryBtn } from '../ui'

const FAUCET_URL = 'https://faucet.circle.com'

const FAQ: { q: string; a: ReactNode }[] = [
  { q: 'Is this real money?', a: 'Not yet. ArcQuest runs on Arc Testnet, a test network. The USDC you use has no real value and is free from the faucet. The same rules will apply when it moves to real money.' },
  { q: 'Do I need a crypto wallet?', a: 'Yes, for now. Your wallet holds your funds, signs your deposits and receives your pay. You keep control: ArcQuest cannot move your money.' },
  { q: 'Who holds the money?', a: 'A smart contract on Arc. It has no owner and no fees. Task rewards stay locked in it until the work is approved, paid automatically, or resolved by an arbiter.' },
  { q: 'How do I get paid?', a: 'When your submission is approved, the reward is added to your ArcQuest balance in the contract. Withdraw it to your wallet at any time from the Wallet page.' },
  { q: 'What if the creator never answers?', a: 'The creator has a review time (shown on every task, usually 3 days). After it ends without an answer, you are paid automatically: open My submissions and tap Collect payment.' },
  { q: 'What if my work is rejected unfairly?', a: 'You have 7 days to dispute. An arbiter looks at your proof and the creator’s reason, then either pays you or refunds the creator. If the arbiter does not decide within 14 days, the reward is split 50/50.' },
  { q: 'Why do I pay a small network fee?', a: 'Registering a submission and collecting a payment are transactions on Arc. The fee is paid in USDC and is only a fraction of a cent to a few cents.' },
  { q: 'How do I withdraw?', a: 'Go to Wallet, open Withdraw, enter an amount and confirm in your wallet. The USDC goes straight back to your wallet.' },
  { q: 'I forgot my password.', a: 'On the sign-in page, tap Forgot your password? and enter your email. We send you a link to choose a new one. If you signed up with a wallet, there is no password: just sign in with the wallet.' },
  { q: 'Something went wrong. Who can help?', a: 'Open the Support page and message us on Telegram or X. Include your username and the transaction link if there is one.' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
      {children}
    </Card>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((t, i) => (
        <li key={t} className="flex gap-3 text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'white' }}>{i + 1}</span>
          <span className="pt-0.5">{t}</span>
        </li>
      ))}
    </ol>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })
  }
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(26,47,110,0.05)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
        <div className="text-sm font-mono truncate" style={{ color: 'var(--ink)' }}>{value}</div>
      </div>
      <button onClick={copy} aria-label={`Copy ${label}`} className="w-11 h-11 flex items-center justify-center flex-shrink-0" style={{ color: 'var(--accent)' }}>
        {done ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  )
}

export default function HelpPage({ onNavigate }: { onNavigate: (target: string) => void }) {
  const { user } = useAuth()
  const { address } = useWallet()
  const { switchChainAsync } = useSwitchChain()
  const [open, setOpen] = useState<number | null>(0)
  const chain = getChain(ARC_TESTNET_ID)
  const wallet = address ?? user?.walletAddress ?? null

  const addNetwork = async () => {
    try {
      await switchChainAsync({ chainId: ARC_TESTNET_ID })
      toast.success('Arc Testnet is ready in your wallet.')
    } catch {
      toast.error('Could not add the network. Use the details below to add it by hand.')
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <PageTitle title="How it works" sub="Everything you need to start earning or hiring on ArcQuest." />

      <Section title="Earn USDC by completing tasks">
        <Steps items={[
          'Open Tasks and pick an offer. Read the instructions and the review time.',
          'Do the task, then send your proof (a link or a screenshot). Your submission is registered in the contract.',
          'The creator approves and you are paid. If they do nothing within the review time, you are paid automatically.',
          'Withdraw your USDC to your wallet whenever you want.',
        ]} />
      </Section>

      <Section title="Hire people by publishing tasks">
        <Steps items={[
          'Deposit USDC into ArcQuest from the Wallet page.',
          'Publish a task: set the reward, the number of places, the deadline and your review time. The funds are locked in the contract.',
          'Review the proofs in My tasks and approve or reject each one with a reason.',
          'After the deadline, recover any unused funds.',
        ]} />
      </Section>

      <Section title="Your money is protected">
        <ul className="text-sm space-y-1.5 list-disc pl-5 text-pretty" style={{ color: 'var(--ink-2)' }}>
          <li>Rewards are locked in the contract when a task is published, so creators cannot spend them elsewhere.</li>
          <li>A creator who stays silent cannot keep the work for free: the worker is paid automatically after the review time.</li>
          <li>A rejection can be disputed. An arbiter can only pay the worker or refund the creator, never take the money.</li>
        </ul>
      </Section>

      <Section title="Get test USDC and start">
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          ArcQuest uses Arc Testnet. On Arc, USDC is also used to pay network fees, so a few cents are enough for fees.
        </p>
        <Steps items={[
          'Add Arc Testnet to your wallet (button below).',
          'Get free test USDC from the Circle faucet: choose Arc Testnet and USDC, then paste your wallet address.',
          'Come back, open Wallet and deposit some USDC into ArcQuest.',
        ]} />
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => void addNetwork()} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={primaryBtn()}>
            <PlusCircle size={15} /> Add Arc Testnet to my wallet
          </button>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ background: 'rgba(26,47,110,0.08)', color: 'var(--accent)' }}>
            Open the faucet <ExternalLink size={14} />
          </a>
          <button onClick={() => onNavigate('wallet')} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold" style={{ background: 'rgba(26,47,110,0.08)', color: 'var(--accent)' }}>Go to Wallet</button>
        </div>
        {wallet && <CopyField label="Your wallet address" value={wallet} />}
        {chain && (
          <details className="text-sm">
            <summary className="cursor-pointer min-h-[44px] flex items-center font-medium" style={{ color: 'var(--accent)' }}>Network details (to add it by hand)</summary>
            <div className="space-y-2 pt-2">
              <CopyField label="Network name" value="Arc Testnet" />
              <CopyField label="RPC URL" value={chain.rpcUrls[0] ?? ''} />
              <CopyField label="Chain ID" value={String(ARC_TESTNET_ID)} />
              <CopyField label="Currency symbol" value="USDC" />
              <CopyField label="Block explorer" value={chain.explorerBase} />
            </div>
          </details>
        )}
      </Section>

      <Section title="Frequently asked questions">
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {FAQ.map((f, i) => (
            <div key={f.q}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full min-h-[48px] py-2 flex items-center gap-3 text-left">
                <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{f.q}</span>
                <ChevronDown size={16} style={{ color: 'var(--subtle)', transform: open === i ? 'rotate(180deg)' : 'none' }} />
              </button>
              {open === i && <p className="pb-3 text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{f.a}</p>}
            </div>
          ))}
        </div>
        <button onClick={() => onNavigate('support')} className="text-sm font-semibold underline" style={{ color: 'var(--accent)' }}>Still stuck? Contact support</button>
      </Section>
    </div>
  )
}

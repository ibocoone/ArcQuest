import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { getUsdc } from '@/onchain-facts'
import { ARC_TESTNET_ID } from '@/contracts/vault'
import { useAuth } from '../context/AuthContext'
import { useVaultBalance } from '../hooks/useVault'
import { Card, primaryBtn } from '../ui'

const DISMISS_KEY = 'arcquest:get-started-dismissed'

interface Props {
  stats?: { tasksDone: number; pendingSubmissions: number; myOpenTasks: number }
  onNavigate: (target: string) => void
}

/** Liste de départ pour un nouvel utilisateur : disparaît quand tout est fait ou si on la ferme. */
export default function GetStarted({ stats, onNavigate }: Props) {
  const { user } = useAuth()
  const { address } = useAccount()
  const { balance } = useVaultBalance()
  const [hidden, setHidden] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const usdc = getUsdc(ARC_TESTNET_ID)
  const wallet = useReadContract({
    address: usdc?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_ID,
    query: { enabled: !!usdc && !!address },
  })

  if (hidden || !stats) return null
  const hasUsdc = (wallet.data ?? 0n) > 0n || balance > 0
  const activity = stats.tasksDone > 0 || stats.pendingSubmissions > 0 || stats.myOpenTasks > 0
  const steps = [
    { done: !!user?.walletAddress, title: 'Link your wallet', text: 'It receives your pay and signs your deposits.', go: 'settings', cta: 'Open Settings' },
    { done: hasUsdc || activity, title: 'Get free test USDC', text: 'ArcQuest runs on a test network: the faucet is free.', go: 'help', cta: 'Show me how' },
    { done: balance > 0 || activity, title: 'Deposit into ArcQuest', text: 'Your deposit stays yours and can be withdrawn any time.', go: 'wallet', cta: 'Open Wallet' },
    { done: activity, title: 'Do or publish your first task', text: 'Earn USDC or hire people to do work for you.', go: 'jobs', cta: 'See tasks' },
  ]
  if (steps.every((s) => s.done)) return null
  const next = steps.find((s) => !s.done)

  const dismiss = () => { localStorage.setItem(DISMISS_KEY, '1'); setHidden(true) }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>Get started</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{steps.filter((s) => s.done).length} of {steps.length} done</p>
        </div>
        <button onClick={dismiss} aria-label="Hide this checklist" className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center" style={{ color: 'var(--subtle)' }}><X size={16} /></button>
      </div>
      <ul className="space-y-2.5">
        {steps.map((s) => (
          <li key={s.title} className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: s.done ? 'var(--success)' : 'rgba(15,28,53,0.08)', color: s.done ? 'white' : 'var(--subtle)' }}>
              {s.done ? <Check size={14} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: s.done ? 'var(--muted)' : 'var(--ink)', textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</div>
              {!s.done && <div className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>{s.text}</div>}
            </div>
          </li>
        ))}
      </ul>
      {next && <button onClick={() => onNavigate(next.go)} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn()}>{next.cta}</button>}
    </Card>
  )
}

import { useState } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, Copy, CheckCircle2,
  Inbox, PlusCircle, MinusCircle, History, ShieldCheck,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useAccount, useDisconnect, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { getUsdc } from '@/onchain-facts'
import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { useVaultHistory } from '../hooks/useVaultHistory'
import { TxLink } from '../ui'
import { ARC_TESTNET_ID } from '@/contracts/vault'
import { useVaultBalance } from '../hooks/useVault'
import WalletDeposit from './WalletDeposit'
import WalletWithdraw from './WalletWithdraw'

const glass: React.CSSProperties = {
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.68)',
  boxShadow: '0 8px 32px rgba(15,28,53,0.07), inset 0 1px 0 rgba(255,255,255,0.55)',
}

type Tab = 'deposit' | 'withdraw' | 'history'

export default function WalletPage({ initialTab }: { initialTab?: string }) {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const history = useVaultHistory()
  const events = history.data ?? []
  const vault = useVaultBalance()
  const [tab, setTab] = useState<Tab>(initialTab === 'withdraw' || initialTab === 'history' ? initialTab : 'deposit')
  const [copied, setCopied] = useState(false)

  const usdc = getUsdc(ARC_TESTNET_ID)
  const { data: rawBalance, refetch } = useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_ID,
    query: { enabled: !!address && !!usdc },
  })
  const walletBalance = rawBalance != null ? Amount.fromRaw(rawBalance, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(2) : '—'

  const copyAddress = () => {
    if (!address) return
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'deposit', label: 'Deposit', icon: PlusCircle },
    { id: 'withdraw', label: 'Withdraw', icon: MinusCircle },
    { id: 'history', label: 'History', icon: History },
  ]

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--accent)', boxShadow: '0 12px 40px rgba(26,47,110,0.25)' }}>
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #5fbeff, #af8ff4, #f05c6b, #ffcd83, #7ef1b3)' }} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <TokenUSDC variant="branded" size={14} />
              <span className="text-xs font-semibold text-white opacity-60 uppercase tracking-wider">Wallet balance</span>
            </div>
            <div className="display font-bold text-3xl tabular-nums text-white">{isConnected ? `$${walletBalance}` : '—'}</div>
            <div className="text-xs text-white opacity-40 mt-0.5">USDC · Arc Testnet</div>
          </div>
          <div className="border-l border-white/20 pl-4">
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldCheck size={14} className="text-white opacity-60" />
              <span className="text-xs font-semibold text-white opacity-60 uppercase tracking-wider">ArcQuest balance</span>
            </div>
            <div className="display font-bold text-3xl tabular-nums text-white">${vault.balance.toFixed(2)}</div>
            <div className="text-xs text-white opacity-40 mt-0.5">Available for tasks</div>
          </div>
        </div>
        {isConnected && address ? (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button onClick={copyAddress} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium min-h-[40px]"
              style={{ background: 'rgba(255,255,255,0.13)', color: 'white', border: '1px solid rgba(255,255,255,0.20)' }}>
              <span className="mono opacity-70 truncate max-w-[200px]">{address}</span>
              {copied ? <CheckCircle2 size={13} className="opacity-70" /> : <Copy size={13} className="opacity-70" />}
            </button>
            <button onClick={() => disconnect()} className="rounded-xl px-3 py-2 text-xs font-semibold min-h-[40px]"
              style={{ background: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.30)' }}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-4"><ConnectKitButton label="Connect wallet" /></div>
        )}
      </div>

      <div className="rounded-2xl overflow-hidden" style={glass}>
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold transition-colors whitespace-nowrap"
              style={{ color: tab === id ? 'var(--accent)' : 'var(--muted)', borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === 'deposit' && <WalletDeposit walletBalance={walletBalance} onDone={() => { void refetch(); void vault.refetch() }} />}
        {tab === 'withdraw' && <WalletWithdraw />}
        {tab === 'history' && (
          history.isLoading ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--muted)' }}>Loading contract activity…</div>
          ) : !isConnected ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to see your history.</div>
          ) : events.length === 0 ? (
            <div className="text-center py-12" style={{ color: 'var(--muted)' }}>
              <Inbox size={28} className="mx-auto mb-2 opacity-25" />
              <div className="text-sm font-medium">No activity yet</div>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {events.map((t) => {
                const color = t.incoming ? 'var(--success)' : 'var(--danger)'
                return (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-4">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: t.incoming ? 'rgba(26,128,71,0.10)' : 'rgba(186,43,76,0.08)' }}>
                      {t.incoming ? <ArrowDownLeft size={16} style={{ color }} /> : <ArrowUpRight size={16} style={{ color }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{t.label}</div>
                      <div className="text-xs flex items-center gap-2" style={{ color: 'var(--subtle)' }}>
                        {t.at && <span>{t.at.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                        <TxLink hash={t.hash} label="Transaction" />
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-nums" style={{ color }}>{t.incoming ? '+' : '-'}${t.amount.toFixed(2)}</div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}

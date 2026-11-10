import { useState } from 'react'
import { MinusCircle, Info, AlertCircle, Inbox, CheckCircle2, ExternalLink } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useSwitchChain } from 'wagmi'
import { useWallet } from '../hooks/useWallet'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { ARC_TESTNET_ID, VAULT_ADDRESS } from '@/contracts/vault'
import { explorerTx, useVaultActions, useVaultBalance } from '../hooks/useVault'
import { useQueryClient } from '@tanstack/react-query'

export default function WalletWithdraw() {
  const { isConnected, chainId } = useWallet()
  const { switchChain } = useSwitchChain()
  const { balance, refetch } = useVaultBalance()
  const { withdraw } = useVaultActions()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastTx, setLastTx] = useState<string | null>(null)

  const num = parseFloat(amount)
  const amountValid = amount !== '' && num > 0 && num <= balance
  const wrongChain = isConnected && chainId !== ARC_TESTNET_ID

  const submit = async () => {
    if (!amountValid || busy) return
    setBusy(true)
    try {
      const hash = await withdraw(amount)
      void qc.invalidateQueries({ queryKey: ['activity'] })
      setLastTx(hash)
      setAmount('')
      void refetch()
      toast.success(`$${num.toFixed(2)} USDC sent to your wallet.`)
    } catch (err) {
      console.error('Withdrawal failed:', err)
      const msg = err instanceof Error ? err.message : ''
      toast.error(/rejected|denied/i.test(msg) ? 'Transaction cancelled.' : 'The withdrawal failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(26,47,110,0.06)', border: '1px solid rgba(26,47,110,0.10)' }}>
        <Info size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
        <div style={{ color: 'var(--ink-2)' }}>
          Withdrawals are instant: the contract sends the USDC straight back to the connected wallet. No manual approval.
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.13)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Available ArcQuest balance</span>
        <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--success)' }}>${balance.toFixed(2)} USDC</span>
      </div>

      {!VAULT_ADDRESS ? (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span>Withdrawals are temporarily unavailable. Please try again later.</span>
        </div>
      ) : !isConnected ? (
        <div className="text-center py-6">
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>Connect your wallet to withdraw</p>
          <ConnectKitButton />
        </div>
      ) : wrongChain ? (
        <div className="flex items-center justify-between gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
          <span className="flex items-center gap-2 text-sm"><AlertCircle size={15} /> Switch to Arc Testnet</span>
          <button onClick={() => switchChain({ chainId: ARC_TESTNET_ID })} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--danger)', color: 'white' }}>Switch</button>
        </div>
      ) : balance === 0 ? (
        <div className="text-center py-6" style={{ color: 'var(--muted)' }}>
          <Inbox size={28} className="mx-auto mb-2 opacity-25" />
          <p className="text-sm">Your balance is empty. Make a deposit first.</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Amount (USDC)</label>
            <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.60)', border: `1px solid ${amount && !amountValid ? 'var(--danger)' : 'rgba(15,28,53,0.12)'}` }}>
              <TokenUSDC variant="branded" size={16} />
              <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm min-w-0" style={{ color: 'var(--ink)' }} />
              <button onClick={() => setAmount(balance.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''))} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>All</button>
            </div>
            {amount && num > balance && (
              <p className="text-xs flex items-center gap-1" style={{ color: 'var(--danger)' }}><AlertCircle size={11} /> More than your balance</p>
            )}
          </div>

          {lastTx && (
            <a href={explorerTx(lastTx)} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs rounded-xl px-4 py-3" style={{ background: 'rgba(26,128,71,0.08)', color: 'var(--success)' }}>
              <CheckCircle2 size={13} /> Last withdrawal confirmed
              <ExternalLink size={11} className="ml-auto" />
            </a>
          )}

          <button onClick={() => void submit()} disabled={!amountValid || busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ background: amountValid && !busy ? 'var(--accent)' : 'var(--subtle)', color: 'white', cursor: amountValid && !busy ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Confirm in your wallet…' : <><MinusCircle size={15} /> Withdraw {amountValid ? `$${amount}` : ''} USDC</>}
          </button>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { PlusCircle, Info, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { ARC_TESTNET_ID, VAULT_ADDRESS } from '@/contracts/vault'
import { explorerTx, useVaultActions } from '../hooks/useVault'
import { useQueryClient } from '@tanstack/react-query'

const QUICK = ['1', '5', '10', '25', '50']
type Step = 'idle' | 'working'

export default function WalletDeposit({ walletBalance, onDone }: { walletBalance: string; onDone: () => void }) {
  const { isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { deposit } = useVaultActions()
  const qc = useQueryClient()

  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [lastTx, setLastTx] = useState<string | null>(null)

  const num = parseFloat(amount)
  const valid = amount !== '' && num > 0
  const wrongChain = isConnected && chainId !== ARC_TESTNET_ID
  const busy = step === 'working'
  const disabled = !valid || busy || !VAULT_ADDRESS

  const handleDeposit = async () => {
    if (disabled) return
    setStep('working')
    try {
      const hash = await deposit(amount)
      void qc.invalidateQueries({ queryKey: ['vault-history'] })
      setLastTx(hash)
      setAmount('')
      onDone()
      toast.success(`$${num.toFixed(2)} USDC déposés sur votre solde ArcQuest.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      toast.error(/rejected|denied/i.test(msg) ? 'Transaction annulée.' : 'Le dépôt a échoué. Vérifiez votre solde USDC et réessayez.')
    } finally {
      setStep('idle')
    }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(26,47,110,0.06)', border: '1px solid rgba(26,47,110,0.10)' }}>
        <Info size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
        <div style={{ color: 'var(--ink-2)' }}>
          Votre USDC est déposé dans le contrat ArcQuest sur Arc Testnet. Il reste à vous : vous pouvez le retirer à tout moment. La première fois, deux confirmations sont demandées (autorisation, puis dépôt).
        </div>
      </div>

      {!VAULT_ADDRESS && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span>Les dépôts sont momentanément indisponibles. Réessayez plus tard.</span>
        </div>
      )}

      {!isConnected ? (
        <div className="text-center py-6">
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>Connectez votre portefeuille pour déposer du USDC</p>
          <ConnectKitButton />
        </div>
      ) : wrongChain ? (
        <div className="flex items-center justify-between gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
          <span className="flex items-center gap-2 text-sm"><AlertCircle size={15} /> Passez sur Arc Testnet</span>
          <button onClick={() => switchChain({ chainId: ARC_TESTNET_ID })} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--danger)', color: 'white' }}>Changer</button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Montant (USDC)</label>
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>Wallet : <strong style={{ color: 'var(--ink)' }}>${walletBalance}</strong></span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid rgba(15,28,53,0.12)' }}>
              <TokenUSDC variant="branded" size={16} />
              <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} disabled={busy}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm min-w-0" style={{ color: 'var(--ink)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {QUICK.map((v) => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} className="px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ background: amount === v ? 'var(--accent)' : 'rgba(26,47,110,0.07)', color: amount === v ? 'white' : 'var(--accent)' }}>
                  ${v}
                </button>
              ))}
            </div>
          </div>

          {lastTx && (
            <a href={explorerTx(lastTx)} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs rounded-xl px-4 py-3" style={{ background: 'rgba(26,128,71,0.08)', color: 'var(--success)' }}>
              <CheckCircle2 size={13} /> Dernier dépôt confirmé
              <ExternalLink size={11} className="ml-auto" />
            </a>
          )}

          <button onClick={() => void handleDeposit()} disabled={disabled}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ background: disabled ? 'var(--subtle)' : 'var(--accent)', color: 'white', cursor: disabled ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Confirmez dans le portefeuille…' : <><PlusCircle size={15} /> Déposer {valid ? `$${amount}` : ''} USDC</>}
          </button>
        </>
      )}
    </div>
  )
}

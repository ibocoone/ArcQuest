import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export interface VaultEvent {
  id: string
  label: string
  /** Montant en USDC, positif si l'argent arrive dans le coffre de l'utilisateur. */
  amount: number
  incoming: boolean
  hash: `0x${string}`
  at: Date | null
}

interface ActivityRow { id: string; txHash: `0x${string}`; kind: string; amount: string; at: string }

const KINDS: Record<string, { label: string; incoming: boolean }> = {
  deposit: { label: 'Dépôt', incoming: true },
  withdraw: { label: 'Retrait vers votre portefeuille', incoming: false },
  fund: { label: 'Réservé pour une tâche ou un concours', incoming: false },
  reward: { label: 'Récompense reçue', incoming: true },
  refund: { label: 'Fonds récupérés', incoming: true },
}

/**
 * Historique des opérations du coffre pour le compte connecté.
 * Il vient du serveur (qui relit chaque transaction sur la blockchain), pas d'une lecture des journaux
 * par le navigateur : le RPC public refuse les grandes plages et bloque vite les rafales de requêtes.
 */
export function useVaultHistory() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['activity', address],
    enabled: !!address,
    staleTime: 15_000,
    queryFn: async (): Promise<VaultEvent[]> => {
      const { items } = await api<{ items: ActivityRow[] }>('/me/activity')
      return items.map((a) => {
        const k = KINDS[a.kind] ?? { label: a.kind, incoming: true }
        return { id: a.id, label: k.label, amount: Number(a.amount), incoming: k.incoming, hash: a.txHash, at: new Date(a.at) }
      })
    },
  })
}

import { useAccount, usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseAbiItem } from 'viem'
import { ARC_TESTNET_ID, VAULT_ADDRESS } from '@/contracts/vault'

export interface VaultEvent {
  id: string
  label: string
  /** Montant en USDC, positif si l'argent arrive dans le coffre de l'utilisateur. */
  amount: number
  incoming: boolean
  hash: `0x${string}`
  at: Date | null
}

const deposited = parseAbiItem('event Deposited(address indexed user, uint256 amount)')
const withdrawn = parseAbiItem('event Withdrawn(address indexed user, uint256 amount)')
const funded = parseAbiItem('event TaskFunded(bytes32 indexed taskId, address indexed funder, uint256 amount, uint64 refundableAfter)')
const released = parseAbiItem('event RewardReleased(bytes32 indexed taskId, address indexed worker, uint256 amount)')
const refunded = parseAbiItem('event TaskRefunded(bytes32 indexed taskId, address indexed funder, uint256 amount)')

// Le scan démarre au bloc de déploiement du contrat, jamais au bloc 0.
const deployBlock = (import.meta.env.VITE_VAULT_DEPLOY_BLOCK as string | undefined) ?? '0'
const FROM = BigInt(/^\d+$/.test(deployBlock) ? deployBlock : '0')
const STEP = 20_000n

/** Historique des opérations du portefeuille connecté, lu directement dans les événements du contrat. */
export function useVaultHistory() {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: ARC_TESTNET_ID })

  return useQuery({
    queryKey: ['vault-history', address],
    enabled: !!client && !!address && !!VAULT_ADDRESS && FROM > 0n,
    refetchInterval: 20_000,
    queryFn: async (): Promise<VaultEvent[]> => {
      if (!client || !address || !VAULT_ADDRESS) return []
      const head = await client.getBlockNumber()
      const found: { id: string; label: string; raw: bigint; incoming: boolean; hash: `0x${string}`; block: bigint }[] = []

      for (let from = FROM; from <= head; from += STEP) {
        const to = from + STEP - 1n > head ? head : from + STEP - 1n
        const range = { address: VAULT_ADDRESS, fromBlock: from, toBlock: to } as const
        const [d, w, f, r, rf] = await Promise.all([
          client.getLogs({ ...range, event: deposited, args: { user: address } }),
          client.getLogs({ ...range, event: withdrawn, args: { user: address } }),
          client.getLogs({ ...range, event: funded, args: { funder: address } }),
          client.getLogs({ ...range, event: released, args: { worker: address } }),
          client.getLogs({ ...range, event: refunded, args: { funder: address } }),
        ])
        const push = (logs: { transactionHash: `0x${string}`; logIndex: number | null; blockNumber: bigint; args: { amount?: bigint } }[], label: string, incoming: boolean) => {
          for (const l of logs) {
            found.push({ id: `${l.transactionHash}-${l.logIndex}`, label, raw: l.args.amount ?? 0n, incoming, hash: l.transactionHash, block: l.blockNumber })
          }
        }
        push(d, 'Dépôt', true)
        push(w, 'Retrait vers votre portefeuille', false)
        push(f, 'Réservé pour une tâche ou un concours', false)
        push(r, 'Récompense reçue', true)
        push(rf, 'Fonds récupérés', true)
      }

      found.sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? 1 : -1))
      const latest = found.slice(0, 50)
      const blocks = [...new Set(latest.map((e) => e.block))]
      const times = new Map<bigint, Date>()
      await Promise.all(blocks.map(async (b) => {
        const blk = await client.getBlock({ blockNumber: b })
        times.set(b, new Date(Number(blk.timestamp) * 1000))
      }))
      return latest.map((e) => ({
        id: e.id,
        label: e.label,
        amount: Number(formatUnits(e.raw, 6)),
        incoming: e.incoming,
        hash: e.hash,
        at: times.get(e.block) ?? null,
      }))
    },
  })
}

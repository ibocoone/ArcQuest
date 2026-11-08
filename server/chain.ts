import { createPublicClient, erc20Abi, http, keccak256, parseAbiItem, parseEventLogs, parseUnits, stringToBytes, type Hex } from 'viem'
import { getChain, getUsdc, USDC_DECIMALS } from '../src/onchain-facts'
import { HttpError } from './http'

const CHAIN_ID = 5042002
const VAULT = (process.env.VITE_VAULT_ADDRESS ?? '').toLowerCase()

function rpcUrl(): string {
  if (process.env.RPC_URL_Arc_Testnet) return process.env.RPC_URL_Arc_Testnet
  const base = process.env.RPC_PROXY_BASE_URL
  const chains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
  if (base && chains.includes('Arc_Testnet')) {
    return `${base}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
  }
  const url = getChain(CHAIN_ID)?.rpcUrls[0]
  if (!url) throw new Error('Arc Testnet RPC not found')
  return url
}

const client = createPublicClient({ transport: http(rpcUrl()) })

const events = [
  parseAbiItem('event TaskFunded(bytes32 indexed taskId, address indexed funder, uint256 amount, uint64 refundableAfter)'),
  parseAbiItem('event RewardReleased(bytes32 indexed taskId, address indexed worker, uint256 amount)'),
  parseAbiItem('event Deposited(address indexed user, uint256 amount)'),
  parseAbiItem('event Withdrawn(address indexed user, uint256 amount)'),
  parseAbiItem('event TaskRefunded(bytes32 indexed taskId, address indexed funder, uint256 amount)'),
] as const

/** USDC (vue ERC-20) détenu par le coffre, en unités brutes. null si la lecture échoue. */
export async function vaultUsdcRaw(): Promise<bigint | null> {
  const usdc = getUsdc(CHAIN_ID)
  if (!usdc || !VAULT) return null
  try {
    return await client.readContract({ address: usdc.address as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [VAULT as Hex] })
  } catch {
    return null
  }
}

export function taskIdOf(appId: string): Hex {
  return keccak256(stringToBytes(appId))
}

export function toRaw(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS)
}

/** Cherche le reçu d'une transaction. Le RPC public peut être lent ou refuser des requêtes : on insiste environ 30 secondes avant d'abandonner. */
async function fetchReceipt(hash: Hex) {
  for (let i = 0; i < 20; i++) {
    try { return await client.getTransactionReceipt({ hash }) } catch { await Bun.sleep(1500) }
  }
  throw new HttpError(400, 'Transaction not found on Arc Testnet. If you just sent it, wait a few seconds and try again.')
}

async function vaultLogs(hash: Hex) {
  if (!VAULT) throw new HttpError(503, 'Contract not configured.')
  const receipt = await fetchReceipt(hash)
  if (receipt.status !== 'success') throw new HttpError(400, 'The transaction failed onchain.')
  return parseEventLogs({ abi: events, logs: receipt.logs.filter((l) => l.address.toLowerCase() === VAULT) })
}

/** Vérifie que la transaction a bien réservé au moins `minRaw` pour `appId`, depuis `funder`. */
export async function verifyFunding(hash: Hex, appId: string, funder: string, minRaw: bigint): Promise<void> {
  const id = taskIdOf(appId)
  const total = (await vaultLogs(hash))
    .filter((l) => l.eventName === 'TaskFunded' && l.args.taskId === id && l.args.funder.toLowerCase() === funder.toLowerCase())
    .reduce((s, l) => s + (l.eventName === 'TaskFunded' ? l.args.amount : 0n), 0n)
  if (total < minRaw) throw new HttpError(400, 'The onchain funding does not match (amount, task or wallet).')
}

/** Vérifie que la transaction a bien payé exactement `amountRaw` à `worker` pour `appId`. */
export async function verifyRelease(hash: Hex, appId: string, worker: string, amountRaw: bigint): Promise<void> {
  const id = taskIdOf(appId)
  const ok = (await vaultLogs(hash)).some((l) =>
    l.eventName === 'RewardReleased' && l.args.taskId === id
    && l.args.worker.toLowerCase() === worker.toLowerCase() && l.args.amount === amountRaw)
  if (!ok) throw new HttpError(400, 'The onchain payment does not match (worker, amount or task).')
}

export interface ActivityEntry { logIndex: number; kind: 'deposit' | 'withdraw' | 'fund' | 'reward' | 'refund'; amountRaw: bigint; at: Date }

/** Opérations du contrat qui concernent `wallet` dans la transaction `hash` (lues sur la blockchain, jamais saisies par le client). */
export async function activityFromTx(hash: Hex, wallet: string): Promise<ActivityEntry[]> {
  if (!VAULT) throw new HttpError(503, 'Contract not configured.')
  const receipt = await fetchReceipt(hash)
  if (receipt.status !== 'success') throw new HttpError(400, 'The transaction failed onchain.')
  const w = wallet.toLowerCase()
  const out: Omit<ActivityEntry, 'at'>[] = []
  for (const l of parseEventLogs({ abi: events, logs: receipt.logs.filter((x) => x.address.toLowerCase() === VAULT) })) {
    const logIndex = l.logIndex ?? 0
    if (l.eventName === 'Deposited' && l.args.user.toLowerCase() === w) out.push({ logIndex, kind: 'deposit', amountRaw: l.args.amount })
    else if (l.eventName === 'Withdrawn' && l.args.user.toLowerCase() === w) out.push({ logIndex, kind: 'withdraw', amountRaw: l.args.amount })
    else if (l.eventName === 'TaskFunded' && l.args.funder.toLowerCase() === w) out.push({ logIndex, kind: 'fund', amountRaw: l.args.amount })
    else if (l.eventName === 'RewardReleased' && l.args.worker.toLowerCase() === w) out.push({ logIndex, kind: 'reward', amountRaw: l.args.amount })
    else if (l.eventName === 'TaskRefunded' && l.args.funder.toLowerCase() === w) out.push({ logIndex, kind: 'refund', amountRaw: l.args.amount })
  }
  if (!out.length) return []
  const block = await client.getBlock({ blockNumber: receipt.blockNumber })
  const at = new Date(Number(block.timestamp) * 1000)
  return out.map((e) => ({ ...e, at }))
}

import { isAddress, parseAbi } from 'viem'

export const ARC_TESTNET_ID = 5042002

const raw = import.meta.env.VITE_VAULT_ADDRESS as string | undefined

/** Adresse du coffre ArcQuestVault déployé sur Arc Testnet (undefined tant qu'elle n'est pas configurée). */
export const VAULT_ADDRESS: `0x${string}` | undefined = raw && isAddress(raw) ? raw : undefined

export const vaultAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'tasks', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: 'funder', type: 'address' }, { name: 'refundableAfter', type: 'uint64' }, { name: 'escrow', type: 'uint256' }] },
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundTask', stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }, { name: 'refundableAfter', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'releaseReward', stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'bytes32' }, { name: 'worker', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'refundTask', stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const

/** Fonctions du protocole de tâches protégées (création, soumission, relecture, litige). */
export const jobAbi = parseAbi([
  'function createJob(bytes32 jobId, uint128 reward, uint32 slots, uint64 deadline, uint32 reviewPeriod)',
  'function submitClaim(bytes32 jobId, uint64 expiry, bytes signature)',
  'function approveClaim(bytes32 jobId, address worker)',
  'function rejectClaim(bytes32 jobId, address worker)',
  'function finalizeClaim(bytes32 jobId, address worker)',
  'function disputeClaim(bytes32 jobId)',
  'function releaseRejected(bytes32 jobId, address worker)',
  'function resolveDispute(bytes32 jobId, address worker, bool payWorker)',
  'function expireDispute(bytes32 jobId, address worker)',
  'function reclaimJob(bytes32 jobId)',
  'function jobs(bytes32) view returns (address funder, uint64 deadline, uint32 reviewPeriod, uint32 slots, uint32 active, uint128 reward, uint256 escrow, uint256 locked)',
  'function claims(bytes32, address) view returns (uint8 status, uint64 at)',
  'function arbiter() view returns (address)',
])

/** Délais fixés par le contrat. */
export const DISPUTE_WINDOW_SECONDS = 7 * 86_400
export const ARBITER_TIMEOUT_SECONDS = 14 * 86_400

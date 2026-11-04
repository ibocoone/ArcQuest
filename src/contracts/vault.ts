import { isAddress } from 'viem'

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

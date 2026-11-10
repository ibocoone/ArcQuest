import { usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { erc20Abi, keccak256, stringToBytes } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { Amount, parseAmount, usdcDecimalsFor } from '@/onchain-money'
import { ARC_TESTNET_ID, VAULT_ADDRESS, jobAbi, vaultAbi } from '@/contracts/vault'
import { useWallet } from './useWallet'

/** Identifiant onchain d'une tâche ou d'un concours à partir de son id applicatif. */
export function taskIdOf(id: string): `0x${string}` {
  return keccak256(stringToBytes(id))
}

/** Solde du portefeuille connecté dans le coffre, en USDC. */
export function useVaultBalance() {
  const { address } = useWallet()
  const { data, refetch } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_ID,
    query: { enabled: !!VAULT_ADDRESS && !!address, refetchInterval: 15_000 },
  })
  const balance = data != null ? Number(Amount.fromRaw(data, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(6)) : 0
  return { balance, refetch, available: !!VAULT_ADDRESS }
}

export function explorerTx(hash: string): string {
  return buildTxExplorerUrl(ARC_TESTNET_ID, hash)
}

/** Actions onchain sur le coffre. Chaque fonction attend la confirmation et renvoie le hash. */
export type DepositStep = 'checking' | 'approve' | 'approving' | 'deposit' | 'confirming'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

interface WriteRequest { address: `0x${string}`; abi: unknown; functionName: string; args: unknown[]; chainId?: number }

export function useVaultActions() {
  const wallet = useWallet()
  const address = wallet.address
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })
  const { writeContractAsync } = useWriteContract()

  /** Envoie une transaction : par le portefeuille externe, ou par opération sponsorisée pour un portefeuille à passkey. */
  const write = async (req: WriteRequest): Promise<`0x${string}`> => {
    if (wallet.kind === 'passkey') {
      return wallet.sendPasskey([{ to: req.address, abi: req.abi, functionName: req.functionName, args: req.args }])
    }
    return writeContractAsync(req as unknown as Parameters<typeof writeContractAsync>[0])
  }
  const qc = useQueryClient()
  const usdc = getUsdc(ARC_TESTNET_ID)

  const ready = () => {
    if (!VAULT_ADDRESS || !usdc || !address || !publicClient) throw new Error('Vault unavailable')
    return { vault: VAULT_ADDRESS, token: usdc.address as `0x${string}`, owner: address, client: publicClient }
  }

  const confirm = async (hash: `0x${string}`) => {
    const { client } = ready()
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 })
    if (receipt.status !== 'success') throw new Error('Transaction failed onchain')
    // Le serveur relit la transaction sur la blockchain et l'ajoute à l'historique ; sans effet sur l'opération
    void api('/me/activity', { body: { txHash: hash } })
      .then(() => qc.invalidateQueries({ queryKey: ['activity'] }))
      .catch(() => undefined)
    return hash
  }

  const deposit = async (amount: string, onStep?: (step: DepositStep) => void) => {
    const { vault, token, owner, client } = ready()
    const raw = parseAmount(ARC_TESTNET_ID, amount).raw
    if (wallet.kind === 'passkey') {
      // un seul geste avec le passkey : autorisation exacte puis dépôt, frais pris en charge
      onStep?.('deposit')
      const batch = await wallet.sendPasskey([
        { to: token, abi: erc20Abi, functionName: 'approve', args: [vault, raw] },
        { to: vault, abi: vaultAbi, functionName: 'deposit', args: [raw] },
      ])
      onStep?.('confirming')
      return confirm(batch)
    }
    onStep?.('checking')
    // Si le RPC public est lent ou refuse la lecture, on ne bloque pas : on demande simplement l'autorisation.
    let allowance = 0n
    try {
      allowance = await withTimeout(client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, vault] }), 5_000)
    } catch {
      allowance = 0n
    }
    if (allowance < raw) {
      onStep?.('approve')
      // approbation exacte du montant, jamais illimitée
      const approval = await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [vault, raw], chainId: ARC_TESTNET_ID })
      onStep?.('approving')
      await confirm(approval)
    }
    onStep?.('deposit')
    const hash = await write({ address: vault, abi: vaultAbi, functionName: 'deposit', args: [raw], chainId: ARC_TESTNET_ID })
    onStep?.('confirming')
    return confirm(hash)
  }

  const withdraw = async (amount: string) => {
    const { vault } = ready()
    const raw = parseAmount(ARC_TESTNET_ID, amount).raw
    return confirm(await write({ address: vault, abi: vaultAbi, functionName: 'withdraw', args: [raw], chainId: ARC_TESTNET_ID }))
  }

  /** Réserve `raw` (unités USDC) du solde pour la tâche/concours `appId`, remboursable après `refundableAfter` (secondes Unix). */
  const fundTask = async (appId: string, raw: bigint, refundableAfter: number) => {
    const { vault } = ready()
    return confirm(await write({
      address: vault, abi: vaultAbi, functionName: 'fundTask',
      args: [taskIdOf(appId), raw, BigInt(refundableAfter)], chainId: ARC_TESTNET_ID,
    }))
  }

  /** Paie `amount` USDC (depuis la réserve de `appId`) au solde de `worker`. */
  const releaseReward = async (appId: string, worker: `0x${string}`, amount: string) => {
    const { vault } = ready()
    const raw = parseAmount(ARC_TESTNET_ID, amount).raw
    return confirm(await write({
      address: vault, abi: vaultAbi, functionName: 'releaseReward',
      args: [taskIdOf(appId), worker, raw], chainId: ARC_TESTNET_ID,
    }))
  }

  /** Récupère `raw` de la réserve de `appId` (possible après la date de déverrouillage). */
  const refundTask = async (appId: string, raw: bigint) => {
    const { vault } = ready()
    return confirm(await write({
      address: vault, abi: vaultAbi, functionName: 'refundTask', args: [taskIdOf(appId), raw], chainId: ARC_TESTNET_ID,
    }))
  }

  // ── Tâches protégées : chaque action attend la confirmation puis renvoie le hash ──
  const job = async <F extends 'createJob' | 'submitClaim' | 'approveClaim' | 'rejectClaim' | 'finalizeClaim' | 'disputeClaim' | 'releaseRejected' | 'resolveDispute' | 'expireDispute' | 'reclaimJob'>(
    functionName: F, args: unknown[],
  ) => {
    const { vault } = ready()
    const request: WriteRequest = { address: vault, abi: jobAbi, functionName, args, chainId: ARC_TESTNET_ID }
    const hash = await write(request)
    return confirm(hash)
  }
  const createJob = (appId: string, rewardRaw: bigint, slots: number, deadline: number, reviewDays: number) =>
    job('createJob', [taskIdOf(appId), rewardRaw, slots, BigInt(deadline), reviewDays * 86_400])
  const submitClaim = (appId: string, expiry: number, signature: `0x${string}`) => job('submitClaim', [taskIdOf(appId), BigInt(expiry), signature])
  const approveClaim = (appId: string, worker: `0x${string}`) => job('approveClaim', [taskIdOf(appId), worker])
  const rejectClaim = (appId: string, worker: `0x${string}`) => job('rejectClaim', [taskIdOf(appId), worker])
  const finalizeClaim = (appId: string, worker: `0x${string}`) => job('finalizeClaim', [taskIdOf(appId), worker])
  const disputeClaim = (appId: string) => job('disputeClaim', [taskIdOf(appId)])
  const releaseRejected = (appId: string, worker: `0x${string}`) => job('releaseRejected', [taskIdOf(appId), worker])
  const resolveDispute = (appId: string, worker: `0x${string}`, payWorker: boolean) => job('resolveDispute', [taskIdOf(appId), worker, payWorker])
  const expireDispute = (appId: string, worker: `0x${string}`) => job('expireDispute', [taskIdOf(appId), worker])
  const reclaimJob = (appId: string) => job('reclaimJob', [taskIdOf(appId)])

  return {
    deposit, withdraw, fundTask, releaseReward, refundTask,
    createJob, submitClaim, approveClaim, rejectClaim, finalizeClaim, disputeClaim, releaseRejected, resolveDispute, expireDispute, reclaimJob,
  }
}

/** Remaining reserve et date de déverrouillage d'une tâche/concours, lues dans le contrat. */
export function useEscrow(appId: string) {
  const { data, refetch } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: 'tasks',
    args: [taskIdOf(appId)],
    chainId: ARC_TESTNET_ID,
    query: { enabled: !!VAULT_ADDRESS, refetchInterval: 20_000 },
  })
  const raw = data?.[2] ?? 0n
  return {
    raw,
    amount: Number(Amount.fromRaw(raw, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(6)),
    refundableAfter: data ? Number(data[1]) : 0,
    refetch,
  }
}

/** Fonds restants d'une tâche protégée (libres et verrouillés), lus dans le contrat. */
export function useJob(appId: string) {
  const { data, refetch } = useReadContract({
    address: VAULT_ADDRESS,
    abi: jobAbi,
    functionName: 'jobs',
    args: [taskIdOf(appId)],
    chainId: ARC_TESTNET_ID,
    query: { enabled: !!VAULT_ADDRESS, refetchInterval: 30_000 },
  })
  const dec = usdcDecimalsFor(ARC_TESTNET_ID)
  const num = (raw: bigint) => Number(Amount.fromRaw(raw, dec).toFixed(6))
  return {
    escrow: data ? num(data[6]) : 0,
    locked: data ? num(data[7]) : 0,
    deadline: data ? Number(data[1]) : 0,
    exists: !!data && data[0] !== '0x0000000000000000000000000000000000000000',
    refetch,
  }
}

/** Adresse de l'arbitre du contrat. */
export function useArbiter(): `0x${string}` | undefined {
  const { data } = useReadContract({
    address: VAULT_ADDRESS, abi: jobAbi, functionName: 'arbiter', chainId: ARC_TESTNET_ID, query: { enabled: !!VAULT_ADDRESS },
  })
  return data
}

/** Convertit un montant décimal en unités USDC (6 décimales). */
export function toRawUsdc(amount: string): bigint {
  return parseAmount(ARC_TESTNET_ID, amount).raw
}

/** Connexion du portefeuille au bon compte : le contrat agit sur l'adresse connectée. */
export function useWalletMatch(linked: string | null | undefined) {
  const { address, isConnected } = useWallet()
  return {
    isConnected,
    linked: !!linked,
    matches: !!linked && !!address && linked.toLowerCase() === address.toLowerCase(),
  }
}

/** Indique si l'utilisateur peut signer une transaction pour son compte (portefeuille lié et connecté). */
export function useTxGate(linked: string | null | undefined): { ok: boolean; message: string | null } {
  const { isConnected, linked: hasLinked, matches } = useWalletMatch(linked)
  if (!VAULT_ADDRESS) return { ok: false, message: 'The contract is not configured.' }
  if (!hasLinked) return { ok: false, message: 'Link a wallet to your account in Settings.' }
  if (!isConnected) return { ok: false, message: 'Connect your wallet.' }
  if (!matches) return { ok: false, message: `Connect the wallet linked to your account (${linked?.slice(0, 6)}…${linked?.slice(-4)}).` }
  return { ok: true, message: null }
}

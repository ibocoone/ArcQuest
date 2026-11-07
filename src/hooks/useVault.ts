import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { erc20Abi, keccak256, stringToBytes } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { Amount, parseAmount, usdcDecimalsFor } from '@/onchain-money'
import { ARC_TESTNET_ID, VAULT_ADDRESS, vaultAbi } from '@/contracts/vault'

/** Identifiant onchain d'une tâche ou d'un concours à partir de son id applicatif. */
export function taskIdOf(id: string): `0x${string}` {
  return keccak256(stringToBytes(id))
}

/** Solde du portefeuille connecté dans le coffre, en USDC. */
export function useVaultBalance() {
  const { address } = useAccount()
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
export function useVaultActions() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })
  const { writeContractAsync } = useWriteContract()
  const qc = useQueryClient()
  const usdc = getUsdc(ARC_TESTNET_ID)

  const ready = () => {
    if (!VAULT_ADDRESS || !usdc || !address || !publicClient) throw new Error('Coffre indisponible')
    return { vault: VAULT_ADDRESS, token: usdc.address as `0x${string}`, owner: address, client: publicClient }
  }

  const confirm = async (hash: `0x${string}`) => {
    const { client } = ready()
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('Transaction échouée onchain')
    // Le serveur relit la transaction sur la blockchain et l'ajoute à l'historique ; sans effet sur l'opération
    void api('/me/activity', { body: { txHash: hash } })
      .then(() => qc.invalidateQueries({ queryKey: ['activity'] }))
      .catch(() => undefined)
    return hash
  }

  const deposit = async (amount: string) => {
    const { vault, token, owner, client } = ready()
    const raw = parseAmount(ARC_TESTNET_ID, amount).raw
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, vault] })
    if (allowance < raw) {
      // approbation exacte du montant, jamais illimitée
      await confirm(await writeContractAsync({ address: token, abi: erc20Abi, functionName: 'approve', args: [vault, raw], chainId: ARC_TESTNET_ID }))
    }
    return confirm(await writeContractAsync({ address: vault, abi: vaultAbi, functionName: 'deposit', args: [raw], chainId: ARC_TESTNET_ID }))
  }

  const withdraw = async (amount: string) => {
    const { vault } = ready()
    const raw = parseAmount(ARC_TESTNET_ID, amount).raw
    return confirm(await writeContractAsync({ address: vault, abi: vaultAbi, functionName: 'withdraw', args: [raw], chainId: ARC_TESTNET_ID }))
  }

  /** Réserve `raw` (unités USDC) du solde pour la tâche/concours `appId`, remboursable après `refundableAfter` (secondes Unix). */
  const fundTask = async (appId: string, raw: bigint, refundableAfter: number) => {
    const { vault } = ready()
    return confirm(await writeContractAsync({
      address: vault, abi: vaultAbi, functionName: 'fundTask',
      args: [taskIdOf(appId), raw, BigInt(refundableAfter)], chainId: ARC_TESTNET_ID,
    }))
  }

  /** Paie `amount` USDC (depuis la réserve de `appId`) au solde de `worker`. */
  const releaseReward = async (appId: string, worker: `0x${string}`, amount: string) => {
    const { vault } = ready()
    const raw = parseAmount(ARC_TESTNET_ID, amount).raw
    return confirm(await writeContractAsync({
      address: vault, abi: vaultAbi, functionName: 'releaseReward',
      args: [taskIdOf(appId), worker, raw], chainId: ARC_TESTNET_ID,
    }))
  }

  /** Récupère `raw` de la réserve de `appId` (possible après la date de déverrouillage). */
  const refundTask = async (appId: string, raw: bigint) => {
    const { vault } = ready()
    return confirm(await writeContractAsync({
      address: vault, abi: vaultAbi, functionName: 'refundTask', args: [taskIdOf(appId), raw], chainId: ARC_TESTNET_ID,
    }))
  }

  return { deposit, withdraw, fundTask, releaseReward, refundTask }
}

/** Réserve restante et date de déverrouillage d'une tâche/concours, lues dans le contrat. */
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

/** Convertit un montant décimal en unités USDC (6 décimales). */
export function toRawUsdc(amount: string): bigint {
  return parseAmount(ARC_TESTNET_ID, amount).raw
}

/** Connexion du portefeuille au bon compte : le contrat agit sur l'adresse connectée. */
export function useWalletMatch(linked: string | null | undefined) {
  const { address, isConnected } = useAccount()
  return {
    isConnected,
    linked: !!linked,
    matches: !!linked && !!address && linked.toLowerCase() === address.toLowerCase(),
  }
}

/** Indique si l'utilisateur peut signer une transaction pour son compte (portefeuille lié et connecté). */
export function useTxGate(linked: string | null | undefined): { ok: boolean; message: string | null } {
  const { isConnected, linked: hasLinked, matches } = useWalletMatch(linked)
  if (!VAULT_ADDRESS) return { ok: false, message: 'Le contrat n\'est pas configuré.' }
  if (!hasLinked) return { ok: false, message: 'Liez un portefeuille à votre compte dans Paramètres.' }
  if (!isConnected) return { ok: false, message: 'Connectez votre portefeuille.' }
  if (!matches) return { ok: false, message: `Connectez le portefeuille lié à votre compte (${linked?.slice(0, 6)}…${linked?.slice(-4)}).` }
  return { ok: true, message: null }
}

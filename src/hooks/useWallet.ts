import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import type { Hex } from 'viem'
import { ARC_TESTNET_ID } from '@/contracts/vault'
import { useAuth } from '../context/AuthContext'
import { usePasskey } from '../passkey/PasskeyContext'

export type WalletKind = 'passkey' | 'external'

/**
 * Portefeuille actif : celui du compte connecté s'il correspond, sinon le portefeuille externe connecté,
 * sinon le portefeuille à passkey. Tout le reste de l'application passe par ce hook.
 */
export function useWallet() {
  const pk = usePasskey()
  const ext = useAccount()
  const { user } = useAuth()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()

  const linked = user?.walletAddress?.toLowerCase()
  const pkAddr = pk.address?.toLowerCase()
  const extAddr = ext.address?.toLowerCase()

  let kind: WalletKind | null = null
  if (linked) {
    // Un compte lié à un portefeuille n'utilise jamais un autre portefeuille, même s'il est connecté
    if (pkAddr === linked) kind = 'passkey'
    else if (extAddr === linked) kind = 'external'
  } else if (ext.isConnected) kind = 'external'
  else if (pk.address) kind = 'passkey'

  // Un autre portefeuille que celui du compte est connecté
  const foreign = linked && kind === null ? (ext.address ?? pk.address) : undefined
  const mismatch = !!foreign

  const address: Hex | undefined = kind === 'passkey' ? pk.address : kind === 'external' ? ext.address : undefined

  return {
    kind,
    address,
    isConnected: kind !== null,
    mismatch,
    foreignAddress: foreign,
    linkedAddress: user?.walletAddress ?? undefined,
    chainId: kind === 'passkey' ? ARC_TESTNET_ID : ext.chainId,
    passkeyEnabled: pk.enabled,
    disconnect: () => {
      if (kind === 'passkey') pk.signOut()
      else if (kind === 'external') disconnect()
      else { disconnect(); pk.signOut() }
    },
    signMessage: async (message: string): Promise<Hex> => {
      if (kind === 'passkey' && pk.account) return pk.account.signMessage({ message })
      return signMessageAsync({ message })
    },
    sendPasskey: pk.send,
  }
}

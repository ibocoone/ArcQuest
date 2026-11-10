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
  if (linked && pkAddr === linked) kind = 'passkey'
  else if (linked && extAddr === linked) kind = 'external'
  else if (ext.isConnected) kind = 'external'
  else if (pk.address) kind = 'passkey'

  const address: Hex | undefined = kind === 'passkey' ? pk.address : kind === 'external' ? ext.address : undefined

  return {
    kind,
    address,
    isConnected: kind !== null,
    chainId: kind === 'passkey' ? ARC_TESTNET_ID : ext.chainId,
    passkeyEnabled: pk.enabled,
    disconnect: () => { if (kind === 'passkey') pk.signOut(); else disconnect() },
    signMessage: async (message: string): Promise<Hex> => {
      if (kind === 'passkey' && pk.account) return pk.account.signMessage({ message })
      return signMessageAsync({ message })
    },
    sendPasskey: pk.send,
  }
}

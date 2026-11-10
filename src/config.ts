/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { fallback, http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ARC_TESTNET_RPCS } from './rpc'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

/** Arc Testnet avec plusieurs accès : un portefeuille qui ajoute le réseau reçoit d'abord un accès non bloqué dans les pays restreints. */
const arcChain = { ...arcTestnet, rpcUrls: { default: { http: [...ARC_TESTNET_RPCS] } } }
const direct = (url: string) => http(url, { retryCount: 0, timeout: 5_000 })

export const config = createConfig({
  chains: [arcChain, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    // Plusieurs accès publics l'un après l'autre (un refus de pays est immédiat)
    [arcChain.id]: fallback(ARC_TESTNET_RPCS.map(direct)),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    // Le RPC public peut refuser des requêtes (429) quand il est sollicité : on réessaie plus longtemps
    [arcTestnet.id]: http(undefined, { retryCount: 3, retryDelay: 500, timeout: 8_000 }),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

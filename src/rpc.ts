/**
 * Accès publics officiels à Arc Testnet (docs.arc.io), sans clé. Le principal (rpc.testnet.arc.io) est protégé par
 * Cloudflare et refuse certains pays, dont le Mali : on le garde en dernier. Le site essaie ces accès l'un après l'autre.
 */
export const ARC_TESTNET_RPCS = [
  'https://rpc.blockdaemon.testnet.arc.io',
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
  'https://rpc.testnet.arc.io',
] as const

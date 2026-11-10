import type { Hex } from 'viem'
import type { P256Credential, SmartAccount } from 'viem/account-abstraction'

/** Portefeuilles à passkey (Circle Modular Wallets). Désactivés tant que la clé client n'est pas renseignée. */
const CLIENT_KEY = String(import.meta.env.VITE_CLIENT_KEY ?? '')
const CLIENT_URL = String(import.meta.env.VITE_CLIENT_URL ?? '')
export const passkeyEnabled = CLIENT_KEY.length > 0 && CLIENT_URL.length > 0

const STORAGE = 'arcquest:passkey-credential'

export function loadCredential(): P256Credential | null {
  try {
    const raw = localStorage.getItem(STORAGE)
    return raw ? (JSON.parse(raw) as P256Credential) : null
  } catch {
    return null
  }
}
export const saveCredential = (c: P256Credential) => localStorage.setItem(STORAGE, JSON.stringify(c))
export const clearCredential = () => localStorage.removeItem(STORAGE)

/** Le SDK n'est chargé qu'au premier usage pour ne pas alourdir le site de ceux qui n'utilisent pas de passkey. */
let cached: ReturnType<typeof build> | null = null
async function build() {
  const [circle, aa, chains, viem] = await Promise.all([
    import('@circle-fin/modular-wallets-core'),
    import('viem/account-abstraction'),
    import('viem/chains'),
    import('viem'),
  ])
  const passkeyTransport = circle.toPasskeyTransport(CLIENT_URL, CLIENT_KEY)
  const modularTransport = circle.toModularTransport(`${CLIENT_URL}/arcTestnet`, CLIENT_KEY)
  const client = viem.createPublicClient({ chain: chains.arcTestnet, transport: modularTransport })
  const bundler = aa.createBundlerClient({ chain: chains.arcTestnet, transport: modularTransport })
  return { circle, aa, passkeyTransport, client, bundler }
}
const clients = () => (cached ??= build())

async function credentialFor(mode: 'register' | 'login', username?: string): Promise<P256Credential> {
  const { circle, passkeyTransport } = await clients()
  const credential = await circle.toWebAuthnCredential(
    mode === 'register'
      ? { transport: passkeyTransport, mode: circle.WebAuthnMode.Register, username: username ?? 'ArcQuest user' }
      : { transport: passkeyTransport, mode: circle.WebAuthnMode.Login },
  )
  saveCredential(credential)
  return credential
}
export const registerPasskey = (username: string) => credentialFor('register', username)
export const loginPasskey = () => credentialFor('login')

export async function accountFromCredential(credential: P256Credential): Promise<SmartAccount> {
  const { circle, aa, client } = await clients()
  return circle.toCircleSmartAccount({ client, owner: aa.toWebAuthnAccount({ credential }) })
}

export interface PasskeyCall { to: Hex; abi: unknown; functionName: string; args: unknown[] }

/** Envoie une ou plusieurs appels en une seule opération, frais pris en charge par Circle (Gas Station), et renvoie le hash de transaction. */
export async function sendCalls(account: SmartAccount, calls: PasskeyCall[]): Promise<Hex> {
  const { bundler } = await clients()
  const hash = await bundler.sendUserOperation({ account, calls: calls as unknown as never[], paymaster: true })
  const { receipt } = await bundler.waitForUserOperationReceipt({ hash })
  return receipt.transactionHash
}

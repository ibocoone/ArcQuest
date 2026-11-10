import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Hex } from 'viem'
import type { SmartAccount } from 'viem/account-abstraction'
import {
  accountFromCredential, clearCredential, loadCredential, loginPasskey, passkeyEnabled, registerPasskey, sendCalls, type PasskeyCall,
} from './circle'

interface PasskeyValue {
  enabled: boolean
  address: Hex | undefined
  account: SmartAccount | undefined
  signUp: (username: string) => Promise<SmartAccount>
  signIn: () => Promise<SmartAccount>
  signOut: () => void
  send: (calls: PasskeyCall[]) => Promise<Hex>
}

const Ctx = createContext<PasskeyValue | null>(null)

export function PasskeyProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [credential, setCredential] = useState(() => (passkeyEnabled ? loadCredential() : null))
  const account = useQuery({
    queryKey: ['passkey-account', credential?.id],
    queryFn: () => accountFromCredential(credential!),
    enabled: passkeyEnabled && !!credential,
    staleTime: Infinity,
    retry: false,
  })

  const adopt = async (next: Awaited<ReturnType<typeof registerPasskey>>) => {
    const acc = await accountFromCredential(next)
    qc.setQueryData(['passkey-account', next.id], acc)
    setCredential(next)
    return acc
  }
  const value: PasskeyValue = {
    enabled: passkeyEnabled,
    address: account.data?.address,
    account: account.data,
    signUp: async (username) => adopt(await registerPasskey(username)),
    signIn: async () => adopt(await loginPasskey()),
    signOut: () => {
      clearCredential()
      setCredential(null)
      qc.removeQueries({ queryKey: ['passkey-account'] })
    },
    send: async (calls) => {
      if (!account.data) throw new Error('Passkey wallet is not ready.')
      return sendCalls(account.data, calls)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePasskey(): PasskeyValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePasskey must be used inside PasskeyProvider')
  return v
}

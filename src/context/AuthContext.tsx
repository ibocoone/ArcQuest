import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDisconnect } from 'wagmi'
import { api, type User } from '../api'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  /** Recharge le profil après une connexion, une inscription ou une liaison de portefeuille. */
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { disconnect } = useDisconnect()
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User | null }>('/me'),
    staleTime: 60_000,
  })

  const refresh = async () => {
    // les données d'un autre compte ne doivent jamais rester en cache
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    await qc.invalidateQueries({ queryKey: ['me'] })
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined)
    disconnect()
    qc.clear()
    qc.setQueryData(['me'], { user: null })
  }

  return (
    <AuthContext.Provider value={{ user: data?.user ?? null, isLoading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

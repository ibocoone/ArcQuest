import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api, fmtDate } from '../api'
import { useAuth } from '../context/AuthContext'
import { buildShareLink } from '../lib/share'
import { Card, Empty, ErrorBox, Loading, PageTitle, inputStyle } from '../ui'

interface Referral { username: string; joinedAt: string; active: boolean }

export default function ReferralsPage() {
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  // Le lien est construit une seule fois : Safari perd l'activation utilisateur pendant l'attente.
  const link = useQuery({
    queryKey: ['share-link', user?.referralCode],
    queryFn: () => buildShareLink(`/?ref=${user?.referralCode ?? ''}`),
    enabled: !!user,
    staleTime: Infinity,
  })
  const list = useQuery({ queryKey: ['referrals'], queryFn: () => api<{ items: Referral[] }>('/me/referrals') })

  const copy = () => {
    if (!link.data) return
    void navigator.clipboard.writeText(link.data).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  const share = () => {
    if (!link.data) return
    if (navigator.share) navigator.share({ title: 'ArcQuest', text: 'Rejoins-moi sur ArcQuest', url: link.data }).catch(() => copy())
    else copy()
  }

  const items = list.data?.items ?? []
  const active = items.filter((r) => r.active).length

  return (
    <div className="max-w-2xl space-y-5">
      <PageTitle title="Parrainage" sub="Invitez des amis. Un filleul est « actif » dès qu'il a reçu un premier paiement réel." />

      <Card className="p-5 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--muted)' }}>Votre code</div>
          <div className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--ink)' }}>{user?.referralCode}</div>
        </div>
        <div className="flex gap-2">
          <input readOnly style={{ ...inputStyle, flex: 1 }} value={link.data ?? 'Préparation du lien…'} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={copy} disabled={!link.data} aria-label="Copier le lien" className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(26,47,110,0.07)', color: 'var(--accent)' }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          <button onClick={share} disabled={!link.data} aria-label="Partager" className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-white"
            style={{ background: link.data ? 'var(--accent)' : 'var(--subtle)' }}><Share2 size={16} /></button>
        </div>
        <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          Aucune récompense en argent n'est versée pour le parrainage à ce jour. Les inscriptions sont comptées uniquement pour les statistiques.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4"><div className="text-xs" style={{ color: 'var(--muted)' }}>Filleuls</div><div className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--ink)' }}>{items.length}</div></Card>
        <Card className="p-4"><div className="text-xs" style={{ color: 'var(--muted)' }}>Actifs</div><div className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--success)' }}>{active}</div></Card>
      </div>

      <Card>
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox message={list.error.message} /></div>
          : !items.length ? <Empty title="Aucun filleul pour l'instant" sub="Partagez votre lien pour commencer." />
          : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {items.map((r) => (
                <div key={r.username} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>@{r.username}</div>
                    <div className="text-xs" style={{ color: 'var(--subtle)' }}>Inscrit le {fmtDate(r.joinedAt)}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: r.active ? 'rgba(26,128,71,0.10)' : 'rgba(15,28,53,0.07)', color: r.active ? 'var(--success)' : 'var(--muted)' }}>
                    {r.active ? 'Actif' : 'Inscrit'}
                  </span>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  )
}

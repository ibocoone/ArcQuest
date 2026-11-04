import { useState } from 'react'
import { Bell } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate } from '../api'
import { glass } from '../ui'

interface Notif { id: string; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }

export default function NotificationsBell({ onNavigate }: { onNavigate: (target: string) => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; items: Notif[] }>('/notifications'),
    refetchInterval: 30_000,
  })
  const markRead = useMutation({
    mutationFn: () => api('/notifications/read', { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && (data?.unread ?? 0) > 0) markRead.mutate()
  }

  return (
    <div className="relative">
      <button onClick={toggle} aria-label="Notifications" className="relative w-11 h-11 rounded-xl flex items-center justify-center" style={{ color: '#334155' }}>
        <Bell size={20} />
        {(data?.unread ?? 0) > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: 'var(--danger)' }}>
            {data?.unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] z-50 rounded-2xl overflow-hidden" style={{ ...glass, background: 'rgba(255,255,255,0.97)' }}>
            <div className="px-4 py-3 border-b text-sm font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>Notifications</div>
            <div className="max-h-96 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
              {(data?.items ?? []).length === 0 && <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>Aucune notification</div>}
              {(data?.items ?? []).map((n) => (
                <button key={n.id} className="w-full text-left px-4 py-3 block" style={{ background: n.read ? 'transparent' : 'rgba(26,47,110,0.05)' }}
                  onClick={() => { setOpen(false); if (n.link) onNavigate(n.link) }}>
                  <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{n.title}</div>
                  {n.body && <div className="text-xs mt-0.5 text-pretty" style={{ color: 'var(--muted)' }}>{n.body}</div>}
                  <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{fmtDate(n.createdAt)}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api'
import { inputStyle } from '../ui'

export default function ReportButton({ type, id }: { type: 'task' | 'contest' | 'user'; id: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    try {
      await api('/reports', { body: { targetType: type, targetId: id, reason } })
      toast.success('Report sent to moderation.')
      setOpen(false)
      setReason('')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not send.') } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="min-h-[44px] inline-flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
        <Flag size={12} /> Report
      </button>
    )
  }
  return (
    <div className="space-y-2 w-full">
      <textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={500} placeholder="Why are you reporting this?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: 'rgba(15,28,53,0.07)', color: 'var(--muted)' }}>Cancel</button>
        <button onClick={() => void send()} disabled={busy || reason.trim().length < 5} className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white"
          style={{ background: busy || reason.trim().length < 5 ? 'var(--subtle)' : 'var(--danger)' }}>Send</button>
      </div>
    </div>
  )
}

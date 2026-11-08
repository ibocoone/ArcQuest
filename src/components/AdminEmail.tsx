import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmtDate } from '../api'
import { useAuth } from '../context/AuthContext'
import { Card, ErrorBox, Label, Loading, ghostBtn, inputStyle, primaryBtn } from '../ui'

interface Status {
  configured: boolean
  from: string | null
  fromName: string
  publicUrl: string | null
  production: boolean
  recentErrors: { at: string; message: string }[]
}

/** Traduit les erreurs du fournisseur en une consigne claire. */
function hint(message: string): string | null {
  if (/\b401\b|unrecognised IP|unauthor/i.test(message)) return 'Brevo refused the request. Check that BREVO_API_KEY is the full API key, and in Brevo open Security > Authorised IPs and deactivate the IP restriction (Render uses changing addresses).'
  if (/\b400\b/.test(message) && /sender|from/i.test(message)) return 'The sender address is not valid or not verified. In Brevo open Senders and make sure EMAIL_FROM is listed as "Verified", with exactly the same spelling.'
  if (/\b400\b/.test(message)) return 'Brevo rejected the message. Read the details above; the sender address (EMAIL_FROM) must be verified in Brevo.'
  if (/\b403\b/.test(message)) return 'Brevo account not activated or sending blocked. Check your Brevo account status and its confirmation emails.'
  if (/timeout|fetch failed|network/i.test(message)) return 'The server could not reach Brevo. Try again in a minute.'
  return null
}

export default function AdminEmail() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['admin-email'], queryFn: () => api<Status>('/admin/email-status') })
  const [to, setTo] = useState(user?.email ?? '')
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; error?: string }>('/admin/email-test', { body: { to } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin-email'] }),
  })
  if (status.isLoading) return <Loading />
  if (status.error || !status.data) return <ErrorBox message="Could not load the email status." />
  const s = status.data
  const rows: [string, string][] = [
    ['Provider configured', s.configured ? 'Yes (Brevo)' : 'No: BREVO_API_KEY or EMAIL_FROM is missing'],
    ['Sender address', s.from ?? 'Not set'],
    ['Sender name', s.fromName],
    ['Public address in links', s.publicUrl ?? 'Not set (PUBLIC_URL)'],
  ]
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm"><span style={{ color: 'var(--muted)' }}>{k}</span><span className="font-medium text-right break-all">{v}</span></div>
        ))}
      </Card>
      <Card className="p-5 space-y-3">
        <div className="font-semibold">Send a test email</div>
        <div><Label>Send to</Label><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" style={inputStyle} /></div>
        <button style={primaryBtn(test.isPending || !to)} disabled={test.isPending || !to} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send test email'}</button>
        {test.data?.ok && <div className="text-sm font-medium" style={{ color: '#047857' }}>Sent. Check the inbox and the spam folder of {to}.</div>}
        {test.data && !test.data.ok && (
          <div className="space-y-2">
            <ErrorBox message={test.data.error ?? 'Sending failed.'} />
            {hint(test.data.error ?? '') && <div className="text-sm" style={{ color: 'var(--muted)' }}>{hint(test.data.error ?? '')}</div>}
          </div>
        )}
        {test.error && <ErrorBox message={test.error.message} />}
      </Card>
      <Card className="p-5 space-y-2">
        <div className="flex items-center justify-between"><div className="font-semibold">Recent sending errors</div><button style={ghostBtn} onClick={() => void status.refetch()}>Refresh</button></div>
        {s.recentErrors.length === 0 && <div className="text-sm" style={{ color: 'var(--muted)' }}>No error since the server last started.</div>}
        {s.recentErrors.map((e) => (
          <div key={e.at} className="text-sm"><span style={{ color: 'var(--muted)' }}>{fmtDate(e.at)}</span> {e.message}</div>
        ))}
      </Card>
    </div>
  )
}

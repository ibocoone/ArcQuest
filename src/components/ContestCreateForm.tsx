import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatUnits } from 'viem'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { toRawUsdc, useTxGate, useVaultActions, useVaultBalance } from '../hooks/useVault'
import { Card, ErrorBox, Label, inputStyle, primaryBtn } from '../ui'

export const CONTEST_TYPES = [
  { id: 'meme', label: 'Mème' }, { id: 'contenu', label: 'Contenu' }, { id: 'referral', label: 'Parrainage' },
  { id: 'video', label: 'Vidéo' }, { id: 'autre', label: 'Autre' },
]
const DAY = 86_400
const ORD = ['1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e']
const inDays = (d: number) => new Date(Date.now() + d * DAY * 1000).toISOString().slice(0, 16)

export default function ContestCreateForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const gate = useTxGate(user?.walletAddress)
  const { balance } = useVaultBalance()
  const { fundTask } = useVaultActions()
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null)
  const [f, setF] = useState({ title: '', description: '', prompt: '', type: 'meme', endsAt: inDays(14), slots: '100' })
  const [prizes, setPrizes] = useState([{ place: '1er', amount: '' }])
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const valid = prizes.every((p) => /^\d+(\.\d{1,6})?$/.test(p.amount) && Number(p.amount) > 0)
  const poolRaw = valid ? prizes.reduce((s, p) => s + toRawUsdc(p.amount), 0n) : 0n
  const pool = Number(formatUnits(poolRaw, 6))
  const enough = pool <= balance

  const register = async (payload: Record<string, unknown>) => {
    await api('/contests', { body: payload })
    setRetry(null)
    toast.success('Concours publié. La cagnotte est réservée dans le contrat.')
    await qc.invalidateQueries({ queryKey: ['contests'] })
    await qc.invalidateQueries({ queryKey: ['my-contests'] })
    onClose()
  }

  const submit = async () => {
    if (retry) {
      setBusy(true)
      try { await register(retry) } catch (e) { toast.error(e instanceof Error ? e.message : 'Enregistrement impossible.') } finally { setBusy(false) }
      return
    }
    if (f.title.trim().length < 3) return void toast.error('Le titre est trop court.')
    if (f.description.trim().length < 10) return void toast.error('La description est trop courte (10 caractères min.).')
    if (f.prompt.trim().length < 10) return void toast.error('Les instructions sont trop courtes (10 caractères min.).')
    if (!valid) return void toast.error('Chaque prix doit avoir un montant valide.')
    const slots = Number(f.slots)
    if (!Number.isInteger(slots) || slots < 1) return void toast.error('Nombre de places invalide.')
    const ends = new Date(f.endsAt)
    if (!(ends.getTime() > Date.now() + 3_600_000)) return void toast.error('La date de fin doit être dans plus d\'une heure.')
    if (!enough) return void toast.error(`Solde insuffisant : il faut $${pool.toFixed(2)}, vous avez $${balance.toFixed(2)}.`)

    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const refundableAfter = Math.min(Math.floor(ends.getTime() / 1000) + 7 * DAY, now + 360 * DAY)
    setBusy(true)
    let hash: string
    try { hash = await fundTask(id, poolRaw, refundableAfter) } catch (e) {
      setBusy(false)
      const m = e instanceof Error ? e.message : ''
      return void toast.error(/rejected|denied/i.test(m) ? 'Transaction annulée.' : 'Le financement a échoué. Réessayez.')
    }
    const payload = { id, title: f.title.trim(), description: f.description.trim(), prompt: f.prompt.trim(), type: f.type, endsAt: ends.toISOString(), slots, prizes, fundTx: hash }
    try { await register(payload) } catch (e) {
      setRetry(payload)
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Créer un concours</span>
        <button onClick={onClose} aria-label="Fermer" className="w-11 h-11 -mr-2 flex items-center justify-center" style={{ color: 'var(--muted)' }}><X size={16} /></button>
      </div>
      <div className="p-5 space-y-4">
        {gate.message && <ErrorBox message={gate.message} />}
        <div><Label>Titre *</Label><input style={inputStyle} maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div><Label>Description *</Label><textarea style={{ ...inputStyle, minHeight: 64 }} maxLength={1000} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div><Label>Ce que les participants doivent envoyer *</Label><textarea style={{ ...inputStyle, minHeight: 64 }} maxLength={2000} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Type</Label>
            <select style={inputStyle} value={f.type} onChange={(e) => set('type', e.target.value)}>{CONTEST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <div><Label>Participants max</Label><input style={inputStyle} inputMode="numeric" value={f.slots} onChange={(e) => set('slots', e.target.value)} /></div>
        </div>
        <div><Label>Date de fin *</Label><input type="datetime-local" style={inputStyle} value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></div>

        <div>
          <Label>Prix (USDC) *</Label>
          <div className="space-y-2">
            {prizes.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input style={{ ...inputStyle, width: 90 }} value={p.place} maxLength={20} aria-label="Rang" onChange={(e) => setPrizes((a) => a.map((x, j) => j === i ? { ...x, place: e.target.value } : x))} />
                <input style={inputStyle} inputMode="decimal" placeholder="Montant" aria-label="Montant" value={p.amount} onChange={(e) => setPrizes((a) => a.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                {prizes.length > 1 && <button onClick={() => setPrizes((a) => a.filter((_, j) => j !== i))} aria-label="Retirer ce prix" className="w-11 h-11 flex-shrink-0 flex items-center justify-center" style={{ color: 'var(--danger)' }}><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
          {prizes.length < 10 && (
            <button onClick={() => setPrizes((a) => [...a, { place: ORD[a.length] ?? `${a.length + 1}e`, amount: '' }])} className="min-h-[44px] mt-1 inline-flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              <Plus size={14} /> Ajouter un prix
            </button>
          )}
        </div>

        {poolRaw > 0n && (
          <div className="rounded-xl px-4 py-3 flex items-center text-sm" style={{ background: enough ? 'rgba(26,128,71,0.07)' : 'rgba(186,43,76,0.07)' }}>
            <span className="flex-1" style={{ color: 'var(--ink)' }}>Cagnotte à réserver <strong className="tabular-nums" style={{ color: enough ? 'var(--success)' : 'var(--danger)' }}>${pool.toFixed(2)}</strong></span>
            <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>Solde : ${balance.toFixed(2)}</span>
          </div>
        )}
        {retry && <ErrorBox message="Les fonds sont réservés mais le concours n'est pas enregistré. Appuyez pour réessayer (sans nouvelle transaction)." />}
        <button onClick={() => void submit()} disabled={busy || !gate.ok} className="w-full min-h-[48px] rounded-xl font-semibold text-sm" style={primaryBtn(busy || !gate.ok)}>
          {busy ? 'En cours…' : retry ? 'Réessayer l\'enregistrement' : 'Réserver la cagnotte et publier'}
        </button>
      </div>
    </Card>
  )
}

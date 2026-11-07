import { Image as ImageIcon, X } from 'lucide-react'
import { uploadImage } from '../api'
import { inputStyle, Label } from '../ui'

export interface ProofValue { url: string; note: string; file: File | null }
export const emptyProof: ProofValue = { url: '', note: '', file: null }

/** Envoie l'image si besoin et renvoie le corps à poster au serveur. */
export async function buildProof(v: ProofValue) {
  const proofFile = v.file ? await uploadImage(v.file) : undefined
  return { proofUrl: v.url.trim() || undefined, proofFile, note: v.note.trim() || undefined }
}

export default function ProofFields({ value, onChange, noteRequired = false }: {
  value: ProofValue; onChange: (v: ProofValue) => void; noteRequired?: boolean
}) {
  const set = (patch: Partial<ProofValue>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-3">
      <div>
        <Label>Proof link</Label>
        <input style={inputStyle} placeholder="https://…" value={value.url} onChange={(e) => set({ url: e.target.value })} />
      </div>
      <div>
        <Label>Or a screenshot (PNG, JPEG, WebP, 3 MB max)</Label>
        {value.file ? (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(26,47,110,0.06)' }}>
            <ImageIcon size={15} style={{ color: 'var(--accent)' }} />
            <span className="flex-1 truncate" style={{ color: 'var(--ink)' }}>{value.file.name}</span>
            <button type="button" onClick={() => set({ file: null })} aria-label="Remove image" className="p-1" style={{ color: 'var(--muted)' }}><X size={15} /></button>
          </div>
        ) : (
          <input type="file" accept="image/png,image/jpeg,image/webp" className="text-sm w-full"
            onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
        )}
      </div>
      <div>
        <Label>Note {noteRequired ? '' : '(optional)'}</Label>
        <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} maxLength={1000} placeholder="Details for the creator"
          value={value.note} onChange={(e) => set({ note: e.target.value })} />
      </div>
    </div>
  )
}

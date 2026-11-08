import { one, rows, sql } from './db'
import { notify } from './http'
import { readClaim } from './chain'

export interface SubRow {
  id: string; status: string; claim_at: Date | null; status_at: Date | null; worker_id: string; task_id: string
  wallet: string | null; title: string; creator_id: string; reward: string; review_days: number
}

const LOAD = (id: string) => sql`
  SELECT s.id, s.status, s.claim_at, s.status_at, s.worker_id, s.task_id, u.wallet_address AS wallet,
         t.title, t.creator_id, t.reward, t.review_days
  FROM submissions s JOIN users u ON u.id = s.worker_id JOIN tasks t ON t.id = s.task_id WHERE s.id = ${id}`

/** Notifications envoyées quand l'état de la soumission change dans le contrat. */
async function onTransition(s: SubRow, next: string): Promise<void> {
  if (next === 'pending') await notify(s.creator_id, 'submission', 'New submission', `A worker submitted "${s.title}". You have ${s.review_days} day(s) to approve or reject it.`, 'jobs:mine')
  if (next === 'approved') await notify(s.worker_id, 'paid', 'Payment received', `${s.reward} USDC for "${s.title}" were added to your balance.`, 'wallet')
  if (next === 'rejected') await notify(s.worker_id, 'rejected', 'Submission rejected', `"${s.title}" was rejected. You can dispute it within 7 days.`, 'jobs:submissions')
  if (next === 'disputed') {
    await notify(s.creator_id, 'dispute', 'Submission disputed', `The worker disputed the rejection of "${s.title}". An arbiter will decide.`, 'jobs:mine')
    const admins = await rows<{ id: string }>(sql`SELECT id FROM users WHERE role = 'admin'`)
    for (const a of admins) await notify(a.id, 'dispute', 'Dispute to review', `A rejection of "${s.title}" was disputed.`, 'admin')
  }
  if (next === 'refunded') await notify(s.worker_id, 'refunded', 'Rejection confirmed', `The reward for "${s.title}" went back to the creator.`, 'jobs:submissions')
  if (next === 'split') {
    await notify(s.worker_id, 'split', 'Dispute closed', `The arbiter did not decide in time: the reward for "${s.title}" was split 50/50.`, 'wallet')
    await notify(s.creator_id, 'split', 'Dispute closed', `The arbiter did not decide in time: the reward for "${s.title}" was split 50/50.`, 'wallet')
  }
}

/** Aligne la base sur l'état réel de la soumission dans le contrat. Retourne la ligne à jour. */
export async function syncSubmission(id: string): Promise<SubRow | null> {
  const s = await one<SubRow>(LOAD(id))
  if (!s?.wallet) return s
  const chain = await readClaim(s.task_id, s.wallet)
  if (chain.status === 'none' || chain.status === s.status) return s
  const claimAt = chain.status === 'pending' ? chain.at : s.claim_at
  // Le passage n'est enregistré qu'une fois (la condition évite les doubles notifications en cas d'appels simultanés).
  const upd = await one(sql`
    UPDATE submissions SET status = ${chain.status}, claim_at = ${claimAt}, status_at = ${chain.at}, reviewed_at = CASE WHEN ${chain.status} = 'pending' THEN reviewed_at ELSE now() END
    WHERE id = ${id} AND status <> ${chain.status} RETURNING id`)
  if (upd) await onTransition(s, chain.status)
  return one<SubRow>(LOAD(id))
}

/** Boucle de rattrapage : met à jour les soumissions dont l'état a pu changer sans que personne ne soit connecté. */
export function startReconcile(): void {
  const run = async () => {
    try {
      const list = await rows<{ id: string }>(sql`
        SELECT id FROM submissions
        WHERE status IN ('pending','rejected','disputed') OR (status = 'draft' AND permit_expires > now() - interval '2 days')
        ORDER BY coalesce(status_at, created_at) ASC LIMIT 40`)
      for (const r of list) { try { await syncSubmission(r.id) } catch { /* on réessaie au prochain passage */ } }
    } catch (e) {
      console.error('[reconcile]', e instanceof Error ? e.message : e)
    }
  }
  setTimeout(() => void run(), 5_000)
  setInterval(() => void run(), 90_000)
}

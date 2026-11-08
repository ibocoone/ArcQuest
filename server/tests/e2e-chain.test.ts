/* oxlint-disable typescript/no-explicit-any */
// Parcours complet avec de vraies transactions sur Arc Testnet.
// S'exécute seulement si E2E_KEYS pointe vers un fichier {"creator": "0x…", "worker": "0x…"}
// (deux portefeuilles jetables, le premier financé en USDC de test). Voir README.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, keccak256, parseAbi, parseUnits, stringToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getChain, getUsdc } from '../../src/onchain-facts'
import { sql } from '../db'

const BASE = process.env.TEST_API ?? 'http://localhost:3001'
const KEYS = process.env.E2E_KEYS ?? ''
const keys = KEYS && existsSync(KEYS) ? (JSON.parse(readFileSync(KEYS, 'utf8')) as { creator: `0x${string}`; worker: `0x${string}` }) : null
const VAULT = (process.env.VITE_VAULT_ADDRESS ?? '') as `0x${string}`
const CHAIN_ID = 5042002

const vaultAbi = parseAbi([
  'function deposit(uint256 amount)',
  'function withdraw(uint256 amount)',
  'function fundTask(bytes32 taskId, uint256 amount, uint64 refundableAfter)',
  'function releaseReward(bytes32 taskId, address worker, uint256 amount)',
  'function refundTask(bytes32 taskId, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function tasks(bytes32) view returns (address funder, uint64 refundableAfter, uint256 escrow)',
  'function createJob(bytes32 jobId, uint128 reward, uint32 slots, uint64 deadline, uint32 reviewPeriod)',
  'function submitClaim(bytes32 jobId, uint64 expiry, bytes signature)',
  'function approveClaim(bytes32 jobId, address worker)',
  'function rejectClaim(bytes32 jobId, address worker)',
  'function finalizeClaim(bytes32 jobId, address worker)',
  'function disputeClaim(bytes32 jobId)',
  'function resolveDispute(bytes32 jobId, address worker, bool payWorker)',
  'function reclaimJob(bytes32 jobId)',
  'function jobs(bytes32) view returns (address funder, uint64 deadline, uint32 reviewPeriod, uint32 slots, uint32 active, uint128 reward, uint256 escrow, uint256 locked)',
])

const rpc = getChain(CHAIN_ID)?.rpcUrls[0] ?? ''
const chain = defineChain({ id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
const pub = createPublicClient({ chain, transport: http(rpc) })
const usdcAddr = getUsdc(CHAIN_ID)?.address as `0x${string}`

class Client {
  cookie = ''
  userId = ''
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const sc = res.headers.get('set-cookie')
    if (sc) this.cookie = sc.split(';')[0]
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
  }
}

async function signIn(pk: `0x${string}`): Promise<Client> {
  const account = privateKeyToAccount(pk)
  const c = new Client()
  const { body } = await c.req('GET', '/auth/nonce')
  const message = `ArcQuest : proof of wallet ownership\nAddress: ${account.address}\nNonce: ${body.nonce}`
  const signature = await account.signMessage({ message })
  const r = await c.req('POST', '/auth/wallet', { address: account.address, message, signature })
  expect(r.status).toBe(200)
  c.userId = r.body.user.id
  return c
}

describe.skipIf(!keys)('parcours complet sur Arc Testnet', () => {
  test('tâche protégée : création, autorisation signée, soumission, approbation, refus, litige', async () => {
    const k = keys as NonNullable<typeof keys>
    const creatorAcc = privateKeyToAccount(k.creator)
    const workerAcc = privateKeyToAccount(k.worker)
    const w2Key = generatePrivateKey()
    const w2Acc = privateKeyToAccount(w2Key)
    const wallet = (acc: typeof creatorAcc) => createWalletClient({ account: acc, chain, transport: http(rpc) })
    const creatorW = wallet(creatorAcc)
    const workerW = wallet(workerAcc)
    const w2W = wallet(w2Acc)
    const wait = async (hash: `0x${string}`) => {
      expect((await pub.waitForTransactionReceipt({ hash })).status).toBe('success')
      return hash
    }
    const bal = async (a: `0x${string}`) => await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [a] })
    const jobCall = async (w: ReturnType<typeof wallet>, functionName: string, args: unknown[]) =>
      wait(await w.writeContract({ address: VAULT, abi: vaultAbi, functionName, args } as any))
    const reverts = async (acc: typeof creatorAcc, functionName: string, args: unknown[]) => {
      await expect(pub.simulateContract({ account: acc, address: VAULT, abi: vaultAbi, functionName, args } as any)).rejects.toThrow()
    }

    const creator = await signIn(k.creator)
    const worker = await signIn(k.worker)
    const w2 = await signIn(w2Key)
    const ids = [creator.userId, worker.userId, w2.userId]
    try {
      const funds = await pub.readContract({ address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [creatorAcc.address] })
      console.log('USDC du créateur :', formatUnits(funds, 6))
      expect(funds).toBeGreaterThan(parseUnits('0.6', 6))

      // Le second travailleur reçoit un peu de USDC pour les frais de réseau
      await wait(await creatorW.writeContract({ address: usdcAddr, abi: erc20Abi, functionName: 'transfer', args: [w2Acc.address, parseUnits('0.05', 6)] }))

      // 1. Dépôt puis création de la tâche dans le contrat
      const dep = parseUnits('0.3', 6)
      await wait(await creatorW.writeContract({ address: usdcAddr, abi: erc20Abi, functionName: 'approve', args: [VAULT, dep] }))
      await wait(await creatorW.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [dep] }))
      const b0 = await bal(creatorAcc.address)

      const taskId = crypto.randomUUID()
      const jobId = keccak256(stringToBytes(taskId))
      const reward = parseUnits('0.05', 6)
      const deadline = Math.floor(Date.now() / 1000) + 3 * 3600
      const createTx = await jobCall(creatorW, 'createJob', [jobId, reward, 3, BigInt(deadline), 86_400])
      expect(await bal(creatorAcc.address)).toBe(b0 - reward * 3n)

      const payload = {
        id: taskId, title: 'Tâche protégée', description: 'Description de la tâche protégée', instructions: 'Instructions de la tâche protégée',
        type: 'social', reward: '0.05', slots: 3, deadline: new Date(deadline * 1000).toISOString(), reviewDays: 1, fundTx: createTx,
      }
      // paramètres trafiqués ou mauvais créateur : refusés
      expect((await creator.req('POST', '/tasks', { ...payload, reward: '0.06' })).status).toBe(400)
      expect((await creator.req('POST', '/tasks', { ...payload, reviewDays: 2 })).status).toBe(400)
      expect((await creator.req('POST', '/tasks', { ...payload, slots: 4 })).status).toBe(400)
      expect((await worker.req('POST', '/tasks', payload)).status).toBe(400)
      expect((await creator.req('POST', '/tasks', payload)).status).toBe(200)
      const listed = (await worker.req('GET', '/tasks')).body.items.find((t: any) => t.id === taskId)
      expect(listed.reviewDays).toBe(1)
      // l'historique enregistre la réservation
      expect((await creator.req('POST', '/me/activity', { txHash: createTx })).body.recorded).toBe(1)
      const fund = (await creator.req('GET', '/me/activity')).body.items.find((a: any) => a.txHash === createTx)
      expect(fund.kind).toBe('fund')
      expect(Number(fund.amount)).toBe(0.15)

      const job = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'jobs', args: [jobId] })
      expect(job[6]).toBe(reward * 3n)

      // 2. Le travailleur obtient une autorisation et enregistre sa soumission
      const claim = async (c: Client, w: ReturnType<typeof wallet>) => {
        const p = await c.req('POST', `/tasks/${taskId}/claim-permit`, { proofUrl: 'https://example.com/preuve' })
        expect(p.status).toBe(200)
        await jobCall(w, 'submitClaim', [jobId, BigInt(p.body.expiry), p.body.signature])
        const synced = await c.req('POST', `/submissions/${p.body.submissionId}/sync`, {})
        expect(synced.body.status).toBe('pending')
        return { sid: p.body.submissionId as string, permit: p.body }
      }
      const c1 = await claim(worker, workerW)
      // rejeu de l'autorisation et autorisation volée : refusés par le contrat
      await reverts(workerAcc, 'submitClaim', [jobId, BigInt(c1.permit.expiry), c1.permit.signature])
      await reverts(w2Acc, 'submitClaim', [jobId, BigInt(c1.permit.expiry), c1.permit.signature])
      const c2 = await claim(w2, w2W)

      const mine = (await worker.req('GET', '/me/submissions')).body.items.find((s: any) => s.id === c1.sid)
      expect(mine.status).toBe('pending')
      expect(mine.reviewDays).toBe(1)
      expect((await creator.req('GET', `/tasks/${taskId}/submissions`)).body.items.length).toBe(2)
      expect((await creator.req('GET', '/me/tasks')).body.items.find((t: any) => t.id === taskId).pending).toBe(2)

      // 3. Avant la fin du délai : impossible de s'auto-payer ; seul le créateur peut approuver ou refuser
      await reverts(workerAcc, 'finalizeClaim', [jobId, workerAcc.address])
      await reverts(w2Acc, 'approveClaim', [jobId, workerAcc.address])
      await reverts(w2Acc, 'rejectClaim', [jobId, workerAcc.address])

      // 4. Le créateur approuve le second travailleur : payé dans son solde du contrat
      const w2Before = await bal(w2Acc.address)
      await jobCall(creatorW, 'approveClaim', [jobId, w2Acc.address])
      expect((await creator.req('POST', `/submissions/${c2.sid}/sync`, {})).body.status).toBe('approved')
      expect(await bal(w2Acc.address)).toBe(w2Before + reward)
      const earn = (await w2.req('GET', '/me/earnings')).body.items.find((e: any) => e.title === payload.title)
      expect(Number(earn.amount)).toBe(0.05)
      expect((await w2.req('GET', '/notifications')).body.items.some((n: any) => n.title === 'Payment received')).toBe(true)

      // 5. Le créateur refuse le premier, avec un motif ; le travailleur conteste
      await jobCall(creatorW, 'rejectClaim', [jobId, workerAcc.address])
      expect((await creator.req('POST', `/submissions/${c1.sid}/reject-reason`, { reason: 'Capture illisible' })).status).toBe(200)
      expect((await creator.req('POST', `/submissions/${c1.sid}/reject-reason`, { reason: 'Encore' })).status).toBe(409)
      const rej = (await worker.req('GET', '/me/submissions')).body.items.find((s: any) => s.id === c1.sid)
      expect(rej.status).toBe('rejected')
      expect(rej.rejectReason).toBe('Capture illisible')
      await jobCall(workerW, 'disputeClaim', [jobId])
      expect((await worker.req('POST', `/submissions/${c1.sid}/sync`, {})).body.status).toBe('disputed')

      // 6. Un administrateur voit le litige avec la preuve et le motif
      await sql`UPDATE users SET role = 'admin' WHERE id = ${creator.userId}`
      const disputes = (await creator.req('GET', '/admin/disputes')).body.items
      const d = disputes.find((x: any) => x.id === c1.sid)
      expect(d.rejectReason).toBe('Capture illisible')
      expect(d.proofUrl).toBe('https://example.com/preuve')
      // Le créateur n'est pas l'arbitre : il ne peut pas trancher son propre litige
      await reverts(creatorAcc, 'resolveDispute', [jobId, workerAcc.address, false])
      await reverts(workerAcc, 'resolveDispute', [jobId, workerAcc.address, true])

      // 7. Le créateur ne peut pas reprendre les fonds avant la date limite
      await reverts(creatorAcc, 'reclaimJob', [jobId])
      const after = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'jobs', args: [jobId] })
      expect(after[4]).toBe(2)            // places occupées
      expect(after[7]).toBe(reward)       // fonds verrouillés pour le litige
      expect(after[6]).toBe(reward)       // fonds libres restants (1 place)

      // 8. Les finances administrateur voient bien l'USDC du contrat
      const fin = await creator.req('GET', '/admin/finance')
      expect(Number(fin.body.vaultUsdc)).toBeGreaterThan(0)
    } finally {
      await sql`DELETE FROM activity WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM audit_log WHERE actor_id IN ${sql(ids)}`
      await sql`DELETE FROM submissions WHERE worker_id IN ${sql(ids)} OR task_id IN (SELECT id FROM tasks WHERE creator_id IN ${sql(ids)})`
      await sql`DELETE FROM tasks WHERE creator_id IN ${sql(ids)}`
      await sql`DELETE FROM sessions WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`
    }
  }, 300_000)
  test('concours : réservation, participation, attribution des prix payés onchain', async () => {
    const k = keys as NonNullable<typeof keys>
    const creatorAcc = privateKeyToAccount(k.creator)
    const workerAcc = privateKeyToAccount(k.worker)
    const creatorW = createWalletClient({ account: creatorAcc, chain, transport: http(rpc) })
    const wait = async (hash: `0x${string}`) => {
      expect((await pub.waitForTransactionReceipt({ hash })).status).toBe('success')
      return hash
    }
    const creator = await signIn(k.creator)
    const worker = await signIn(k.worker)
    const ids = [creator.userId, worker.userId]
    try {
      const id = crypto.randomUUID()
      const cid = keccak256(stringToBytes(id))
      // le créateur a besoin de solde dans le coffre
      const dep = parseUnits('0.1', 6)
      await wait(await creatorW.writeContract({ address: usdcAddr, abi: erc20Abi, functionName: 'approve', args: [VAULT, dep] }))
      await wait(await creatorW.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [dep] }))
      const fundTx = await wait(await creatorW.writeContract({
        address: VAULT, abi: vaultAbi, functionName: 'fundTask', args: [cid, parseUnits('0.05', 6), BigInt(Math.floor(Date.now() / 1000) + 9 * 86400)],
      }))
      const payload = {
        id, title: 'Concours de test', description: 'Concours créé par le test automatique.', prompt: 'Envoyez votre meilleure idée.', type: 'autre',
        endsAt: new Date(Date.now() + 2 * 86400_000).toISOString(), slots: 10,
        prizes: [{ place: '1er', amount: '0.03' }, { place: '2e', amount: '0.02' }], fundTx,
      }
      // une réservation insuffisante pour les prix annoncés est refusée
      expect((await creator.req('POST', '/contests', { ...payload, prizes: [{ place: '1er', amount: '0.04' }, { place: '2e', amount: '0.02' }] })).status).toBe(400)
      expect((await creator.req('POST', '/contests', payload)).status).toBe(200)
      const shown = (await worker.req('GET', '/contests')).body.items.find((x: any) => x.id === id)
      expect(shown.prizes).toEqual([{ place: '1er', amount: '0.03' }, { place: '2e', amount: '0.02' }])
      expect((await worker.req('POST', `/contests/${id}/entries`, { note: 'Mon idée', proofUrl: 'https://example.com/idee' })).status).toBe(200)
      expect((await worker.req('POST', `/contests/${id}/entries`, { note: 'Encore' })).status).toBe(409)
      expect((await creator.req('POST', `/contests/${id}/entries`, { note: 'Moi' })).status).toBe(400)

      const entry = (await creator.req('GET', `/contests/${id}/entries`)).body.items[0]
      // un paiement d'un autre montant ne valide pas le rang demandé
      const wrong = await wait(await creatorW.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'releaseReward', args: [cid, workerAcc.address, parseUnits('0.02', 6)] }))
      expect((await creator.req('POST', `/entries/${entry.id}/award`, { prizePlace: '1er', txHash: wrong })).status).toBe(400)
      // le bon paiement valide le prix
      const right = await wait(await creatorW.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'releaseReward', args: [cid, workerAcc.address, parseUnits('0.03', 6)] }))
      expect((await worker.req('POST', `/entries/${entry.id}/award`, { prizePlace: '1er', txHash: right })).status).toBe(403)
      expect((await creator.req('POST', `/entries/${entry.id}/award`, { prizePlace: '1er', txHash: right })).status).toBe(200)
      expect((await creator.req('POST', `/entries/${entry.id}/award`, { prizePlace: '1er', txHash: right })).status).toBe(409)
      const earn = await worker.req('GET', '/me/earnings')
      expect(earn.body.items.some((e: any) => e.tx === right)).toBe(true)
    } finally {
      await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM audit_log WHERE actor_id IN ${sql(ids)}`
      await sql`DELETE FROM contest_entries WHERE user_id IN ${sql(ids)} OR contest_id IN (SELECT id FROM contests WHERE creator_id IN ${sql(ids)})`
      await sql`DELETE FROM contests WHERE creator_id IN ${sql(ids)}`
      await sql`DELETE FROM sessions WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`
    }
  }, 240_000)
})

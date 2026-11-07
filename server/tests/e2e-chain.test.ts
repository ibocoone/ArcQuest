/* oxlint-disable typescript/no-explicit-any */
// Parcours complet avec de vraies transactions sur Arc Testnet.
// S'exécute seulement si E2E_KEYS pointe vers un fichier {"creator": "0x…", "worker": "0x…"}
// (deux portefeuilles jetables, le premier financé en USDC de test). Voir README.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, keccak256, parseAbi, parseUnits, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
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
  test('dépôt, tâche, soumission, approbation, paiement, retrait', async () => {
    const k = keys as NonNullable<typeof keys>
    const creatorAcc = privateKeyToAccount(k.creator)
    const workerAcc = privateKeyToAccount(k.worker)
    const creatorW = createWalletClient({ account: creatorAcc, chain, transport: http(rpc) })
    const workerW = createWalletClient({ account: workerAcc, chain, transport: http(rpc) })
    const wait = async (hash: `0x${string}`) => {
      const r = await pub.waitForTransactionReceipt({ hash })
      expect(r.status).toBe('success')
      return hash
    }
    const bal = async (a: `0x${string}`) => await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [a] })

    const creator = await signIn(k.creator)
    const worker = await signIn(k.worker)
    const ids = [creator.userId, worker.userId]
    try {
      // Le portefeuille du créateur a bien reçu du USDC de test
      const funds = await pub.readContract({ address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [creatorAcc.address] })
      console.log('USDC du créateur :', formatUnits(funds, 6))
      expect(funds).toBeGreaterThan(parseUnits('0.5', 6))

      const w0 = await bal(workerAcc.address)
      // 1. Dépôt (autorisation exacte puis dépôt)
      const dep = parseUnits('0.3', 6)
      const b0 = await bal(creatorAcc.address)
      await wait(await creatorW.writeContract({ address: usdcAddr, abi: erc20Abi, functionName: 'approve', args: [VAULT, dep] }))
      const depHash = await wait(await creatorW.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [dep] }))
      // Historique : la transaction est relue sur la blockchain, enregistrée une seule fois, et visible uniquement par son propriétaire
      expect((await creator.req('POST', '/me/activity', { txHash: depHash })).body.recorded).toBe(1)
      expect((await creator.req('POST', '/me/activity', { txHash: depHash })).body.recorded).toBe(1)
      expect((await worker.req('POST', '/me/activity', { txHash: depHash })).body.recorded).toBe(0)
      const hist = (await creator.req('GET', '/me/activity')).body.items.filter((a: any) => a.txHash === depHash)
      expect(hist.length).toBe(1)
      expect(hist[0].kind).toBe('deposit')
      expect(Number(hist[0].amount)).toBe(0.3)
      expect((await worker.req('GET', '/me/activity')).body.items.some((a: any) => a.txHash === depHash)).toBe(false)
      expect((await creator.req('POST', '/me/activity', { txHash: '0x' + '1'.repeat(64) })).status).toBe(400)
      expect(await bal(creatorAcc.address)).toBe(b0 + dep)

      // 2. Publication d'une tâche : récompense 0.05 x 2 places = 0.1 réservé
      const taskId = crypto.randomUUID()
      const refundableAfter = BigInt(Math.floor(Date.now() / 1000) + 8 * 86400)
      const fundTx = await wait(await creatorW.writeContract({
        address: VAULT, abi: vaultAbi, functionName: 'fundTask', args: [keccak256(stringToBytes(taskId)), parseUnits('0.1', 6), refundableAfter],
      }))
      expect(await bal(creatorAcc.address)).toBe(b0 + dep - parseUnits('0.1', 6))
      const payload = {
        id: taskId, title: 'Test de bout en bout', description: 'Tâche créée par le test automatique.', instructions: 'Envoyez un lien de preuve quelconque.',
        type: 'autre', reward: '0.05', slots: 2, deadline: new Date(Date.now() + 5 * 86400_000).toISOString(), fundTx,
      }
      // une transaction qui ne correspond pas à la tâche est refusée
      const other = crypto.randomUUID()
      expect((await creator.req('POST', '/tasks', { ...payload, id: other })).status).toBe(400)
      expect((await creator.req('POST', '/tasks', { ...payload, slots: 5 })).status).toBe(400)
      // le worker ne peut pas enregistrer la tâche du créateur avec sa transaction
      expect((await worker.req('POST', '/tasks', payload)).status).toBe(400)
      const created = await creator.req('POST', '/tasks', payload)
      expect(created.status).toBe(200)
      expect((await creator.req('POST', '/tasks', payload)).status).toBe(409)

      // 3. Le travailleur voit la tâche et soumet
      const list = await worker.req('GET', '/tasks')
      expect(list.body.items.some((t: any) => t.id === taskId)).toBe(true)
      expect((await worker.req('POST', `/tasks/${taskId}/submissions`, { proofUrl: 'https://example.com/preuve', note: 'Fait.' })).status).toBe(200)
      expect((await worker.req('POST', `/tasks/${taskId}/submissions`, { proofUrl: 'https://example.com/preuve2' })).status).toBe(409)

      // 4. Le créateur approuve : on ne peut pas marquer payé sans paiement
      const subs = await creator.req('GET', `/tasks/${taskId}/submissions`)
      const sub = subs.body.items[0]
      expect(sub.workerWallet).toBe(workerAcc.address.toLowerCase())
      expect((await creator.req('POST', `/submissions/${sub.id}/approve`, { txHash: fundTx })).status).toBe(400)
      expect((await worker.req('POST', `/submissions/${sub.id}/approve`, { txHash: fundTx })).status).toBe(403)

      // 5. Vrai paiement depuis le portefeuille du créateur, puis approbation
      const payTx = await wait(await creatorW.writeContract({
        address: VAULT, abi: vaultAbi, functionName: 'releaseReward', args: [keccak256(stringToBytes(taskId)), workerAcc.address, parseUnits('0.05', 6)],
      }))
      expect(await bal(workerAcc.address)).toBe(w0 + parseUnits('0.05', 6))
      const ok = await creator.req('POST', `/submissions/${sub.id}/approve`, { txHash: payTx })
      expect(ok.status).toBe(200)
      expect((await creator.req('POST', `/submissions/${sub.id}/approve`, { txHash: payTx })).status).toBe(409)

      // 6. Les gains du travailleur sont réels et confirmés
      const earn = await worker.req('GET', '/me/earnings')
      expect(earn.body.items.some((e: any) => e.tx === payTx)).toBe(true)
      const stats = await worker.req('GET', '/me/stats')
      expect(Number(stats.body.earned)).toBeCloseTo(0.05, 6)
      const notifs = await worker.req('GET', '/notifications')
      expect(notifs.body.items.some((n: any) => n.kind === 'paid')).toBe(true)

      // 7. Le travailleur retire son gain (le créateur lui envoie un peu de gaz)
      await wait(await creatorW.writeContract({ address: usdcAddr, abi: erc20Abi, functionName: 'transfer', args: [workerAcc.address, parseUnits('0.05', 6)] }))
      const before = await pub.readContract({ address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [workerAcc.address] })
      await wait(await workerW.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [parseUnits('0.05', 6)] }))
      const after = await pub.readContract({ address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [workerAcc.address] })
      expect(await bal(workerAcc.address)).toBe(w0)
      expect(after).toBeGreaterThan(before)

      // 8. Remboursement impossible avant la date prévue (verrou du contrat)
      const refund = await creatorW.writeContract({
        address: VAULT, abi: vaultAbi, functionName: 'refundTask', args: [keccak256(stringToBytes(taskId)), parseUnits('0.05', 6)],
      }).then(() => 'ok', () => 'revert')
      expect(refund).toBe('revert')
      const t = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'tasks', args: [keccak256(stringToBytes(taskId))] })
      expect(t[2]).toBe(parseUnits('0.05', 6))

      // 9. Un administrateur voit le paiement et l'USDC détenu par le contrat
      await sql`UPDATE users SET role = 'admin' WHERE id = ${creator.userId}`
      const pay = await creator.req('GET', '/admin/payments')
      expect(pay.body.items.some((p: any) => p.tx === payTx)).toBe(true)
      const fin = await creator.req('GET', '/admin/finance')
      expect(fin.status).toBe(200)
      expect(Number(fin.body.vaultUsdc)).toBeGreaterThan(0)
    } finally {
      await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM audit_log WHERE actor_id IN ${sql(ids)}`
      await sql`DELETE FROM submissions WHERE worker_id IN ${sql(ids)} OR task_id IN (SELECT id FROM tasks WHERE creator_id IN ${sql(ids)})`
      await sql`DELETE FROM tasks WHERE creator_id IN ${sql(ids)}`
      await sql`DELETE FROM sessions WHERE user_id IN ${sql(ids)}`
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`
    }
  }, 240_000)
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

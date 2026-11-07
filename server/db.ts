import { SQL } from 'bun'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is missing')

export const sql = new SQL(url)

export type Row = Record<string, unknown>

export async function migrate(): Promise<void> {
  const schema = await Bun.file(`${import.meta.dir}/schema.sql`).text()
  await sql.unsafe(schema)
}

/** Exécute une requête et type le résultat. */
export async function rows<T = Row>(q: PromiseLike<unknown>): Promise<T[]> {
  return (await q) as T[]
}

export async function one<T = Row>(q: PromiseLike<unknown>): Promise<T | null> {
  return (await rows<T>(q))[0] ?? null
}

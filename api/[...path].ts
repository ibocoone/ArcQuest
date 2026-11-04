// Proxy Vercel : renvoie /api/* vers le serveur ArcQuest hébergé ailleurs.
// Le navigateur ne parle qu'à ce domaine, donc les cookies de session restent du même site.
export const config = { runtime: 'edge' }

const FORWARD_REQUEST = ['cookie', 'content-type', 'accept', 'authorization']
const DROP_RESPONSE = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']

export default async function handler(req: Request): Promise<Response> {
  const origin = (process.env.API_ORIGIN ?? '').replace(/\/+$/, '')
  if (!/^https:\/\//.test(origin)) {
    return Response.json({ error: "Le serveur ArcQuest n'est pas configuré (API_ORIGIN)." }, { status: 503 })
  }
  const url = new URL(req.url)
  const target = origin + url.pathname.replace(/^\/api/, '') + url.search

  const headers = new Headers()
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: 'manual',
    // @ts-expect-error `duplex` est requis pour transmettre un corps en flux
    duplex: hasBody ? 'half' : undefined,
  }).catch(() => null)
  if (!upstream) return Response.json({ error: 'Serveur indisponible. Réessayez dans un instant.' }, { status: 502 })

  const out = new Headers(upstream.headers)
  for (const name of DROP_RESPONSE) out.delete(name)
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

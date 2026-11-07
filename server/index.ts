import { migrate } from './db'
import { handle } from './http'
import { hasStatic, serveStatic } from './static'
import './routes/auth'
import './routes/tasks'
import './routes/contests'
import './routes/me'
import './routes/admin'
import './routes/adminData'

await migrate()

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
Bun.serve({
  port,
  // la vérification d'une transaction onchain peut prendre plusieurs secondes
  idleTimeout: 60,
  maxRequestBodySize: 4 * 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url)
    // En ligne, le site et l'API partagent la même adresse : /api/* est l'API
    if (url.pathname.startsWith('/api/')) {
      return handle(new Request(url.origin + url.pathname.slice(4) + url.search, req))
    }
    if (hasStatic && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = await serveStatic(url.pathname)
      if (file) return file
    }
    return handle(req)
  },
})
console.log(`[server] ArcQuest sur le port ${port}${hasStatic ? ' (site + API)' : ' (API seule)'}`)

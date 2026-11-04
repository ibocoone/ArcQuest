import { migrate } from './db'
import { handle } from './http'
import './routes/auth'
import './routes/tasks'
import './routes/contests'
import './routes/me'
import './routes/admin'
import './routes/adminData'

await migrate()

const port = Number(process.env.API_PORT ?? 3001)
Bun.serve({
  port,
  // la vérification d'une transaction onchain peut prendre plusieurs secondes
  idleTimeout: 60,
  maxRequestBodySize: 4 * 1024 * 1024,
  fetch: handle,
})
console.log(`[server] API ArcQuest sur le port ${port}`)

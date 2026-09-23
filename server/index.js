import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { loadDb, shutdown as dbShutdown } from './db.js'
import { Game } from './engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.join(__dirname, '..', 'client')
const PORT = Number(process.env.PORT ?? 8123)
const HOST = process.env.HOST ?? '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const filePath = path.join(CLIENT_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403); return res.end('Forbidden')
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('Not found')
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache'
    })
    res.end(data)
  })
})

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 })

loadDb()
const game = new Game({ wss })

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  ███╗   ██╗██╗ ██████╗ ██╗  ██╗████████╗    ██████╗██╗████████╗██╗   ██╗')
  console.log('  ████╗  ██║██║██╔════╝ ██║  ██║╚══██╔══╝   ██╔════╝██║╚══██╔══╝╚██╗ ██╔╝')
  console.log('  ██╔██╗ ██║██║██║  ███╗███████║   ██║      ██║     ██║   ██║    ╚████╔╝ ')
  console.log('  ██║╚██╗██║██║██║   ██║██╔══██║   ██║      ██║     ██║   ██║     ╚██╔╝  ')
  console.log('  ██║ ╚████║██║╚██████╔╝██║  ██║   ██║      ╚██████╗██║   ██║      ██║   ')
  console.log('  ╚═╝  ╚═══╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝       ╚═════╝╚═╝   ╚═╝      ╚═╝   ')
  console.log('')
  console.log(`  Night City is online.`)
  console.log(`  Local:   http://localhost:${PORT}`)
  console.log(`  Network: http://<your-lan-ip>:${PORT}   (friends on your Wi-Fi)`)
  console.log(`  Share:   expose port ${PORT} via port-forward / Tailscale to play over the net.`)
  console.log('')
})

function bye () {
  console.log('\nShutting down — saving Night City...')
  try { game.shutdown() } catch {}
  try { wss.close() } catch {}
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
process.on('uncaughtException', err => { console.error('uncaught:', err); dbShutdown() })

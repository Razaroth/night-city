import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAVE_DIR = path.join(__dirname, '..', 'data', 'save')
const DB_FILE = path.join(SAVE_DIR, 'world.json')

const EMPTY_DB = { accounts: {}, world: {} }

let db = null
let writeTimer = null
let saveChain = Promise.resolve()
let redisStore = null

const REDIS_SAVE_KEY = 'night-city-world'

export function ensureSaveDir () {
  fs.mkdirSync(SAVE_DIR, { recursive: true })
}

export async function loadDb () {
  ensureSaveDir()
  const url = String(process.env.UPSTASH_REDIS_REST_URL ?? '').trim().replace(/\/+$/, '')
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim()
  if (url || token) {
    if (!url || !token) throw new Error('Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.')
    redisStore = { url, token }
    const saved = await redisGet()
    db = saved == null ? structuredClone(EMPTY_DB) : JSON.parse(saved)
  } else {
    if (process.env.NIGHT_CITY_REQUIRE_REMOTE_SAVE === 'true') {
      throw new Error('Remote save is required, but Upstash credentials are missing.')
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
      } catch (err) {
        console.error('Corrupt save file, starting fresh:', err.message)
        db = structuredClone(EMPTY_DB)
      }
    } else {
      db = structuredClone(EMPTY_DB)
    }
  }
  db.accounts ??= {}
  db.world ??= {}
  return db
}

export function getDb () {
  return db
}

export async function saveNow () {
  if (!db) return
  if (redisStore) {
    await redisSet(JSON.stringify(db))
    return
  }
  fs.mkdirSync(SAVE_DIR, { recursive: true })
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
  fs.renameSync(tmp, DB_FILE)
}

export function queueSave (delay = 250) {
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    saveChain = saveChain.then(() => saveNow()).catch(err => console.error('Save failed:', err))
  }, delay)
}

export async function shutdown () {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  await saveChain
  if (db) await saveNow()
}

async function redisGet () {
  const response = await fetch(`${redisStore.url}/get/${REDIS_SAVE_KEY}`, {
    headers: { Authorization: `Bearer ${redisStore.token}` }
  })
  const body = await response.json()
  if (!response.ok || body.error) throw new Error(`Upstash save read failed: ${body.error ?? response.statusText}`)
  return body.result
}

async function redisSet (value) {
  const response = await fetch(`${redisStore.url}/set/${REDIS_SAVE_KEY}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisStore.token}`,
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: value
  })
  const body = await response.json()
  if (!response.ok || body.error) throw new Error(`Upstash save write failed: ${body.error ?? response.statusText}`)
}

// ---------- crypto ----------

export function hashPassword (password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword (password, stored) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const test = crypto.scryptSync(password, salt, 64).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(test, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function createSession (accountId) {
  const token = crypto.randomBytes(32).toString('hex')
  db.accounts[accountId].sessions = db.accounts[accountId].sessions ?? {}
  db.accounts[accountId].sessions[token] = Date.now()
  queueSave()
  return token
}

export function validateToken (accountId, token) {
  const acc = db.accounts[accountId]
  if (!acc || !acc.sessions) return false
  const at = acc.sessions[token]
  if (typeof at !== 'number') return false
  if (Date.now() - at > SESSION_TTL_MS) {
    delete acc.sessions[token]
    queueSave()
    return false
  }
  acc.sessions[token] = Date.now()
  return true
}

export function deleteSession (accountId, token) {
  const acc = db.accounts[accountId]
  if (acc && acc.sessions) delete acc.sessions[token]
  queueSave()
}

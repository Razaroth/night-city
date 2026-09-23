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

export function ensureSaveDir () {
  fs.mkdirSync(SAVE_DIR, { recursive: true })
}

export function loadDb () {
  ensureSaveDir()
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
  db.accounts ??= {}
  db.world ??= {}
  return db
}

export function getDb () {
  return db
}

export function saveNow () {
  if (!db) return
  fs.mkdirSync(SAVE_DIR, { recursive: true })
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
  fs.renameSync(tmp, DB_FILE)
}

export function queueSave (delay = 250) {
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    try {
      saveNow()
    } catch (err) {
      console.error('Save failed:', err)
    }
  }, delay)
}

export function shutdown () {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (db) saveNow()
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
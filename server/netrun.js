// Breach Protocol — the netrunner's signature minigame.
// Jack into a room's netport, dance a code sequence across the grid
// (alternating row/col picks) to upload daemon sequences before the
// buffer runs out or the ICE traces you.

import { allItemDefs } from './items.js'
import { computeStats, addToInv, addXp } from './player.js'
import { rooms } from './world.js'

export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

const HEX_POOL = [
  { v: '1C', col: 'ice' },
  { v: '55', col: 'volt' },
  { v: 'BD', col: 'fire' },
  { v: 'E9', col: 'acid' },
  { v: '7A', col: 'ghost' },
  { v: 'FF', col: 'acid' },
  { v: '0A', col: 'volt' },
  { v: 'A1', col: 'ice' },
  { v: 'DD', col: 'fire' },
  { v: '3B', col: 'ghost' },
  { v: '77', col: 'volt' },
  { v: '8E', col: 'fire' }
]

// reward + cooldown profile per access point tier
export const NETPORT_TIERS = {
  safe: { eddies: [45, 110], xp: [22, 30], cd: 90000 },
  mid: { eddies: [90, 190], xp: [30, 44], cd: 150000 },
  hot: { eddies: [150, 300], xp: [46, 66], cd: 240000 }
}

export function netportInRoom (room) {
  if (!room) return null
  const ap = (room.objects ?? []).find(o => o.kind === 'netport')
  return ap ?? null
}

export function netportOnCooldown (game, roomId, now) {
  const until = game.netportCd.get(roomId) ?? 0
  return until > now ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
}

/* ---------------- generate a guaranteed-solvable board ---------------- */

function buildGrid (size, daemonCount) {
  // A guaranteed-solvable route: a snake that alternates vertical/horizontal
  // moves through distinct cells. Columns are shuffled so boards vary, and the
  // daemon sequences are written along the snake in order — so following the
  // visible codes is always a valid win. Codes repeat across the board too, so
  // finding the right cells is the puzzle.
  const perm = [...Array(size).keys()].sort(() => Math.random() - 0.5)
  const col = (c) => perm[c]

  const lengths = [size === 5 ? 4 : 3]
  for (let k = 1; k < daemonCount; k++) lengths.push(3)
  const total = lengths.reduce((a, b) => a + b, 0)

  // snake: (0,c0) → (1,c0) → (1,c1) → (2,c1) → (2,c2) → … up to `total` cells.
  // Rows bounce at the bottom edge so the whole path stays on the board.
  const route = []
  let r = 0
  let c = 0
  let dr = 1
  while (route.length < total) {
    route.push({ r, c })
    const vertical = route.length % 2 === 1
    if (vertical) {
      r += dr
      if (r >= size) { r = size - 2; dr = -1 }
    } else {
      c = c + 1
    }
  }

  const cells = []
  for (let rr = 0; rr < size; rr++) {
    for (let cc = 0; cc < size; cc++) {
      cells.push({ r: rr, c: cc, v: null, col: 'ice', daemon: null })
    }
  }
  const cellAt = (rr, cc) => cells[rr * size + cc]

  // lay daemon sequences along the snake
  const daemons = []
  let offset = 0
  for (let k = 0; k < daemonCount; k++) {
    const seq = []
    for (let s = 0; s < lengths[k]; s++) {
      const cell = route[offset + s]
      const hex = HEX_POOL[rand(0, HEX_POOL.length - 1)]
      cellAt(cell.r, col(cell.c)).v = hex.v
      cellAt(cell.r, col(cell.c)).col = hex.col
      cellAt(cell.r, col(cell.c)).daemon = k
      seq.push(hex.v)
    }
    offset += lengths[k]
    daemons.push({ seq, len: seq.length, uploaded: false })
  }

  // fill the rest randomly
  for (const cell of cells) {
    if (cell.v === null) {
      const hex = HEX_POOL[rand(0, HEX_POOL.length - 1)]
      cell.v = hex.v
      cell.col = hex.col
    }
  }

  // the guaranteed win path, as cell indices (kept server-side, never sent)
  const path = route.map(cell => cell.r * size + col(cell.c))

  return { cells, daemons, path }
}

/* ---------------- session lifecycle ---------------- */

export function startBreach (game, session, now) {
  const p = session.player
  const ap = netportInRoom(rooms[p.room])
  if (!ap) return { ok: false, error: 'No netport jack point here.' }
  if (session.breach) return { ok: false, error: 'You are already jacked into a subnet.' }
  const cd = netportOnCooldown(game, p.room, now)
  if (cd > 0) return { ok: false, error: `Access point rebooting (${cd}s).` }

  const intel = p.attrs.intel
  const size = intel >= 7 ? 5 : 4
  const daemonCount = size === 5 ? (intel >= 9 ? 3 : 2) : (intel >= 6 ? 2 : 1)
  const buffer = daemonCount * 4 + 2
  const deadline = now + 28000 + intel * 1500
  const { cells, daemons, path } = buildGrid(size, daemonCount)

  session.breach = {
    apId: ap.id,
    apName: ap.name,
    roomId: p.room,
    tier: ap.tier ?? 'mid',
    size,
    buffer,
    deadline,
    codes: [],
    picks: [],
    grid: cells,
    daemons,
    path,
    done: false
  }
  return { ok: true }
}

export function abortBreach (game, session) {
  session.breach = null
  return { done: true, ok: false, silent: true }
}

/* ---------------- pick + resolution ---------------- */

export function pickBreach (game, session, cellIdx, now) {
  const b = session.breach
  if (!b || b.done) return { done: true }
  if (now > b.deadline) return resolveBreach(game, session, now, 'timeout')

  const size = b.size
  const i = Number(cellIdx)
  if (!Number.isInteger(i) || i < 0 || i >= size * size) return { done: false, error: 'That cell is off the net.' }
  if (b.picks.includes(i)) return { done: false, error: 'You already burned that cell.' }

  const cell = b.grid[i]
  const last = b.picks.length ? b.grid[b.picks[b.picks.length - 1]] : null
  if (!last) {
    if (cell.r !== 0) return { done: false, error: 'Breach sequence starts on the top row.' }
  } else {
    const vertical = b.picks.length % 2 === 1
    if (vertical && cell.c !== last.c) return { done: false, error: 'Next code must run down the same column.' }
    if (!vertical && cell.r !== last.r) return { done: false, error: 'Next code must run across the same row.' }
  }

  b.codes.push(cell.v)
  b.picks.push(i)

  // upload daemons whose whole sequence now appears contiguously
  for (const d of b.daemons) {
    if (d.uploaded) continue
    if (seqMatch(b.codes, d.seq)) d.uploaded = true
  }

  const allUp = b.daemons.every(d => d.uploaded)
  if (allUp) return resolveBreach(game, session, now, 'win')
  if (b.codes.length >= b.buffer) return resolveBreach(game, session, now, 'overflow')
  return { done: false }
}

export function tickBreach (game, session, now) {
  const b = session.breach
  if (!b || b.done) return { done: true }
  if (now > b.deadline) return resolveBreach(game, session, now, 'timeout')
  return { done: false, tLeft: b.deadline - now }
}

function seqMatch (codes, seq) {
  if (codes.length < seq.length) return false
  const start = codes.length - seq.length
  for (let k = 0; k < seq.length; k++) {
    if (codes[start + k] !== seq[k]) return false
  }
  return true
}

/* ---------------- resolution ---------------- */

function resolveBreach (game, session, now, how) {
  const b = session.breach
  if (!b) return { done: true }
  b.done = true

  const p = session.player
  const eff = computeStats(p)
  const tier = NETPORT_TIERS[b.tier] ?? NETPORT_TIERS.mid
  const lines = []

  // cooldown the access point either way
  game.netportCd.set(b.roomId, now + tier.cd)

  if (how === 'win') {
    p.stats.breaches = (p.stats.breaches || 0) + 1
    const base = tier.eddies
    let eddies = 0
    let xp = 0
    for (const d of b.daemons) {
      eddies += rand(base[0], base[1])
      xp += rand(tier.xp[0], tier.xp[1])
    }
    eddies = Math.floor(eddies * 1.15)
    xp = Math.floor(xp * 1.15)
    p.eddies += eddies
    lines.push(`[B]BREACH SUCCESSFUL[/B] — ${b.daemons.length} daemon${b.daemons.length > 1 ? 's' : ''} uploaded. +${eddies} eddies, +${xp} XP.`)

    // bonus roll: scar a quickhack off the subnet
    const hacks = allItemDefs().filter(d => d.category === 'quickhacks')
    if (hacks.length && Math.random() < 0.35) {
      const def = hacks[rand(0, hacks.length - 1)]
      addToInv(p, def.id, 1)
      lines.push(`You pull ${def.name} off the subnet and into your carry.`)
    }

    const gained = addXp(p, xp)
    p.ram = eff.maxRam // a clean breach tops off your deck
    return { done: true, ok: true, lines, gained }
  }

  // fail: overflow buffer or the trace caught you
  p.hp = Math.max(1, Math.floor(p.hp - eff.maxHp * 0.12))
  const flavor = how === 'timeout' ? 'your trace window collapses' : 'the buffer overflows'
  lines.push(`[B]ICE TRACE ${how === 'timeout' ? 'TIMED OUT' : 'BUFFER OVERFLOW'}[/B] — ${flavor}. Your deck kicks you out with a stab of feedback headache.`)
  return { done: true, ok: false, lines, gained: [] }
}

/* ---------------- wire payload ---------------- */

export function breachPayload (session, now) {
  const b = session.breach
  if (!b) return null
  return {
    t: 'breach',
    done: b.done,
    ap: b.apName,
    tier: b.tier,
    size: b.size,
    buffer: b.buffer,
    tLeft: Math.max(0, b.deadline - now),
    uploaded: b.daemons.reduce((n, d) => n + (d.uploaded ? 1 : 0), 0),
    daemonTotal: b.daemons.length,
    daemons: b.daemons.map(d => ({ seq: d.seq, uploaded: d.uploaded })),
    codes: b.codes,
    cells: b.grid.map((cell, i) => ({
      i, r: cell.r, c: cell.c, v: cell.v, col: cell.col, used: b.picks.includes(i), daemon: cell.daemon
    }))
  }
}
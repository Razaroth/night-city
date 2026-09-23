import crypto from 'node:crypto'
import * as db from './db.js'
import {
  WorldState, rooms, districts, npcDefs, describeRoom,
  districtMapPayload, roomsPayload, EXIT_NAMES, HUB_ROOMS
} from './world.js'
import { getItemDef, allItemDefs, describeStack, makeStack, iconFor } from './items.js'
import * as P from './player.js'
import * as C from './combat.js'
import * as Q from './quests.js'
import { handleCommand } from './commands.js'
import { ambientLine, npcChatterLine, AMBIENT_MIN, AMBIENT_MAX } from './ambient.js'

const TICK_MS = 1000
const AUTOSAVE_MS = 20000

export class Game {
  constructor ({ wss }) {
    this.wss = wss
    this.sessions = new Map() // ws -> session
    this.byAccount = new Map() // accountId -> session
    this.world = new WorldState()
    this.world.seed()
    this.lastSave = Date.now()
    this.itemCatalog = buildCatalog()
    this.districts = districtMapPayload()
    this.roomList = roomsPayload()
    this.startedAt = Date.now()
    this.ambientAt = new Map() // roomId -> next ambient epoch (ms)
    wss.on('connection', ws => this.onConnection(ws))
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  now () { return Date.now() }

  /* ------------------- connection ------------------- */
  onConnection (ws) {
    const session = { ws, authed: false, accountId: null, player: null, username: null }
    this.sessions.set(ws, session)
    this.send(session, { t: 'hello', name: 'NIGHT CITY', version: '0.1.0', motd: 'Welcome to Night City. Break nothing you can\'t afford to replace.' })
    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      this.onMessage(session, msg)
    })
    ws.on('close', () => this.onClose(session))
    ws.on('error', () => {})
  }

  onClose (session) {
    const { player } = session
    if (player) {
      player.played_sec = (player.played_sec || 0) + Math.floor((this.now() - (session.enteredAt || this.now())) / 1000)
      db.getDb().world.players[session.accountId] = P.serializePlayer(player)
      db.queueSave()
      this.roomLog(player.room, `${player.name} jacks out of the district.`, 'sys', session.accountId)
      this.byAccount.delete(session.accountId)
    }
    this.sessions.delete(session.ws)
  }

  send (session, msg) {
    if (session.ws.readyState !== 1) return
    try { session.ws.send(JSON.stringify(msg)) } catch {}
  }

  log (session, text, cls = 'sys') {
    this.send(session, { t: 'log', lines: [{ text, cls }] })
  }

  logLines (session, lines) {
    const arr = (lines ?? []).map(l => typeof l === 'string' ? { text: l, cls: 'sys' } : l)
    if (arr.length) this.send(session, { t: 'log', lines: arr })
  }

  toast (session, text, cls = 'info') {
    this.send(session, { t: 'toast', text, cls })
  }

  playerSessions (roomId) {
    const out = []
    for (const s of this.sessions.values()) {
      if (s.player && s.player.alive && s.player.room === roomId) out.push(s)
    }
    return out
  }

  roomLog (roomId, text, cls = 'sys', exceptAccount = null) {
    for (const s of this.playerSessions(roomId)) {
      if (s.accountId === exceptAccount) continue
      this.log(s, text, cls)
    }
  }

  /* ------------------- messages ------------------- */
  onMessage (session, msg) {
    const t = msg.t
    if (t === 'register') return this.handleRegister(session, msg)
    if (t === 'login') return this.handleLogin(session, msg)
    if (t === 'resume') return this.handleResume(session, msg)
    if (!session.authed) return this.send(session, { t: 'error', msg: 'Not authenticated.' })
    if (t === 'logout') return this.handleLogout(session)
    if (t === 'charCreate') return this.handleCharCreate(session, msg)
    if (t === 'charDelete') return this.handleCharDelete(session)
    if (t === 'cmd') return this.handleCmd(session, msg.line ?? '')
    if (t === 'ping') return this.send(session, { t: 'pong' })
  }

  authSuccess (session, accountId, account) {
    session.authed = true
    session.accountId = accountId
    session.username = account.username
    const token = db.createSession(accountId)
    session.token = token
    const hasChar = !!db.getDb().world.players?.[accountId]
    this.send(session, { t: 'auth', ok: true, token, username: account.username, hasChar })
    this.send(session, { t: 'world', districts: this.districts, rooms: this.roomList, items: this.itemCatalog })
    if (hasChar) this.enterGame(session)
    else this.send(session, { t: 'needChar', creation: this.creationPayload() })
  }

  handleRegister (session, msg) {
    const username = String(msg.username ?? '').trim()
    const password = String(msg.password ?? '')
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return this.send(session, { t: 'auth', ok: false, error: 'Handle must be 3-16 letters, numbers, or underscores.' })
    if (password.length < 6) return this.send(session, { t: 'auth', ok: false, error: 'Passphrase must be at least 6 characters.' })
    const accounts = db.getDb().accounts
    if (Object.values(accounts).some(a => a.username.toLowerCase() === username.toLowerCase())) {
      return this.send(session, { t: 'auth', ok: false, error: 'That handle is already jacked in.' })
    }
    const id = crypto.randomUUID()
    accounts[id] = { id, username, pass: db.hashPassword(password), sessions: {}, created: this.now() }
    db.getDb().world.players ??= {}
    db.queueSave()
    this.authSuccess(session, id, accounts[id])
  }

  handleLogin (session, msg) {
    const username = String(msg.username ?? '').trim()
    const password = String(msg.password ?? '')
    const accounts = db.getDb().accounts
    const account = Object.values(accounts).find(a => a.username.toLowerCase() === username.toLowerCase())
    if (!account || !db.verifyPassword(password, account.pass)) {
      return this.send(session, { t: 'auth', ok: false, error: 'Wrong handle or passphrase.' })
    }
    this.authSuccess(session, account.id, account)
  }

  handleResume (session, msg) {
    const username = String(msg.username ?? '').trim()
    const token = String(msg.token ?? '')
    const account = Object.values(db.getDb().accounts).find(a => a.username.toLowerCase() === username.toLowerCase())
    if (!account || !db.validateToken(account.id, token)) {
      return this.send(session, { t: 'auth', ok: false, error: 'Session expired. Log in again.' })
    }
    this.authSuccess(session, account.id, account)
  }

  handleLogout (session) {
    const { player, accountId } = session
    if (player) {
      player.played_sec = (player.played_sec || 0) + Math.floor((this.now() - (session.enteredAt || this.now())) / 1000)
      db.getDb().world.players[accountId] = P.serializePlayer(player)
      db.queueSave()
      this.roomLog(player.room, `${player.name} jacks out of the district.`, 'sys', accountId)
    }
    if (accountId) {
      if (session.token) db.deleteSession(accountId, session.token)
      this.byAccount.delete(accountId)
    }
    session.authed = false
    session.accountId = null
    session.username = null
    session.player = null
    session.enteredAt = null
    session.token = null
    this.send(session, { t: 'logout', ok: true })
  }

  creationPayload () {
    return {
      lifepaths: P.LIFEPATHS,
      styles: P.STYLES,
      attrs: P.ATTRS,
      attrLabels: P.ATTR_LABELS,
      basePoints: P.BASE_POINTS,
      attrMin: 3,
      attrMaxCreate: 9,
      chrome: Object.values(allItemDefs()).filter(d => d.category === 'cyberware').map(d => ({
        id: d.id, name: d.name, capacity: d.capacity, humanity: d.humanity, slot: d.slot,
        desc: d.desc, effect: d.effect, effectValue: d.effectValue ?? null
      }))
    }
  }

  handleCharCreate (session, msg) {
    const accountId = session.accountId
    if (db.getDb().world.players?.[accountId]) return this.send(session, { t: 'error', msg: 'You already have a runner on file.' })
    const name = String(msg.name ?? '').trim()
    if (!/^[A-Za-z0-9_\- ']{2,20}$/.test(name)) return this.send(session, { t: 'error', msg: 'Name must be 2-20 characters.' })
    if (!P.LIFEPATHS[msg.lifepath]) return this.send(session, { t: 'error', msg: 'Pick a lifepath.' })

    const attrs = msg.attrs ?? {}
    let pool = 0
    for (const a of P.ATTRS) {
      const v = Number(attrs[a])
      if (!Number.isInteger(v) || v < 3 || v > 9) return this.send(session, { t: 'error', msg: `Invalid value for ${a}.` })
      pool += v - 3
    }
    if (pool > P.BASE_POINTS) return this.send(session, { t: 'error', msg: `Too many attribute points (${pool}/${P.BASE_POINTS}).` })

    const picks = Array.isArray(msg.cyberware) ? msg.cyberware : []
    if (picks.length > 3) return this.send(session, { t: 'error', msg: 'At most 3 starting implants.' })
    let cap = 0
    const slots = new Set()
    for (const id of picks) {
      const d = getItemDef(id)
      if (!d || d.category !== 'cyberware') return this.send(session, { t: 'error', msg: `Unknown implant: ${id}` })
      cap += d.capacity ?? 0
      if (slots.has(d.slot)) return this.send(session, { t: 'error', msg: `Two implants can't share the ${d.slot} slot.` })
      slots.add(d.slot)
    }
    if (cap > 4) return this.send(session, { t: 'error', msg: `Starting chrome exceeds capacity (${cap}/4).` })

    const player = P.makeNewPlayer(accountId, { name, lifepath: msg.lifepath, style: msg.style, attrs })
    for (const id of picks) {
      const st = makeStack(id)
      player.inv.push(st)
      player.cyberware[getItemDef(id).slot] = st
    }
    const eff = P.computeStats(player)
    player.hp = eff.maxHp
    player.stam = eff.maxStam
    db.getDb().world.players[accountId] = P.serializePlayer(player)
    db.queueSave()
    this.send(session, { t: 'charCreated', name })
    this.enterGame(session)
  }

  handleCharDelete (session) {
    const accountId = session.accountId
    if (this.byAccount.has(accountId)) return this.send(session, { t: 'error', msg: 'Log out fully before deleting.' })
    delete db.getDb().world.players[accountId]
    db.queueSave()
    this.send(session, { t: 'charDeleted' })
    this.send(session, { t: 'needChar', creation: this.creationPayload() })
  }

  enterGame (session) {
    const accountId = session.accountId
    const existing = this.byAccount.get(accountId)
    if (existing && existing !== session) {
      this.send(existing, { t: 'kicked', msg: 'This runner jacked in from another terminal.' })
      try { existing.ws.close() } catch {}
    }
    const saved = db.getDb().world.players[accountId]
    const player = P.hydratePlayer(saved, accountId)
    session.player = player
    session.enteredAt = this.now()
    this.byAccount.set(accountId, session)

    const lp = P.LIFEPATHS[player.lifepath]
    this.send(session, { t: 'entered', name: player.name })
    this.log(session, `─── ${player.name.toUpperCase()} // ${lp.name} ───`, 'level')
    this.log(session, lp.desc, 'room')
    if (!player.flags.intro) {
      player.flags.intro = true
      this.log(session, this.introObjective(player), 'good')
    }
    this.pushAll(session)
    this.roomLog(player.room, `${player.name} jacks into the district.`, 'sys', accountId)
  }

  introObjective (player) {
    if (player.lifepath === 'corpo') return 'OBJECTIVE: The boardroom is gone. Find work at the Afterlife — Rogue keeps the ledger. Type HELP for commands.'
    if (player.lifepath === 'nomad') return 'OBJECTIVE: The city eats the unconnected. Dakota Smith runs jobs out of the nomad camp — talk to her. Type HELP for commands.'
    return 'OBJECTIVE: Watson is your pond. Wakako Okada has work in the Kabuki Market — find her. Type HELP for commands.'
  }

  /* ------------------- command routing ------------------- */
  handleCmd (session, line) {
    if (!session.player) return this.send(session, { t: 'error', msg: 'No active runner.' })
    line = String(line).slice(0, 500).trim()
    if (!line) return
    try {
      handleCommand(this, session, line)
    } catch (err) {
      console.error('cmd error:', err)
      this.log(session, 'Something glitched in the net. (command error)', 'bad')
    }
  }

  /* ------------------- state pushes ------------------- */
  pushAll (session) {
    this.pushRoom(session)
    this.pushState(session)
    this.pushInv(session)
    this.pushJobs(session)
  }

  roomPayload (session, now) {
    const p = session.player
    const room = rooms[p.room]
    const hostiles = this.world.hostilesInRoom(p.room)
    const npcs = []
    for (const inst of this.world.allInRoom(p.room)) {
      const d = inst.def
      npcs.push({
        id: inst.id, name: d.name, kind: d.kind, faction: d.faction, danger: d.danger ?? 'neutral',
        desc: d.desc, hpPct: d.kind === 'hostile' ? Math.round(inst.hp / inst.maxhp * 100) : null,
        stunned: inst.statuses.some(s => s.kind === 'stun' && now < s.until),
        burning: inst.statuses.some(s => s.kind === 'burn' || s.kind === 'poison')
      })
    }
    const players = this.playerSessions(p.room)
      .filter(s => s !== session)
      .map(s => ({ name: s.player.name, level: s.player.level, lifepath: s.player.lifepath }))
    const corpse = this.world.corpseFor(p.room)
    return {
      t: 'room',
      id: room.id,
      name: room.name,
      district: room.district,
      districtName: districts[room.district]?.name,
      color: districts[room.district]?.color,
      category: room.category,
      danger: !!room.danger,
      desc: room.desc,
      exits: Object.entries(room.exits ?? {}).map(([dir, to]) => ({ dir, name: EXIT_NAMES[dir] ?? dir, to, toName: rooms[to]?.name ?? to })),
      npcs,
      players,
      corpse: corpse ? { name: corpse.name, eddies: corpse.eddies, items: corpse.items.map(s => ({ name: getItemDef(s.id)?.name, qty: s.qty })) } : null,
      objects: (room.objects ?? []).map(o => ({ id: o.id, name: o.name, kind: o.kind, desc: o.desc })),
      weather: this.weatherFor(p.room, now),
      clock: new Date(now).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      inCombat: hostiles.length > 0
    }
  }

  weatherFor (roomId, now) {
    const room = rooms[roomId]
    const dist = room?.district
    if (dist === 'badlands') return 'Dry static. The wind smells of iron.'
    if (dist === 'pacifica') return 'Salt haze off the water. Gulls with grudges.'
    const hour = new Date(now).getHours()
    if (hour >= 20 || hour < 5) return 'Neon rain drizzles across the pavement.'
    return 'Overcast, humid, and buzzing with drone traffic.'
  }

  pushRoom (session) {
    this.send(session, this.roomPayload(session, this.now()))
  }

  pushState (session) {
    const p = session.player
    if (!p) return
    const eff = P.computeStats(p)
    const state = P.stateForClient(p)
    state.cooldowns = {
      atk: Math.max(0, Math.min(1, ((p.attackAt || 0) - this.now()) / Math.max(300, (C.weaponCooldownRemaining(p, this.now()) * 1000) || 1))),
      hack: Math.max(0, Math.min(1, ((p.hackAt || 0) - this.now()) / 1800)),
      grenade: Math.max(0, Math.min(1, ((p.grenadeAt || 0) - this.now()) / 1000))
    }
    state.buffs = {
      sandevistan: (p.buff?.sandevistanUntil ?? 0) > this.now(),
      berserk: (p.buff?.berserkUntil ?? 0) > this.now(),
      defend: (p.buff?.defendUntil ?? 0) > this.now(),
      dodge: (p.buff?.dodgeUntil ?? 0) > this.now()
    }
    state.abilities = {
      sandevistan: eff.sandevistan,
      berserk: eff.berserk,
      secondHeart: eff.secondHeart && !p.flags.secondHeartUsed
    }
    this.send(session, { t: 'state', state })
  }

  pushInv (session) {
    const p = session.player
    this.send(session, {
      t: 'inv',
      stacks: P.describeInventory(p),
      equip: P.describeEquipment(p),
      cyberware: P.describeCyberware(p),
      quickhacks: p.inv.filter(s => getItemDef(s.id)?.category === 'quickhacks').map(s => describeStack(s)),
      capacity: P.computeStats(p).capacity,
      capacityUsed: P.cyberwareCapacityUsed(p)
    })
  }

  pushJobs (session) {
    const now = this.now()
    const room = rooms[session.player.room]
    const fixersHere = (room.npcs ?? []).filter(id => npcDefs[id]?.kind === 'fixer')
    this.send(session, {
      t: 'jobs',
      fixersHere,
      gigs: Q.gigListView(session.player, now)
    })
  }

  pushShop (session, npcInst) {
    const p = session.player
    const def = npcInst.def
    const cats = def.shop?.sells ?? []
    const items = []
    for (const d of allItemDefs()) {
      if (!cats.includes(d.category)) continue
      items.push({ ...describeStack(makeStack(d.id)), price: Math.ceil(d.value * (def.shop.sellMul ?? 1.5)) })
    }
    const buyable = p.inv.filter(s => cats.includes(getItemDef(s.id)?.category))
    this.send(session, {
      t: 'shop',
      npc: def.name,
      npcId: def.id,
      kind: def.kind,
      items,
      sellable: buyable.map(s => ({ ...describeStack(s), price: Math.max(1, Math.floor(getItemDef(s.id).value * (def.shop.buyMul ?? 0.4))) }))
    })
  }

  /* ------------------- movement ------------------- */
  move (session, dir) {
    const p = session.player
    if (!p.alive) return this.log(session, 'You are flatlined. Wait for the trauma team... or your ripper.', 'bad')
    const room = rooms[p.room]
    const to = room.exits?.[dir]
    if (!to) return this.log(session, `You can't go ${EXIT_NAMES[dir] ?? dir} from here.`, 'bad')
    const from = p.room
    p.room = to
    this.roomLog(from, `${p.name} heads ${EXIT_NAMES[dir] ?? dir}.`, 'sys', session.accountId)
    this.roomLog(to, `${p.name} arrives from the ${EXIT_NAMES[opposite(dir)] ?? opposite(dir)}.`, 'sys', session.accountId)
    this.pushRoom(session)
    this.pushJobs(session)
    this.describeCurrentRoom(session)
  }

  describeCurrentRoom (session) {
    const now = this.now()
    const room = rooms[session.player.room]
    const lines = []
    lines.push({ text: `◈ ${room.name}`, cls: 'place' })
    lines.push({ text: room.desc, cls: 'room' })
    const exits = Object.keys(room.exits ?? {})
    if (exits.length) lines.push({ text: `Exits: ${exits.map(e => EXIT_NAMES[e]).join(', ')}`, cls: 'exit' })
    const others = this.playerSessions(room.id).filter(s => s !== session)
    for (const s of others) lines.push({ text: `${s.player.name} is here.`, cls: 'who' })
    const hostiles = this.world.hostilesInRoom(room.id)
    for (const h of hostiles) lines.push({ text: `${h.def.name} [${h.def.faction}] is watching you. HP ${Math.round(h.hp / h.maxhp * 100)}%.`, cls: 'hostile' })
    const neutrals = this.world.allInRoom(room.id).filter(i => i.def.kind !== 'hostile')
    for (const n of neutrals) lines.push({ text: `${n.def.name} — ${n.def.desc}`, cls: 'npc' })
    const corpse = this.world.corpseFor(room.id)
    if (corpse) lines.push({ text: `A corpse of ${corpse.name} lies here. (take)`, cls: 'loot' })
    for (const o of room.objects ?? []) lines.push({ text: `${o.name}: ${o.desc}`, cls: 'npc' })
    this.logLines(session, lines)
  }

  /* ------------------- combat helpers ------------------- */
  npcInRoom (session, query) {
    const room = session.player.room
    const q = String(query ?? '').toLowerCase()
    const all = this.world.allInRoom(room)
    if (!q) return null
    let match = all.find(i => i.id.toLowerCase() === q)
    if (match) return match
    match = all.find(i => i.def.name.toLowerCase().startsWith(q))
    if (match) return match
    match = all.find(i => i.def.name.toLowerCase().includes(q))
    return match ?? null
  }

  hostileInRoom (session, query) {
    const inst = this.npcInRoom(session, query)
    if (!inst || inst.def.kind !== 'hostile') return null
    return inst
  }

  addThreat (inst, session, amount) {
    inst.threat[session.accountId] = (inst.threat[session.accountId] || 0) + amount
    inst.lastAttacker = session.accountId
  }

  grantKill (session, inst) {
    const now = this.now()
    const p = session.player
    this.world.kill(inst, now)
    p.stats.kills = (p.stats.kills || 0) + 1
    const isBoss = inst.def.danger === 'boss'
    const xp = inst.def.level * 30 + (isBoss ? inst.def.level * 70 : 0)
    const gained = P.addXp(p, xp)
    this.log(session, `${inst.def.name} goes down. +${xp} XP${isBoss ? ' — BOUNTY COMPLETE' : ''}.`, 'xp')
    this.roomLog(p.room, `${inst.def.name} is flatlined by ${p.name}.`, 'combat', session.accountId)
    for (const lvl of gained) this.log(session, `LEVEL UP — you are now level ${lvl}. Attribute point available (type: up <attr>).`, 'level')

    // corpse
    const items = []
    for (const entry of inst.def.loot ?? []) {
      if (Math.random() < entry.chance) {
        const qty = entry.qty ? C.rand(entry.qty[0], entry.qty[1]) : 1
        items.push(makeStack(entry.id, qty))
      }
    }
    const eddies = inst.def.eddies ? C.rand(inst.def.eddies[0], inst.def.eddies[1]) : 0
    const uid = crypto.randomUUID()
    this.world.corpses.set(uid, { uid, roomId: p.room, npcId: inst.id, name: inst.def.name, items, eddies, ttl: now + 120000 })

    const gigs = Q.handleKill(p, inst.id, now)
    for (const gig of gigs) {
      this.log(session, `GIG COMPLETE — "${gig.title}". +${gig.rewardEddies} eddies, +${gig.rewardXp} XP, +${gig.rep} rep.`, 'gig')
      const lv = P.addXp(p, gig.rewardXp)
      for (const lvl of lv) this.log(session, `LEVEL UP — you are now level ${lvl}.`, 'level')
      this.toast(session, `GIG COMPLETE: ${gig.title}`, 'gig')
    }
    this.pushRoom(session)
    this.pushJobs(session)
    this.pushState(session)
    db.queueSave()
  }

  lootCorpse (session) {
    const p = session.player
    const corpse = this.world.corpseFor(p.room)
    if (!corpse) return this.log(session, 'Nothing to loot here.', 'bad')
    const lines = []
    if (corpse.eddies > 0) {
      p.eddies += corpse.eddies
      lines.push({ text: `You scoop ${corpse.eddies} eddies off the corpse.`, cls: 'loot' })
    }
    for (const st of corpse.items) {
      P.addToInv(p, st.id, st.qty)
      lines.push({ text: `Looted: ${getItemDef(st.id)?.name}${st.qty > 1 ? ` x${st.qty}` : ''}.`, cls: 'loot' })
    }
    if (!lines.length) lines.push({ text: 'The corpse has nothing but regret.', cls: 'sys' })
    this.world.corpses.delete(corpse.uid)
    this.logLines(session, lines)
    this.pushInv(session)
    this.pushState(session)
    this.pushRoom(session)
    db.queueSave()
  }

  handlePlayerDeath (session, now) {
    const p = session.player
    if (!p.alive) return
    const eff = P.computeStats(p)
    if (eff.secondHeart && !p.flags.secondHeartUsed) {
      p.flags.secondHeartUsed = true
      p.hp = Math.floor(eff.maxHp * 0.45)
      p.buff.dodgeUntil = now + 4000
      this.log(session, 'Your Second Heart slams into gear. Chest cracks, vision returns — you are NOT done yet.', 'good')
      this.roomLog(p.room, `${p.name}'s chest spasms — a Second Heart kicks in.`, 'combat', session.accountId)
      return
    }
    p.alive = false
    p.hp = 0
    p.stats.deaths = (p.stats.deaths || 0) + 1
    const lost = Math.min(p.eddies, Math.floor(p.eddies * 0.1))
    p.eddies -= lost
    session.rt = session.rt ?? {}
    session.rt.diedDistrict = rooms[p.room]?.district
    session.rt.respawnAt = now + 7000
    this.log(session, `You flatline. The last thing you hear is your own heartbeat arguing with the pavement.`, 'bad')
    this.log(session, `You dropped ${lost} eddies in the scramble. Respawn in 7 seconds...`, 'bad')
    this.roomLog(p.room, `${p.name} drops — flatlined.`, 'combat', session.accountId)
    this.send(session, { t: 'death', respawnIn: 7000 })
    this.pushState(session)
    db.queueSave()
  }

  respawn (session) {
    const p = session.player
    const dist = session.rt?.diedDistrict
    let target = HUB_ROOMS[dist]
    // prefer a ripperdoc clinic in the same district
    for (const r of Object.values(rooms)) {
      if (r.district === dist && r.category === 'clinic') { target = r.id; break }
    }
    target = target ?? P.LIFEPATHS[p.lifepath].startRoom
    p.room = target
    p.alive = true
    const eff = P.computeStats(p)
    p.hp = eff.maxHp
    p.stam = eff.maxStam
    p.ram = eff.maxRam
    p.buff = {}
    p.attackAt = 0
    p.hackAt = 0
    this.log(session, `You wake in ${rooms[target]?.name}. A ripper charges you nothing for the privilege of breathing.`, 'good')
    this.roomLog(target, `${p.name} staggers in, freshly stitched.`, 'sys', session.accountId)
    this.pushAll(session)
    this.describeCurrentRoom(session)
    db.queueSave()
  }

  /* ------------------- ambient area activity ------------------- */
  tickAmbient (now, spawnedRooms) {
    // announce respawns to players who are in that room
    for (const sp of spawnedRooms) {
      const players = this.playerSessions(sp.roomId)
      if (!players.length) continue
      const line = sp.def.kind === 'hostile'
        ? (sp.def.danger === 'boss'
            ? `${sp.def.name} pulls themselves out of the wreckage, sockets glowing. The area holds its breath.`
            : `${sp.def.name} shambles back into the area, nursing a fresh grudge.`)
        : `${sp.def.name} returns to their post.`
      this.roomLog(sp.roomId, line, 'amb')
    }

    // periodic ambient life: one line per occupied room on an independent cadence
    const occupied = new Set()
    for (const s of this.sessions.values()) {
      if (s.player?.alive) occupied.add(s.player.room)
    }
    for (const roomId of occupied) {
      const next = this.ambientAt.get(roomId) ?? 0
      if (now < next) continue
      const room = rooms[roomId]
      if (!room) continue
      this.ambientAt.set(roomId, now + C.rand(AMBIENT_MIN, AMBIENT_MAX))

      const hostile = this.world.hostilesInRoom(roomId).some(i => i.alive)
      let line = null
      if (!hostile && Math.random() < 0.45) line = npcChatterLine(room)
      if (!line) line = ambientLine(room)
      if (line) this.roomLog(roomId, line, 'amb')
    }
  }

  /* ------------------- main tick ------------------- */
  tick () {
    const now = this.now()
    const spawnedRooms = this.world.tickRespawns(now)
    for (const sp of spawnedRooms) {
      for (const s of this.playerSessions(sp.roomId)) this.pushRoom(s)
    }
    this.world.tickCorpses(now)
    this.tickAmbient(now, spawnedRooms)

    // player regen + pushes
    for (const session of this.sessions.values()) {
      const p = session.player
      if (!p) continue
      if (!p.alive) {
        if (session.rt?.respawnAt && now >= session.rt.respawnAt) {
          session.rt.respawnAt = 0
          this.respawn(session)
        }
        continue
      }
      const eff = P.computeStats(p)
      const outOfCombat = this.world.hostilesInRoom(p.room).length === 0
      const sinceHit = now - (p.lastHitAt || 0)
      if (sinceHit > 7000) {
        if (p.hp < eff.maxHp) p.hp = Math.min(eff.maxHp, p.hp + Math.max(1, Math.floor(eff.maxHp * 0.03)))
        if (p.stam < eff.maxStam) p.stam = Math.min(eff.maxStam, p.stam + 6)
      }
      if (eff.hasDeck) {
        const rate = outOfCombat ? 1 : 0.5
        if ((p.ram ?? 0) < eff.maxRam) p.ram = Math.min(eff.maxRam, (p.ram ?? 0) + rate)
      }
      this.pushState(session)
    }

    // NPC AI
    const roomIds = new Set()
    for (const s of this.sessions.values()) if (s.player?.alive) roomIds.add(s.player.room)
    for (const roomId of roomIds) {
      const hostiles = this.world.hostilesInRoom(roomId)
      if (!hostiles.length) continue
      const players = this.playerSessions(roomId)
      if (!players.length) continue
      for (const inst of hostiles) {
        if (!inst.alive) continue
        const dotLines = C.tickEnemyStatuses(inst, now)
        if (dotLines.length) this.roomLog(roomId, dotLines.join(' '), 'combat')
        if (inst.hp <= 0) {
          const killer = inst.lastAttacker ? this.byAccount.get(inst.lastAttacker) : players[0]
          if (killer) this.grantKill(killer, inst)
          continue
        }
        // threat decay
        for (const k of Object.keys(inst.threat)) {
          inst.threat[k] *= 0.97
          if (inst.threat[k] < 0.5) delete inst.threat[k]
        }
        if (C.isEnemyStunned(inst, now)) continue
        let target = null
        let best = -1
        for (const s of players) {
          const th = inst.threat[s.accountId] ?? 0
          if (th > best) { best = th; target = s }
        }
        if (!target) target = players[C.rand(0, players.length - 1)]
        if (!target) continue
        const res = C.enemyAttack(inst, target.player, now)
        if (res) {
          this.log(target, res.desc, res.crit ? 'bad' : 'combat')
          for (const s of players) if (s !== target) this.log(s, `${inst.def.name} attacks ${target.player.name}.`, 'combat')
          this.pushState(target)
          if (target.player.hp <= 0) this.handlePlayerDeath(target, now)
        }
      }
    }

    if (now - this.lastSave > AUTOSAVE_MS) {
      this.lastSave = now
      this.persistAll()
    }
  }

  persistAll () {
    for (const session of this.sessions.values()) {
      if (!session.player) continue
      db.getDb().world.players[session.accountId] = P.serializePlayer(session.player)
    }
    db.queueSave()
  }

  shutdown () {
    clearInterval(this.timer)
    this.persistAll()
    db.shutdown()
  }
}

function opposite (dir) {
  return { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', up: 'down', down: 'up' }[dir] ?? dir
}

function buildCatalog () {
  return allItemDefs().map(d => ({
    id: d.id, name: d.name, category: d.category, class: d.class ?? null, slot: d.slot ?? null,
    value: d.value, weight: d.weight ?? 0, desc: d.desc, icon: iconFor(d.id),
    dmg: d.dmg ?? null, speed: d.speed ?? null, crit: d.crit ?? null, pen: d.pen ?? null,
    armor: d.armor ?? null, ram: d.ram ?? null, heal: d.heal ?? null, stamina: d.stamina ?? null,
    capacity: d.capacity ?? null, humanity: d.humanity ?? 0, effect: d.effect ?? null,
    effectValue: d.effectValue ?? null, skill: d.skill ?? null, skillName: d.skillName ?? null
  }))
}

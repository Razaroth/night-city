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
import { CLASSES, PERKS, TIER_REQUIREMENTS, perkEffects, classPerks } from './classes.js'
import { handleCommand } from './commands.js'
import { ambientLine, npcChatterLine, AMBIENT_MIN, AMBIENT_MAX } from './ambient.js'
import * as netrun from './netrun.js'
import { createSims } from './sims.js'
import { SPECIAL_MISSIONS, createSpecialRun, specialMissionView } from './special-missions.js'
import { levelDelta, rewardMultiplier, scaledLootChance } from './scaling.js'

const TICK_MS = 1000
const AUTOSAVE_MS = 20000

export class Game {
  constructor ({ wss }) {
    this.wss = wss
    this.sessions = new Map() // ws -> session
    this.byAccount = new Map() // accountId -> session
    this.world = new WorldState()
    this.world.seed()
    this.sims = createSims()
    this.lastSave = Date.now()
    this.itemCatalog = buildCatalog()
    this.districts = districtMapPayload()
    this.roomList = roomsPayload()
    this.startedAt = Date.now()
    this.ambientAt = new Map() // roomId -> next ambient epoch (ms)
    this.netportCd = new Map() // roomId -> access point reboot ready at (ms)
    this.specialRuns = new Map() // runId -> isolated Special Mission runtime
    this.specialRooms = new Map() // roomId -> isolated room data
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
      this.cleanupSpecialMission(session)
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

  pushCombatEnd (session, roomId) {
    if (this.world.hostilesInRoom(roomId).length) return
    this.send(session, { t: 'combatEnd', roomId })
  }

  pushRoomToPlayers (roomId) {
    const sessions = this.playerSessions(roomId)
    const combatEnded = this.world.hostilesInRoom(roomId).length === 0
    for (const session of sessions) {
      this.pushRoom(session)
      if (combatEnded) this.pushCombatEnd(session, roomId)
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
    if (t === 'breach') return this.handleBreachMsg(session, msg)
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
    this.send(session, { t: 'world', districts: this.districts, rooms: this.roomList, items: this.itemCatalog, classes: CLASSES, perks: PERKS, tierRequirements: TIER_REQUIREMENTS, attrLabels: P.ATTR_LABELS })
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
      this.cleanupSpecialMission(session)
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
    session.breach = null
    this.send(session, { t: 'logout', ok: true })
  }

  creationPayload () {
    return {
      lifepaths: P.LIFEPATHS,
      styles: P.STYLES,
      classes: CLASSES,
      perks: PERKS,
      tierRequirements: TIER_REQUIREMENTS,
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
    const cls = msg.cls ?? 'solo'
    if (!CLASSES[cls]) return this.send(session, { t: 'error', msg: 'Pick a class.' })

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

    const player = P.makeNewPlayer(accountId, { name, lifepath: msg.lifepath, style: msg.style, attrs, cls })
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
    if (!rooms[player.room]) player.room = P.LIFEPATHS[player.lifepath]?.startRoom ?? HUB_ROOMS.watson
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

  roomFor (roomId) {
    return rooms[roomId] ?? this.specialRooms.get(roomId) ?? null
  }

  scaleGigTarget (session, inst) {
    const p = session.player
    const activeGig = Object.entries(p.quests ?? {}).some(([gigId, rec]) =>
      rec && !rec.completedAt && Q.GIGS[gigId]?.targets.includes(inst.id))
    if (!activeGig) return

    const base = inst.baseDef ?? inst.def
    const delta = levelDelta(p.level, base.level, 12)
    const targetLevel = (base.level || 1) + delta
    if (!delta || targetLevel <= (inst.scaledLevel ?? base.level)) return

    const hpPct = inst.maxhp > 0 ? inst.hp / inst.maxhp : 1
    inst.baseDef ??= base
    inst.scaledLevel = targetLevel
    inst.def = {
      ...base,
      level: targetLevel,
      armor: (base.armor ?? 0) + Math.floor(delta / 4),
      stats: Object.fromEntries(Object.entries(base.stats ?? {}).map(([attr, value]) => [attr, value + Math.floor(delta / 4)]))
    }
    inst.maxhp = Math.floor(base.maxhp * Math.pow(1.06, targetLevel - 1))
    inst.hp = Math.max(1, Math.round(inst.maxhp * hpPct))
  }

  specialMissionList (session, now = this.now()) {
    return specialMissionView(session.player, now, this.specialRuns.get(session.specialRunId))
  }

  startSpecialMission (session, missionId) {
    const p = session.player
    const mission = SPECIAL_MISSIONS[missionId]
    if (!mission) return this.log(session, `No Special Mission "${missionId}". Type SPECIAL to see the slate.`, 'bad')
    if (!p.alive) return this.log(session, 'You need to be alive to accept a Special Mission.', 'bad')
    if (session.specialRunId) return this.log(session, 'You are already inside a Special Mission. Type SPECIAL LEAVE to extract.', 'bad')
    if ((p.level || 1) < mission.minLevel) return this.log(session, `You need level ${mission.minLevel} to run "${mission.title}".`, 'bad')
    if (this.world.hostilesInRoom(p.room).length) return this.log(session, 'Break contact before jacking into a Special Mission.', 'bad')
    const record = p.specialMissions?.[missionId]
    if (record?.availableAt > this.now()) return this.log(session, `That shard is still cold. Reboot in ${Math.ceil((record.availableAt - this.now()) / 60000)} min.`, 'bad')
    if (mission.requiredGigId) {
      const contract = p.quests?.[mission.requiredGigId]
      if (!contract?.acceptedAt) return this.log(session, 'Accept Rogue’s Bad Fish in the Nest gig before jacking into this Special Mission.', 'bad')
    }

    const run = createSpecialRun(missionId, session.accountId, p.room, npcDefs, p.level)
    this.specialRuns.set(run.id, run)
    for (const [id, room] of run.rooms) this.specialRooms.set(id, room)
    for (const enemy of run.enemyIds) {
      const inst = this.world.spawnTemporaryInstance(enemy.id, enemy.roomId, enemy.def, run.id)
      inst.questTargetId = enemy.questTargetId
    }
    session.specialRunId = run.id
    p.room = run.roomIds[0]
    this.log(session, `SPECIAL MISSION ACCEPTED — ${mission.title}. ${mission.desc}`, 'gig')
    this.roomLog(run.entryRoom, `${p.name} disappears into a sealed contract shard.`, 'sys', session.accountId)
    this.pushAll(session)
    this.describeCurrentRoom(session)
  }

  cleanupSpecialMission (session, run = this.specialRuns.get(session.specialRunId)) {
    if (!run) return
    if (session.player && run.roomIds.includes(session.player.room)) session.player.room = run.entryRoom
    this.world.removeTemporaryInstances(run.id)
    for (const roomId of run.roomIds) {
      this.specialRooms.delete(roomId)
      for (const [uid, corpse] of this.world.corpses) {
        if (corpse.roomId === roomId) this.world.corpses.delete(uid)
      }
    }
    this.specialRuns.delete(run.id)
    session.specialRunId = null
  }

  leaveSpecialMission (session, { quiet = false } = {}) {
    const run = this.specialRuns.get(session.specialRunId)
    if (!run) return this.log(session, 'You are not inside a Special Mission.', 'bad')
    const p = session.player
    p.room = run.entryRoom
    this.cleanupSpecialMission(session, run)
    if (!quiet) {
      this.log(session, 'You extract from the Special Mission. The shard is lost; no completion payout.', 'sys')
      this.pushAll(session)
      this.describeCurrentRoom(session)
    }
  }

  specialMissionKill (session, inst, now) {
    const run = this.specialRuns.get(session.specialRunId)
    if (!run || inst.instanceRunId !== run.id || run.clearedRooms?.has(inst.roomId)) return
    if (this.world.hostilesInRoom(inst.roomId).length) return
    run.clearedRooms ??= new Set()
    run.clearedRooms.add(inst.roomId)
    const mission = SPECIAL_MISSIONS[run.missionId]
    const stage = mission.rooms[run.roomIndex]
    this.log(session, stage.clear, 'good')
    if (run.roomIndex !== mission.rooms.length - 1 || run.completed) return

    run.completed = true
    const p = session.player
    p.specialMissions ??= {}
    p.specialMissions[mission.id] = { completedAt: now, availableAt: now + mission.cooldownSec * 1000 }
    p.stats.special_missions = (p.stats.special_missions || 0) + 1
    if (mission.rewardsFromGig) {
      this.log(session, `SPECIAL MISSION COMPLETE — "${mission.title}". Rogue’s contract payout is secured.`, 'gig')
    } else {
      const eddiesPct = perkEffects(p).eddiesPct ?? 0
      const scale = rewardMultiplier(run.playerLevel, mission.minLevel)
      const paid = Math.round(mission.rewardEddies * scale * (1 + eddiesPct / 100))
      const xp = Math.round(mission.rewardXp * scale)
      const rep = Math.round(mission.rewardRep * scale)
      p.eddies += paid
      p.rep += rep
      this.log(session, `SPECIAL MISSION COMPLETE — "${mission.title}". +${paid} eddies, +${xp} XP, +${rep} rep.`, 'gig')
      for (const lvl of P.addXp(p, xp)) this.log(session, `LEVEL UP — you are now level ${lvl}. Attribute point + perk point available.`, 'level')
    }
    this.toast(session, `SPECIAL MISSION COMPLETE: ${mission.title}`, 'gig')
    this.pushState(session)
    this.pushJobs(session)
    db.queueSave()
  }

  /* ------------------- netrunning / breach protocol ------------------- */
  handleBreachMsg (session, msg) {
    const p = session.player
    if (!p) return
    const now = this.now()
    const b = session.breach
    if (!b) {
      if (msg.action === 'start' || msg.action === 'pick') {
        const start = netrun.startBreach(this, session, now)
        if (!start.ok) return this.log(session, start.error, 'bad')
        const nb = session.breach
        this.log(session, `You jack into ${nb.apName}. Trace window active — upload the daemons.`, 'net')
        this.pushBreach(session)
        return
      }
      return
    }
    if (msg.action === 'abort') {
      netrun.abortBreach(this, session)
      this.send(session, { t: 'breach', done: true, aborted: true })
      this.log(session, 'You pull the cable. The net spits you out clean.', 'sys')
      return
    }
    if (msg.action === 'pick') {
      const res = netrun.pickBreach(this, session, msg.cell, now)
      if (res.error) { this.send(session, { t: 'breach', error: res.error }); return }
      if (res.done) return this.finishBreach(session, res, now)
      this.pushBreach(session)
    }
  }

  finishBreach (session, res, now) {
    const p = session.player
    const b = session.breach
    if (!b) return
    const full = {
      done: true,
      ok: !!res.ok,
      tier: b.tier,
      lines: res.lines ?? []
    }
    this.send(session, { t: 'breach', ...full })
    if (res.ok) {
      this.roomLog(p.room, `${p.name} finishes a breach run on ${b.apName}.`, 'sys', session.accountId)
      for (const lvl of res.gained ?? []) this.log(session, `LEVEL UP — you are now level ${lvl}. Attribute point + perk point available.`, 'level')
    } else {
      this.log(session, 'The ICE bites back. Your skull rings like a spent bell.', 'bad')
    }
    this.pushInv(session)
    this.pushState(session)
    if (p.hp <= 0) this.handlePlayerDeath(session, now)
    else this.pushRoom(session)
    session.breach = null
  }

  pushBreach (session) {
    const payload = netrun.breachPayload(session, this.now())
    if (payload) this.send(session, payload)
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
    const room = this.roomFor(p.room)
    for (const inst of this.world.hostilesInRoom(p.room)) this.scaleGigTarget(session, inst)
    const hostiles = this.world.hostilesInRoom(p.room)
    const npcs = []
    for (const inst of this.world.allInRoom(p.room)) {
      const d = inst.def
      npcs.push({
        id: inst.id, name: d.name, kind: d.kind, faction: d.faction, danger: d.danger ?? 'neutral', level: d.level ?? 1,
        desc: d.desc, hpPct: d.kind === 'hostile' ? Math.round(inst.hp / inst.maxhp * 100) : null,
        hp: d.kind === 'hostile' ? inst.hp : null,
        maxhp: d.kind === 'hostile' ? inst.maxhp : null,
        stunned: inst.statuses.some(s => s.kind === 'stun' && now < s.until),
        burning: inst.statuses.some(s => s.kind === 'burn' || s.kind === 'poison'),
        blinded: inst.statuses.some(s => s.kind === 'blind' && now < s.until),
        weakened: inst.statuses.some(s => s.kind === 'weaken' && now < s.until)
      })
    }
    const players = this.playerSessions(p.room)
      .filter(s => s !== session)
      .map(s => ({ name: s.player.name, level: s.player.level, lifepath: s.player.lifepath }))
    const simsHere = (this.sims?.presentIn(p.room) ?? []).map(sim => ({ name: sim.name, level: sim.level, lifepath: sim.lifepath, sim: true }))
    const corpse = this.world.corpseFor(p.room)
    const cdLeft = netrun.netportOnCooldown(this, p.room, now)
    const payload = {
      t: 'room',
      id: room.id,
      name: room.name,
      district: room.district,
      districtName: districts[room.district]?.name,
      color: districts[room.district]?.color,
      category: room.category,
      danger: !!room.danger,
      desc: room.desc,
      exits: Object.entries(room.exits ?? {}).map(([dir, to]) => ({ dir, name: EXIT_NAMES[dir] ?? dir, to, toName: this.roomFor(to)?.name ?? to })),
      npcs,
      players: [...players, ...simsHere],
      corpse: corpse ? { name: corpse.name, eddies: corpse.eddies, items: corpse.items.map(s => ({ name: getItemDef(s.id)?.name, qty: s.qty })) } : null,
      objects: (room.objects ?? []).map(o => o.kind === 'netport'
        ? { id: o.id, name: o.name, kind: o.kind, desc: o.desc, tier: o.tier ?? 'mid', ready: cdLeft === 0, cdLeft }
        : { id: o.id, name: o.name, kind: o.kind, desc: o.desc }),
      netportCd: cdLeft,
      weather: this.weatherFor(p.room, now),
      clock: new Date(now).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      inCombat: hostiles.length > 0
    }
    const run = this.specialRuns.get(session.specialRunId)
    if (run && run.roomIds.includes(p.room)) {
      payload.specialMission = {
        title: SPECIAL_MISSIONS[run.missionId].title,
        room: run.roomIndex + 1,
        total: SPECIAL_MISSIONS[run.missionId].rooms.length,
        completed: run.completed,
        canAdvance: run.roomIndex < SPECIAL_MISSIONS[run.missionId].rooms.length - 1 && hostiles.length === 0,
        rooms: SPECIAL_MISSIONS[run.missionId].rooms.map((stage, i) => ({
          name: stage.name,
          current: i === run.roomIndex,
          cleared: run.clearedRooms?.has(run.roomIds[i]) ?? false,
          locked: !((run.clearedRooms?.has(run.roomIds[i]) ?? false) || i === run.roomIndex) &&
            (i > run.roomIndex + 1 || (i === run.roomIndex + 1 && hostiles.length > 0))
        }))
      }
    }
    return payload
  }

  weatherFor (roomId, now) {
    const room = this.roomFor(roomId)
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
    const room = this.roomFor(session.player.room)
    const fixersHere = (room.npcs ?? []).filter(id => npcDefs[id]?.kind === 'fixer')
    this.send(session, {
      t: 'jobs',
      fixersHere,
      gigs: Q.gigListView(session.player, now),
      specialMissions: specialMissionView(session.player, now, this.specialRuns.get(session.specialRunId))
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
    if (session.breach && !session.breach.done) {
      netrun.abortBreach(this, session)
      this.send(session, { t: 'breach', done: true, aborted: true })
      this.log(session, 'You pull the cable and get moving.', 'sys')
    }
    const room = this.roomFor(p.room)
    const to = room.exits?.[dir]
    if (!to) return this.log(session, `You can't go ${EXIT_NAMES[dir] ?? dir} from here.`, 'bad')
    const run = this.specialRuns.get(session.specialRunId)
    const nextIndex = run?.roomIds.indexOf(to) ?? -1
    if (run && nextIndex > run.roomIndex && this.world.hostilesInRoom(p.room).length) {
      return this.log(session, 'Hostiles still hold this room. Clear them before pushing deeper.', 'bad')
    }
    const from = p.room
    const wasInCombat = this.world.hostilesInRoom(from).length > 0
    p.room = to
    if (run && nextIndex >= 0) run.roomIndex = nextIndex
    else if (run && to === run.entryRoom) this.cleanupSpecialMission(session, run)
    this.roomLog(from, `${p.name} heads ${EXIT_NAMES[dir] ?? dir}.`, 'sys', session.accountId)
    this.roomLog(to, `${p.name} arrives from the ${EXIT_NAMES[opposite(dir)] ?? opposite(dir)}.`, 'sys', session.accountId)
    this.pushRoom(session)
    if (wasInCombat) this.pushCombatEnd(session, to)
    this.pushJobs(session)
    this.describeCurrentRoom(session)
  }

  describeCurrentRoom (session) {
    const now = this.now()
    const room = this.roomFor(session.player.room)
    const lines = []
    lines.push({ text: `◈ ${room.name}`, cls: 'place' })
    lines.push({ text: room.desc, cls: 'room' })
    const exits = Object.keys(room.exits ?? {})
    if (exits.length) lines.push({ text: `Exits: ${exits.map(e => EXIT_NAMES[e]).join(', ')}`, cls: 'exit' })
    const others = this.playerSessions(room.id).filter(s => s !== session)
    for (const s of others) lines.push({ text: `${s.player.name} is here.`, cls: 'who' })
    for (const sim of this.sims?.presentIn(room.id) ?? []) lines.push({ text: `${sim.name} is here.`, cls: 'who' })
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
    for (const lvl of gained) this.log(session, `LEVEL UP — you are now level ${lvl}. Attribute point + perk point available (up <attr> / perks).`, 'level')

    // corpse
    const items = []
    for (const entry of inst.def.loot ?? []) {
      const chance = scaledLootChance(entry.chance, getItemDef(entry.id), p.level)
      if (Math.random() < chance) {
        const qty = entry.qty ? C.rand(entry.qty[0], entry.qty[1]) : 1
        items.push(makeStack(entry.id, qty))
      }
    }
    const eddies = inst.def.eddies ? C.rand(inst.def.eddies[0], inst.def.eddies[1]) : 0
    const uid = crypto.randomUUID()
    this.world.corpses.set(uid, { uid, roomId: p.room, npcId: inst.id, name: inst.def.name, items, eddies, ttl: now + 120000 })

    const gigs = Q.handleKill(p, inst.questTargetId ?? inst.id, now)
    for (const gig of gigs) {
      this.log(session, `GIG COMPLETE — "${gig.title}". +${gig.rewardEddies} eddies, +${gig.rewardXp} XP, +${gig.rep} rep.`, 'gig')
      const lv = P.addXp(p, gig.rewardXp)
      for (const lvl of lv) this.log(session, `LEVEL UP — you are now level ${lvl}. Attribute point + perk point available.`, 'level')
      this.toast(session, `GIG COMPLETE: ${gig.title}`, 'gig')
    }
    if (inst.instanceRunId) this.specialMissionKill(session, inst, now)
    this.pushRoomToPlayers(p.room)
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
    if (session.breach && !session.breach.done) {
      session.breach = null
      this.send(session, { t: 'breach', done: true, aborted: true })
    }
    const eff = P.computeStats(p)
    if (eff.secondHeart && !p.flags.secondHeartUsed) {
      p.flags.secondHeartUsed = true
      p.hp = Math.floor(eff.maxHp * 0.45)
      p.buff.dodgeUntil = now + 4000
      this.log(session, 'Your Second Heart slams into gear. Chest cracks, vision returns — you are NOT done yet.', 'good')
      this.roomLog(p.room, `${p.name}'s chest spasms — a Second Heart kicks in.`, 'combat', session.accountId)
      return
    }
    if (session.specialRunId) {
      this.cleanupSpecialMission(session)
      this.log(session, 'SPECIAL MISSION FAILED — your shard signal drops before the objective is secured.', 'bad')
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
    this.send(session, { t: 'respawned' })
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
      const room = this.roomFor(roomId)
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
    this.sims?.tick(this, now)

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
      // active breach: drive the trace countdown / timeout
      if (session.breach && !session.breach.done) {
        const tb = netrun.tickBreach(this, session, now)
        if (tb.done) {
          this.finishBreach(session, tb, now)
          continue
        }
        this.pushBreach(session)
      }
      const eff = P.computeStats(p)
      const outOfCombat = this.world.hostilesInRoom(p.room).length === 0
      const sinceHit = now - (p.lastHitAt || 0)
      if (sinceHit > 7000) {
        if (p.hp < eff.maxHp) p.hp = Math.min(eff.maxHp, p.hp + Math.max(1, Math.floor(eff.maxHp * 0.03 * (1 + (eff.regenHpPct || 0) / 100))))
        if (p.stam < eff.maxStam) p.stam = Math.min(eff.maxStam, p.stam + 6)
      }
      if (eff.hasDeck) {
        const rate = (outOfCombat ? 1 : 0.5) * (1 + (eff.ramRatePct || 0) / 100)
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

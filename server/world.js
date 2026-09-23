import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const WORLD_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'world.json'), 'utf8'))
export const NPCS_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'npcs.json'), 'utf8'))

export const districts = WORLD_DATA.districts
export const rooms = WORLD_DATA.rooms
export const npcDefs = NPCS_DATA

// reverse index: roomId -> npc ids present (from static data)
export const staticNpcsByRoom = {}
for (const [rid, room] of Object.entries(rooms)) {
  for (const nid of room.npcs ?? []) {
    staticNpcsByRoom[nid] = rid
    if (!npcDefs[nid]) throw new Error(`room ${rid} references unknown npc ${nid}`)
  }
}

export const EXIT_NAMES = { n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest', up: 'up', down: 'down' }
export const EXIT_MAP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] }

export const HUB_ROOMS = {
  watson: 'watson-streets',
  westbrook: 'japantown',
  citycenter: 'downtown',
  heywood: 'the-glen',
  pacifica: 'pacifica-streets',
  santo: 'arroyo',
  badlands: 'badlands-crossroads'
}

// ---- runtime NPC instance store ----
export class WorldState {
  constructor () {
    this.npcs = new Map() // id -> instance
    this.corpses = new Map() // uid -> corpse
    this.deaths = {}        // npcId -> {at, respawnAt}
  }

  seed () {
    for (const nid of Object.keys(npcDefs)) {
      const roomId = staticNpcsByRoom[nid]
      if (!roomId) continue
      const inst = this.spawnInstance(nid, roomId, true)
      this.npcs.set(nid, inst)
    }
  }

  spawnInstance (nid, roomId, boot = false) {
    const def = npcDefs[nid]
    const hpScale = Math.pow(1.06, Math.max(0, def.level - 1))
    const inst = {
      id: nid,
      roomId,
      def,
      hp: Math.floor(def.maxhp * hpScale),
      maxhp: Math.floor(def.maxhp * hpScale),
      alive: true,
      diedAt: 0,
      respawnAt: 0,
      threat: {},          // playerId -> threat score
      attackAt: def.kind === 'hostile' ? Date.now() + 400 + Math.floor(Math.random() * 1800) : 0,
      statuses: [],        // {kind, until}
      specialAt: 0
    }
    if (boot) delete this.deaths[nid]
    return inst
  }

  instance (nid) {
    return this.npcs.get(nid)
  }

  allInRoom (roomId) {
    return [...this.npcs.values()].filter(n => n.alive && n.roomId === roomId)
  }

  hostilesInRoom (roomId) {
    return this.allInRoom(roomId).filter(n => n.def.kind === 'hostile')
  }

  corpseFor (roomId) {
    for (const c of this.corpses.values()) if (c.roomId === roomId && c.ttl > Date.now()) return c
    return null
  }

  kill (instance, now) {
    instance.alive = false
    instance.diedAt = now
    const def = instance.def
    const respawnSec = def.danger === 'boss' ? 600 : (def.kind === 'hostile' ? 90 : 30)
    instance.respawnAt = now + respawnSec * 1000
    this.deaths[instance.id] = { at: now, respawnAt: instance.respawnAt }
  }

  tickRespawns (now) {
    const spawned = []
    for (const [nid, d] of Object.entries(this.deaths)) {
      if (now >= d.respawnAt) {
        const roomId = staticNpcsByRoom[nid]
        if (!roomId) continue
        const inst = this.spawnInstance(nid, roomId)
        this.npcs.set(nid, inst)
        delete this.deaths[nid]
        spawned.push({ roomId, def: inst.def })
      }
    }
    return spawned
  }

  tickCorpses (now) {
    for (const [uid, c] of [...this.corpses]) {
      if (now > c.ttl) this.corpses.delete(uid)
    }
  }
}

export function describeRoom (roomId) {
  const room = rooms[roomId]
  if (!room) return null
  return {
    id: room.id,
    name: room.name,
    district: room.district,
    category: room.category,
    danger: !!room.danger,
    desc: room.desc,
    exits: Object.keys(room.exits ?? {}).map(k => ({ dir: k, to: room.exits[k] })),
    npcs: room.npcs ?? [],
    objects: room.objects ?? []
  }
}

// district color map for the client
export function districtMapPayload () {
  const dmap = {}
  for (const [id, d] of Object.entries(districts)) dmap[id] = { id, name: d.name, color: d.color, blurb: d.blurb }
  return dmap
}

export function roomsPayload () {
  const list = []
  for (const r of Object.values(rooms)) {
    list.push({ id: r.id, name: r.name, district: r.district, category: r.category })
  }
  return list
}
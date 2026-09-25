// Simulated runners — NPCs that move through Night City like real players:
// walking room-to-room, lingering, trading, hitting subnet terminals, talking
// back, taking gigs against gang dens, and trading fire with hostiles. They can
// be flatlined and respawn later. They exist only in memory (no save data) and
// are re-seeded on every boot. Hostiles still treat real player sessions as
// their primary targets; sims only engage hostiles that no player has aggroed.

import { rooms, HUB_ROOMS, EXIT_NAMES, npcDefs } from './world.js'
import { rand } from './combat.js'

const FIRST = [
  'Zero', 'Mariel', 'Corso', 'Vee', 'Tomas', 'Igni', 'Nine', 'Sable', 'Koda',
  'Rhea', 'Ash', 'Dex', 'Lotus', 'Burner', 'Wren', 'Octav', 'Nyx', 'Sook',
  'Mirek', 'Fable', 'Tori', 'Quill', 'Rook', 'Juno', 'Cabal', 'Slate',
  'Ember', 'Vasily', 'Iris', 'Hagen'
]

const LAST = [
  'Ríos', 'Lathrop', 'Akusek', 'Moro', 'Delgado', 'Voss', 'Tanaka', 'Okafor',
  'Hollow', 'Pryce', 'Quintero', 'Sade', 'Beacon', 'Nóvak', 'Teng', 'Marsh',
  'Kazarian', 'Ortiz', 'Blume', 'Cruz', 'Fenn', 'Weiss', 'Nakamura', 'Devereaux',
  'Scar', 'Vinton', 'Mallick', 'Reeve', 'Dhar', 'Salazar'
]

const CLASS_POOL = ['solo', 'netrunner', 'techie', 'rockerboy', 'nomad']
const LIFEPATH_POOL = ['streetkid', 'corpo', 'nomad']

// how likely each class is to throw down with hostiles
const FIGHT_CHANCE = { solo: 0.95, nomad: 0.8, techie: 0.55, rockerboy: 0.35, netrunner: 0.3 }
const WEAPONS = {
  solo: { name: 'an assault rifle', dmg: [6, 11] },
  netrunner: { name: 'a back-up pistol', dmg: [4, 9] },
  techie: { name: 'a mil-spec SMG', dmg: [4, 10] },
  rockerboy: { name: 'belt-fed knuckles', dmg: [2, 8] },
  nomad: { name: 'a pump shotgun', dmg: [7, 14] }
}
const BOSS_HUNT_LEVEL = 14 // sims below this dodge boss lairs entirely
const RESURRECT_MS = [4 * 60000, 10 * 60000]
const GIG_CD_MS = [8 * 60000, 18 * 60000]
const MAX_LEVEL = 30

// generic "runner doing runner things" lines, keyed by room category
const RUNNER_ACTIONS = {
  street: [
    'spins a flip-phone shut, shaking their head at the price on the screen.',
    'walks the block like they own it, glancing up at the drone traffic.',
    'shoulder-bumps a vendor cart, then buys a brew to make it right.',
    'counts eddies in their palm, sighs, and tucks the stash away.',
    'leans on a hydrant casing, agent chattering in their native tongue.',
    'flags down a cab, changes their mind, and waves it off.'
  ],
  gangden: [
    'checks a burner pistol in a baggy jacket pocket.',
    'trades a nod with the gangers at the door. The nod is accepted.',
    'sells a handful of part-codes to a runner in a tech-vest.',
    'lays dibs on the next run to the corner crew, no handshake needed.'
  ],
  plaza: [
    'squints up at the corpo towers and mutters something rude.',
    'feeds eddies into a public chip-kiosk, buying nothing in particular.',
    'gets waved straight through the checkpoint locker.',
    'buttons a blazer shut and walks like they belong here.'
  ],
  bar: [
    'nurses a synth-whiskey against the bar\'s neon glow.',
    'loses a round of pool and buys the table a round of drinks.',
    'scrolls a fixer feed between sips, humming.',
    'slides a chip to the barkeep — a tab, not a file.',
    'compares ripper prices with the regular next to them.'
  ],
  club: [
    'rides the bass-line like it\'s drive home.',
    'dances alone with eyes closed, glowing arm-chips on full.',
    'waves off a flash-influencer scanning the crowd for content.'
  ],
  clinic: [
    'get their optics recalibrated, blinking at the ceiling.',
    'haggles the ripper\'s rate down to a favour.',
    'picks up a trauma chip refill and checks the expiry twice.',
    'flexes new fingers, watching the seams crawl shut.'
  ],
  market: [
    'buys noodles and eats them standing up, wrong with the world fully fixed.',
    'haggles a booster vendor down on a used hand.',
    'fences a small stack of junked microchips for lunch money.',
    'tests three identical knick-knacks, picks the loudest.'
  ],
  industrial: [
    'checks the clock above the foundry like they have a shift to catch.',
    'clocks a rig keycard back into a docked unit.',
    'loads a crate onto a trolley for a mechanic who pays in favours.'
  ],
  apartment: [
    'begs the elevator to come up, hand on the button panel.',
    'calls their landlord from the landing and smiles through the yelling.',
    'runs maintenance on a delivery drone outside the door.'
  ],
  ruin: [
    'kicks through the rubble with purpose, hunting salvage codes.',
    'logs a dead-store crawl in case anyone wants the layout.',
    'drags a scrap panel off and pockets the copper.'
  ],
  wasteland: [
    'checks a fuel-cell parcel strapped to the back of a rusted bike.',
    'squats by a dead terminal, tapping out a beacon frequency.',
    'trades water for spare rounds with a nomad convoy scout.'
  ],
  tent: [
    'adds another wind charm to the tent line, for the radio static.',
    'stirs a pot of something and refuses to say what\'s in it.'
  ],
  corpo: [
    'answers a call, apologises to the lobby, and walks out.',
    'hands a dead man\'s ID chip to the front desk without a word.'
  ],
  netshop: [
    'data-jacks a booth terminal and runs a ghost-trace for fun.',
    'flicks through stolen deck firmware like it\'s a menu.'
  ]
}

const RESPONSES = [
  'Eh? Don\'t look at me, choom — I just work here.',
  'You said it. City\'s going to hell in a handcart.',
  'Careful. That\'s the kind of talk that gets a barrel pointed at you.',
  'Preem. You heard it here first, folks.',
  'Yeah… nothing stays dead in Night City. You learn that fast.',
  'Sounds like a gig. You got eddies? I got time.',
  'Ain\'t that the truth.',
  'Rumor has it that\'s worth something to somebody.',
  'Mmm. Buy me a drink and I\'ll remember more.',
  'I\'d say the same, only louder.'
]

function opposite (dir) {
  return { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', up: 'down', down: 'up' }[dir] ?? dir
}

// BFS over the room exits; returns [{ dir, to }] or null if unreachable
function stepsBetween (fromId, toId) {
  if (fromId === toId) return []
  const prev = { [fromId]: null }
  const q = [fromId]
  while (q.length) {
    const cur = q.shift()
    const room = rooms[cur]
    if (!room) continue
    for (const [dir, to] of Object.entries(room.exits ?? {})) {
      if (to in prev) continue
      prev[to] = { from: cur, dir }
      q.push(to)
    }
  }
  if (!(toId in prev)) return null
  const steps = []
  let at = toId
  while (at !== fromId) {
    const p = prev[at]
    steps.unshift({ dir: p.dir, to: at })
    at = p.from
  }
  return steps
}

class Sims {
  constructor () {
    this.sims = []
    this.gigRooms = this.buildGigRooms()
    this.seed()
  }

  // rooms that host hostiles, together with the strongest threat there
  buildGigRooms () {
    const out = []
    for (const [rid, room] of Object.entries(rooms)) {
      const hostiles = (room.npcs ?? []).filter(nid => npcDefs[nid]?.kind === 'hostile')
      if (!hostiles.length) continue
      const maxLevel = Math.max(...hostiles.map(nid => npcDefs[nid].level))
      const hasBoss = hostiles.some(nid => npcDefs[nid].danger === 'boss')
      out.push({ roomId: rid, maxLevel, hasBoss, count: hostiles.length })
    }
    return out
  }

  seed () {
    const roomsWithExits = Object.values(rooms).filter(r => r.exits && Object.keys(r.exits).length)
    const hubs = Object.values(HUB_ROOMS)
    const pool = [...roomsWithExits.map(r => r.id)]
    const count = 8

    for (let i = 0; i < count; i++) {
      // biased start: hubs get priority so districts feel lived-in
      const startId = i < hubs.length ? hubs[i % hubs.length]
        : Math.random() < 0.5 ? hubs[rand(0, hubs.length - 1)]
          : pool[rand(0, pool.length - 1)]
      const name = `${FIRST[rand(0, FIRST.length - 1)]} ${LAST[rand(0, LAST.length - 1)]}`
      const cls = CLASS_POOL[rand(0, CLASS_POOL.length - 1)]
      const level = rand(2, 20)
      this.sims.push({
        id: 'sim-' + i,
        name,
        cls,
        lifepath: LIFEPATH_POOL[rand(0, LIFEPATH_POOL.length - 1)],
        level,
        roomId: startId,
        destId: null,
        path: [],
        weapon: WEAPONS[cls],
        willFight: Math.random() < FIGHT_CHANCE[cls],
        hp: 50 + level * 11,
        maxhp: 50 + level * 11,
        attackAt: 0,
        kills: 0,
        gig: null,
        gigCdAt: 0,
        dead: false,
        respawnAt: 0,
        lastCombatAt: 0,
        nextAt: Date.now() + rand(2000, 9000),
        walkDelay: rand(8000, 16000),
        linger: rand(30000, 180000)
      })
    }
  }

  presentIn (roomId) {
    return this.sims.filter(s => !s.dead && s.roomId === roomId)
  }

  pickDestination (sim) {
    const hubs = Object.values(HUB_ROOMS)
    // weighted: hubs 40%, any other room with exits 60%
    if (Math.random() < 0.4) return hubs[rand(0, hubs.length - 1)]
    const roomsWithExits = Object.values(rooms).filter(r => r.exits && Object.keys(r.exits).length)
    return roomsWithExits[rand(0, roomsWithExits.length - 1)].id
  }

  chase (sim) {
    // scoot a sim on to a new walk target (walk, or catch a shuttle across the map)
    const from = sim.roomId
    if (Math.random() < 0.08) {
      const hubs = Object.values(HUB_ROOMS)
      const target = hubs[rand(0, hubs.length - 1)]
      if (target !== from) {
        sim.roomId = target
        sim.path = []
        sim.destId = target
        return { line: `${sim.name} catches a shuttle across the district.`, roomId: from, cls: 'sys' }
      }
    }
    let target = null
    if (sim.gig && (!sim.destId || !sim.path.length)) target = sim.gig.roomId
    else if (sim.destId && sim.path.length) target = sim.destId
    else target = this.pickDestination(sim)
    const steps = stepsBetween(from, target)
    if (!steps || !steps.length) return null
    sim.destId = target
    sim.path = steps
    sim.nextAt = Date.now() + sim.walkDelay
    return null
  }

  // step one room along the current path; returns [leavingLine, arrivingLine]
  step (sim) {
    const from = sim.roomId
    const s = sim.path.shift()
    if (!s) return null
    sim.roomId = s.to
    const leaving = `${sim.name} heads ${EXIT_NAMES[s.dir] ?? s.dir}.`
    const arriving = `${sim.name} arrives from the ${EXIT_NAMES[opposite(s.dir)] ?? opposite(s.dir)}.`
    if (!sim.path.length) sim.nextAt = Date.now() + sim.linger
    else sim.nextAt = Date.now() + sim.walkDelay
    return { leaving, arriving, from }
  }

  actionLine (sim) {
    const room = rooms[sim.roomId]
    const pool = RUNNER_ACTIONS[room?.category] ?? RUNNER_ACTIONS.street
    return `${sim.name} ${pool[rand(0, pool.length - 1)]}`
  }

  // --- combat -------------------------------------------------------------

  canEngage (sim, inst) {
    if (!inst.alive || inst.hp <= 0) return false
    // never snipe a hostile a player has claimed
    if (Object.keys(inst.threat ?? {}).length) return false
    // below level 14 sims give boss lairs a wide berth
    if ((inst.def.danger === 'boss') && sim.level < BOSS_HUNT_LEVEL) return false
    return true
  }

  combatTick (game, sim, now) {
    const hostiles = game.world.hostilesInRoom?.(sim.roomId) ?? []
    const target = hostiles.find(i => this.canEngage(sim, i))
    if (!target) return false
    sim.lastCombatAt = now
    if (now < (sim.attackAt || 0)) return true
    // not every pass produces a shot — pacing and variety
    if (Math.random() < 0.4) { sim.attackAt = now + rand(900, 1800); return true }

    const evade = target.def.stats?.reflexes ? rand(1, 100) > 70 : false
    if (evade) {
      sim.attackAt = now + rand(1400, 2400)
      game.roomLog(sim.roomId, `${target.def.name} ducks ${sim.name}'s shot.`, 'combat')
      return true
    }
    const base = Math.floor(sim.level * 2.4) + rand(sim.weapon.dmg[0], sim.weapon.dmg[1])
    const taken = Math.max(1, base - Math.floor((target.def.armor ?? 0) * 0.55))
    const crit = Math.random() < 0.12
    const damage = crit ? Math.floor(taken * 1.5) : taken
    target.hp = Math.max(0, target.hp - damage)
    sim.attackAt = now + rand(1600, 2800)
    game.roomLog(sim.roomId, `${sim.name} lets off ${sim.weapon.name} at ${target.def.name} for [B]${damage}[/B]${crit ? ' — clean crit!' : ''}.`, 'combat')

    // hostile hits back
    if (target.hp > 0 && Math.random() < 0.65) {
      this.hostileHits(sim, target, game, now)
    } else if (target.hp <= 0 && target.alive) {
      this.simKills(game, sim, target, now)
    }
    return true
  }

  hostileHits (sim, inst, game, now) {
    const simArmor = Math.floor(sim.level / 2)
    const baseDamage = Math.max(1, rand(4, 10) + Math.floor(inst.def.level * 0.5) - simArmor)
    const crit = Math.random() < 0.08
    const dmg = crit ? Math.floor(baseDamage * 1.5) : baseDamage
    sim.hp = Math.max(0, sim.hp - dmg)
    game.roomLog(sim.roomId, `${inst.def.name} fights back, scoring [B]${dmg}[/B] on ${sim.name}${crit ? ' — a hell of a hit.' : '.'}`, 'combat')
    if (sim.hp <= 0) this.simDies(game, sim, inst, now)
    else sim.lastCombatAt = now
  }

  simKills (game, sim, inst, now) {
    game.world.kill(inst, now)
    sim.kills++
    const isBoss = inst.def.danger === 'boss'
    game.roomLog(sim.roomId, `${inst.def.name} is flatlined by ${sim.name}.${isBoss ? ' [B]Boss down![/B]' : ''}`, 'combat')
    if (sim.gig && sim.gig.roomId === sim.roomId) sim.gig.kills++
  }

  simDies (game, sim, inst, now) {
    sim.dead = true
    sim.respawnAt = now + rand(RESURRECT_MS[0], RESURRECT_MS[1])
    sim.gig = null
    sim.path = []
    const min = Math.round((sim.respawnAt - now) / 60000)
    game.roomLog(sim.roomId, `${sim.name} is flatlined by ${inst.def.name}. Back on the streets in ~${min} min.`, 'combat')
  }

  gigLoop (game, sim, now) {
    // picking up / finishing contract work against gang dens
    if (sim.gig) return
    if (!sim.willFight) return
    if (now < sim.gigCdAt) return
    if (Math.random() > 0.08) return
    const eligible = this.gigRooms.filter(g =>
      (g.maxLevel >= 2 && sim.level >= g.maxLevel - 1) &&
      (g.hasBoss ? sim.level >= BOSS_HUNT_LEVEL : true)
    )
    if (!eligible.length) return
    const gig = eligible[rand(0, eligible.length - 1)]
    sim.gig = { roomId: gig.roomId, kills: 0 }
    sim.destId = gig.roomId
    sim.path = []
    game.roomLog(sim.roomId, `${sim.name} picks up a contract: ${rooms[gig.roomId]?.name}.`, 'sys')
  }

  gigComplete (game, sim, now) {
    sim.gig = null
    sim.gigCdAt = now + rand(GIG_CD_MS[0], GIG_CD_MS[1])
    sim.destId = null
    sim.path = []
    const payout = rand(120, 460) + sim.level * 20
    game.roomLog(sim.roomId, `${sim.name} wraps the gig — ${payout} eddies, no questions asked.`, 'sys')
    if (sim.kills >= 2 && sim.level < MAX_LEVEL && Math.random() < 0.5) {
      sim.level++
      sim.maxhp = 50 + sim.level * 11
      sim.hp = sim.maxhp
      sim.kills = 0
      game.roomLog(sim.roomId, `${sim.name} pulls up to level ${sim.level}.`, 'sys')
    }
    sim.nextAt = now + sim.walkDelay
  }

  tick (game, now) {
    for (const sim of this.sims) {
      if (sim.dead) {
        if (now >= sim.respawnAt) this.respawn(game, sim)
        continue
      }
      // regen out of combat
      if (now - (sim.lastCombatAt || 0) > 30000 && sim.hp < sim.maxhp) {
        sim.hp = Math.min(sim.maxhp, sim.hp + Math.max(1, Math.floor(sim.maxhp * 0.04)))
      }
      // exchange lead with anything unfriendly sharing the room
      if (this.combatTick(game, sim, now)) continue
      // standing in the gig room? grind the crew down, then call it done
      if (sim.gig && sim.roomId === sim.gig.roomId) {
        const hostiles = game.world.hostilesInRoom?.(sim.roomId) ?? []
        if (!hostiles.length && sim.gig.kills > 0) this.gigComplete(game, sim, now)
        else sim.nextAt = now + rand(3000, 8000)
        continue
      }
      if (now < sim.nextAt) continue
      if (sim.path.length) {
        const res = this.step(sim)
        if (res) {
          game.roomLog(res.from, res.leaving, 'sys')
          game.roomLog(sim.roomId, res.arriving, 'sys')
        }
        continue
      }
      if (sim.gig && sim.roomId !== sim.gig.roomId) {
        // headed somewhere: plan the walk next spin via chase()
        const moved = this.chase(sim)
        if (moved) game.roomLog(moved.roomId, moved.line, 'sys')
        else sim.nextAt = now + sim.walkDelay
        continue
      }
      // no path: linger action, pick up gigs, or start a new walk
      this.gigLoop(game, sim, now)
      if (Math.random() < 0.6 && game.playerSessions(sim.roomId).length) {
        const line = this.actionLine(sim)
        game.roomLog(sim.roomId, line, 'amb')
        sim.nextAt = now + Math.max(20000, sim.walkDelay * rand(2, 5))
        continue
      }
      const moved = this.chase(sim)
      if (moved) game.roomLog(moved.roomId, moved.line, 'sys')
      else sim.nextAt = now + sim.walkDelay
    }
  }

  respawn (game, sim) {
    const hubs = Object.values(HUB_ROOMS)
    const target = hubs[rand(0, hubs.length - 1)]
    const from = sim.roomId
    sim.roomId = target
    sim.dead = false
    sim.respawnAt = 0
    sim.hp = sim.maxhp
    sim.lastCombatAt = 0
    sim.attackAt = 0
    sim.destId = null
    sim.path = []
    sim.nextAt = Date.now() + rand(3000, 9000)
    game.roomLog(from, `${sim.name} breathes again. Resurrected somewhere safer than that.`, 'sys')
    game.roomLog(target, `${sim.name} limps in, sweaty and alive.`, 'sys')
  }

  handleSay (game, roomId) {
    const here = this.presentIn(roomId)
    if (!here.length) return
    const sim = here[rand(0, here.length - 1)]
    if (Math.random() > 0.5) return
    const line = `${sim.name}: "${RESPONSES[rand(0, RESPONSES.length - 1)]}"`
    game.roomLog(roomId, line, 'chat')
  }
}

export function createSims () {
  return new Sims()
}

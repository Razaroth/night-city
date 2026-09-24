// Simulated runners — NPCs that move through Night City like real players:
// walking room-to-room, lingering, trading, hitting subnet terminals, and
// occasionally talking back. They exist only in memory (no save data) and are
// re-seeded on every boot. Hostiles never target them (combat only picks real
// player sessions), so they are pure ambience.

import { rooms, HUB_ROOMS, EXIT_NAMES } from './world.js'
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
    this.sims = [] // { id, name, cls, lifepath, level, roomId, destId, path, nextAt }
    this.seed()
  }

  seed () {
    const roomsWithExits = Object.values(rooms).filter(r => r.exits && Object.keys(r.exits).length)
    const hubs = Object.values(HUB_ROOMS)
    const pool = [...roomsWithExits.map(r => r.id)]
    const count = 22

    for (let i = 0; i < count; i++) {
      // biased start: hubs get priority so districts feel lived-in
      const startId = i < hubs.length ? hubs[i % hubs.length]
        : Math.random() < 0.5 ? hubs[rand(0, hubs.length - 1)]
          : pool[rand(0, pool.length - 1)]
      const name = `${FIRST[rand(0, FIRST.length - 1)]} ${LAST[rand(0, LAST.length - 1)]}`
      this.sims.push({
        id: 'sim-' + i,
        name,
        cls: CLASS_POOL[rand(0, CLASS_POOL.length - 1)],
        lifepath: LIFEPATH_POOL[rand(0, LIFEPATH_POOL.length - 1)],
        level: rand(2, 20),
        roomId: startId,
        destId: null,
        path: [],
        nextAt: Date.now() + rand(2000, 9000),
        walkDelay: rand(8000, 16000),
        linger: rand(30000, 180000)
      })
    }
  }

  presentIn (roomId) {
    return this.sims.filter(s => s.roomId === roomId)
  }

  pickDestination (sim) {
    const hubs = Object.values(HUB_ROOMS)
    // weighted: hubs 40%, any other room with exits 60%
    if (Math.random() < 0.4) return hubs[rand(0, hubs.length - 1)]
    const roomsWithExits = Object.values(rooms).filter(r => r.exits && Object.keys(r.exits).length)
    return roomsWithExits[rand(0, roomsWithExits.length - 1)].id
  }

  chase(sim) {
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
    if (sim.destId && sim.path.length) target = sim.destId
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

  tick (game, now) {
    for (const sim of this.sims) {
      if (now < sim.nextAt) continue
      if (sim.path.length) {
        const res = this.step(sim)
        if (res) {
          game.roomLog(res.from, res.leaving, 'sys')
          game.roomLog(sim.roomId, res.arriving, 'sys')
        }
        continue
      }
      // no path: linger action or start a new walk
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
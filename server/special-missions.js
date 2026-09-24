import crypto from 'node:crypto'
import { levelDelta, rewardMultiplier } from './scaling.js'

export const SPECIAL_MISSIONS = {
  'blackout-relay': {
    id: 'blackout-relay',
    title: 'BLACKOUT: Ghost Signal',
    desc: 'A stolen Arasaka relay is ghosting through an abandoned Watson clinic. Clear the security teams and pull its encrypted shard.',
    minLevel: 3,
    cooldownSec: 1200,
    rewardEddies: 700,
    rewardXp: 300,
    rewardRep: 35,
    rooms: [
      {
        name: 'Clinic Service Entrance',
        desc: 'A steel service door seals behind you. Red emergency strips pick out blood-specked tiles and a pair of scavengers stripping copper from the walls.',
        enemies: [{ id: 'scav-1', count: 2 }],
        clear: 'The service lift unlocks with a hydraulic groan.'
      },
      {
        name: 'Cold Storage Hall',
        desc: 'Refrigeration units thrum beneath a film of frost. Two Maelstrom stragglers guard the corridor between the clinic and the relay core.',
        enemies: [
          { id: 'maelstrom-1', count: 1, level: 2, maxhp: 55, armor: 3 },
          { id: 'maelstrom-2', count: 1, level: 3, maxhp: 68, armor: 4, weapon: 'unity' }
        ],
        clear: 'The security shutters retract. The relay signal is coming from the core.'
      },
      {
        name: 'Ghost Signal Core',
        desc: 'A relay rack burns blue in the dark. Its guardian steps out of the static, Fenrir muzzle already whining.',
        enemies: [{ id: 'maelstrom-2', count: 1, name: 'Black ICE Warden', level: 5, maxhp: 140, armor: 9, danger: 'boss' }],
        clear: 'The Warden collapses. The ghost signal dies, leaving one clean shard in the relay.'
      }
    ]
  },
  'fangs-foundry': {
    id: 'fangs-foundry',
    title: 'FANGS IN THE FOUNDRY',
    desc: 'Punch into the old Maelstrom foundry, clear the assembly floor, and put Fang down before he powers up the chrome rig.',
    minLevel: 5,
    cooldownSec: 1800,
    rewardEddies: 500,
    rewardXp: 300,
    rewardRep: 35,
    rooms: [
      {
        name: 'Assembly Floor',
        desc: 'Dead conveyor belts crawl beneath red work lamps. A Maelstrom patrol has set up among the half-built drones.',
        enemies: [{ id: 'maelstrom-1', count: 1 }, { id: 'maelstrom-2', count: 1 }],
        clear: 'The freight lift grinds open. Fang is waiting in the furnace room.'
      },
      {
        name: 'Furnace Room',
        desc: 'Heat shimmers above a bank of industrial furnaces. Fang steps from behind a steel press, jaw-grinder spinning.',
        enemies: [{ id: 'maelstrom-boss', count: 1 }],
        clear: 'Fang hits the concrete. The foundry goes quiet.'
      }
    ]
  },
  'lazarillo-contract': {
    id: 'lazarillo-contract',
    title: 'THE LAST PROCESSION',
    desc: 'Take the Valentino compound room by room and end El Lazarillo’s protection racket at its source.',
    minLevel: 6,
    cooldownSec: 2400,
    rewardEddies: 750,
    rewardXp: 420,
    rewardRep: 50,
    rooms: [
      {
        name: 'Rosary Courtyard',
        desc: 'Candle smoke curls through a courtyard of scratched bikes. Two pistoleros spot your silhouette in the gate lights.',
        enemies: [{ id: 'valentino-1', count: 2 }],
        clear: 'The chapel doors unlatch. The compound boss is inside.'
      },
      {
        name: 'The Chapel',
        desc: 'Votive candles gutter around a chrome altar. El Lazarillo raises his Kongou and smiles like the sermon is over.',
        enemies: [{ id: 'valentino-boss', count: 1 }],
        clear: 'El Lazarillo falls. The compound channel goes dark.'
      }
    ]
  },
  'grimes-firebase': {
    id: 'grimes-firebase',
    title: 'NO MORE DRILLS',
    desc: 'Breach the 6th Street firebase, cut through its guard detail, and shut down Corporal Grimes’s command bunker.',
    minLevel: 7,
    cooldownSec: 2700,
    rewardEddies: 900,
    rewardXp: 520,
    rewardRep: 65,
    rooms: [
      {
        name: 'Ammo Depot',
        desc: 'Crates are stacked into firing lanes beneath a faded flag. The firebase guard detail opens up as soon as the alarm trips.',
        enemies: [{ id: 'sixthstreet-1', count: 1 }, { id: 'sixthstreet-2', count: 1 }],
        clear: 'The blast door unlocks. Grimes is calling the shots from the bunker.'
      },
      {
        name: 'Command Bunker',
        desc: 'Maps and spent casings cover the walls. Corporal Grimes shoulders an Achilles rifle and barks one last order.',
        enemies: [{ id: 'sixthstreet-boss', count: 1 }],
        clear: 'Grimes is down. The firebase command net falls silent.'
      }
    ]
  },
  'bad-fish-nest': {
    id: 'bad-fish-nest',
    title: 'BAD FISH IN THE NEST',
    desc: 'Rogue’s contract sends you into the abandoned resort. Clear the security checkpoint and stop the cyberpsycho in the penthouse.',
    minLevel: 8,
    cooldownSec: 3600,
    rewardEddies: 1600,
    rewardXp: 900,
    rewardRep: 120,
    requiredGigId: 'gig-bad-fish',
    rewardsFromGig: true,
    rooms: [
      {
        name: 'Resort Security Checkpoint',
        desc: 'A security shutter hangs crooked above a drowned reception desk. An Arasaka contractor blocks the stairwell to the penthouse.',
        enemies: [{ id: 'arasaka-sec-1', count: 1 }],
        clear: 'The penthouse lift wakes up. The cyberpsycho is just above you.'
      },
      {
        name: 'Penthouse Nest',
        desc: 'Chrome scars the walls beneath a chandelier of broken implants. GLITCH turns toward you, mantis blades already singing.',
        enemies: [{ id: 'cyberpsycho', count: 1, questTargetId: 'cyberpsycho' }],
        clear: 'GLITCH collapses. The penthouse finally falls quiet.'
      }
    ]
  }
}

export function specialMissionView (player, now, activeRun = null) {
  player.specialMissions ??= {}
  return Object.values(SPECIAL_MISSIONS).map(mission => {
    const record = player.specialMissions[mission.id]
    let status = 'available'
    let progress = null
    if (activeRun?.missionId === mission.id) {
      status = activeRun.completed ? 'completed' : 'active'
      progress = { room: activeRun.roomIndex + 1, total: mission.rooms.length }
    } else if (record?.availableAt > now) status = 'cooldown'
    else if (mission.requiredGigId) {
      const contract = player.quests?.[mission.requiredGigId]
      if (!contract?.acceptedAt) status = 'needs-contract'
    }
    const rewardLevel = activeRun?.missionId === mission.id ? activeRun.playerLevel : player.level
    const rewards = rewardMultiplier(rewardLevel, mission.minLevel)
    const contractPaid = mission.rewardsFromGig && !!player.quests?.[mission.requiredGigId]?.completedAt
    return {
      id: mission.id,
      title: mission.title,
      desc: mission.desc,
      minLevel: mission.minLevel,
      rewardEddies: contractPaid ? 0 : Math.round(mission.rewardEddies * rewards),
      rewardXp: contractPaid ? 0 : Math.round(mission.rewardXp * rewards),
      rewardRep: contractPaid ? 0 : Math.round(mission.rewardRep * rewards),
      replayOnly: contractPaid,
      status,
      progress,
      cooldownMs: status === 'cooldown' ? record.availableAt - now : 0
    }
  })
}

export function createSpecialRun (missionId, accountId, entryRoom, enemyDefs, playerLevel = null) {
  const mission = SPECIAL_MISSIONS[missionId]
  if (!mission) return null
  playerLevel ??= mission.minLevel
  const scaleBy = levelDelta(playerLevel, mission.minLevel)
  const id = crypto.randomUUID()
  const roomIds = mission.rooms.map((_, i) => `special:${id}:${i}`)
  const run = {
    id,
    missionId,
    accountId,
    playerLevel,
    scaleBy,
    entryRoom,
    roomIds,
    roomIndex: 0,
    completed: false,
    rooms: new Map(),
    enemyIds: []
  }

  mission.rooms.forEach((template, i) => {
    const roomId = roomIds[i]
    const exits = {}
    if (i === 0) exits.w = entryRoom
    else exits.w = roomIds[i - 1]
    if (i < roomIds.length - 1) exits.e = roomIds[i + 1]
    run.rooms.set(roomId, {
      id: roomId,
      name: template.name,
      district: 'watson',
      category: 'industrial',
      danger: true,
      desc: template.desc,
      exits,
      objects: [],
      specialMission: mission.id,
      specialRoomIndex: i
    })

    for (const group of template.enemies) {
      const source = enemyDefs[group.id]
      if (!source) throw new Error(`Special Mission ${mission.id} references unknown NPC ${group.id}`)
      for (let n = 0; n < group.count; n++) {
        const enemyId = `special:${id}:enemy:${i}:${group.id}:${n}`
        const overrides = { ...group }
        delete overrides.id
        delete overrides.count
        delete overrides.questTargetId
        const def = { ...source, ...overrides, id: enemyId }
        if (scaleBy) {
          def.level += scaleBy
          def.armor = (def.armor ?? 0) + Math.floor(scaleBy / 3)
          def.stats = Object.fromEntries(Object.entries(def.stats ?? {}).map(([attr, value]) => [attr, value + Math.floor(scaleBy / 4)]))
        }
        run.enemyIds.push({ id: enemyId, roomId, def, questTargetId: group.questTargetId ?? null })
      }
    }
  })

  return run
}

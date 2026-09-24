import { perkEffects } from './classes.js'
import { rewardMultiplier } from './scaling.js'

export const GIGS = {
  'gig-scavdawgs': {
    id: 'gig-scavdawgs', title: 'Dead Scav-Dogs', fixer: 'wakako',
    desc: 'A pack of scav-biters is nesting in the Watson warehouse district conduit squats. Bold now they are. Wakako wants them apologized out of existence.',
    targets: ['scav-1', 'scav-2'],
    rewardEddies: 180, rewardXp: 120, rep: 20, cooldownSec: 1200, minLevel: 1
  },
  'gig-valentino-dust': {
    id: 'gig-valentino-dust', title: 'Valentino Blood In, Blood Out', fixer: 'padre',
    desc: 'A pair of Valentino pistoleros have been shaking down Padre\'s parishioners. He asks, in his gentle way, for you to introduce them to accountability.',
    targets: ['valentino-2', 'valentino-1'],
    rewardEddies: 350, rewardXp: 200, rep: 35, cooldownSec: 1500, minLevel: 2
  },
  'gig-wraith-dust': {
    id: 'gig-wraith-dust', title: 'Wraith Dust', fixer: 'dakota',
    desc: 'Wraiths are stripping salvage convoys along the interchange. Dakota\'s burned through patience and a pallet of fuel chasing them. She pays in eddies.',
    targets: ['raider-1', 'raider-2'],
    rewardEddies: 260, rewardXp: 160, rep: 30, cooldownSec: 1200, minLevel: 1
  },
  'gig-sixthstreet-heat': {
    id: 'gig-sixthstreet-heat', title: 'Sixth Street Heat', fixer: 'el-capitan',
    desc: '6th Street jingo squads keep taxing Arteria deliveries. El Capitán hates taxes and patriots equally. Remove two of the loud ones.',
    targets: ['sixthstreet-1', 'sixthstreet-2'],
    rewardEddies: 500, rewardXp: 280, rep: 40, cooldownSec: 1500, minLevel: 3
  },
  'gig-bad-fish': {
    id: 'gig-bad-fish', title: 'Bad Fish in the Nest', fixer: 'rog',
    desc: 'A cyberpsycho has holed up in the Pacifica resort penthouse. NCPD is pretending it isn\'t happening. Rogue says it\'s happening and there\'s a payout. The kind of payout that lets you sleep with the lights off.',
    targets: ['cyberpsycho'],
    rewardEddies: 1600, rewardXp: 900, rep: 120, cooldownSec: 3600, minLevel: 8
  }
}

export const FIXERS = ['wakako', 'padre', 'rog', 'dakota', 'el-capitan']

export function gigsForFixer (fixerId) {
  return Object.values(GIGS).filter(g => g.fixer === fixerId)
}

export function acceptGig (p, gigId, now) {
  const gig = GIGS[gigId]
  if (!gig) return { error: 'gig not found' }
  p.quests ??= {}
  const rec = p.quests[gigId]
  if (rec?.completedAt) return { error: 'You already completed this gig.' }
  if ((p.level || 1) < gig.minLevel) return { error: `You need level ${gig.minLevel} for this job.` }
  if (rec && rec.availableAt > now) return { error: `Still cold. Cooldown: ${Math.ceil((rec.availableAt - now) / 60000)} min.` }
  if (rec && !rec.completedAt) return { error: 'You already have this gig active.' }
  p.quests[gigId] = { acceptedAt: now, prog: {} }
  return { ok: true, gig }
}

export function handleKill (p, npcId, now) {
  p.quests ??= {}
  const results = []
  for (const [gigId, rec] of Object.entries(p.quests)) {
    if (!rec || rec.completedAt) continue
    const gig = GIGS[gigId]
    if (!gig) continue
    if (gig.targets.includes(npcId)) rec.prog[npcId] = true
    const done = gig.targets.every(t => rec.prog[t])
    if (done) {
      rec.completedAt = now
      rec.completed = gigId
      rec.availableAt = now + gig.cooldownSec * 1000
      const rewards = scaledGigRewards(p, gig)
      p.eddies += rewards.rewardEddies
      p.rep += rewards.rep
      p.stats.gigs_done = (p.stats.gigs_done || 0) + 1
      results.push({ ...gig, ...rewards })
    }
  }
  return results
}

export function gigListView (p, now) {
  p.quests ??= {}
  const out = []
  for (const gig of Object.values(GIGS)) {
    const rec = p.quests[gig.id]
    if (rec?.completedAt) continue
    let status = 'available'
    if (rec) {
      if (rec.completedAt) status = now < rec.availableAt ? 'cooldown' : 'available'
      else status = 'active'
    }
    const prog = rec && !rec.completedAt ? gig.targets.filter(t => rec.prog[t]).length : 0
    out.push({
      id: gig.id,
      title: gig.title,
      fixer: gig.fixer,
      desc: gig.desc,
      status,
      prog,
      total: gig.targets.length,
      ...scaledGigRewards(p, gig),
      minLevel: gig.minLevel
    })
  }
  return out
}

function scaledGigRewards (player, gig) {
  const scale = rewardMultiplier(player.level, gig.minLevel)
  const eddiesPct = perkEffects(player).eddiesPct ?? 0
  return {
    rewardEddies: Math.round(gig.rewardEddies * scale * (1 + eddiesPct / 100)),
    rewardXp: Math.round(gig.rewardXp * scale),
    rep: Math.round(gig.rep * scale)
  }
}

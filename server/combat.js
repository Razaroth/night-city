import { getItemDef } from './items.js'
import { computeStats, equippedWeapon } from './player.js'

export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

function governingStat (p, skill) {
  const a = p.attrs
  const skills = {
    body: 'body', reflexes: 'reflexes', blades: 'reflexes', smg: 'reflexes', shotguns: 'reflexes',
    rifles: 'reflexes', sniper: 'reflexes', intelligence: 'intel', smart: 'intel',
    quickhacking: 'intel', projectiles: 'intel', cool: 'cool', tech: 'tech'
  }
  const key = skills[skill] || 'reflexes'
  return a[key]
}

function hitChance (attr, level, evasion, windMod = 0) {
  let c = 0.6 + 0.025 * attr + 0.012 * level - evasion + windMod
  return Math.max(0.12, Math.min(0.95, c))
}

export function weaponDamage (p, wepDef, eff, opts = {}) {
  const attr = governingStat(p, wepDef.skill)
  const base = rand(wepDef.dmg[0], wepDef.dmg[1])
  let dmg = base + Math.floor(attr * 0.8) + Math.floor((p.level || 1) * 0.7)
  if (opts.berserk) dmg = Math.floor(dmg * 1.35)
  return dmg
}

function applyDamageTo (target, amount, eff, opts = {}) {
  const res = { taken: 0, crit: false, dodged: false, resisted: 0 }
  let dr = opts.dr ?? 0
  if (opts.chromeBreak) dr = Math.max(0, dr - 12)
  if (opts.defending) dr += 8
  if (opts.pen) dr = dr * (1 - opts.pen)
  let resist = Math.floor(dr)
  if (opts.ice && opts.dmgKind === 'hack') {
    const red = Math.floor(opts.ice / 100 * amount)
    res.resisted = red
  }
  if (opts.defendingPercent) amount = Math.floor(amount * (1 - opts.defendingPercent))
  let taken = Math.max(1, amount - resist)
  if (opts.crit) taken = Math.floor(taken * 1.5)
  if (opts.dmgKind === 'dot') taken = Math.max(1, taken - Math.floor(dr * 0.5))
  target.hp = Math.max(0, target.hp - taken)
  res.taken = taken
  res.crit = !!opts.crit
  return res
}

/* ---------------- player attacks ---------------- */

export function playerAttack (p, target, now, eff) {
  const wepSt = equippedWeapon(p)
  const wep = wepSt ? getItemDef(wepSt.id) : null
  if (!wep) return { error: 'You have no weapon in hand.' }
  if (wep.class === 'smart' && !eff.hasSmartLink) return { error: `${wep.name} requires a Smart Link to aim.` }
  if (now < (p.attackAt || 0)) {
    return { cooldown: true, remaining: Math.ceil(((p.attackAt || 0) - now) / 100) / 10 }
  }
  const speed = Math.max(260, Math.floor(wep.speed * (1 - (eff.haste + (p.buff?.sandevistan ? 25 : 0)) / 100)))
  p.attackAt = now + speed

  const attr = governingStat(p, wep.skill)
  const evasion = (target.def.stats.reflexes * 0.014) + target.def.level * 0.012
  const dodgeBonus = (p.buff?.dodgeUntil && now < p.buff.dodgeUntil) ? 0.35 : 0
  const chance = hitChance(attr, p.level, Math.min(0.4, evasion + (target.statuses.some(s => s.kind === 'stun') ? 0.2 : 0) - dodgeBonus))
  if (Math.random() > chance) {
    return { miss: true, desc: `You swing the ${wep.name}, and ${target.def.name} ducks it clean.` }
  }
  const critRoll = Math.random() < clamp01((wep.crit || 0) / 100 + eff.crit / 100 + attr * 0.004)
  const winds = now < (p.buff?.berserkUntil) ? 1.25 : 1
  const dmg = Math.floor(weaponDamage(p, wep, eff) * winds)
  const res = applyDamageTo(target, dmg, { dr: target.def.armor, pen: wep.pen + eff.pen, crit: critRoll, defending: target.buff?.defendUntil > now ? true : false })
  return { hit: true, crit: res.crit, dmg: res.taken, desc: `You ${wep.class === 'melee' || wep.class === 'blunt' || wep.class === 'brawling' ? 'strike' : 'fire your'} ${wep.name} at ${target.def.name} for [B]${res.taken}[/B] damage${res.crit ? ' — critical hit!' : ''}.` }
}

export function playerQuickhack (p, target, qhDef, now, eff, roomList) {
  if (!eff.hasDeck) return { error: 'You need a Netrunner deck to run quickhacks.' }
  if (now < (p.hackAt || 0)) return { cooldown: true }
  if ((p.ram || 0) < qhDef.ram) return { error: `Not enough RAM. ${qhDef.name} needs ${qhDef.ram} RAM.` }
  p.ram -= qhDef.ram
  p.hackAt = now + 1800
  const attr = governingStat(p, 'quickhacking')
  const resist = target.statuses.some(s => s.kind === 'ice') ? 0.3 : 0
  const chance = hitChance(attr, p.level, 0.12 + target.def.level * 0.01, 0.1) - resist
  p.stats.hacks = (p.stats.hacks || 0) + 1
  if (Math.random() > chance) {
    return { miss: true, desc: `${target.def.name} ICE burps and shrugs off the ${qhDef.name}.` }
  }
  const dmg = weaponDamage(p, qhDef, eff) + rand(0, 4)
  const res = applyDamageTo(target, dmg, { dr: target.def.armor * 0.35, ice: eff.ice, dmgKind: 'hack', crit: Math.random() < 0.1 })
  const effects = []
  if (qhDef.burn && target.alive) { target.statuses.push({ kind: 'burn', until: now + 6000, perTick: qhDef.burn.perTick, ticks: qhDef.burn.ticks }); effects.push('a burn') }
  if (qhDef.poison && target.alive) { target.statuses.push({ kind: 'poison', until: now + 9000, perTick: qhDef.poison.perTick, ticks: qhDef.poison.ticks }); effects.push('contagion') }
  if (qhDef.stunChance && target.alive) {
    if (Math.random() < qhDef.stunChance) { target.statuses.push({ kind: 'stun', until: now + 4000 }); effects.push('a stun lock') }
  }
  if (qhDef.chromeBreak && target.alive) { target.statuses.push({ kind: 'chromeBreak', until: now + 8000 }); effects.push('chrome seizure') }
  if (qhDef.id === 'memory-wipe') { target.threat = {}; effects.length === 0 && effects.push('a full memory wipe') }
  return {
    hit: true,
    dmg: res.taken,
    desc: `You run ${qhDef.name} on ${target.def.name} for [B]${res.taken}[/B] damage${effects.length ? ' causing ' + effects.join(' and ') : ''}${res.resisted ? ` (self-ICE negated ${res.resisted})` : ''}.`
  }
}

export function playerGrenade (p, qhList, roomHostiles, now) {
  const qh = qhList[0]
  if (!qh) return { error: 'No grenade in flight trajectory.' }
  if (now < (p.grenadeAt || 0)) return { cooldown: true }
  p.grenadeAt = now + 1000
  const lines = []
  let stuns = 0
  for (const inst of roomHostiles) {
    const taken = rand(qh.dmg[0] * 0.8, qh.dmg[1]) - Math.floor(inst.def.armor * 0.25)
    inst.hp = Math.max(0, inst.hp - taken)
    lines.push(`${inst.def.name} takes [B]${taken}[/B] from the blast.`)
    if (qh.burn) inst.statuses.push({ kind: 'burn', until: now + 5000, perTick: qh.burn.perTick, ticks: qh.burn.ticks })
    if (qh.stunChance && Math.random() < qh.stunChance) { inst.statuses.push({ kind: 'stun', until: now + 3500 }); stuns++ }
  }
  return { desc: `You lob a ${qh.name} into the room. ${lines.join(' ')}${stuns ? ` ${stuns} target${stuns > 1 ? 's' : ''} stunned.` : ''}` }
}

/* ---------------- enemy AI ---------------- */

export function enemyAttack (inst, target, now) {
  const wep = getItemDef(inst.def.weapon) || getItemDef('fists')
  if (now < (inst.attackAt || 0)) return null
  const enraged = inst.def.danger === 'boss' && inst.hp < inst.maxhp * 0.4
  let speed = wep.speed * (enraged ? 0.7 : 1)
  speed = Math.max(300, speed)
  inst.attackAt = now + speed
  const eff = computeStats(target)
  const evasion = 0.08 + eff.dodge / 100 + (target.buff?.dodgeUntil && now < target.buff.dodgeUntil ? 0.6 : 0)
  const chance = hitChance((inst.def.stats[governingStat(target, wep.skill)] || 6), inst.def.level, Math.min(0.55, evasion))
  target.stam = Math.max(0, target.stam - 1)
  if (Math.random() > chance) {
    return { desc: `${inst.def.name} swings at you — you slip out of the way.` }
  }
  let dmg = rand(wep.dmg[0], wep.dmg[1]) + Math.floor(inst.def.level * 0.9)
  if (enraged) dmg = Math.floor(dmg * 1.4)
  const crit = Math.random() < (wep.crit || 0) / 100 + inst.def.level * 0.004
  const res = applyDamageTo(target, dmg, { dr: eff.dr, pen: wep.pen || 0, crit, defending: target.buff?.defendUntil && now < target.buff.defendUntil, defendingPercent: target.buff?.defendUntil && now < target.buff.defendUntil ? 0.4 : 0 })
  target.lastHitAt = now
  target.hp = Math.max(0, target.hp)
  return { desc: `${inst.def.name} hits you for [B]${res.taken}[/B] damage${res.crit ? ' — brutal crit!' : ''}.`, dmg: res.taken, crit: res.crit }
}

function clamp01 (x) { return Math.max(0, Math.min(1, x)) }

/* ---------------- status ticks ---------------- */

export function tickEnemyStatuses (inst, now) {
  const out = []
  for (const s of [...inst.statuses]) {
    if (now >= s.until) { inst.statuses = inst.statuses.filter(x => x !== s); continue }
    if (s.kind === 'burn' || s.kind === 'poison') {
      inst.hp = Math.max(0, inst.hp - s.perTick)
      out.push(`${inst.def.name} suffers ${s.perTick} from ${s.kind}.`)
    }
  }
  return out
}

export function isEnemyStunned (inst, now) {
  return inst.statuses.some(s => (s.kind === 'stun') && now < s.until)
}

export function weaponCooldownRemaining (p, now) {
  const wepSt = equippedWeapon(p)
  const wep = wepSt ? getItemDef(wepSt.id) : null
  if (!wep) return 0
  const eff = computeStats(p)
  const speed = Math.max(260, Math.floor(wep.speed * (1 - (eff.haste + (p.buff?.sandevistan ? 25 : 0)) / 100)))
  const at = p.attackAt || 0
  return Math.max(0, at - now) / speed
}
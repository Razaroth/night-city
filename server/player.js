import crypto from 'node:crypto'
import { getItemDef, makeStack, maxStack, canStack, describeStack } from './items.js'
import { CLASSES, perkEffects } from './classes.js'

export const ATTRS = ['body', 'reflexes', 'tech', 'intel', 'cool']
export const ATTR_LABELS = { body: 'BODY', reflexes: 'REFLEXES', tech: 'TECH', intel: 'INTELLIGENCE', cool: 'COOL' }
export const ATTR_FLAVOR = {
  body: 'Meaty, hydraulic, and emphatic.',
  reflexes: 'Nerves like a drunk carpenter.',
  tech: 'Gremlins who know where the screws go.',
  intel: 'Netting up old brains and new lies.',
  cool: 'Ice-blooded. Unbothered. Unscarred. Mostly.'
}

export const LIFEPATHS = {
  corpo: {
    id: 'corpo', name: 'Corpo', color: '#ffd24a', attrBonus: 'intel', attrBonusVal: 1,
    startRoom: 'downtown', eddies: 1400, weapon: 'lexington', apparel: 'jacket-clean',
    desc: 'You climbed the glass towers eating lunches made of other people\'s careers. Then the severance package arrived—by way of a security escort and a severed chit.'
  },
  streetkid: {
    id: 'streetkid', name: 'Street Kid', color: '#29f2c3', attrBonus: 'cool', attrBonusVal: 1,
    startRoom: 'megabuilding-h10', eddies: 500, weapon: 'unity', apparel: 'jacket-street',
    desc: 'Raised in the streets of Watson like a weed through cracked concrete. You know who runs what, who owes who, and which alleys have teeth.'
  },
  nomad: {
    id: 'nomad', name: 'Nomad', color: '#e0b06a', attrBonus: 'body', attrBonusVal: 1,
    startRoom: 'nomad-camp', eddies: 800, weapon: 'unity', apparel: 'jacket-nomad',
    desc: 'Born to the open road and the sound of engines. The clan code is in your blood, but the city\'s neon called—and so did its money.'
  }
}

export const STYLES = {
  neokitsch: { id: 'neokitsch', name: 'Neo-Kitsch', desc: 'Boldly retro. You wear last century like a fashion statement.' },
  entropism: { id: 'entropism', name: 'Entropism', desc: 'Brutalist leftovers and honest grime. Style that survives apocalypses.' },
  militaria: { id: 'militaria', name: 'Militarism', desc: 'Tactical gear, harnesses, and the subtle fragrance of excess munitions.' },
  kitsch: { id: 'kitsch', name: 'Kitsch', desc: 'Saturated, maximal, unapologetic. You light up a room like a warning sign.' }
}

export const BASE_POINTS = 8
const ATTR_MIN = 3
const ATTR_MAX_CREATE = 9

export function xpToNext (level) {
  return Math.floor(100 * Math.pow(level, 1.4))
}

export function makeNewPlayer (accountId, opts) {
  const lifepath = LIFEPATHS[opts.lifepath]
  const lpBonus = lifepath.attrBonus
  const cls = CLASSES[opts.cls] ? opts.cls : 'solo'
  const attrs = { body: 3, reflexes: 3, tech: 3, intel: 3, cool: 3 }
  for (const a of ATTRS) {
    const v = opts.attrs[a]
    if (typeof v !== 'number') continue
    attrs[a] = Math.max(ATTR_MIN, Math.min(ATTR_MAX_CREATE, v))
  }
  attrs[lpBonus] = Math.min(ATTR_MAX_CREATE, attrs[lpBonus] + lifepath.attrBonusVal)

  const p = {
    accountId,
    name: opts.name,
    cls,
    lifepath: opts.lifepath,
    style: opts.style in STYLES ? opts.style : 'entropism',
    attrs,
    xp: 0,
    level: 1,
    attrPoints: 0,
    perks: [],
    perkPoints: 0,
    eddies: lifepath.eddies,
    rep: 0,
    room: lifepath.startRoom,
    alive: true,
    hp: 0,
    stam: 0,
    inv: [],
    equip: {},
    cyberware: {},
    quickhacks: [],
    created_at: Date.now(),
    played_sec: 0,
    stats: { kills: 0, deaths: 0, gigs_done: 0, hacks: 0, breaches: 0 },
    flags: {},
    log: []
  }

  // starting gear
  const wSt = makeStack(lifepath.weapon)
  p.inv.push(wSt)
  p.equip.hands = wSt
  const aSt = makeStack(lifepath.apparel)
  p.inv.push(aSt)
  p.equip.chest = aSt
  p.inv.push(makeStack('bounce-back', 2))
  p.inv.push(makeStack('stimpack', 3))
  p.inv.push(makeStack('frag', 1))

  const eff = computeStats(p)
  p.hp = eff.maxHp
  p.stam = eff.maxStam
  return p
}

function isEquippedUid (p, uid) {
  for (const s of Object.values(p.equip)) if (s && s.uid === uid) return true
  return false
}

export function carriedWeight (p, { exclude = null } = {}) {
  let w = 0
  for (const st of p.inv) {
    if (exclude && st.uid === exclude) {
      const d = getItemDef(st.id)
      w += (d?.weight ?? 0) * Math.max(0, st.qty - 1)
      continue
    }
    w += (getItemDef(st.id)?.weight ?? 0) * st.qty
  }
  return Math.round(w * 10) / 10
}

export function carryCapacity (p, eff) {
  const s = eff ?? computeStats(p)
  return s.capacity + 40 + (s.carryBonus || 0)
}

/* ---------- cyberware aggregation ---------- */
export function computeStats (p) {
  const a = p.attrs
  const level = p.level || 1
  const eff = {
    maxHp: 40 + a.body * 12 + (level - 1) * 6,
    maxStam: 30 + a.body * 3 + (level - 1) * 2,
    maxRam: Math.min(12, 2 + a.intel),
    dr: 0,
    crit: 0,
    dodge: 0,
    haste: 0,
    capacity: 4 + Math.floor(level / 2),
    ice: 0,
    pen: 0,
    ramBonus: 0,
    humanity: 100,
    hasDeck: false,
    hasSmartLink: false,
    sandevistan: false,
    berserk: false,
    secondHeart: false,
    biomonitor: false,
    weaponDmgPct: 0,
    lowHpDmgPct: 0,
    fullStamDmgPct: 0,
    grenadePct: 0,
    hackDmgPct: 0,
    hackCrit: 0,
    hackCdPct: 0,
    healPct: 0,
    eddiesPct: 0,
    regenHpPct: 0,
    ramRatePct: 0,
    carryBonus: 0
  }
  for (const st of Object.values(p.cyberware)) {
    const d = getItemDef(st?.id)
    if (!d) continue
    eff.humanity += d.humanity ?? 0
    if (d.effect === 'ram') eff.ramBonus += d.effectValue
    if (d.effect === 'dr') eff.dr += d.effectValue
    if (d.effect === 'crit') eff.crit += d.effectValue
    if (d.effect === 'dodge') eff.dodge += d.effectValue
    if (d.effect === 'hastreg' || d.effect === 'hast') eff.haste += d.effectValue
    if (d.effect === 'capacity') eff.capacity += d.effectValue
    if (d.effect === 'ice') eff.ice += d.effectValue
    if (d.effect === 'pen') eff.pen += d.effectValue
    if (d.effect === 'smart') eff.hasSmartLink = true
    if (d.effect === 'sandevistan') eff.sandevistan = true
    if (d.effect === 'berserk') eff.berserk = true
    if (d.effect === 'secondheart') eff.secondHeart = true
    if (d.effect === 'biomonitor') eff.biomonitor = true
    if (d.slot === 'deck' && d.effect === 'ram') eff.hasDeck = true
  }
  if (eff.hasDeck) eff.maxRam += eff.ramBonus
  // class perks
  const pk = perkEffects(p)
  eff.dodge += pk.dodge ?? 0
  eff.crit += pk.crit ?? 0
  eff.dr += pk.dr ?? 0
  eff.maxHp += pk.maxHp ?? 0
  eff.maxStam += pk.maxStam ?? 0
  eff.maxRam += pk.maxRam ?? 0
  eff.capacity += pk.capacity ?? 0
  eff.ice += pk.ice ?? 0
  eff.pen += pk.pen ?? 0
  eff.humanity += pk.humanity ?? 0
  eff.haste += pk.haste ?? 0
  eff.weaponDmgPct = pk.weaponDmgPct ?? 0
  eff.lowHpDmgPct = pk.lowHpDmgPct ?? 0
  eff.fullStamDmgPct = pk.fullStamDmgPct ?? 0
  eff.grenadePct = pk.grenadePct ?? 0
  eff.hackDmgPct = pk.hackDmgPct ?? 0
  eff.hackCrit = pk.hackCrit ?? 0
  eff.hackCdPct = pk.hackCdPct ?? 0
  eff.healPct = pk.healPct ?? 0
  eff.eddiesPct = pk.eddiesPct ?? 0
  eff.regenHpPct = pk.regenHpPct ?? 0
  eff.ramRatePct = pk.ramRatePct ?? 0
  eff.carryBonus = pk.carryBonus ?? 0
  // apparel
  for (const st of Object.values(p.equip)) {
    const d = getItemDef(st?.id)
    if (!d) continue
    if (d.category === 'apparel') eff.dr += d.armor ?? 0
    if (d.category === 'weapons') eff.smartNeeded = eff.smartNeeded || d.class === 'smart'
  }
  return eff
}

export function equippedWeapon (p) {
  const st = p.equip.arms || p.equip.hands
  return st ?? null
}

export function cyberwareCapacityUsed (p) {
  let used = 0
  for (const st of Object.values(p.cyberware)) {
    const d = getItemDef(st?.id)
    if (d) used += d.capacity ?? 0
  }
  return used
}

/* ---------- inventory ---------- */
export function findStack (p, uid) {
  return p.inv.find(s => s.uid === uid)
}

export function addToInv (p, defId, qty = 1) {
  if (canStack(defId)) {
    const existing = p.inv.find(s => s.id === defId)
    if (existing) {
      existing.qty += qty
      return existing
    }
  }
  const st = makeStack(defId, qty)
  p.inv.push(st)
  return st
}

export function removeFromInv (p, uid, qty = 1) {
  const st = findStack(p, uid)
  if (!st) return false
  const removedAny = isEquippedUid(p, uid)
  if (st.qty > qty) {
    st.qty -= qty
    return !removedAny
  }
  // remove entirely
  const idx = p.inv.indexOf(st)
  p.inv.splice(idx, 1)
  for (const slot of Object.keys(p.equip)) if (p.equip[slot]?.uid === uid) delete p.equip[slot]
  for (const slot of Object.keys(p.cyberware)) if (p.cyberware[slot]?.uid === uid) delete p.cyberware[slot]
  return true
}

export function dropStackCount (p, uid, qty) {
  const st = findStack(p, uid)
  if (!st) return null
  if (isEquippedUid(p, uid) && st.qty <= qty) return null
  const out = makeStack(st.id, Math.min(qty, st.qty))
  removeFromInv(p, uid, out.qty)
  return out
}

export function describeInventory (p) {
  return p.inv.map(describeStack)
}

export function describeEquipment (p) {
  const out = {}
  for (const [slot, st] of Object.entries(p.equip)) {
    if (!st) continue
    out[slot] = { slot, ...describeStack(st) }
  }
  return out
}

export function describeCyberware (p) {
  const out = []
  for (const st of Object.values(p.cyberware)) {
    if (!st) continue
    out.push({ slot: st.slot, ...describeStack(st) })
  }
  return out
}

/* ---------- xp / level ---------- */
export function addXp (p, amount) {
  p.xp += amount
  const levelsGained = []
  while (xpToNext(p.level) <= p.xp) {
    p.xp -= xpToNext(p.level)
    p.level += 1
    p.attrPoints = (p.attrPoints || 0) + 1
    p.perkPoints = (p.perkPoints || 0) + 1
    const eff = computeStats(p)
    p.hp = eff.maxHp
    p.stam = eff.maxStam
    levelsGained.push(p.level)
  }
  return levelsGained
}

export function stateForClient (p) {
  const eff = computeStats(p)
  return {
    name: p.name,
    cls: p.cls ?? 'solo',
    className: CLASSES[p.cls]?.name ?? 'Solo',
    lifepath: p.lifepath,
    lifepathName: LIFEPATHS[p.lifepath]?.name ?? '—',
    style: p.style,
    level: p.level,
    attrPoints: p.attrPoints ?? 0,
    perkPoints: p.perkPoints ?? 0,
    perks: p.perks ?? [],
    xp: p.xp,
    xpToNext: xpToNext(p.level),
    eddies: p.eddies,
    rep: p.rep,
    attrs: p.attrs,
    hp: Math.max(0, Math.floor(p.hp)),
    maxHp: eff.maxHp,
    stam: Math.max(0, Math.floor(p.stam)),
    maxStam: eff.maxStam,
    ram: Math.max(0, Math.floor(p.ram ?? eff.maxRam)),
    maxRam: eff.maxRam,
    dr: eff.dr,
    crit: eff.crit,
    dodge: eff.dodge,
    capacity: eff.capacity,
    capacityUsed: cyberwareCapacityUsed(p),
    humanity: Math.max(0, eff.humanity),
    hasDeck: eff.hasDeck,
    alive: p.alive,
    kills: p.stats.kills,
    deaths: p.stats.deaths,
    gigs_done: p.stats.gigs_done ?? 0,
    hacks: p.stats.hacks ?? 0,
    breaches: p.stats.breaches ?? 0,
    weight: carriedWeight(p),
    carryCap: carryCapacity(p, eff)
  }
}

const PERSISTED = ['name', 'cls', 'lifepath', 'style', 'attrs', 'xp', 'level', 'attrPoints', 'perks', 'perkPoints', 'eddies', 'rep', 'room', 'hp', 'stam', 'inv', 'equip', 'cyberware', 'quickhacks', 'created_at', 'played_sec', 'stats', 'flags', 'quests']

export function serializePlayer (p) {
  const out = {}
  for (const k of PERSISTED) if (p[k] !== undefined) out[k] = p[k]
  return out
}

export function hydratePlayer (saved, accountId) {
  const p = { accountId, ...saved }
  p.inv ??= []
  p.equip ??= {}
  p.cyberware ??= {}
  p.quickhacks ??= []
  p.stats ??= { kills: 0, deaths: 0, gigs_done: 0, hacks: 0, breaches: 0 }
  p.flags ??= {}
  p.quests ??= {}
  p.attrs ??= { body: 3, reflexes: 3, tech: 3, intel: 3, cool: 3 }
  p.cls ??= 'solo'
  p.perks ??= []
  p.perkPoints ??= 0
  p.played_sec ??= 0
  p.attrPoints ??= 0
  const eff = computeStats(p)
  p.alive = true
  p.hp = Math.min(eff.maxHp, Math.max(1, p.hp ?? eff.maxHp))
  p.stam = eff.maxStam
  p.ram = eff.maxRam
  p.attackAt = 0
  p.hackAt = 0
  p.grenadeAt = 0
  p.lastHitAt = 0
  p.buff = {}
  p.pendingRespawnAt = 0
  return p
}
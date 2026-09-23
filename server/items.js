import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ITEMS_PATH = path.join(__dirname, '..', 'data', 'items.json')

const CATALOG = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'))

const byId = new Map()
for (const cat of ['weapons', 'cyberware', 'quickhacks', 'grenades', 'consumables', 'apparel', 'junk']) {
  for (const id of Object.keys(CATALOG[cat])) {
    const def = CATALOG[cat][id]
    def.category = cat
    byId.set(id, def)
  }
}

export function getItemDef (id) {
  return byId.get(id)
}

export function allItemDefs () {
  return [...byId.values()]
}

export function newUid () {
  return crypto.randomUUID()
}

export function maxStack (id) {
  const def = getItemDef(id)
  if (!def) return 1
  if (def.stacks) return def.stacks
  if (def.category === 'consumables' || def.category === 'grenades' || def.category === 'junk') return 99
  return 1
}

export function canStack (id) {
  return maxStack(id) > 1
}

export function isWeapon (id) {
  const d = getItemDef(id)
  return d && d.category === 'weapons'
}

export function isCyberware (id) {
  const d = getItemDef(id)
  return d && d.category === 'cyberware'
}

export function isQuickhack (id) {
  const d = getItemDef(id)
  return d && d.category === 'quickhacks'
}

export function isConsumable (id) {
  const d = getItemDef(id)
  return d && d.category === 'consumables'
}

export function isGrenade (id) {
  const d = getItemDef(id)
  return d && d.category === 'grenades'
}

export function isApparel (id) {
  const d = getItemDef(id)
  return d && d.category === 'apparel'
}

/* A "bound" item is a concrete copy in an inventory: {uid, id, qty} */
export function makeStack (id, qty = 1) {
  return { uid: newUid(), id, qty }
}

/* describe an inventory stack with stat summary for the client */
export function describeStack (stack) {
  const def = getItemDef(stack.id)
  return {
    uid: stack.uid,
    id: stack.id,
    name: def.name,
    icon: iconFor(stack.id),
    category: def.category,
    class: def.class ?? null,
    qty: stack.qty ?? 1,
    stackable: canStack(stack.id),
    value: def.value,
    weight: def.weight ?? 0,
    slot: def.slot ?? null,
    armor: def.armor ?? null,
    dmg: def.dmg ?? null,
    speed: def.speed ?? null,
    crit: def.crit ?? null,
    ram: def.ram ?? null,
    effect: def.effect ?? null,
    effectValue: def.effectValue ?? null,
    heal: def.heal ?? null,
    stamina: def.stamina ?? null,
    capacity: def.capacity ?? null,
    humanity: def.humanity ?? 0,
    desc: def.desc
  }
}

export function iconFor (id) {
  const d = getItemDef(id)
  if (!d) return '?'
  const glyphs = {
    power: ['U', 'L', 'Y', 'K', 'C', 'F'],
    smart: ['W', 'M'],
    melee: ['K', 'B', 'M'],
    blunt: ['|'],
    brawling: ['X'],
    quickhack: ['Q'],
    grenade: ['*'],
    consumable: ['+'],
    apparel: ['J'],
    cyberware: ['-'],
    junk: [';']
  }
  if (d.category === 'weapons') return glyphs[d.class]?.[0] ?? 'W'
  if (d.class === 'quickhack') return 'Q'
  if (d.category === 'const') return '+'
  return glyphs[d.category]?.[0] ?? '?'
}
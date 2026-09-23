import { getItemDef, describeStack, allItemDefs } from './items.js'
import * as P from './player.js'
import * as C from './combat.js'
import * as Q from './quests.js'
import { CLASSES, PERKS, TIER_REQUIREMENTS, classPerks } from './classes.js'
import { rooms, districts, HUB_ROOMS, EXIT_NAMES, npcDefs } from './world.js'

const DIRS = { n: 'n', s: 's', e: 'e', w: 'w', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw', up: 'up', down: 'down' }
const DIR_ALIAS = { north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', up: 'up', down: 'down' }

export function handleCommand (game, session, line) {
  const firstSpace = line.indexOf(' ')
  const verb = (firstSpace === -1 ? line : line.slice(0, firstSpace)).toLowerCase()
  const rest = firstSpace === -1 ? '' : line.slice(firstSpace + 1).trim()
  const p = session.player
  const now = game.now()

  // bare direction — `up`/`down` with an argument is the attribute command instead
  const dirKey = DIRS[verb] || DIR_ALIAS[verb]
  if (dirKey && !(rest && (verb === 'up' || verb === 'down'))) return game.move(session, dirKey)

  switch (verb) {
    case 'help': return cmdHelp(game, session)
    case 'look': case 'l': case 'examine': case 'exa': return cmdLook(game, session, rest)
    case 'go': case 'move': return game.move(session, DIRS[rest] || DIR_ALIAS[rest] || rest)
    case 'say': case '"': return cmdSay(game, session, rest)
    case 'shout': case 'yell': return cmdShout(game, session, rest)
    case 'emote': case 'me': return cmdEmote(game, session, rest)
    case 'who': return cmdWho(game, session)
    case 'stats': case 'stat': case 'char': case 'sheet': return cmdStats(game, session)
    case 'inv': case 'inventory': case 'i': return cmdInv(game, session)
    case 'equip': case 'wield': return cmdEquip(game, session, rest)
    case 'unequip': case 'remove': return cmdUnequip(game, session, rest)
    case 'use': case 'consume': return cmdUse(game, session, rest)
    case 'drop': return cmdDrop(game, session, rest)
    case 'take': case 'loot': case 'get': return game.lootCorpse(session)
    case 'attack': case 'a': case 'kill': case 'shoot': return cmdAttack(game, session, rest, now)
    case 'hack': case 'quickhack': case 'qh': return cmdHack(game, session, rest, now)
    case 'defend': case 'block': return cmdDefend(game, session, now)
    case 'dodge': return cmdDodge(game, session, now)
    case 'grenade': case 'nade': case 'throw': return cmdGrenade(game, session, rest, now)
    case 'sandevistan': case 'sandy': return cmdSandevistan(game, session, now)
    case 'berserk': return cmdBerserk(game, session, now)
    case 'shop': case 'store': return cmdShop(game, session, rest)
    case 'buy': case 'purchase': return cmdBuy(game, session, rest, now)
    case 'sell': return cmdSell(game, session, rest, now)
    case 'chrome': case 'cyberware': case 'implants': return cmdChrome(game, session)
    case 'install': case 'rip': return cmdInstall(game, session, rest)
    case 'uninstall': return cmdUninstall(game, session, rest)
    case 'jobs': case 'gigs': case 'job': return cmdJobs(game, session)
    case 'accept': case 'gig': return cmdAccept(game, session, rest, now)
    case 'up': case 'raise': return cmdUp(game, session, rest)
    case 'perk': case 'perks': case 'tree': return cmdPerks(game, session, rest)
    case 'travel': case 'fasttravel': case 'ft': return cmdTravel(game, session, rest, now)
    case 'talk': case 'speak': return cmdTalk(game, session, rest)
    case 'map': return cmdMap(game, session)
    case 'exits': return game.describeCurrentRoom(session)
    case 'weather': return game.log(session, game.weatherFor(p.room, now), 'sys')
    default:
      return game.log(session, `Unknown command: "${verb}". Type HELP.`, 'bad')
  }
}

/* ---------------- helpers ---------------- */
function findItem (game, session, query) {
  const p = session.player
  const q = query.toLowerCase()
  if (!q) return { none: true }
  const matches = p.inv.filter(s => {
    const d = getItemDef(s.id)
    return s.uid === query || s.id.toLowerCase() === q || (d && d.name.toLowerCase() === q) ||
      (d && d.name.toLowerCase().startsWith(q)) || (d && d.name.toLowerCase().includes(q))
  })
  if (!matches.length) return { none: true }
  return { stack: matches[0], multiple: matches.length > 1 }
}

function ripperHere (game, session) {
  const room = rooms[session.player.room]
  for (const id of room.npcs ?? []) if (npcDefs[id]?.kind === 'ripper') return npcDefs[id]
  return null
}

function vendorHere (game, session, query = '') {
  const room = rooms[session.player.room]
  const q = query.toLowerCase()
  for (const id of room.npcs ?? []) {
    const def = npcDefs[id]
    if (!def || !def.shop) continue
    if (!q || def.id.toLowerCase().includes(q) || def.name.toLowerCase().includes(q)) return { id, def }
  }
  return null
}

/* ---------------- commands ---------------- */
function cmdHelp (game, session) {
  const lines = [
    { text: '◈ NIGHT CITY — COMMAND REFERENCE', cls: 'level' },
    { text: 'MOVEMENT   n/s/e/w/ne/nw/se/sw/up/down, go <dir>, travel <district>', cls: 'sys' },
    { text: 'INFO       look [thing], stats, inv, chrome, map, who, weather', cls: 'sys' },
    { text: 'SOCIAL     say <text>, shout <text>, emote <text>, talk <npc>', cls: 'sys' },
    { text: 'COMBAT     attack <target>, hack <quickhack> <target>, defend, dodge', cls: 'sys' },
    { text: '           grenade <name>, sandevistan, berserk, take (loot corpse)', cls: 'sys' },
    { text: 'GEAR       equip <item>, unequip <slot>, use <item>, drop <item> [qty]', cls: 'sys' },
    { text: 'TRADE      shop, buy <item> [qty], sell <item> [qty], install <implant>', cls: 'sys' },
    { text: 'JOBS       jobs (at a fixer), accept <gigId>, up <attr> (spend level point)', cls: 'sys' },
    { text: 'CLASS      perks (view tree), perk <name> (spend a point)', cls: 'sys' },
    { text: 'Buttons on the right panel do all of this too. Stay chrome, choom.', cls: 'good' }
  ]
  game.logLines(session, lines)
}

function cmdLook (game, session, query) {
  if (!query) return game.describeCurrentRoom(session)
  const inst = game.npcInRoom(session, query)
  if (inst) {
    const lines = [{ text: `◈ ${inst.def.name} [${inst.def.faction}]`, cls: 'place' }, { text: inst.def.desc, cls: 'npc' }]
    if (inst.def.kind === 'hostile') lines.push({ text: `Threat level ${inst.def.level}. HP ${Math.round(inst.hp / inst.maxhp * 100)}%.`, cls: 'hostile' })
    if (inst.def.shop) lines.push({ text: 'They are willing to trade. (shop)', cls: 'good' })
    if (inst.def.kind === 'fixer') lines.push({ text: 'They hand out gigs. (jobs)', cls: 'good' })
    return game.logLines(session, lines)
  }
  const f = findItem(game, session, query)
  if (f.stack) {
    const d = describeStack(f.stack)
    const lines = [{ text: `◈ ${d.name}`, cls: 'place' }, { text: d.desc, cls: 'sys' }]
    if (d.dmg) lines.push({ text: `Damage ${d.dmg[0]}-${d.dmg[1]} • Speed ${d.speed}ms • Crit ${d.crit}% • ${d.skillName}`, cls: 'good' })
    if (d.armor) lines.push({ text: `Armor +${d.armor}`, cls: 'good' })
    if (d.capacity != null) lines.push({ text: `Capacity ${d.capacity} • Humanity ${d.humanity}`, cls: 'good' })
    if (d.ram) lines.push({ text: `RAM cost ${d.ram}`, cls: 'good' })
    if (d.heal) lines.push({ text: `Heals ${d.heal}`, cls: 'good' })
    lines.push({ text: `Value ${d.value} eddies`, cls: 'sys' })
    return game.logLines(session, lines)
  }
  const room = rooms[session.player.room]
  const exit = Object.entries(room.exits ?? {}).find(([dir, to]) => dir === query || EXIT_NAMES[dir] === query || rooms[to]?.name.toLowerCase().includes(query.toLowerCase()))
  if (exit) return game.log(session, `To the ${EXIT_NAMES[exit[0]]}: ${rooms[exit[1]]?.name}.`, 'exit')
  const obj = (room.objects ?? []).find(o => o.id === query || o.name.toLowerCase().includes(query.toLowerCase()))
  if (obj) return game.log(session, `${obj.name}: ${obj.desc}`, 'npc')
  game.log(session, `You see nothing special about "${query}".`, 'bad')
}

function cmdSay (game, session, text) {
  if (!text) return
  game.log(session, `You say: "${text}"`, 'chat')
  game.roomLog(session.player.room, `${session.player.name} says: "${text}"`, 'chat', session.accountId)
}
function cmdShout (game, session, text) {
  if (!text) return
  game.log(session, `You shout: "${text}"`, 'chat')
  for (const s of game.sessions.values()) {
    if (s.accountId === session.accountId) continue
    if (s.player) game.log(s, `${session.player.name} shouts from ${rooms[session.player.room]?.name}: "${text}"`, 'chat')
  }
}
function cmdEmote (game, session, text) {
  if (!text) return
  game.log(session, `${session.player.name} ${text}`, 'chat')
  game.roomLog(session.player.room, `${session.player.name} ${text}`, 'chat', session.accountId)
}

function cmdWho (game, session) {
  const lines = [{ text: '◈ RUNNERS ONLINE', cls: 'level' }]
  let n = 0
  for (const s of game.sessions.values()) {
    if (!s.player) continue
    n++
    const mark = s.accountId === session.accountId ? ' (you)' : ''
    lines.push({ text: `${s.player.name}${mark} — Lv${s.player.level} ${CLASSES[s.player.cls]?.name ?? ''} ${P.LIFEPATHS[s.player.lifepath]?.name ?? ''} @ ${rooms[s.player.room]?.name}`, cls: 'who' })
  }
  lines.push({ text: `${n} runner${n === 1 ? '' : 's'} in Night City.`, cls: 'sys' })
  game.logLines(session, lines)
}

function cmdStats (game, session) {
  const p = session.player
  const s = P.stateForClient(p)
  const a = s.attrs
  const lines = [
    { text: `◈ ${p.name} — ${s.className} • ${s.lifepathName} • Level ${s.level} (${s.xp}/${s.xpToNext} XP)`, cls: 'level' },
    { text: `HP ${s.hp}/${s.maxHp}  STAM ${s.stam}/${s.maxStam}  RAM ${s.ram}/${s.maxRam}  ARMOR ${s.dr}`, cls: 'good' },
    { text: `BODY ${a.body}  REFLEXES ${a.reflexes}  TECH ${a.tech}  INT ${a.intel}  COOL ${a.cool}`, cls: 'sys' },
    { text: `Eddies ${s.eddies} • Street Cred ${s.rep} • Kills ${s.kills} • Deaths ${s.deaths}`, cls: 'sys' },
    { text: `Chrome ${s.capacityUsed}/${s.capacity} capacity • Humanity ${s.humanity}% • Weight ${s.weight}/${s.carryCap}kg`, cls: 'sys' },
    { text: `Attribute points: ${p.attrPoints ?? 0} (up <attr>). Perk points: ${p.perkPoints ?? 0} (perks).`, cls: (p.attrPoints || p.perkPoints) ? 'good' : 'sys' }
  ]
  game.logLines(session, lines)
}

function cmdInv (game, session) {
  const p = session.player
  const s = P.stateForClient(p)
  game.pushInv(session)
  const lines = [{ text: `◈ INVENTORY — ${s.weight}/${s.carryCap}kg • ${p.inv.length} stack(s)`, cls: 'level' }]
  const eq = P.describeEquipment(p)
  if (eq.hands) lines.push({ text: `HANDS: ${eq.hands.name}${eq.hands.dmg ? ` (${eq.hands.dmg[0]}-${eq.hands.dmg[1]} dmg)` : ''}`, cls: 'good' })
  if (eq.chest) lines.push({ text: `BODY:  ${eq.chest.name}${eq.chest.armor ? ` (armor ${eq.chest.armor})` : ''}`, cls: 'good' })
  for (const st of P.describeInventory(p)) {
    lines.push({ text: `  ${st.name}${st.qty > 1 ? ` x${st.qty}` : ''} — ${st.category}${st.dmg ? ` ${st.dmg[0]}-${st.dmg[1]} dmg` : ''}${st.armor ? ` armor ${st.armor}` : ''}${st.heal ? ` heal ${st.heal}` : ''}`, cls: st.category === 'consumables' ? 'good' : 'sys' })
  }
  game.logLines(session, lines)
}

function cmdJobs (game, session) {
  const now = game.now()
  const room = rooms[session.player.room]
  const fixersHere = (room.npcs ?? []).filter(id => npcDefs[id]?.kind === 'fixer')
  game.pushJobs(session)
  const lines = [{ text: `◈ GIGS — ${fixersHere.length ? 'Fixers here: ' + fixersHere.map(id => npcDefs[id].name).join(', ') : 'no fixer around (jobs panel shows all)'}`, cls: 'level' }]
  for (const g of Q.gigListView(session.player, now)) {
    const status = g.status === 'active' ? `ACTIVE ${g.prog}/${g.total}` : g.status === 'cooldown' ? 'ON COOLDOWN' : 'AVAILABLE'
    lines.push({ text: `${g.title} — ${g.desc} (${status} • ${g.rewardEddies}€$ • ${g.rep}rep)`, cls: g.status === 'active' ? 'gig' : 'sys' })
  }
  if (!lines.length) lines.push({ text: 'No gigs on the slate.', cls: 'sys' })
  game.logLines(session, lines)
}

function cmdEquip (game, session, query) {
  const p = session.player
  const f = findItem(game, session, query)
  if (!f.stack) return game.log(session, `You aren't carrying "${query}".`, 'bad')
  const d = getItemDef(f.stack.id)
  if (d.category === 'cyberware') return game.log(session, 'Cyberware must be installed at a ripperdoc. (install <item>)', 'bad')
  if (d.category === 'quickhack') return game.log(session, 'Quickhacks are ready once you have a deck equipped.', 'sys')
  if (d.category === 'weapons') {
    p.equip.hands = f.stack
    game.log(session, `You ready the ${d.name}.`, 'good')
  } else if (d.category === 'apparel') {
    p.equip.chest = f.stack
    game.log(session, `You strap on the ${d.name}.`, 'good')
  } else {
    return game.log(session, `You can't equip ${d.name}.`, 'bad')
  }
  game.pushInv(session); game.pushState(session)
}

function cmdUnequip (game, session, slot) {
  const p = session.player
  slot = slot.toLowerCase()
  if (slot === 'weapon' || slot === 'hands') {
    if (!p.equip.hands) return game.log(session, 'Nothing in hand.', 'bad')
    game.log(session, `You holster the ${getItemDef(p.equip.hands.id).name}.`, 'sys')
    delete p.equip.hands
  } else if (slot === 'armor' || slot === 'chest') {
    if (!p.equip.chest) return game.log(session, 'Nothing on your back.', 'bad')
    delete p.equip.chest
  } else if (slot === 'arms') {
    if (!p.cyberware.arms) return game.log(session, 'No arm chrome installed.', 'bad')
    return game.log(session, 'Arm chrome must be uninstalled at a ripperdoc. (uninstall arms)', 'bad')
  } else {
    return game.log(session, 'Slots: hands, chest. (arm chrome: uninstall arms)', 'bad')
  }
  game.pushInv(session); game.pushState(session)
}

function cmdUse (game, session, query) {
  const p = session.player
  const f = findItem(game, session, query)
  if (!f.stack) return game.log(session, `You aren't carrying "${query}".`, 'bad')
  const d = getItemDef(f.stack.id)
  if (d.category !== 'consumables') return game.log(session, `You can't use ${d.name} like that.`, 'bad')
  const eff = P.computeStats(p)
  const parts = []
  if (d.heal) {
    const h = d.heal + (eff.healPct ? Math.floor(d.heal * eff.healPct / 100) : 0)
    p.hp = Math.min(eff.maxHp, p.hp + h)
    parts.push(`+${h} HP`)
  }
  if (d.stamina) { p.stam = Math.min(eff.maxStam, p.stam + d.stamina); parts.push(`+${d.stamina} stamina`) }
  if (d.ram) { p.ram = Math.min(eff.maxRam, (p.ram ?? 0) + d.ram); parts.push(`+${d.ram} RAM`) }
  P.removeFromInv(p, f.stack.uid, 1)
  game.log(session, `You use ${d.name}. ${parts.join(', ')}.`, 'good')
  game.pushInv(session); game.pushState(session)
  if (d.heal || d.stamina || d.ram) game.roomLog(p.room, `${p.name} uses ${d.name}.`, 'sys', session.accountId)
}

function cmdDrop (game, session, rest) {
  const p = session.player
  const m = rest.match(/^(.*?)(?:\s+(\d+))?$/)
  const query = (m?.[1] ?? rest).trim()
  const qty = m?.[2] ? parseInt(m[2], 10) : 1
  const f = findItem(game, session, query)
  if (!f.stack) return game.log(session, `You aren't carrying "${query}".`, 'bad')
  const dropped = P.dropStackCount(p, f.stack.uid, qty)
  if (!dropped) return game.log(session, 'You cannot drop an equipped item.', 'bad')
  game.log(session, `You drop ${getItemDef(dropped.id).name}${dropped.qty > 1 ? ` x${dropped.qty}` : ''}.`, 'sys')
  game.pushInv(session); game.pushState(session)
}

function cmdAttack (game, session, target, now) {
  const p = session.player
  if (!p.alive) return
  const room = rooms[p.room]
  let inst = game.hostileInRoom(session, target)
  if (!inst && !target) {
    const hs = game.world.hostilesInRoom(p.room)
    if (hs.length === 1) inst = hs[0]
  }
  if (!inst) return game.log(session, target ? `No hostile "${target}" here.` : 'Nothing to attack here.', 'bad')
  const eff = P.computeStats(p)
  const res = C.playerAttack(p, inst, now, eff)
  if (res.error) return game.log(session, res.error, 'bad')
  if (res.cooldown) return game.log(session, `Weapon not ready (${res.remaining}s).`, 'sys')
  if (res.miss) { game.log(session, res.desc, 'combat'); return game.pushState(session) }
  game.log(session, res.desc, res.crit ? 'good' : 'combat')
  game.roomLog(p.room, `${p.name} attacks ${inst.def.name} for ${res.dmg}.`, 'combat', session.accountId)
  game.addThreat(inst, session, res.dmg)
  if (inst.hp <= 0) game.grantKill(session, inst)
  else { game.pushRoom(session); game.pushState(session) }
}

function cmdHack (game, session, rest, now) {
  const p = session.player
  const eff = P.computeStats(p)
  const parts = rest.split(/\s+/)
  if (!rest) return game.log(session, 'Usage: hack <quickhack> <target>', 'bad')
  // allow either order: try first token as hack
  let hackQuery = parts[0]
  let targetQuery = parts.slice(1).join(' ')
  let f = findItem(game, session, hackQuery)
  if (!f.stack || getItemDef(f.stack.id).category !== 'quickhacks') {
    // try last token as hack
    hackQuery = parts[parts.length - 1]
    targetQuery = parts.slice(0, -1).join(' ')
    f = findItem(game, session, hackQuery)
  }
  if (!f.stack || getItemDef(f.stack.id).category !== 'quickhacks') return game.log(session, 'You do not have that quickhack. (buy from a netrunner vendor)', 'bad')
  const qh = getItemDef(f.stack.id)
  const inst = game.hostileInRoom(session, targetQuery)
  if (!inst) return game.log(session, `No hostile "${targetQuery}" here.`, 'bad')
  const res = C.playerQuickhack(p, inst, qh, now, eff)
  if (res.error) return game.log(session, res.error, 'bad')
  if (res.cooldown) return game.log(session, 'Deck still cycling.', 'sys')
  if (res.miss) { game.log(session, res.desc, 'combat'); return game.pushState(session) }
  game.log(session, res.desc, 'good')
  game.roomLog(p.room, `${p.name} quickhacks ${inst.def.name}.`, 'combat', session.accountId)
  game.addThreat(inst, session, res.dmg)
  if (inst.hp <= 0) game.grantKill(session, inst)
  else { game.pushRoom(session); game.pushState(session) }
}

function cmdDefend (game, session, now) {
  const p = session.player
  p.buff.defendUntil = now + 4000
  game.log(session, 'You hunker behind cover and brace for incoming. (-40% damage for 4s)', 'good')
  game.pushState(session)
}

function cmdDodge (game, session, now) {
  const p = session.player
  if (p.stam < 8) return game.log(session, 'Not enough stamina to dodge.', 'bad')
  p.stam -= 8
  p.buff.dodgeUntil = now + 2500
  game.log(session, 'You kick into overdrive — movement blur. (high evasion for 2.5s)', 'good')
  game.pushState(session)
}

function cmdGrenade (game, session, rest, now) {
  const p = session.player
  if (now < (p.grenadeAt || 0)) return game.log(session, 'Still reaching for another grenade.', 'sys')
  const f = findItem(game, session, rest)
  if (!f.stack || getItemDef(f.stack.id).category !== 'grenades') return game.log(session, 'You have no such grenade.', 'bad')
  const gren = getItemDef(f.stack.id)
  const hostiles = game.world.hostilesInRoom(p.room)
  if (!hostiles.length) return game.log(session, 'Nothing to blow up here.', 'bad')
  P.removeFromInv(p, f.stack.uid, 1)
  p.grenadeAt = now + 1000
  const res = C.playerGrenade(p, [gren], hostiles, now)
  if (res.error) return game.log(session, res.error, 'bad')
  game.log(session, res.desc, 'combat')
  game.roomLog(p.room, `${p.name} lobs a ${gren.name}!`, 'combat', session.accountId)
  for (const inst of hostiles) {
    game.addThreat(inst, session, 10)
    if (inst.hp <= 0 && inst.alive) game.grantKill(session, inst)
  }
  game.pushRoom(session); game.pushInv(session); game.pushState(session)
}

function cmdSandevistan (game, session, now) {
  const p = session.player
  const eff = P.computeStats(p)
  if (!eff.sandevistan) return game.log(session, 'No Sandevistan installed.', 'bad')
  if ((p.buff.sandCd ?? 0) > now) return game.log(session, `Sandevistan recharging (${Math.ceil((p.buff.sandCd - now) / 1000)}s).`, 'sys')
  p.buff.sandevistanUntil = now + 15000
  p.buff.sandCd = now + 45000
  game.log(session, 'SANDEVISTAN ONLINE. The world pours into slow motion. You move like a rumor.', 'good')
  game.pushState(session)
}

function cmdBerserk (game, session, now) {
  const p = session.player
  const eff = P.computeStats(p)
  if (!eff.berserk) return game.log(session, 'No Berserk OS installed.', 'bad')
  if ((p.buff.berserkCd ?? 0) > now) return game.log(session, `Berserk recharging (${Math.ceil((p.buff.berserkCd - now) / 1000)}s).`, 'sys')
  p.buff.berserkUntil = now + 15000
  p.buff.berserkCd = now + 60000
  game.log(session, 'BERSERK ENGAGED. Pain becomes a suggestion. Damage up, incoming down.', 'good')
  game.pushState(session)
}

function cmdShop (game, session, query) {
  const v = vendorHere(game, session, query)
  if (!v) return game.log(session, 'No vendor here. Find a stall, bar, or ripperdoc.', 'bad')
  game.pushShop(session, game.world.allInRoom(session.player.room).find(i => i.id === v.id))
}

function cmdBuy (game, session, rest, now) {
  const p = session.player
  const m = rest.match(/^(.*?)(?:\s+(\d+))?$/)
  const query = (m?.[1] ?? rest).trim()
  const qty = m?.[2] ? Math.max(1, parseInt(m[2], 10)) : 1
  const v = vendorHere(game, session)
  if (!v) return game.log(session, 'No vendor here.', 'bad')
  const cats = v.def.shop.sells
  const def = allItemDefs().find(d => cats.includes(d.category) && (d.id.toLowerCase() === query.toLowerCase() || d.name.toLowerCase().includes(query.toLowerCase())))
  if (!def) return game.log(session, `They don't sell "${query}".`, 'bad')
  const price = Math.ceil(def.value * (v.def.shop.sellMul ?? 1.5)) * qty
  if (p.eddies < price) return game.log(session, `Not enough eddies. Need ${price}, you have ${p.eddies}.`, 'bad')
  p.eddies -= price
  if (def.category === 'cyberware' && v.def.kind === 'ripper') {
    const eff = P.computeStats(p)
    const used = P.cyberwareCapacityUsed(p)
    if (p.cyberware[def.slot]) {
      p.eddies += price
      return game.log(session, `Your ${def.slot} slot is occupied. Uninstall first.`, 'bad')
    }
    if (used + def.capacity > eff.capacity) {
      p.eddies += price
      return game.log(session, `Not enough chrome capacity (${used + def.capacity}/${eff.capacity}). Install a Chrome Compressor or uninstall something.`, 'bad')
    }
    const st = P.addToInv(p, def.id, 1)
    p.cyberware[def.slot] = st
    P.removeFromInv(p, st.uid, 1) // it lives in cyberware now
    game.log(session, `Ripper installs ${def.name}. You feel it settle behind your ribs. (-${price} eddies)`, 'good')
    game.roomLog(p.room, `${p.name} gets chrome installed.`, 'sys', session.accountId)
  } else {
    P.addToInv(p, def.id, qty)
    game.log(session, `Bought ${def.name}${qty > 1 ? ` x${qty}` : ''} for ${price} eddies.`, 'good')
  }
  game.pushInv(session); game.pushState(session)
}

function cmdSell (game, session, rest, now) {
  const p = session.player
  const m = rest.match(/^(.*?)(?:\s+(\d+))?$/)
  const query = (m?.[1] ?? rest).trim()
  const qty = m?.[2] ? Math.max(1, parseInt(m[2], 10)) : 1
  const v = vendorHere(game, session)
  if (!v) return game.log(session, 'No vendor here.', 'bad')
  const f = findItem(game, session, query)
  if (!f.stack) return game.log(session, `You aren't carrying "${query}".`, 'bad')
  const d = getItemDef(f.stack.id)
  if (!v.def.shop.sells.includes(d.category)) return game.log(session, `${v.def.name} doesn't buy ${d.category}.`, 'bad')
  const sellQty = Math.min(qty, f.stack.qty)
  const price = Math.max(1, Math.floor(d.value * (v.def.shop.buyMul ?? 0.4))) * sellQty
  P.removeFromInv(p, f.stack.uid, sellQty)
  p.eddies += price
  game.log(session, `Sold ${d.name}${sellQty > 1 ? ` x${sellQty}` : ''} for ${price} eddies.`, 'good')
  game.pushInv(session); game.pushState(session)
}

function cmdChrome (game, session) {
  const p = session.player
  const s = P.stateForClient(p)
  const lines = [{ text: `◈ INSTALLED CHROME — ${s.capacityUsed}/${s.capacity} capacity • Humanity ${s.humanity}%`, cls: 'level' }]
  const cw = P.describeCyberware(p)
  if (!cw.length) lines.push({ text: 'No implants installed. Visit a ripperdoc. (shop at a clinic)', cls: 'sys' })
  for (const c of cw) lines.push({ text: `${c.name} [${c.slot}] — ${c.desc} (cap ${c.capacity}, humanity ${c.humanity})`, cls: 'good' })
  if (s.humanity < 40) lines.push({ text: 'Your reflection holds your gaze a beat too long. (humanity low)', cls: 'bad' })
  game.logLines(session, lines)
}

function cmdInstall (game, session, query) {
  const p = session.player
  const ripper = ripperHere(game, session)
  if (!ripper) return game.log(session, 'You need a ripperdoc to install chrome. Find a clinic.', 'bad')
  const f = findItem(game, session, query)
  if (!f.stack) return game.log(session, `You aren't carrying "${query}".`, 'bad')
  const d = getItemDef(f.stack.id)
  if (d.category !== 'cyberware') return game.log(session, `${d.name} is not cyberware.`, 'bad')
  const eff = P.computeStats(p)
  const used = P.cyberwareCapacityUsed(p)
  if (p.cyberware[d.slot]) return game.log(session, `Your ${d.slot} slot is occupied (${getItemDef(p.cyberware[d.slot].id).name}). Uninstall it first.`, 'bad')
  if (used + d.capacity > eff.capacity) return game.log(session, `Capacity exceeded (${used + d.capacity}/${eff.capacity}).`, 'bad')
  P.removeFromInv(p, f.stack.uid, 1)
  const st = P.addToInv(p, d.id, 1)
  p.cyberware[d.slot] = st
  P.removeFromInv(p, st.uid, 1)
  game.log(session, `${ripper.name} installs ${d.name}. ${d.desc}`, 'good')
  game.roomLog(p.room, `${p.name} goes under the ripper's knife.`, 'sys', session.accountId)
  game.pushInv(session); game.pushState(session)
}

function cmdUninstall (game, session, slot) {
  const p = session.player
  const ripper = ripperHere(game, session)
  if (!ripper) return game.log(session, 'You need a ripperdoc to uninstall chrome.', 'bad')
  slot = slot.toLowerCase()
  const st = p.cyberware[slot]
  if (!st) return game.log(session, `No chrome in the ${slot} slot.`, 'bad')
  const d = getItemDef(st.id)
  delete p.cyberware[slot]
  P.addToInv(p, d.id, 1)
  game.log(session, `${ripper.name} pops out the ${d.name}. It goes back in your kit.`, 'good')
  game.pushInv(session); game.pushState(session)
}

function cmdAccept (game, session, gigId, now) {
  const p = session.player
  const room = rooms[p.room]
  const gig = Q.GIGS[gigId]
  if (!gig) return game.log(session, `No such gig "${gigId}". Type jobs.`, 'bad')
  if (!(room.npcs ?? []).includes(gig.fixer)) return game.log(session, `You must accept this gig from ${npcDefs[gig.fixer]?.name}.`, 'bad')
  const res = Q.acceptGig(p, gigId, now)
  if (res.error) return game.log(session, res.error, 'bad')
  game.log(session, `GIG ACCEPTED — "${gig.title}". ${gig.desc}`, 'gig')
  game.pushJobs(session)
  game.pushState(session)
}

function cmdUp (game, session, attr) {
  const p = session.player
  attr = attr.toLowerCase()
  if (!P.ATTRS.includes(attr)) return game.log(session, `Attributes: ${P.ATTRS.join(', ')}`, 'bad')
  if ((p.attrPoints ?? 0) <= 0) return game.log(session, 'No attribute points available. Level up first.', 'bad')
  if (p.attrs[attr] >= 20) return game.log(session, `${attr} is maxed.`, 'bad')
  p.attrs[attr] += 1
  p.attrPoints -= 1
  const eff = P.computeStats(p)
  p.hp = eff.maxHp
  p.ram = eff.maxRam
  game.log(session, `${P.ATTR_LABELS[attr]} raised to ${p.attrs[attr]}. ${P.ATTR_FLAVOR[attr]}`, 'level')
  game.pushState(session)
  game.pushInv(session)
}

function cmdPerks (game, session, query) {
  const p = session.player
  if (query) return cmdPerk(game, session, query)
  const cls = CLASSES[p.cls] ?? CLASSES.solo
  const owned = new Set(p.perks ?? [])
  const tree = classPerks(cls.id)
  const lines = [{ text: `◈ ${cls.name.toUpperCase()} — CLASS PERK TREE (${owned.size}/${tree.length} learned • ${p.perkPoints ?? 0} point${p.perkPoints === 1 ? '' : 's'})`, cls: 'level' }]
  for (const pr of tree) {
    const got = owned.has(pr.id)
    const tierGateOk = owned.size >= (TIER_REQUIREMENTS[pr.tier] ?? 0)
    const gateOk = (p.attrs[pr.attr] ?? 0) >= pr.attrVal
    const can = (p.perkPoints ?? 0) > 0 && !got && tierGateOk && gateOk
    let note = ''
    if (!got) {
      note = !gateOk ? ` needs ${P.ATTR_LABELS[pr.attr]} ${pr.attrVal}` : !tierGateOk ? ` learn ${TIER_REQUIREMENTS[pr.tier]} perks for T${pr.tier}` : ''
    }
    lines.push({ text: `${got ? '[X]' : can ? '[ ]' : '[·]'} T${pr.tier} ${pr.name} — ${pr.desc}${got ? '' : note ? ` (${note})` : ' (1 point)'}`, cls: got ? 'good' : can ? 'level' : 'sys' })
  }
  lines.push({ text: 'Type: perk <name> to spend a point.', cls: 'sys' })
  game.logLines(session, lines)
}

function cmdPerk (game, session, query) {
  const p = session.player
  const q = (query || '').toLowerCase()
  if (!q) return cmdPerks(game, session, '')
  const cls = CLASSES[p.cls] ?? CLASSES.solo
  const pr = classPerks(cls.id).find(x => x.id === q || x.id.includes(q) || x.name.toLowerCase() === q || x.name.toLowerCase().startsWith(q))
  if (!pr) return game.log(session, `No "${query}" perk in the ${cls.name} tree.`, 'bad')
  const owned = new Set(p.perks ?? [])
  if (owned.has(pr.id)) return game.log(session, `${pr.name} already learned.`, 'bad')
  if ((p.perkPoints ?? 0) <= 0) return game.log(session, 'No perk points available. Level up to earn one.', 'bad')
  if ((p.attrs[pr.attr] ?? 0) < pr.attrVal) {
    return game.log(session, `${pr.name} requires ${P.ATTR_LABELS[pr.attr]} ${pr.attrVal}. Your ${P.ATTR_LABELS[pr.attr]} is ${p.attrs[pr.attr]}.`, 'bad')
  }
  if (pr.tier > 1 && owned.size < (TIER_REQUIREMENTS[pr.tier] ?? 0)) {
    return game.log(session, `T${pr.tier} perks unlock after learning ${TIER_REQUIREMENTS[pr.tier]} ${cls.name} perks.`, 'bad')
  }
  p.perks = [...owned, pr.id]
  p.perkPoints -= 1
  const eff = P.computeStats(p)
  p.hp = eff.maxHp
  p.stam = eff.maxStam
  p.ram = eff.maxRam
  game.log(session, `PERK LEARNED — ${pr.name}. ${pr.desc}`, 'level')
  game.log(session, `${p.perkPoints ?? 0} perk point${p.perkPoints === 1 ? '' : 's'} left. Type perks to view the tree.`, 'good')
  game.pushState(session)
  game.pushInv(session)
  db.queueSave()
}

function cmdTravel (game, session, dest, now) {
  const p = session.player
  const dist = Object.keys(HUB_ROOMS).find(d => d === dest.toLowerCase() || districts[d]?.name.toLowerCase().includes(dest.toLowerCase()))
  if (!dist) return game.log(session, `Districts: ${Object.keys(HUB_ROOMS).join(', ')}`, 'bad')
  const target = HUB_ROOMS[dist]
  if (p.room === target) return game.log(session, 'You are already there.', 'bad')
  const cost = 100
  if (p.eddies < cost) return game.log(session, `Fare is ${cost} eddies. You have ${p.eddies}.`, 'bad')
  p.eddies -= cost
  const from = p.room
  p.room = target
  game.roomLog(from, `${p.name} catches a shuttle out.`, 'sys', session.accountId)
  game.log(session, `You ride the NCART/shuttle to ${rooms[target].name}. (-${cost} eddies)`, 'good')
  game.pushRoom(session); game.pushJobs(session); game.pushState(session)
  game.describeCurrentRoom(session)
}

function cmdTalk (game, session, query) {
  const inst = game.npcInRoom(session, query)
  if (!inst) return game.log(session, `No one called "${query}" here.`, 'bad')
  const d = inst.def
  const lines = []
  if (d.dialog?.length) lines.push({ text: `${d.name}: "${d.dialog[C.rand(0, d.dialog.length - 1)]}"`, cls: 'npc' })
  else lines.push({ text: `${d.name} regards you silently.`, cls: 'npc' })
  if (d.kind === 'fixer') lines.push({ text: 'They have gigs. (jobs)', cls: 'good' })
  if (d.shop) lines.push({ text: 'They trade. (shop)', cls: 'good' })
  game.logLines(session, lines)
}

function cmdMap (game, session) {
  const p = session.player
  const room = rooms[p.room]
  const dist = districts[room.district]
  const lines = [
    { text: `◈ ${dist?.name ?? room.district} — ${dist?.blurb ?? ''}`, cls: 'level' },
    { text: `You are at: ${room.name}`, cls: 'place' }
  ]
  for (const [dir, to] of Object.entries(room.exits ?? {})) {
    const r = rooms[to]
    lines.push({ text: `  ${EXIT_NAMES[dir].padEnd(10)} → ${r?.name} [${districts[r?.district]?.name}]`, cls: 'exit' })
  }
  lines.push({ text: `Fast travel: travel <${Object.keys(HUB_ROOMS).join('|')}> (100 eddies)`, cls: 'sys' })
  game.logLines(session, lines)
}

// Class archetypes + CP2077-style perk trees.
// Each perk: attribute gate (attr/attrVal), tier, and an effects bag folded
// into computeStats / combat / healing / rewards.

export const CLASSES = {
  solo: {
    id: 'solo', name: 'Solo', color: '#ff5c78',
    tagline: 'Meat and metal. Killer by trade.',
    desc: 'Every job is a firefight you walked into on purpose. Reflexes like a struck match, a trigger finger that bills by the hour.',
    attrs: ['reflexes', 'body']
  },
  netrunner: {
    id: 'netrunner', name: 'Netrunner', color: '#29f2c3',
    tagline: 'The net is a razor. You swim in it.',
    desc: 'The Blackwall hums in your head like a second heartbeat. You don\'t hack the grid — you smooth-talk it while stealing its wallet.',
    attrs: ['intel']
  },
  techie: {
    id: 'techie', name: 'Techie', color: '#ffd24a',
    tagline: 'If it\'s broken, you built it mightier.',
    desc: 'Wires, torque, and traded humanity. You keep your chrome laughing and your armor stories short — because they never believe you anyway.',
    attrs: ['tech']
  },
  rockerboy: {
    id: 'rockerboy', name: 'Rockerboy', color: '#b678ff',
    tagline: 'Start a riot, file under art.',
    desc: 'Guitar plugged straight into the city\'s nervous system. When you pick up the mic, some people dance and others duck.',
    attrs: ['cool']
  },
  nomad: {
    id: 'nomad', name: 'Nomad', color: '#e0b06a',
    tagline: 'The road raised you. The city funds you.',
    desc: 'Born under a tarp and a fuel gauge. Everything you own either moves or explodes, and you\'re fine with both outcomes.',
    attrs: ['body']
  }
}

// tier rules: can buy a T2 perk once 2 perks in the class are owned;
// a T3 perk once 4 perks in the class are owned. Perks are single-rank.
export const PERKS = {
  // ---------- SOLO ----------
  'solo-reflexes': {
    id: 'solo-reflexes', cls: 'solo', tier: 1, attr: 'reflexes', attrVal: 4,
    name: 'Reflex trigger', desc: '+3 dodge', eff: { dodge: 3 }
  },
  'solo-fatale': {
    id: 'solo-fatale', cls: 'solo', tier: 1, attr: 'body', attrVal: 4,
    name: 'Gun fatale', desc: '+8% weapon damage', eff: { weaponDmgPct: 8 }
  },
  'solo-focus': {
    id: 'solo-focus', cls: 'solo', tier: 1, attr: 'reflexes', attrVal: 4,
    name: 'Combat focus', desc: '+5% crit chance', eff: { crit: 5 }
  },
  'solo-lightning': {
    id: 'solo-lightning', cls: 'solo', tier: 2, attr: 'reflexes', attrVal: 5,
    name: 'Lightning draw', desc: 'Attacks 6% faster', eff: { haste: 6 }
  },
  'solo-ghost': {
    id: 'solo-ghost', cls: 'solo', tier: 2, attr: 'body', attrVal: 5,
    name: 'Ghost protocol', desc: '+6 armor', eff: { dr: 6 }
  },
  'solo-fury': {
    id: 'solo-fury', cls: 'solo', tier: 2, attr: 'body', attrVal: 5,
    name: 'Blood fury', desc: '+20% damage under 50% HP', eff: { lowHpDmgPct: 20 }
  },
  'solo-ace': {
    id: 'solo-ace', cls: 'solo', tier: 3, attr: 'reflexes', attrVal: 7,
    name: 'Gun kata', desc: '+10% weapon damage, +5% crit chance', eff: { weaponDmgPct: 10, crit: 5 }
  },
  'solo-wall': {
    id: 'solo-wall', cls: 'solo', tier: 3, attr: 'body', attrVal: 7,
    name: 'Human wall', desc: '+25 max HP', eff: { maxHp: 25 }
  },

  // ---------- NETRUNNER ----------
  'runner-expanded': {
    id: 'runner-expanded', cls: 'netrunner', tier: 1, attr: 'intel', attrVal: 4,
    name: 'Expanded deck', desc: '+1 max RAM', eff: { maxRam: 1 }
  },
  'runner-sting': {
    id: 'runner-sting', cls: 'netrunner', tier: 1, attr: 'intel', attrVal: 4,
    name: 'Binary stinger', desc: '+15% quickhack damage', eff: { hackDmgPct: 15 }
  },
  'runner-cold': {
    id: 'runner-cold', cls: 'netrunner', tier: 1, attr: 'intel', attrVal: 4,
    name: 'Cold boot', desc: 'Quickhacks cooldown 20% faster', eff: { hackCdPct: 20 }
  },
  'runner-over': {
    id: 'runner-over', cls: 'netrunner', tier: 2, attr: 'intel', attrVal: 5,
    name: 'Overclock', desc: '+1 max RAM, RAM recharges 50% faster', eff: { maxRam: 1, ramRatePct: 50 }
  },
  'runner-ice': {
    id: 'runner-ice', cls: 'netrunner', tier: 2, attr: 'intel', attrVal: 5,
    name: 'ICEbreaker', desc: '+10 ICE (resists incoming hacks)', eff: { ice: 10 }
  },
  'runner-spike': {
    id: 'runner-spike', cls: 'netrunner', tier: 2, attr: 'intel', attrVal: 5,
    name: 'System collapse', desc: '+5% quickhack crit chance', eff: { hackCrit: 5 }
  },
  'runner-daemon': {
    id: 'runner-daemon', cls: 'netrunner', tier: 3, attr: 'intel', attrVal: 7,
    name: 'Daemon protocol', desc: '+25% quickhack damage', eff: { hackDmgPct: 25 }
  },
  'runner-peak': {
    id: 'runner-peak', cls: 'netrunner', tier: 3, attr: 'intel', attrVal: 7,
    name: 'Peak deck', desc: '+2 max RAM', eff: { maxRam: 2 }
  },

  // ---------- TECHIE ----------
  'techie-hands': {
    id: 'techie-hands', cls: 'techie', tier: 1, attr: 'tech', attrVal: 4,
    name: 'Iron hands', desc: '+4 armor', eff: { dr: 4 }
  },
  'techie-frame': {
    id: 'techie-frame', cls: 'techie', tier: 1, attr: 'tech', attrVal: 4,
    name: 'Gorilla frame', desc: '+1 chrome capacity', eff: { capacity: 1 }
  },
  'techie-slag': {
    id: 'techie-slag', cls: 'techie', tier: 1, attr: 'tech', attrVal: 4,
    name: 'Slag buster', desc: '+8% weapon damage', eff: { weaponDmgPct: 8 }
  },
  'techie-plate': {
    id: 'techie-plate', cls: 'techie', tier: 2, attr: 'tech', attrVal: 5,
    name: 'Ceramic plating', desc: '+8 armor', eff: { dr: 8 }
  },
  'techie-jury': {
    id: 'techie-jury', cls: 'techie', tier: 2, attr: 'tech', attrVal: 5,
    name: 'Jury rig', desc: '+20 humanity', eff: { humanity: 20 }
  },
  'techie-pressure': {
    id: 'techie-pressure', cls: 'techie', tier: 2, attr: 'tech', attrVal: 5,
    name: 'Pressure seal', desc: '+15 max HP', eff: { maxHp: 15 }
  },
  'techie-machinist': {
    id: 'techie-machinist', cls: 'techie', tier: 3, attr: 'tech', attrVal: 7,
    name: 'Master machinist', desc: '+15% weapon damage', eff: { weaponDmgPct: 15 }
  },
  'techie-titan': {
    id: 'techie-titan', cls: 'techie', tier: 3, attr: 'tech', attrVal: 7,
    name: 'Titan chassis', desc: '+20 max HP, +4 armor', eff: { maxHp: 20, dr: 4 }
  },

  // ---------- ROCKERBOY ----------
  'rock-kick': {
    id: 'rock-kick', cls: 'rockerboy', tier: 1, attr: 'cool', attrVal: 4,
    name: 'Pick up the pieces', desc: '+5 dodge', eff: { dodge: 5 }
  },
  'rock-band': {
    id: 'rock-band', cls: 'rockerboy', tier: 1, attr: 'cool', attrVal: 4,
    name: 'Backup band', desc: '+15% eddies from gigs', eff: { eddiesPct: 15 }
  },
  'rock-muse': {
    id: 'rock-muse', cls: 'rockerboy', tier: 1, attr: 'cool', attrVal: 4,
    name: 'Muse\'s drive', desc: '+20 max stamina', eff: { maxStam: 20 }
  },
  'rock-fade': {
    id: 'rock-fade', cls: 'rockerboy', tier: 2, attr: 'cool', attrVal: 5,
    name: 'Fade to black', desc: '+8 dodge', eff: { dodge: 8 }
  },
  'rock-head': {
    id: 'rock-head', cls: 'rockerboy', tier: 2, attr: 'cool', attrVal: 5,
    name: 'Headliner', desc: '+8% crit chance', eff: { crit: 8 }
  },
  'rock-pyro': {
    id: 'rock-pyro', cls: 'rockerboy', tier: 2, attr: 'cool', attrVal: 5,
    name: 'Pyromaniac', desc: '+20% damage at full stamina', eff: { fullStamDmgPct: 20 }
  },
  'rock-anarchy': {
    id: 'rock-anarchy', cls: 'rockerboy', tier: 3, attr: 'cool', attrVal: 7,
    name: 'Anarchy anthem', desc: '+12% crit chance, +8% weapon damage', eff: { crit: 12, weaponDmgPct: 8 }
  },
  'rock-heart': {
    id: 'rock-heart', cls: 'rockerboy', tier: 3, attr: 'cool', attrVal: 7,
    name: 'Heart of the city', desc: '+15 max HP, +20 max stamina', eff: { maxHp: 15, maxStam: 20 }
  },

  // ---------- NOMAD ----------
  'nomad-road': {
    id: 'nomad-road', cls: 'nomad', tier: 1, attr: 'body', attrVal: 4,
    name: 'Road-hardened', desc: '+10 max HP', eff: { maxHp: 10 }
  },
  'nomad-stash': {
    id: 'nomad-stash', cls: 'nomad', tier: 1, attr: 'body', attrVal: 4,
    name: 'Scavenger\'s stash', desc: '+20kg carry weight', eff: { carryBonus: 20 }
  },
  'nomad-first': {
    id: 'nomad-first', cls: 'nomad', tier: 1, attr: 'body', attrVal: 4,
    name: 'First aid', desc: '+25% healing from consumables', eff: { healPct: 25 }
  },
  'nomad-regen': {
    id: 'nomad-regen', cls: 'nomad', tier: 2, attr: 'body', attrVal: 5,
    name: 'Second wind', desc: 'Health regen 50% faster', eff: { regenHpPct: 50 }
  },
  'nomad-tire': {
    id: 'nomad-tire', cls: 'nomad', tier: 2, attr: 'body', attrVal: 5,
    name: 'Spare tire', desc: '+15 max HP', eff: { maxHp: 15 }
  },
  'nomad-boom': {
    id: 'nomad-boom', cls: 'nomad', tier: 2, attr: 'body', attrVal: 5,
    name: 'Improvised ordnance', desc: '+25% grenade damage', eff: { grenadePct: 25 }
  },
  'nomad-wrecker': {
    id: 'nomad-wrecker', cls: 'nomad', tier: 3, attr: 'body', attrVal: 7,
    name: 'Clan wrecker', desc: '+12% weapon damage', eff: { weaponDmgPct: 12 }
  },
  'nomad-iron': {
    id: 'nomad-iron', cls: 'nomad', tier: 3, attr: 'body', attrVal: 7,
    name: 'Iron cowboy', desc: '+8 armor, +15 max HP', eff: { dr: 8, maxHp: 15 }
  }
}

export function perkEffects (p) {
  const bag = {}
  for (const id of p.perks ?? []) {
    const def = PERKS[id]
    if (!def) continue
    for (const [k, v] of Object.entries(def.eff)) bag[k] = (bag[k] ?? 0) + v
  }
  return bag
}

export function classPerks (clsId) {
  return Object.values(PERKS).filter(pr => pr.cls === clsId).sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name))
}

// minimum ownrd perks in the class required to unlock each tier
export const TIER_REQUIREMENTS = { 2: 2, 3: 4 }
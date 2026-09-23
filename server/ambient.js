// Ambient neighborhood flavor for the area the player is in.
// Emitted periodically to the room log (class 'amb'). Also drives idle NPC chatter.

import { rand } from './combat.js'
import { npcDefs } from './world.js'

const CATEGORY_LINES = {
  street: [
    'A souped-up Delamain cab hydroplanes past, beeping at pedestrians.',
    'Gunfire crackles a few blocks off. Nobody flinches.',
    'A fixer whispers a job into a ripperdoc\'s ear. The price is a favour.',
    'Corpo media drones circle the intersection, harvesting faces.',
    'A drone hawks 3D weed from a broken vending cart.',
    'The air-holoscreen blinks between ads for cheap chrome and cheaper funerals.',
    'Somebody screams at their agent. The agent is not taking it well.',
    'Rain and neon stream off a passing bucket truck.',
    'A braindance ad glitches into static, screaming static, then snaps back.',
    'Kids chase a rusted delivery drone down the block, howling.',
    'A street preacher hollers about the coming storm while data rains off the towers.',
    'Two women shoulders-check a scavenger in silence. No eddies change hands.'
  ],
  gangden: [
    'Gangers rack weapons and argue over territory in clipped cyberslang.',
    'A welded barricade slides shut, then slowly cracks open again.',
    'Distant autofire answers the music from a boombox strapped to a bike.',
    'Someone is being sold a "never-traceable" phone. It is traceable.',
    'The smell of synthfuel and cheap stims coat the walls.',
    'Two gangers scuffle over a spilled crate of black-market trauma kits.',
    'A drone the size of a fist hovers near the stash, blinking red.',
    'Cold looks follow you, calculate, and move on.',
    'Graffiti overlaps so deep the oldest tag has become a different colour.',
    'A sentry turret tracks you a half-degree, then decides breakfast can wait.'
  ],
  clinic: [
    'The ripperdoc wipes a scalpel on a stained towel, looking at it like an old friend.',
    'A patient in the chair twitches as the mechatkatches their neural wiring.',
    'The waiting room reeks of disinfectant, plasma, and unspoken regrets.',
    'Somewhere behind the curtain, a chipjack chatters a flatline rhythm.',
    'A vitals monitor beeps in a cadence that sounds almost like morse.',
    'Blood gets squeegeed off the floor. Business is good.',
    'A vendor of used eyes tries to upsell the person next to you.',
    'A nurse files her nails with a surgical grade in one hand, a soldering iron in the other.'
  ],
  industrial: [
    'A foundry exhales a cloud of orange smoke downtown that turns silver in the rain.',
    'Pressurised piping ticks overhead, cooling between loads.',
    'A cargo hauler grinds past, chassis groaning under factory alloy.',
    'Static discharges from a cracked transformer. The pavement smells of ozone.',
    'Automated welders spurt blue light behind a fence of corrugated steel.',
    'A forklift reverses, beeping like a wounded bird, and the workers ignore it.',
    'Conveyor loads of scrap groan past on buried rails.',
    'A foreman bellows at a dock that has been on fire since before the union left.'
  ],
  ruin: [
    'Cracked concrete and collapsed signage. The city is reclaiming its own teeth.',
    'Wind whistles through broken girders like a bored ghost.',
    'Squatters have hung tarps that flap like prayer flags.',
    'A holo-ad for a mall that died a decade ago still flickers stubbornly.',
    'Somewhere in the rubble a fusion cell whines on empty.',
    'Graffiti claims this penthouse. Feral dogs back the claim.',
    'The dirt here has a chemistry all its own. Old blood, newer moss.',
    'A jacked satellite dish turns one slow circle, hunting for a signal that died.'
  ],
  wasteland: [
    'Dust devils wander the flats, carrying silt and static.',
    'A rusted wind turbine stutters in the distance, counting time.',
    'The sky is a bruised steel color that never quite lets in the light.',
    'Off-roaders kick up rooster tails of ochre grit on a far ridge.',
    'Flare smoke smears the horizon: someone up there is calling for a ride no one will answer.',
    'An automated water tower moans as it fills, then forgets why.',
    'Ravens circle a swaybacked trailer with professional patience.',
    'Painted on a gas station door in four languages: no fuel, no water, no mercy.'
  ],
  market: [
    'Vendors hawk counterfeit implants and real noodles with equal passion.',
    'A food stall sizzles something that might be chicken. The smell lies.',
    'Prices are quoted in eddies, haggled in favours, settled in threats.',
    'A street doctor tattoos serial numbers on his customers\' jaws.',
    'Someone trades a cortex monitor for a bag of real coffee.',
    'The holo-bazaar shimmer glitches, and six vendors double in number briefly.',
    'A kid runs a skeleton of an early-model Kiroshi on a string.',
    'A stall owner bets a tourist that the next rain will be pink. It always is.'
  ],
  plaza: [
    'A towering corpo ad blinks in slow, patient rhythm over the square.',
    'Slick-suited types cross paths, avoiding each other\'s optics.',
    'A fountain of some legendary corp founder purrs pointlessly in the center.',
    'Assistant drones wheel past, chirping about the weather in weather-app voices.',
    'A media crew films a press conference that will never matter.',
    'The pavement emits a soft direction hum. No one enters the corpo towers.',
    'A concierge opens a door for a man who will not remember this city by morning.'
  ],
  bar: [
    'The jukebox cycles through twenty-year-old synthwaif, and nobody complains.',
    'A burned merc stares into a glass like it holds the answers.',
    'The barkeep slides a synth-whiskey across the counter without breaking their poker face.',
    'A pool table argument is settled by a round of drinks. No, by a round of shots.',
    'Somebody\'s agent pops an ad for a soul-free taxi ride, mid-toast.',
    'Boots scrape sawdust that has seen wetter secrets than blood.',
    'A regular thanks the bartender by name, and means it.',
    'Two veteran mercs count their share of a run before the other one arrives.'
  ],
  corpo: [
    'Glass towers scrape the rain. The tenants never get wet.',
    'A mag-lev shuttle whisper-lifts between megafloors above the street.',
    'Assistants scurry in sync, earpieces glowing, futures scripted.',
    'Premium airjets carve slow circles over the pinnacle, dripping light.',
    'The lobby\'s AI greets you by threat level, then by name.',
    'A cleanser bot polishes a floor that has never known a footprint.',
    'Somewhere up there, a board is deciding a city\'s future over brunch.',
    'A courier hand-delivers a folder that will end three careers by sunset.'
  ],
  apartment: [
    'A neighbour\'s subwoofer bleeds through the wall in a dull heartbeat.',
    'The elevator groans, stopping two floors past the call. Old design, old bones.',
    'Someone on the landing argues with their landlord on a tinny speaker.',
    'Microwave dinners and muted screams of a rented braindance through the walls.',
    'Emergency lighting flickers, counts the breath, and decides not to fail.',
    'A leak dribbles down the stairwell like a suspense timer.',
    'The recycling chute gurgles and burps out a charger.',
    'A janitor drone replays a song that was a hit before the building opened.'
  ],
  club: [
    'Bass hits your sternum. The lights haven\'t decided what year they\'re in.',
    'A holo-VJ slices the crowd into light, then bleeds them back together.',
    'Sweat, synthheaven, and excitement condense on the ceiling and rain back down.',
    'A dancer\'s kinetic rig stutters, and the crowd howls approval.',
    'A bouncer eye-flick court stamps you as acceptable, just barely.',
    'Glow-tipped bottles clink a toast to no one in particular.',
    'The beat drops, and for three seconds the whole room forgets Night City.'
  ],
  tent: [
    'A generator huffs, keeping the lights fighting the dark.',
    'Cloth walls ripple with a ribbon of red light from an icon lamp.',
    'Furs and tarps keep the dust out; desperation keeps it interesting.',
    'A kettle steams on a tripod over an open fuse-coil.',
    'Magpie scavengers trade rumours, eddies, and bullets.',
    'The flap rustles. Wind, or something with sharp opinions.'
  ]
}

const DISTRICT_LINES = {
  watson: ['The Watson skyline is a dog-eared stack of megabuilding teeth.'],
  westbrook: ['Up in Westbrook, the penthouse lights glitter like catcalls.'],
  citycenter: ['City Center scrapes the clouds and ignores the street below.'],
  heywood: ['Heywood hums with barrio heat and old loyalties.'],
  pacifica: ['Pacific\'s gutted resorts watch the surf like revenants.'],
  santo: ['Santo Domingo\'s warehouses chew midnight, freight by freight.'],
  badlands: ['The badlands spread out, patient as a debt collector.']
}

const DANGER_LINES = [
  'A distant siren Doppler-fades. Then a second one, slower to give up.',
  'Gunfire pops somewhere nearby and self-important before it matters.',
  'Someone\'s drone drops a flare that colours the rooftops red, then fades.',
  'An AV sweeps overhead, spotlight cutting through the neon like a scalpel.',
  'A wounded howl rolls through the streets. You hold your breath with the buildings.'
]

const CHATTER = [
  'mutters something about the new corpo tariffs.',
  'spits and adjusts their jacket, watching your hands.',
  'stares at a holo-slate for a beat too long.',
  'laughs at a joke only they could have heard.',
  'scans the street twice before stepping out of a doorway.',
  'trades eddies for a throwaway burner with a vendor, no words exchanged.',
  'complains to a companion about the rain ruining a fresh alley-shine job.',
  'taps an old pocket watch and scowls.',
  'slowly shakes their head at a message on their agent.',
  'flicks a cigarette stub into a drain and watches it spark.'
]

export function ambientLine (room) {
  const pool = CATEGORY_LINES[room.category]
  const distPool = DISTRICT_LINES[room.district]
  const danger = !!room.danger

  const pick = arr => arr[rand(0, arr.length - 1)]
  if (danger && Math.random() < 0.35) return pick(DANGER_LINES)
  if (pool && Math.random() < 0.7) return pick(pool)
  if (distPool && Math.random() < 0.5) return pick(distPool)
  return pick(Object.values(CATEGORY_LINES)[rand(0, Object.keys(CATEGORY_LINES).length - 1)])
}

export function npcChatterLine (room) {
  const neutral = (room.npcs ?? []).map(id => npcDefs?.[id]).filter(n => n && n.kind !== 'hostile')
  if (!neutral.length) return null
  const inst = neutral[rand(0, neutral.length - 1)]
  const short = shortName(inst.name)
  if (inst.dialog?.length && Math.random() < 0.5) {
    return `${short} picks up with a line for nobody in particular: "${inst.dialog[rand(0, inst.dialog.length - 1)]}"`
  }
  return `${short} ${pickNpcAction()}`
}

function shortName (name) {
  const TITLES = new Set(['ripper', 'ripperdoc', 'vendor', 'apparel', 'netrunner', 'noodle', 'restaurant', 'hotel', 'corporate', 'corpo', 'security', 'ncpd', 'street', 'kevin', 'jackie'])
  const words = name.split(/\s+/).filter(Boolean)
  const meaningful = words.filter(w => w.length > 3 && !TITLES.has(w.toLowerCase()))
  if (meaningful.length) return meaningful[rand(0, meaningful.length - 1)]
  if (words.length) return words[words.length - 1]
  return name
}

function pickNpcAction () {
  return CHATTER[rand(0, CHATTER.length - 1)]
}

// room-level activity cadence (ms per room)
export const AMBIENT_MIN = 18000
export const AMBIENT_MAX = 42000
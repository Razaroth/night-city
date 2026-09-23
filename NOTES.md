# Project notes

Status snapshots, findings, and known issues for the NIGHT CITY MUD project.
Focus currently: verifying the full gameplay loop end-to-end.

## Server runtime (Omarchy)

- Runs as a systemd **user** service: `night-city.service`.
  `~/.config/systemd/user/night-city.service`, ExecStart uses the mise shim
  `~/.local/share/mise/shims/node` (node pinned to 26.8.1 in `~/.config/mise/config.toml`).
- Manage: `systemctl --user {status|restart|stop|start} night-city`,
  logs via `journalctl --user -u night-city -f`.
- Lingering enabled (`loginctl enable-linger josh`), so it survives logout.
- Currently **running**; world saved to `data/save/world.json`. Only non-test
  account is `Razaroth`. Test accounts (`gp_`/`dt_`/`sm_`/`bt_` prefixed) are
  cleaned with `nc-clean.mjs` (run with the service stopped).

## Verified end-to-end (protocol + gameplay)

Via `node --check`, a register→create→move protocol client, a 23-command parser
battery, and `nc-gameplay.mjs` (WS bot using real world data; see test files):

- register/auth/world/needChar/charCreate/entered handshake; HTTP + MIME + path-traversal guard.
- Combat: attack ticks respect weapon cooldown, kill awards XP, corpse looted and removed, eddies increase.
- Gigs: `accept gig-scavdawgs` from Wakako works; killing both targets completes it (+rep, +xp).
- Economy: `buy`/`sell` work (edges shift correctly); buying unaffordable chrome is properly
  rejected ("Not enough eddies").
- Death/respawn: Second Heart revives at low HP once (test char created with second-heart,
  cap 4) then real death → `death` msg → 7s respawn → alive again, deaths stat incremented.
- NPCs respawn: hostiles 90s, bosses 600s (`server/world.js` respawnSec). Re-running live tests
  repeatedly will hit freshly-dead NPCs — tests must `waitNpc` (already handled in nc-gameplay.mjs).

## Classes + perk trees (2026-09-23)

- Five CP2077-style classes chosen at creation (orthogonal to lifepath): **Solo**, **Netrunner**,
  **Techie**, **Rockerboy**, **Nomad** — defined in `server/classes.js` (CLASSES + PERKS).
- **Perk economy**: +1 perk point per level-up (alongside the existing +1 attribute point in
  `player.js addXp`). Perks are single-rank, gated by an attribute minimum (`attr`/`attrVal`) and
  a tier gate — T2 needs 2 class perks owned, T3 needs 4 (`TIER_REQUIREMENTS`).
- Effects fold into `computeStats` via `perkEffects(p)` (dodge/crit/dr/maxHp/maxStam/maxRam/capacity/
  ice/pen/humanity/haste) plus percentage hooks used by combat/quests/regen:
  weaponDmgPct (+ lowHpDmgPct / fullStamDmgPct), hackDmgPct/hackCrit/hackCdPct, grenadePct,
  healPct, eddiesPct, regenHpPct, ramRatePct, carryBonus.
- Commands: `perks` (view your tree) and `perk <name>` (spend a point); `stats`/`who` show class.
- Gig eddies bonus is computed in `quests.js handleKill` and returned as a shallow copy so the
  shared GIGS def is never mutated.
- Existing saves get `cls:'solo'`, empty perks, 0 points via `hydratePlayer`.
- Client: class picker on the creation screen, HUD shows `CLASS • LIFEPATH`, a **PERKS** modal
  (quickbar button + left-panel OPEN TREE) rendered from world payload (`classes`/`perks`/
  `tierRequirements`); LEARN buttons call `perk <name>`.
- Verified unit (node) + headless chromium: creation cards, charCreate w/ cls, stats line,
  tree gating text, spend-with-no-points rejection, modal rows, zero page errors.

## Character sheet (2026-09-23)

- **SHEET** button (quickbar) + **CHAR DATA** button (left attrs panel) opens a full
  character sheet modal (`client/app.js` `openSheet`/`renderSheet`): class art + class name
  overlay, identity (class/lifepath/style), HP/STAM/RAM/XP bars, the 5 attributes, merit rows
  (level/xp/eddies/rep/armor/crit/dodge/chrome/humanity/kills/deaths/gigs/hacks/weight),
  loadout (weapon + chest piece incl. dmg/armor), installed chrome (with humanity cost),
  owned quickhacks, owned perks with a shortcut to the perk tree, and an image-attribution
  credit line. Pure client-side from the existing `state`/`inv` payloads, so it live-refreshes.
- `stateForClient` gained `gigs_done` + `hacks` for the sheet.
- **Class art** (`client/img/class-<cls>.jpg`) are real free-license images from Wikimedia
  Commons (no AI art): Solo=Osaka nighttime, Netrunner=PCB macro, Techie=locomotive fitting
  shop (PD), Rockerboy=live band under lights, Nomad=Nevada Hwy 50 sunset. Attribution lives
  in `client/img/CREDITS.json` and is shown bottom of the sheet; server MIME map now includes
  `.jpg/.jpeg`.

## Resolved issues (2026-09-22)

- **`up <attr>` crash**: spending an attribute point from a bare dir (no args)
  crashed the server; fixed in `server/commands.js` (guard before `up 0`).
- **Stale room view across respawn**: NPC respawns published a `room` payload only
  in the kill handler; on respawn the room state was not re-pushed, so clients held a
  stale `room.npcs`. Fixed by pushing the room update on respawn in `server/world.js`
  + `server/engine.js`. Verified live: hostiles reappear for connected clients.
- **Gameplay walk timeout (from prior "Known issue")**: root cause was the test bot
  walking `w` from `watson-streets` to `little-china` and then trying `se` —
  a bad `via` route (the `route` table was populated from the *world payload*, which
  is flat room metadata without exits, so any BFS over it failed). Harness now uses
  explicit `via`/reenter routes; cooldown waits park the bot in a SAFE room.
  `nc-gameplay.mjs` passes fresh and `--consecutive` (two full loops back-to-back).
- **LOOK/INV/JOBS buttons showed no output**: `look` already printed the room to the
  log, but `inv`/`jobs` only re-pushed the (already-visible) side panels, so clicking
  them appeared to do nothing. Fixed in `server/commands.js`: `cmdInv` and `cmdJobs`
  now call `game.pushInv`/`game.pushJobs` AND print a readable summary to the log
  (`◈ INVENTORY` with HANDS/BODY + stacks; `◈ GIGS` with fixers present + gig status
  list). Verified live in headless chromium: all three quickbar buttons print output.
- **Area activity added**: the terminal now shows life in the current area.
  New `server/ambient.js` generator sends periodic themed `amb` lines to the room log
  (matched to room category, district, and danger via `engine.tickAmbient`, on an
  independent 18–42s cadence per occupied room), occasional idle NPC chatter, and a
  respawn announcement when an NPC comes back in a room a player is in. `tickRespawns`
  now returns spawn objects (not just room ids) so the engine can announce them.
  Logged with `cls: 'amb'` (italic dim in `client/style.css`). Verified via live
  harness (ambient cadence) and a direct engine-session test (respawn announce).
- **Cityscape rebuilt (Cyberpunk 2077 style — neon, bright, violent)**: the background
  scene is now layered (`client/index.html` `.scene-*` depth layers; `client/style.css`
  custom-prop skyline silhouettes, window grids, neon strips, shimmer billboard,
  beacons, traffic streaks), with per-district variants selected by `renderScene`
  setting `#scene[data-district=…]` (citycenter/westbrook/heywood/pacifica/santo).
  V2 revamp: big low sun (yellow core, orange+magenta bloom) sitting *behind* the far
  silhouette, magenta/purple district-tinted sky w/ red radial overspill, sweeping
  searchlight (`scene-beam`), flickering window dots (`windowflick`), brighter
  era/street layers + wet-street neon reflections (`scene-street`), 4 red aviation
  beacons. Removed after review: the SAMSARA NET holo-face billboard (`.scene-holo`)
  and the vertical neon sign tubes (`.scene-neon .nl1..4`). Verified across all
  districts in headless chromium (incl. rain) with no console errors.

## Notes / quirks

- **Client logout (new)**: LOGOUT button in the HUD (`client/index.html`, styled
  `.hud-logout`). Client sends `{t:'logout'}`; `handleLogout` (`server/engine.js`)
  persists the player (played_sec, serialize, jack-out room log), revokes the
  session token (`db.deleteSession` using `session.token` set in `authSuccess`),
  clears `byAccount`, marks the session unauthenticated, and replies `{t:'logout'}`.
  Client then clears `nc_token`/`nc_user` from localStorage, resets S state, and
  returns to the auth screen (same open socket; no reconnect). Verified end-to-end
  in headless chromium: register→create→game→LOGOUT→auth screen, localStorage
  cleared, and a `resume` with the revoked token is rejected
  ("Session expired. Log in again.").
- **Combat overlay (new)**: while hostiles are present the client shows a big
  animated HOSTILE CONTACT panel over the play area (`client/index.html`
  `#combatfx`, styled in `client/style.css`, driven by `openCombat()` in
  `client/app.js`). Shows player HP/STAM bars + active buffs, per-foe cards with
  animated HP bar + ATK/HACK/SCAN buttons, and a footer action bar
  (DEFEND/EVADE/GRENADE/STIM/SCAN wired to `cmd()`). Pulsing red danger frame,
  scanline sweep, glitch title, foe entrance pop, shake on player damage, and
  floating combat numbers (-N on you, -N/'✕' on foes). Room payload now carries
  per-hostile `hp`/`maxhp` so bars update on every push. Verified live in headless
  chromium: overlay appears in combat, ATK updates bars (tyger 50→34), DEFEND adds
  buff, no console errors; pixel-confirmed in a screenshot. Difficulty also eased
  for low-level mobs: enemies now use hit base 0.5 (was 0.6, shared `hitChance`)
  with reduced level damage scaling (`level*0.6` vs `0.9`), spawn with a staggered
  initial `attackAt` (400–2200ms random) so rooms don't alpha-strike tick 1, and
  the weakest hostiles were trimmed (tyger-1 55→48, tyger-2 75→68, scav-1 50→46,
  scav-2 75→68, valentino-1 65→58, raider-1 70→62). `nc-diff-sim.mjs` measures
  ~99–100% win vs. single low mobs and ~54% trading straight-up (86% with a
  stimpack) vs. the 2-tyger Watson fight.
- **Attribute double-add (RESOLVED — root cause found)**: `makeNewPlayer` in
  `server/player.js` did `attrs[a] = 3 + v`, treating the create-form value as a
  *bonus on top of* the base 3, while the engine's charCreate validation and the
  client both treat `v` as the *absolute* attribute value. Fix: assign the value
  directly (clamped to `ATTR_MIN..ATTR_MAX_CREATE`), then add the lifepath bonus.
  Verdict: not `up <attr>` (that path was always +1); creation was inflating every
  attribute by exactly +3 (pool 8 became pool ~24). Verified live: `{body:9}`
  now creates body 9 (+streetkid cool bonus), pool 7. **Save-migration**: Razaroth
  was created under the bug; its attrs were re-derived (stored−3, cool also −1)
  to the intended build `{body5,reflexes5,tech4,intel4,cool6}` (pool 8) and the
  save patched in place.
- **Heal budget**: a new streetkid carries 2× bounce-back (40 HP each) + 3× stimpack
  (25 each) = 155 HP. The 4-fight loop (2 tyger + 2 scav) can out-drain that on bad
  RNG; the harness stocks 3 extra stimpacks (96€$ each at Rostovic) and heals in-fight
  below 60% HP. If fights get harder, revisit threshold/budget.
- **Inventory buttons used to fail**: the UI sends item actions by `uid`
  (`equip/use/sell/drop/install/grenade <uid>`), but `findItem` in `server/commands.js`
  only matched item `id`/`name` — every INV button returned "You aren't carrying".
  Fixed by matching `s.uid === query` first. Verified live: equip/use/sell/drop by uid
  all resolve; Rostovic only buys weapons/grenades/consumables (apparel is legitimately
  refused — sell it elsewhere).
- **Consecutive runs**: hostiles respawn 90s (bosses 600s). `nc-gameplay.mjs` records
  kill timestamps to `nc-respawn.json` (`NC_RESPAWN_LOG`); a fresh run unlinks it and
  passes `--consecutive` to respect cooldowns (waits in a safe room instead of a den).

## When restarting the server

- Note earlier accidental port conflict: kill orphans
  (`pgrep -af "server/index.js"`) before `systemctl --user start night-city`.

## World-data cheat sheet (for tests)

- Streetkid start `megabuilding-h10` → `kabuki-market` is `s, e` (hostiles tyger-1/2, fixer
  wakako, weapon vendor weapons-rostovic). `scav-den` is `s, se, s`. Ripperdoc-watson `s, ne`.
- Maelstrom-den from start: `s, sw, ne` (contains maelstrom-boss, lv6 — used for death test).
- NPC defs: hp = `maxhp`, weapon by id, armor number; loot/eddies arrays (see npcs.json).
- Cheapest cyberware = synth-lungs 500€$ (torso, cap 1). Ripdoc sellMul 1.4, buyMul 0.5;
  weapon vendor sellMul 1.6.
- Plumbing: the world *payload* rooms have no exits (id/name/district/category only),
  so route planning must read `world.json` rooms[].exits; the harness uses explicit
  `via`/reenter step lists (see `nc-client.mjs` `route()`).

## Test harness files (outside the repo, in /tmp/opencode)

- `nc-test.mjs` — handshake + create + move smoke test (fast, deterministic).
- `nc-battery.mjs` — 43 commands, asserts no server "command error".
- `nc-gameplay.mjs` — full gameplay loop per above. `--consecutive` respects respawn
  cooldowns (waits in safe rooms); plain run assumes a fresh server and unlinks the
  respawn log. Uses alive-guards, heal-while-waiting, and reenter routes after any
  mid-test respawn.
- `nc-client.mjs` — shared WS client (`waitNpc`, `kill`, `killAndLoot`, `route`,
  `ensureDeadCooldown`, `healTo`, `waitLog`, `assert`/`ok`/`fail`).
- `nc-clean.mjs` — removes `gp_`/`dt_`/`sm_`/`bt_` accounts from the save (run with
  the service stopped).
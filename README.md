# NIGHT CITY

A shareable, self-hosted cyberpunk MUD MMORPG. Text-driven world, neon browser UI,
realtime multiplayer over WebSockets. Clone it, run one command, send your friends a link.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:8123**.

- `npm run dev` — same, but restarts on server file changes (`node --watch`).

No database, no build step, no accounts service. Everything lives in one JSON save file
on the host machine.

## Playing with friends

The server binds `0.0.0.0`, so anyone who can reach the port can play.

| Setup | What to do |
| --- | --- |
| Same Wi-Fi | Share `http://<your-lan-ip>:8123` (the boot banner prints it) |
| Over the internet | Port-forward TCP `8123` on your router, share your public IP |
| No port-forwarding | Use [Tailscale](https://tailscale.com) and share the `100.x` address |
| Different port | `PORT=9000 npm start` |

Env vars: `PORT` (default `8123`), `HOST` (default `0.0.0.0`).

## Your first ten minutes

1. **NEW RUNNER** → pick a handle + passphrase.
2. **Make your runner** — callsign, style, lifepath (Corpo / Street Kid / Nomad), spend
   8 attribute points (baseline 3, max 9 at creation), and pick up to 3 starting implants
   (max 4 chrome capacity).
3. You wake up somewhere in Night City. Type `help`.
4. `look`, then move with the compass buttons or `n` / `s` / `e` / `w` / `ne` …
5. Find a **fixer** (`jobs` → `accept <gig>`), a **vendor** (`shop`), or a **ripperdoc**
   (buy/`install` cyberware).
6. Start a fight with `attack <name>`. Loot corpses with `take`.

### Handy commands

```
look          stats         inv           equipment (in inv panel)
go <dir>      attack <npc>  hack <qh> <npc>   grenade <type>
defend        dodge         sandevistan   berserk
shop          buy <item>    sell <item>   install <cyberware>
jobs          accept <gig>  talk <npc>    up <attr>
special       special enter <mission-id>      special leave
travel <district>           map           who
```

Buttons throughout the UI emit these commands for you — the command line is always
available and is the fastest way to play.

## How it works

- **Server:** Node.js + `ws`. `server/index.js` serves the static client and upgrades
  WebSockets. `server/engine.js` is the game loop (1s tick): player regen, NPC AI and
  threat targeting, status effects, autosave.
- **Client:** plain HTML/CSS/JS, no framework. The scene is pure CSS (district-tinted sky,
  neon sun, skyline, animated rain and perspective grid) — no image assets.
- **Persistence:** `data/save/world.json`, written atomically (tmp + rename) and debounced,
  plus autosave every 20s and on shutdown. Delete it to reset the server.
- **Passwords:** salted `scrypt` via Node's `crypto`. Sessions are random tokens (30-day TTL).
- **Combat:** turn/timer-based. Each weapon has a cooldown (`speed`) reduced by haste and
  Sandevistan. Quickhacks cost RAM and need a cyberdeck. Cyberware uses slot + capacity.
- **PvP is disabled.** Gigs are one-time contracts and disappear when completed. Special
  Missions remain replayable on their own cooldowns.
- **Special Missions** are private, multi-room dungeon runs. Use `special` to see the slate,
  `special enter <mission-id>` to jack in, and `special leave` to extract. Clear each room
  before pushing deeper; completing a run pays eddies, XP, and rep. All four named bosses are
  now exclusive to their Special Missions. Accept Rogue's `Bad Fish in the Nest` gig before
  entering its cyberpsycho mission (level 8+). Enemy levels and mission rewards rise with the
  runner's level; active gig targets and payouts do too. Higher-level runners have better odds
  of rare loot. Mission completion and replay cooldowns save with your runner.

## Content

7 districts (Watson, Westbrook, City Center, Heywood, Pacifica, Santo Domingo, the Badlands),
57 city rooms, 38 NPCs, 5 fixers, 5 gigs, 5 Special Missions, ~70 items. Edit the JSON in `data/` to add more —
`data/world.json` (districts + rooms), `data/npcs.json` (NPCs), `data/items.json` (catalog).
Keep them as valid double-quoted JSON.

## Project layout

```
server/   index.js  engine.js  commands.js  combat.js  player.js
          world.js  items.js   quests.js    special-missions.js  scaling.js  db.js
client/   index.html  style.css  app.js
data/     world.json  npcs.json  items.json   save/world.json (runtime)
```

## License

Do what you want with it. Cyberpunk 2077 is a trademark of CD Projekt Red; this is an
unaffiliated fan project.

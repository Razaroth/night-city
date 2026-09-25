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
travel <district>           tram          tram <district>
map           who
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
- **NCART Night Line** links seven district platforms in a loop. Use the map's glowing rail
  and station markers to walk to a platform; at a station, select a destination or type
  `tram <district>`. Fares are 18 eddies per stop, and the train takes the shorter direction
  around the loop. Trips take time and can turn up fare-jackers, dropped credchips, or a
  carriage-wide Samurai singalong. Defeat fare-jackers with the regular combat commands and
  loot them before disembarking.

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

## Hosting the game

The server is a long-running Node.js process with WebSocket connections and a local JSON
save. The Render setup below uses Upstash Redis for durable saves because Render's free
service sleeps when idle and its local filesystem is temporary.

### Render Free

1. Create a free Redis database at [Upstash](https://upstash.com/) and copy its REST URL and
   token from the database console. The free plan includes 256 MB and 500,000 commands/month.
2. To preserve your current local save, upload it to the empty Upstash database before the
   first Render deploy. Run this from the project directory, using your Upstash credentials:

   ```sh
   export UPSTASH_REDIS_REST_URL='https://your-database.upstash.io'
   export UPSTASH_REDIS_REST_TOKEN='your-token'
   curl -fsS -X POST "$UPSTASH_REDIS_REST_URL/set/night-city-world" \
     -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
     -H 'Content-Type: text/plain' \
     --data-binary @data/save/world.json
   ```

   Upstash should reply with `{"result":"OK"}`. Keep the token private.
3. Push the project to GitHub, then in Render choose **New → Blueprint** and connect the
   repository. Render reads `render.yaml`, creates the free Docker Web Service, and prompts
   for the Upstash REST URL and token. Use the same database you migrated above.
4. After deployment, share the Render `onrender.com` URL. Render provides HTTPS, and the game
   client automatically uses secure WebSockets. Player saves remain in Upstash across service
   sleeps, restarts, and redeploys.

Render's free service sleeps after 15 minutes without inbound traffic and may take about a
minute to wake. Connected players keep it active through WebSocket pings, but it is not a hard
24/7 guarantee. `render.yaml` requires remote-save credentials so it won't silently fall back
to temporary local storage.

### Alternative: Oracle Cloud Always Free VM

1. Create an Ubuntu VM using the **Always Free eligible** Ampere A1 shape. Current Always
   Free limits are 2 OCPUs, 12 GB RAM, and 200 GB combined block storage; a 1 OCPU / 6 GB
   VM is ample for this game and may be easier to provision when capacity is tight.
2. Point a domain at the VM's public IP. A free [DuckDNS](https://www.duckdns.org/) subdomain
   works; note the hostname for the `.env` configuration below.

3. Allow inbound TCP ports **22, 80, and 443** in the Oracle VCN security rules. Port 80/443
   are for Caddy HTTPS; the game port stays private to Docker.
4. Install Docker Engine, Docker Compose, and UFW on Ubuntu:

   ```sh
   sudo apt update
   sudo apt install -y git docker.io docker-compose-v2 ufw
   sudo systemctl enable --now docker
   ```

5. Allow SSH and Caddy through Ubuntu's host firewall:

   ```sh
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 443/udp
   sudo ufw --force enable
   ```

6. Clone and configure the project:

   ```sh
   git clone https://github.com/Razaroth/night-city.git
   cd night-city
   mkdir -p data/save
   cp .env.example .env
   # Edit .env and set DOMAIN to your hostname
   ```

   To migrate your existing save, copy `data/save/world.json` from your current machine to
   `~/night-city/data/save/world.json` on the VM before the first start. Run this example
   from your current machine, replacing the source path and VM IP:

   ```sh
   scp /path/to/night-city/data/save/world.json ubuntu@<VM-IP>:~/night-city/data/save/world.json
   ```

7. Start the game and reverse proxy:

   ```sh
   sudo docker compose up -d --build
   sudo docker compose logs -f night-city
   ```

   Caddy obtains and renews the HTTPS certificate and proxies WebSocket traffic to the game.
   Share `https://<your-domain>` with players. A host-directory mount keeps `world.json`
   across container rebuilds and restarts. The container runs as UID 1000, matching Ubuntu's
   default `ubuntu` account. Back up the save periodically with:

   ```sh
   cp data/save/world.json world.json.backup
   ```

8. Update the game later with `git pull` and `sudo docker compose up -d --build`.

Oracle Always Free has no uptime SLA or guaranteed regional capacity. Oracle may reclaim an
Always Free VM if CPU, network, and (for A1) memory utilization all stay below 20% over a
seven-day period. So this is a good no-cost home for the game, but not a hard 24/7 guarantee.

## License

Do what you want with it. Cyberpunk 2077 is a trademark of CD Projekt Red; this is an
unaffiliated fan project.

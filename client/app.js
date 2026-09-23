'use strict'

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmt = (s) => esc(s).replace(/\[B\](.*?)\[\/B\]/g, '<span class="hl">$1</span>')

const S = {
  ws: null,
  connected: false,
  retry: 0,
  token: localStorage.getItem('nc_token') || '',
  username: localStorage.getItem('nc_user') || '',
  authMode: 'login',
  world: { districts: {}, rooms: [], items: [] },
  roomIndex: {},
  itemIndex: {},
  creation: null,
  char: null,
  inv: null,
  room: null,
  jobs: null,
  shop: null,
  hist: [],
  histIdx: -1,
  draft: { name: '', lifepath: 'streetkid', style: 'entropism', attrs: { body: 3, reflexes: 3, tech: 3, intel: 3, cool: 3 }, cyberware: [] }
}

const DIST_ORDER = ['watson', 'westbrook', 'citycenter', 'heywood', 'pacifica', 'santo', 'badlands']

/* ================= connection ================= */
function connect () {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}`)
  S.ws = ws
  ws.onopen = () => {
    S.connected = true
    S.retry = 0
    if (S.token && S.username) send({ t: 'resume', username: S.username, token: S.token })
  }
  ws.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    handle(msg)
  }
  ws.onclose = () => {
    S.connected = false
    if ($('#game') && !$('#game').classList.contains('hidden')) {
      addLog([{ text: '── CONNECTION LOST — reconnecting ──', cls: 'bad' }])
    }
    S.retry = Math.min(S.retry + 1, 8)
    setTimeout(connect, 500 * S.retry)
  }
  ws.onerror = () => {}
}
function send (o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)) }
function cmd (line) {
  if (!line || !line.trim()) return
  send({ t: 'cmd', line })
  S.hist.push(line); S.histIdx = S.hist.length
  addLog([{ text: '> ' + line, cls: 'sys' }])
}

/* ================= message handling ================= */
function handle (msg) {
  switch (msg.t) {
    case 'hello':
      $('#onlinecount').textContent = msg.motd || ('v' + msg.version)
      $('#hud-online').textContent = 'v' + msg.version
      break
    case 'auth': return onAuth(msg)
    case 'world': {
      S.world = msg
      S.roomIndex = {}
      for (const r of msg.rooms) S.roomIndex[r.id] = r
      S.itemIndex = {}
      for (const it of msg.items) S.itemIndex[it.id] = it
      break
    }
    case 'needChar': S.creation = msg.creation; showScreen('creation'); renderCreation(); break
    case 'charCreated': toast('Runner on file: ' + msg.name, 'good'); break
    case 'entered': onEntered(msg); break
    case 'room': S.room = msg; onRoom(msg); break
    case 'state': S.char = msg.state; renderHud(); renderVitals(); renderAttrs(); renderQuickbar(); break
    case 'inv': S.inv = msg; renderInventory(); renderEquipment(); renderQuickhacks(); renderQuickbar(); break
    case 'jobs': S.jobs = msg; renderJobs(); renderActions(); break
    case 'shop': S.shop = msg; openShop(); break
    case 'log': addLog(msg.lines); break
    case 'toast': toast(msg.text, msg.cls); break
    case 'death': onDeath(msg); break
    case 'respawned': onRespawned(); break
    case 'error': toast(msg.msg, 'bad'); addLog([{ text: msg.msg, cls: 'bad' }]); break
    case 'kicked': toast(msg.msg, 'bad'); localStorage.clear(); setTimeout(() => location.reload(), 1500); break
    case 'logout': onLogout(); break
    case 'charDeleted': toast('Runner wiped.', 'bad'); break
  }
}

function onAuth (msg) {
  if (!msg.ok) {
    if (S.token) { localStorage.removeItem('nc_token'); localStorage.removeItem('nc_user'); S.token = ''; S.username = '' }
    $('#auth-err').textContent = msg.error || 'Authentication failed.'
    return
  }
  S.token = msg.token; S.username = msg.username
  localStorage.setItem('nc_token', msg.token)
  localStorage.setItem('nc_user', msg.username)
  $('#auth-err').textContent = ''
  if (msg.hasChar) toast('Welcome back, ' + msg.username, 'good')
}

function onLogout () {
  localStorage.removeItem('nc_token')
  localStorage.removeItem('nc_user')
  S.token = ''
  S.username = ''
  S.char = null
  S.inv = null
  S.room = null
  S.jobs = null
  S.shop = null
  S.creation = null
  if (S.deathTimer) { clearInterval(S.deathTimer); S.deathTimer = null }
  $('#deathveil').classList.add('hidden')
  $('#auth-pass').value = ''
  $('#auth-err').textContent = ''
  showScreen('auth')
  toast('JACKED OUT. Bye for now.', 'sys')
}

function onEntered (msg) {
  showScreen('game')
  $('#hud-name').textContent = msg.name
  $('#cmdinput').focus()
  toast('JACKED IN — ' + msg.name, 'good')
  $('#deathveil').classList.add('hidden')
}

function onRoom (msg) {
  $('#deathveil').classList.add('hidden')
  if (S.deathTimer) { clearInterval(S.deathTimer); S.deathTimer = null }
  renderScene(msg)
  renderActions()
  renderMinimap()
}

function onDeath (msg) {
  $('#death-sub').textContent = 'RESPAWNING IN ' + Math.ceil(msg.respawnIn / 1000) + 's…'
  $('#deathveil').classList.remove('hidden')
  if (S.deathTimer) clearInterval(S.deathTimer)
  let n = Math.ceil(msg.respawnIn / 1000)
  S.deathTimer = setInterval(() => {
    n--
    $('#death-sub').textContent = n > 0 ? 'RESPAWNING IN ' + n + 's…' : 'FLATLINED'
    if (n <= 0) { clearInterval(S.deathTimer); S.deathTimer = null }
  }, 1000)
}

function onRespawned () {
  const fx = $('#respawnfx')
  if (!fx) return
  if (S.respawnTimer) clearTimeout(S.respawnTimer)
  fx.classList.remove('hidden')
  fx.classList.remove('run')
  void fx.offsetWidth
  fx.classList.add('run')
  S.respawnTimer = setTimeout(() => {
    fx.classList.add('hidden')
    fx.classList.remove('run')
  }, 2200)
}

/* ================= auth screen ================= */
function showScreen (name) {
  for (const s of ['auth', 'creation', 'game']) $('#' + s).classList.toggle('hidden', s !== name)
}
$$('.tab').forEach(t => t.onclick = () => {
  S.authMode = t.dataset.tab
  $$('.tab').forEach(x => x.classList.toggle('active', x === t))
  $('#auth-submit').textContent = S.authMode === 'login' ? 'JACK IN' : 'CREATE ACCOUNT'
})
$('#authform').onsubmit = (e) => {
  e.preventDefault()
  $('#auth-err').textContent = ''
  const username = $('#auth-user').value.trim()
  const password = $('#auth-pass').value
  if (!username || !password) { $('#auth-err').textContent = 'Handle and passphrase required.'; return }
  send(S.authMode === 'login' ? { t: 'login', username, password } : { t: 'register', username, password })
}

/* ================= creation ================= */
function renderCreation () {
  const c = S.creation
  if (!c) return
  $('#c-name').value = S.draft.name
  $('#c-name').oninput = () => { S.draft.name = $('#c-name').value }

  const sp = $('#style-picker')
  sp.innerHTML = ''
  for (const st of Object.values(c.styles)) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'chip' + (S.draft.style === st.id ? ' active' : '')
    b.textContent = st.name; b.title = st.desc
    b.onclick = () => { S.draft.style = st.id; renderCreation() }
    sp.appendChild(b)
  }

  const lp = $('#lifepath-picker')
  lp.innerHTML = ''
  for (const l of Object.values(c.lifepaths)) {
    const d = document.createElement('div')
    d.className = 'lp-card' + (S.draft.lifepath === l.id ? ' active' : '')
    d.innerHTML = `<h4 style="color:${l.color}">${esc(l.name.toUpperCase())}</h4>
      <p>${esc(l.desc)}</p>
      <p class="bonus">+1 ${esc(c.attrLabels?.[l.attrBonus] || l.attrBonus.toUpperCase())} • ${l.eddies} eddies • starts in ${esc(roomName(l.startRoom))}</p>`
    d.onclick = () => { S.draft.lifepath = l.id; renderCreation() }
    lp.appendChild(d)
  }

  // attrs
  const used = Object.values(S.draft.attrs).reduce((a, v) => a + (v - 3), 0)
  const left = c.basePoints - used
  $('#attr-pts').textContent = left
  const al = $('#attr-list')
  al.innerHTML = ''
  for (const a of c.attrs) {
    const row = document.createElement('div')
    row.className = 'attr-row'
    const v = S.draft.attrs[a]
    row.innerHTML = `<span class="aname">${esc(c.attrLabels[a])}</span>
      <span class="attr-bar"><i style="width:${(v / c.attrMaxCreate) * 100}%"></i></span>
      <button type="button" data-m="-1">−</button>
      <span class="val">${v}</span>
      <button type="button" data-m="1">+</button>`
    row.querySelectorAll('button').forEach(b => b.onclick = () => {
      const m = parseInt(b.dataset.m, 10)
      const nv = S.draft.attrs[a] + m
      if (nv < c.attrMin || nv > c.attrMaxCreate) return
      if (m > 0 && left <= 0) return
      S.draft.attrs[a] = nv
      renderCreation()
    })
    al.appendChild(row)
  }

  // chrome
  const rawCap = S.draft.cyberware.reduce((s, id) => s + (itemDef(id)?.capacity || 0), 0)
  $('#chrome-cap').textContent = rawCap
  const cl = $('#chrome-list')
  cl.innerHTML = ''
  for (const ch of c.chrome) {
    const sel = S.draft.cyberware.includes(ch.id)
    const d = document.createElement('div')
    d.className = 'chrome-card' + (sel ? ' active' : '')
    d.innerHTML = `<b>${esc(ch.name)}</b>
      <span class="meta">CAP ${ch.capacity} • HUMANITY ${ch.humanity} • ${esc(ch.slot)}</span>
      <div class="d">${esc(ch.desc)}</div>`
    d.onclick = () => {
      const i = S.draft.cyberware.indexOf(ch.id)
      if (i >= 0) S.draft.cyberware.splice(i, 1)
      else {
        if (S.draft.cyberware.length >= 3) return
        const slotConflict = S.draft.cyberware.some(id => itemDef(id)?.slot === ch.slot)
        if (slotConflict) return
        if (rawCap + ch.capacity > 4) return
        S.draft.cyberware.push(ch.id)
      }
      renderCreation()
    }
    cl.appendChild(d)
  }
}
function itemDef (id) { return S.itemIndex[id] }
function roomName (id) { return S.roomIndex[id]?.name || id }

$('#create-btn').onclick = () => {
  const c = S.creation
  const name = S.draft.name.trim()
  const err = (m) => { $('#create-err').textContent = m }
  if (name.length < 2) return err('Pick a callsign (2+ characters).')
  const used = Object.values(S.draft.attrs).reduce((a, v) => a + (v - 3), 0)
  if (used > c.basePoints) return err('Too many attribute points spent.')
  err('')
  send({ t: 'charCreate', name, lifepath: S.draft.lifepath, style: S.draft.style, attrs: S.draft.attrs, cyberware: S.draft.cyberware })
}

/* ================= HUD / vitals ================= */
function renderHud () {
  const s = S.char
  if (!s) return
  $('#hud-name').textContent = s.name
  $('#hud-lp').textContent = s.lifepathName.toUpperCase()
  $('#hud-level').textContent = 'LV ' + s.level
  $('#hud-eddies').textContent = s.eddies
  $('#hud-rep').textContent = s.rep
  if (S.room) $('#hud-clock').textContent = S.room.clock
}
function bar (cls, val, max, label) {
  const pct = Math.max(0, Math.min(100, max ? (val / max) * 100 : 0))
  return `<div class="vital ${cls}"><div class="lab"><span>${label}</span><span>${Math.floor(val)} / ${Math.floor(max)}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div></div>`
}
function renderVitals () {
  const s = S.char
  if (!s) return
  const buffs = s.buffs || {}
  $('#vitals').innerHTML =
    bar('hp', s.hp, s.maxHp, 'HEALTH') +
    bar('stam', s.stam, s.maxStam, 'STAMINA') +
    (s.maxRam > 0 ? bar('ram', s.ram, s.maxRam, 'RAM') : '') +
    bar('xp', s.xp, s.xpToNext, 'XP') +
    `<div class="buffrow">
      <span class="buff ${buffs.sandevistan ? '' : 'off'}">SANDY</span>
      <span class="buff ${buffs.berserk ? '' : 'off'}">BERSERK</span>
      <span class="buff ${buffs.defend ? '' : 'off'}">DEFEND</span>
      <span class="buff ${buffs.dodge ? '' : 'off'}">EVADE</span>
    </div>
    <div class="attr-mini"><span>ARMOR</span><b>${s.dr}</b></div>
    <div class="attr-mini"><span>CRIT</span><b>${s.crit}%</b></div>
    <div class="attr-mini"><span>CHROME</span><b>${s.capacityUsed}/${s.capacity}</b></div>
    <div class="attr-mini"><span>HUMANITY</span><b>${s.humanity}%</b></div>`
}
function renderAttrs () {
  const s = S.char
  if (!s) return
  const labels = { body: 'BODY', reflexes: 'REFLEXES', tech: 'TECH', intel: 'INT', cool: 'COOL' }
  let html = ''
  for (const [k, v] of Object.entries(s.attrs)) html += `<div class="attr-mini"><span>${labels[k]}</span><b>${v}</b></div>`
  if (s.attrPoints > 0) {
    html += '<div class="spend"><button id="spend-btn">SPEND ' + s.attrPoints + ' POINT(S)</button></div>'
  }
  $('#attrs').innerHTML = html
  const b = $('#spend-btn')
  if (b) b.onclick = () => { const a = prompt('Raise which attribute? (body/reflexes/tech/intel/cool)', 'body'); if (a) cmd('up ' + a.trim()) }
}

/* ================= scene ================= */
function renderScene (room) {
  const d = S.world.districts[room.district]
  document.documentElement.style.setProperty('--district', d?.color || '#4ae7ff')
  $('#scene').dataset.district = room.district
  $('#scene-district').textContent = (d?.name || room.district).toUpperCase()
  $('#scene-room').textContent = room.name
  $('#scene-weather').textContent = (room.clock || '') + '  •  ' + (room.weather || '')
  if (room.clock) $('#hud-clock').textContent = room.clock
  let danger = $('#scene').querySelector('.scene-danger')
  if (room.danger) {
    if (!danger) { danger = document.createElement('div'); danger.className = 'scene-danger'; $('#scene').appendChild(danger) }
    danger.textContent = '⚠ COMBAT ZONE'
  } else if (danger) danger.remove()
}

/* ================= area / actions ================= */
function renderActions () {
  const room = S.room
  if (!room) return
  const hostiles = (room.npcs || []).filter(n => n.kind === 'hostile')
  const others = (room.npcs || []).filter(n => n.kind !== 'hostile')
  let html = ''

  for (const n of hostiles) {
    const cls = n.danger === 'boss' ? 'npc-row hostile boss' : 'npc-row hostile'
    const qh = S.inv?.quickhacks?.[0]?.id
    html += `<div class="${cls}">
      <div class="nname">${esc(n.name)}<small>${esc(n.faction)}${n.stunned ? ' • STUNNED' : ''}${n.burning ? ' • BURNING' : ''}</small>
        <div class="hpbar"><i style="width:${n.hpPct ?? 100}%"></i></div></div>
      <div class="npc-btns">
        <button data-cmd="attack ${esc(n.id)}">ATK</button>
        <button data-cmd="${qh ? `hack ${qh} ${esc(n.id)}` : 'attack ' + esc(n.id)}" ${qh ? '' : 'disabled'} title="${qh ? '' : 'Need a quickhack + deck'}">HACK</button>
        <button data-cmd="look ${esc(n.id)}">SCAN</button>
      </div></div>`
  }
  for (const n of others) {
    const btns = []
    if (n.kind === 'vendor' || n.kind === 'ripper') btns.push(`<button data-cmd="shop ${esc(n.id)}">SHOP</button>`)
    if (n.kind === 'fixer') btns.push('<button data-cmd="jobs">JOBS</button>')
    btns.push(`<button data-cmd="talk ${esc(n.id)}">TALK</button>`)
    html += `<div class="npc-row"><div class="nname">${esc(n.name)}<small>${esc(n.kind.toUpperCase())} • ${esc(n.faction)}</small></div>
      <div class="npc-btns">${btns.join('')}</div></div>`
  }
  if (!room.npcs || !room.npcs.length) html += '<div class="empty-note">No one else here.</div>'

  if (room.corpse) {
    html += `<div class="obj-row" style="color:var(--yellow)">Corpse: ${esc(room.corpse.name)} — ${room.corpse.eddies}€$, ${room.corpse.items.length} item(s)
      <button class="qbtn" data-cmd="take" style="margin-left:6px">LOOT</button></div>`
  }
  html += '<div class="exit-grid" style="margin-top:8px">'
  for (const e of room.exits) html += `<button data-cmd="${e.dir}">${e.name.toUpperCase()} →</button>`
  html += '</div>'
  if (room.players && room.players.length) {
    html += `<div class="players-here">Runners here: ${room.players.map(p => esc(p.name) + ' (Lv' + p.level + ')').join(', ')}</div>`
  }
  if (room.objects && room.objects.length) {
    for (const o of room.objects) html += `<div class="obj-row">${esc(o.name)} — ${esc(o.desc)}</div>`
  }
  $('#actions').innerHTML = html
  bindCmdButtons($('#actions'))
}

function bindCmdButtons (root) {
  root.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => cmd(b.dataset.cmd))
}

/* ================= inventory / equipment ================= */
function renderEquipment () {
  const inv = S.inv
  if (!inv) return
  const slot = (label, st) => `<div class="eq-slot"><span class="sl">${label}</span><span class="it ${st ? '' : 'empty'}">${st ? esc(st.name) : '— empty —'}</span></div>`
  const arms = (inv.cyberware || []).find(c => c.slot === 'arms')
  $('#equipment').innerHTML =
    slot('HANDS', inv.equip.hands) +
    slot('BODY', inv.equip.chest) +
    slot('ARMS', arms || null)
}

function renderInventory () {
  const inv = S.inv
  if (!inv) return
  $('#inv-weight').textContent = S.char ? `${S.char.weight}/${S.char.carryCap}kg` : ''
  const list = inv.stacks
  if (!list.length) { $('#inventory').innerHTML = '<div class="empty-note">Nothing but lint and regret.</div>'; return }
  const ripperHere = (S.room?.npcs || []).some(n => n.kind === 'ripper')
  const equippedSlot = {}
  for (const [slot, st] of Object.entries(inv.equip || {})) if (st?.uid) equippedSlot[st.uid] = slot
  let html = ''
  for (const it of list) {
    const btns = []
    if (it.category === 'consumables') btns.push(`<button data-cmd="use ${it.uid}">USE</button>`)
    if (it.category === 'weapons' || it.category === 'apparel') {
      const slot = equippedSlot[it.uid]
      if (slot) btns.push(`<button class="equipped" data-cmd="unequip ${slot}" title="Click to unequip">EQUIPPED</button>`)
      else btns.push(`<button data-cmd="equip ${it.uid}">EQUIP</button>`)
    }
    if (it.category === 'cyberware' && ripperHere) btns.push(`<button data-cmd="install ${it.uid}">INSTALL</button>`)
    if (it.category === 'grenades') btns.push(`<button data-cmd="grenade ${it.uid}">THROW</button>`)
    btns.push(`<button class="sell" data-cmd="sell ${it.uid}">SELL</button>`)
    btns.push(`<button data-cmd="drop ${it.uid}">DROP</button>`)
    html += `<div class="inv-item"><div class="nm">${esc(it.name)}${it.qty > 1 ? ` <span class="q">x${it.qty}</span>` : ''}${equippedSlot[it.uid] ? ' <span class="eq-badge">EQUIPPED</span>' : ''}
      <small>${esc(it.category)}${it.dmg ? ` • ${it.dmg[0]}-${it.dmg[1]} dmg` : ''}${it.armor ? ` • armor ${it.armor}` : ''}${it.capacity != null ? ` • cap ${it.capacity}` : ''}${it.ram ? ` • ${it.ram} RAM` : ''}</small></div>
      <div class="inv-btns">${btns.join('')}</div></div>`
  }
  $('#inventory').innerHTML = html
  bindCmdButtons($('#inventory'))
}

function renderQuickhacks () {
  const inv = S.inv
  if (!inv) return
  const qh = inv.quickhacks || []
  const hasDeck = S.char?.hasDeck
  if (!qh.length) { $('#quickhacks').innerHTML = '<div class="empty-note">No quickhacks loaded. Buy from a netrunner.</div>'; return }
  let html = hasDeck ? '' : '<div class="empty-note" style="margin-bottom:6px">No deck installed — quickhacks disabled.</div>'
  for (const h of qh) {
    html += `<div class="inv-item"><div class="nm">${esc(h.name)}<small>${esc(h.desc || '')}</small></div>
      <div class="inv-btns"><button data-qh="${esc(h.id)}" ${hasDeck ? '' : 'disabled'}>TARGET</button></div></div>`
  }
  $('#quickhacks').innerHTML = html
  $('#quickhacks').querySelectorAll('[data-qh]').forEach(b => b.onclick = () => {
    const input = $('#cmdinput')
    input.value = 'hack ' + b.dataset.qh + ' '
    input.focus()
  })
}

/* ================= jobs ================= */
function renderJobs () {
  const j = S.jobs
  if (!j) return
  const fixersHere = j.fixersHere || []
  const here = j.gigs.filter(g => fixersHere.includes(g.fixer))
  const others = j.gigs.filter(g => !fixersHere.includes(g.fixer))
  let html = ''
  if (!here.length) html += '<div class="empty-note">Find a fixer for gigs. (Wakako, Padre, Rogue, Dakota, El Capitán)</div>'
  for (const g of here) html += jobCard(g, true)
  for (const g of others) html += jobCard(g, false)
  $('#jobs').innerHTML = html
  $('#jobs').querySelectorAll('[data-gig]').forEach(b => b.onclick = () => cmd('accept ' + b.dataset.gig))
}
function jobCard (g, fixerHere) {
  const status = g.status === 'active' ? `ACTIVE ${g.prog}/${g.total}` : g.status === 'cooldown' ? 'ON COOLDOWN' : 'AVAILABLE'
  const cls = g.status === 'active' ? 'active' : g.status === 'cooldown' ? 'done' : ''
  const can = fixerHere && g.status === 'available'
  return `<div class="job ${cls}"><div class="jt">${esc(g.title)}</div>
    <div class="jd">${esc(g.desc)}</div>
    <div class="jm"><span>${status}</span><span>${g.rewardEddies}€$ • ${g.rewardXp}xp • ${g.rep}rep</span></div>
    <button data-gig="${esc(g.id)}" ${can ? '' : 'disabled'}>${can ? 'ACCEPT' : (fixerHere ? status : 'FIXER ELSEWHERE')}</button></div>`
}

/* ================= minimap ================= */
function renderMinimap () {
  const rooms = S.world.rooms
  if (!rooms.length) return
  const byDist = {}
  for (const r of rooms) (byDist[r.district] ??= []).push(r)
  const colW = 33, gap = 15, top = 10
  let maxN = 1
  for (const d of DIST_ORDER) maxN = Math.max(maxN, (byDist[d] || []).length)
  const height = top + maxN * gap + 16
  const width = colW * DIST_ORDER.length
  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  DIST_ORDER.forEach((d, i) => {
    const dist = S.world.districts[d]
    const cx = i * colW + colW / 2
    svg += `<text x="${cx}" y="${height - 3}" fill="${dist?.color || '#456'}" font-size="6" text-anchor="middle" font-family="monospace">${(dist?.name || d).slice(0, 7).toUpperCase()}</text>`
    const list = byDist[d] || []
    list.forEach((r, k) => {
      const cy = top + k * gap
      const cur = S.room && S.room.id === r.id
      const col = dist?.color || '#456'
      if (cur) svg += `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="${col}" stroke-width="1" opacity="0.8"><animate attributeName="r" values="5;8;5" dur="1.4s" repeatCount="indefinite"/></circle>`
      svg += `<circle cx="${cx}" cy="${cy}" r="${cur ? 4 : 2.6}" fill="${cur ? '#fff' : col}" opacity="${cur ? 1 : 0.75}"><title>${esc(r.name)}</title></circle>`
    })
  })
  svg += '</svg>'
  $('#minimap').innerHTML = svg
  $('#legend').innerHTML = DIST_ORDER.map(d => {
    const dist = S.world.districts[d]
    return `<span class="lg"><i class="dot" style="background:${dist?.color || '#456'}"></i>${esc(dist?.name || d)}</span>`
  }).join('')
}

/* ================= quickbar ================= */
function renderQuickbar () {
  const room = S.room
  if (!room) return
  const hostiles = (room.npcs || []).filter(n => n.kind === 'hostile')
  const btns = []
  if (hostiles.length) {
    for (const h of hostiles.slice(0, 3)) btns.push(`<button class="qbtn hot" data-cmd="attack ${esc(h.id)}">⚔ ${esc(h.name)}</button>`)
    btns.push('<button class="qbtn hot" data-cmd="defend">DEFEND</button>')
    btns.push('<button class="qbtn hot" data-cmd="dodge">DODGE</button>')
    const ownedGrenade = (S.inv?.stacks || []).find(i => i.category === 'grenades')
    if (ownedGrenade) btns.push(`<button class="qbtn hot" data-cmd="grenade ${esc(ownedGrenade.id)}">GRENADE</button>`)
  }
  if (room.corpse) btns.push('<button class="qbtn gig" data-cmd="take">LOOT CORPSE</button>')
  btns.push('<button class="qbtn" data-cmd="look">LOOK</button>')
  btns.push('<button class="qbtn" data-cmd="map">MAP</button>')
  btns.push('<button class="qbtn" data-cmd="stats">STATS</button>')
  btns.push('<button class="qbtn" data-cmd="inv">INV</button>')
  btns.push('<button class="qbtn" data-cmd="jobs">JOBS</button>')
  btns.push('<button class="qbtn" data-cmd="help">HELP</button>')
  $('#quickbar').innerHTML = btns.join('')
  bindCmdButtons($('#quickbar'))
}

/* ================= shop ================= */
function openShop () {
  const sh = S.shop
  if (!sh) return
  $('#shop-title').textContent = 'SHOP — ' + sh.npc
  $('#shop-buy').innerHTML = sh.items.map(it => `<div class="shop-item">
    <div class="si">${esc(it.name)}<small>${esc(it.desc || '')}</small>
      <small>${it.dmg ? `DMG ${it.dmg[0]}-${it.dmg[1]} • ` : ''}${it.armor ? `ARMOR ${it.armor} • ` : ''}${it.capacity != null ? `CAP ${it.capacity} • ` : ''}${it.ram ? `${it.ram} RAM` : ''}</small></div>
    <div style="text-align:right"><div class="sp">${it.price}€$</div>
      <button data-buy="${esc(it.id)}">BUY</button></div></div>`).join('') || '<div class="empty-note">Sold out.</div>'
  $('#shop-sell').innerHTML = sh.sellable.map(it => `<div class="shop-item">
    <div class="si">${esc(it.name)}${it.qty > 1 ? ` x${it.qty}` : ''}<small>${esc(it.category)}</small></div>
    <div style="text-align:right"><div class="sp">${it.price}€$</div>
      <button data-sell="${esc(it.uid)}">SELL</button></div></div>`).join('') || '<div class="empty-note">They want none of your junk.</div>'
  $('#shop-buy').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { cmd('buy ' + b.dataset.buy); setTimeout(() => cmd('shop'), 120) })
  $('#shop-sell').querySelectorAll('[data-sell]').forEach(b => b.onclick = () => { cmd('sell ' + b.dataset.sell); setTimeout(() => cmd('shop'), 120) })
  $('#shopmodal').classList.remove('hidden')
}
$('#shop-close').onclick = () => $('#shopmodal').classList.add('hidden')

/* ================= log / toast ================= */
function addLog (lines) {
  const el = $('#log')
  if (!el) return
  for (const l of lines) {
    const div = document.createElement('div')
    div.className = 'line ' + (l.cls || 'sys')
    div.innerHTML = fmt(l.text)
    el.appendChild(div)
  }
  while (el.children.length > 600) el.removeChild(el.firstChild)
  el.scrollTop = el.scrollHeight
}
function toast (text, cls = 'info') {
  const t = document.createElement('div')
  t.className = 'toast ' + cls
  t.textContent = text
  $('#toasts').appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400) }, 4200)
}

/* ================= input ================= */
$('#cmdform').onsubmit = (e) => {
  e.preventDefault()
  const v = $('#cmdinput').value
  $('#cmdinput').value = ''
  cmd(v)
}
$('#cmdinput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    if (!S.hist.length) return
    S.histIdx = Math.max(0, S.histIdx - 1)
    $('#cmdinput').value = S.hist[S.histIdx] || ''
    e.preventDefault()
  } else if (e.key === 'ArrowDown') {
    S.histIdx = Math.min(S.hist.length, S.histIdx + 1)
    $('#cmdinput').value = S.hist[S.histIdx] || ''
    e.preventDefault()
  }
})

/* ================= boot ================= */
$('#logout-btn').onclick = () => send({ t: 'logout' })
connect()
setInterval(() => { if (S.connected) send({ t: 'ping' }) }, 25000)

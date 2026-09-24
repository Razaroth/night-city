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
  classes: {},
  classPerkIndex: {},
  creation: null,
  char: null,
  inv: null,
  room: null,
  jobs: null,
  shop: null,
  hist: [],
  histIdx: -1,
  draft: { name: '', lifepath: 'streetkid', cls: 'solo', style: 'entropism', attrs: { body: 3, reflexes: 3, tech: 3, intel: 3, cool: 3 }, cyberware: [] }
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
  addLog([{ text: '> ' + prettyCmd(line), cls: 'sys' }])
}

function prettyCmd (line) {
  const inv = S.inv?.stacks || []
  return line.split(/\s+/).map(tok => {
    for (const it of inv) if (it.uid === tok) return it.name
    return tok
  }).join(' ')
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
      S.classes = msg.classes || {}
      S.classPerkIndex = msg.perks || {}
      S.tierRequirements = msg.tierRequirements || { 2: 2, 3: 4 }
      break
    }
    case 'needChar': S.creation = msg.creation; showScreen('creation'); renderCreation(); break
    case 'charCreated': toast('Runner on file: ' + msg.name, 'good'); break
    case 'entered': onEntered(msg); break
    case 'room': S.room = msg; onRoom(msg); break
    case 'state': S.char = msg.state; renderHud(); renderVitals(); renderAttrs(); renderQuickbar(); openCombat(); refreshPerks(); refreshSheet(); break
    case 'inv': S.inv = msg; renderInventory(); renderEquipment(); renderQuickhacks(); renderQuickbar(); refreshSheet(); break
    case 'jobs': S.jobs = msg; renderJobs(); renderActions(); break
    case 'shop': S.shop = msg; openShop(); break
    case 'log': addLog(msg.lines); break
    case 'breach': onBreach(msg); break
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
  $('#combatfx').classList.add('hidden')
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

/* ================= combat overlay ================= */
let cfxPrevHp = null
let cfxPrevFoe = {}

function openCombat () {
  const hostiles = (S.room?.npcs || []).filter(n => n.kind === 'hostile')
  const fx = $('#combatfx')
  if (!hostiles.length || !S.char) {
    fx.classList.add('hidden')
    cfxPrevHp = null
    cfxPrevFoe = {}
    return
  }
  fx.classList.remove('hidden')
  $('#cfx-clk').textContent = S.room.clock || ''
  const s = S.char
  const setBar = (id, val, max) => {
    const el = $(id)
    el.style.width = Math.max(0, Math.min(100, max ? (val / max) * 100 : 0)) + '%'
    return el
  }
  setBar('#cfx-hp', s.hp, s.maxHp)
  $('#cfx-hp-txt').textContent = `${s.hp} / ${s.maxHp}`
  setBar('#cfx-stam', s.stam, s.maxStam)
  $('#cfx-stam-txt').textContent = `${s.stam} / ${s.maxStam}`
  const b = s.buffs || {}
  for (const [k, el] of [['defend', '#cfx-buffs [data-b="defend"]'], ['dodge', '#cfx-buffs [data-b="dodge"]'], ['sandevistan', '#cfx-buffs [data-b="sandevistan"]'], ['berserk', '#cfx-buffs [data-b="berserk"]']]) {
    $(el).classList.toggle('on', !!b[k])
  }
  // player took damage → float
  if (cfxPrevHp != null && s.hp < cfxPrevHp) {
    const d = cfxPrevHp - s.hp
    const f = $(`#combatfx .cfx-you`)
    spawnFloat(f, -d, 'theirs')
    fx.classList.remove('shake'); void fx.offsetWidth; fx.classList.add('shake')
  }
  cfxPrevHp = s.hp

  // foes — build/refresh cards in place so HP bars animate
  const foesEl = $('#cfx-foes')
  const hacks = S.inv?.quickhacks || []
  const hasDeck = !!S.char?.hasDeck
  const ram = S.char?.ram ?? 0

  const existing = {}
  foesEl.querySelectorAll('.cfx-foe').forEach(c => { existing[c.dataset.foe] = c })

  // remove foes that left
  for (const id of Object.keys(existing)) {
    if (!hostiles.some(h => h.id === id)) existing[id].remove()
  }

  for (const h of hostiles) {
    let card = existing[h.id]
    if (!card) {
      card = document.createElement('div')
      card.className = 'cfx-foe'
      card.dataset.foe = h.id
      foesEl.appendChild(card)
      bindCmdButtons(card)
    }
    card.classList.toggle('boss', h.danger === 'boss')
    card.classList.toggle('stunned', !!h.stunned)
    const status = (h.burning ? ' • BURN' : '') + (h.stunned ? ' • STUN' : '') + (h.blinded ? ' • BLIND' : '') + (h.weakened ? ' • WEAK' : '') + (h.danger === 'boss' ? ' • BOSS' : '')
    const hackBtns = hacks.map(q =>
      `<button data-cmd="hack ${esc(q.id)} ${esc(h.id)}" ${hasDeck && ram >= (q.ram || 0) ? '' : 'disabled'} title="${esc(q.name)} (${q.ram || 0} RAM)">${esc(q.name)}</button>`).join('')
    card.innerHTML = `<div class="cfx-fname">${esc(h.name).toUpperCase()}<small>${esc(h.faction)}${status}</small></div>
        <div class="cfx-fbar"><i style="width:${h.hpPct ?? 100}%"></i><b>${h.hp} / ${h.maxhp}</b></div>
        <div class="cfx-fbtns">
          <button class="atk" data-cmd="attack ${esc(h.id)}">⚔ ATK</button>
          ${hackBtns || '<button disabled>HACK</button>'}
          <button data-cmd="look ${esc(h.id)}">SCAN</button>
        </div>`
    bindCmdButtons(card)
    const bar = card.querySelector('.cfx-fbar i')
    bar.style.width = (h.hpPct ?? 100) + '%'
    card.querySelector('.cfx-fbar b').textContent = `${h.hp} / ${h.maxhp}`
  }

  // enemy lost hp → float
  const now = {}
  for (const h of hostiles) now[h.id] = h.hp
  for (const id in cfxPrevFoe) {
    if (now[id] == null && cfxPrevFoe[id] > 0) {
      const card = foesEl.querySelector(`[data-foe="${CSS.escape(id)}"]`)
      if (card) { spawnFloat(card, '✕', 'crit'); card.classList.add('dead') }
    } else if (now[id] != null && now[id] < cfxPrevFoe[id]) {
      const card = foesEl.querySelector(`[data-foe="${CSS.escape(id)}"]`)
      if (card) spawnFloat(card, '-' + (cfxPrevFoe[id] - now[id]), 'mine')
    }
  }
  cfxPrevFoe = now

  const acts = $('#cfx-acts')
  const gre = (S.inv?.stacks || []).find(i => i.category === 'grenades')
  const stim = (S.inv?.stacks || []).find(i => i.category === 'consumables' && i.heal)
  acts.innerHTML =
    `<button data-cmd="defend">🛡 DEFEND</button>` +
    `<button data-cmd="dodge">💨 EVADE</button>` +
    (gre ? `<button data-cmd="grenade ${esc(gre.id)}">💣 GRENADE</button>` : `<button disabled>💣 GRENADE</button>`) +
    (stim ? `<button data-cmd="use ${esc(stim.uid)}">💉 STIM</button>` : `<button disabled>💉 STIM</button>`) +
    `<button data-cmd="look">📡 SCAN</button>`
  bindCmdButtons(acts)
}

function spawnFloat (anchor, text, cls) {
  const fx = $('#combatfx')
  if (!fx || fx.classList.contains('hidden')) return
  const f = document.createElement('div')
  f.className = 'cfx-float ' + cls
  f.textContent = text
  const r = anchor.getBoundingClientRect()
  f.style.left = (r.left + r.width / 2 + (Math.random() * 40 - 20)) + 'px'
  f.style.top = (r.top + 8) + 'px'
  fx.appendChild(f)
  setTimeout(() => f.remove(), 950)
}

/* ================= breach protocol ================= */
let breachTimer = null
let breachGrid = null

function onBreach (msg) {
  const modal = $('#breachmodal')
  if (msg.error) { toast(msg.error, 'bad'); return }
  if (msg.done) {
    closeBreach()
    if (msg.aborted) toast('Disconnected from the subnet.', 'sys')
    else if (msg.ok) {
      toast('Daemons uploaded — breach success.', 'good')
      for (const l of msg.lines || []) addLog([{ text: l, cls: 'good' }])
    } else {
      toast('ICE caught you. Breach failed.', 'bad')
      for (const l of msg.lines || []) addLog([{ text: l, cls: 'bad' }])
    }
    return
  }
  modal.classList.remove('hidden')
  $('#breach-ap').textContent = msg.ap ? String(msg.ap).toUpperCase() + ' ACCESS POINT' : ''
  renderBreachGrid(msg)
}

function closeBreach (keepModal) {
  if (breachTimer) { clearInterval(breachTimer); breachTimer = null }
  const modal = $('#breachmodal')
  if (!keepModal) modal.classList.add('hidden')
}

function renderBreachGrid (msg) {
  const gridEl = $('#breach-grid')
  if (gridEl.dataset.gridSize !== String(msg.size)) {
    gridEl.innerHTML = ''
    gridEl.style.gridTemplateColumns = `repeat(${msg.size}, minmax(0, 1fr))`
    gridEl.dataset.gridSize = String(msg.size)
    breachGrid = msg.cells.map(cell => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'bcq ' + (cell.col || 'ice')
      b.dataset.i = cell.i
      b.dataset.r = cell.r
      b.dataset.c = cell.c
      b.textContent = cell.v
      b.onclick = () => send({ t: 'breach', action: 'pick', cell: cell.i })
      gridEl.appendChild(b)
      return b
    })
  }
  // mark used cells + current row/col hint
  const lastIdx = [...msg.cells].reverse().find(c => c.used)
  const last = lastIdx ? msg.cells[lastIdx.i] : null
  msg.cells.forEach(cell => {
    const el = breachGrid[cell.i]
    el.classList.toggle('used', cell.used)
  })
  breachGrid.forEach(el => el.classList.remove('ok'))
  breachGrid.forEach(el => {
    const idx = Number(el.dataset.i)
    const cell = msg.cells[idx]
    if (cell.used) return
    const r = Number(el.dataset.r)
    const c = Number(el.dataset.c)
    if (!last) {
      if (r === 0) el.classList.add('ok')
    } else {
      const vertical = msg.codes.length % 2 === 1
      if (vertical ? c === last.c : r === last.r) el.classList.add('ok')
    }
  })

  // daemon targets
  $('#breach-daemons').innerHTML = msg.daemons.map((d, k) =>
    `<div class="bd-item ${d.uploaded ? 'up' : ''}"><span class="bd-label">DAEMON ${k + 1}</span>` +
    d.seq.map(v => `<i class="bd-code">${esc(v)}</i>`).join('') +
    (d.uploaded ? '<em class="bd-done">✓ UPLOADED</em>' : '') + '</div>').join('')

  // buffer: slot count vs used
  const buf = $('#breach-buffer')
  let slots = ''
  for (let i = 0; i < msg.buffer; i++) slots += `<i class="${i < msg.codes.length ? 'full' : ''}"></i>`
  buf.innerHTML = `<span class="buf-lbl">BUFFER</span>${slots}<span class="buf-n">${msg.codes.length}/${msg.buffer}</span>`

  updateBreachTimer(msg.tLeft)
}

function updateBreachTimer (tLeft) {
  if (breachTimer) clearInterval(breachTimer)
  const el = $('#breach-timer')
  const tick = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000))
    el.textContent = '⏱ ' + s + (s === 1 ? 's' : 's')
    el.classList.toggle('warn', s <= 5)
  }
  let left = tLeft
  tick(left)
  breachTimer = setInterval(() => {
    left -= 1000
    if (left <= 0) { clearInterval(breachTimer); breachTimer = null; tick(0) }
    else tick(left)
  }, 1000)
}
$('#breach-abort').onclick = () => send({ t: 'breach', action: 'abort' })
$('#breach-close').onclick = () => send({ t: 'breach', action: 'abort' })

function onRoom (msg) {
  $('#deathveil').classList.add('hidden')
  if (S.deathTimer) { clearInterval(S.deathTimer); S.deathTimer = null }
  if (!$('#breachmodal').classList.contains('hidden')) closeBreach()
  renderScene(msg)
  renderActions()
  renderMinimap()
  openCombat()
  mapRouteCheck(msg)
}

function onDeath (msg) {
  S.mapWalk = null; MM.route = null
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

const cp = $('#class-picker')
  cp.innerHTML = ''
  const classList = c.classes ? Object.values(c.classes) : []
  for (const cl of classList) {
    const d = document.createElement('div')
    d.className = 'lp-card' + (S.draft.cls === cl.id ? ' active' : '')
    const attrs = (cl.attrs || []).map(a => c.attrLabels?.[a] || a.toUpperCase()).join(' / ')
    d.innerHTML = `<h4 style="color:${cl.color}">${esc(cl.name.toUpperCase())}</h4>
      <p>${esc(cl.desc)}</p>
      <p class="bonus">KEYS: ${esc(attrs)}</p>`
    d.onclick = () => { S.draft.cls = cl.id; renderCreation() }
    cp.appendChild(d)
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
  send({ t: 'charCreate', name, lifepath: S.draft.lifepath, cls: S.draft.cls, style: S.draft.style, attrs: S.draft.attrs, cyberware: S.draft.cyberware })
}

/* ================= HUD / vitals ================= */
function renderHud () {
  const s = S.char
  if (!s) return
  $('#hud-name').textContent = s.name
  $('#hud-lp').textContent = (s.className || 'SOLO').toUpperCase() + ' • ' + s.lifepathName.toUpperCase()
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
    `<div class="level-row"><span>LEVEL</span><b>${s.level}</b><em>${s.xp} / ${s.xpToNext} XP</em></div>` +
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
  html += `<div class="spend"><span class="perkp">PERK</span>${s.perkPoints || 0}<button id="perk-btn" class="mini">OPEN TREE</button></div>`
  html += '<div class="spend"><button id="sheet-btn">CHAR DATA</button></div>'
  $('#attrs').innerHTML = html
  const b = $('#spend-btn')
  if (b) b.onclick = () => { const a = prompt('Raise which attribute? (body/reflexes/tech/intel/cool)', 'body'); if (a) cmd('up ' + a.trim()) }
  const pb = $('#perk-btn')
  if (pb) pb.onclick = () => openPerks()
  const sb = $('#sheet-btn')
  if (sb) sb.onclick = () => openSheet()
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
  const hacks = S.inv?.quickhacks || []
  const hasDeck = !!S.char?.hasDeck
  const ram = S.char?.ram ?? 0
  let html = ''

  for (const n of hostiles) {
    const cls = n.danger === 'boss' ? 'npc-row hostile boss' : 'npc-row hostile'
    const status = (n.stunned ? ' • STUNNED' : '') + (n.burning ? ' • BURNING' : '') + (n.blinded ? ' • BLINDED' : '') + (n.weakened ? ' • WEAKENED' : '')
    const hackBtns = hacks.map(q =>
      `<button data-cmd="hack ${esc(q.id)} ${esc(n.id)}" ${hasDeck && ram >= (q.ram || 0) ? '' : 'disabled'} title="${esc(q.name)} (${q.ram || 0} RAM)">${esc(q.name)}</button>`).join('')
    html += `<div class="${cls}">
      <div class="nname">${esc(n.name)}<small>${esc(n.faction)}${status}</small>
        <div class="hpbar"><i style="width:${n.hpPct ?? 100}%"></i></div></div>
      <div class="npc-btns">
        <button data-cmd="attack ${esc(n.id)}">ATK</button>
        ${hackBtns}
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
  // access points — breach protocol entry
  const aps = (room.objects || []).filter(o => o.kind === 'netport')
  for (const ap of aps) {
    const ready = ap.ready
    html += `<div class="netport-row ${ready ? 'ready' : ''}">
      <div class="np-info">${esc(ap.name)}<small>${(ap.tier || 'mid').toUpperCase()} TIER</small></div>
      <div class="npc-btns">
        ${ready
          ? `<button class="breach-btn" data-cmd="breach">BREACH ▸</button>`
          : `<button disabled>COOLDOWN ${ap.cdLeft || 0}s</button>`}
      </div>
    </div>`
  }
  html += '<div class="exit-grid" style="margin-top:8px">'
  for (const e of room.exits) html += `<button data-cmd="${e.dir}">${e.name.toUpperCase()} →</button>`
  html += '</div>'
  if (room.players && room.players.length) {
    html += `<div class="players-here">Runners here: ${room.players.map(p => esc(p.name) + ' (Lv' + p.level + ')').join(', ')}</div>`
  }
  for (const o of (room.objects || [])) {
    if (o.kind === 'netport') continue
    html += `<div class="obj-row">${esc(o.name)} — ${esc(o.desc)}</div>`
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

/* ================= city map ================= */
const MAP_H = {
  apartment: 3.2, street: 1.6, market: 1.2, industrial: 2.6, gangden: 2.2,
  clinic: 1.5, plaza: 2.2, club: 1.7, bar: 1.6, corpo: 4.4, ruin: 1.1,
  wasteland: 0.8, tent: 0.6
}
const MM = { cv: null, view: null, hover: null, raf: 0, drag: null, moved: false, tip: null, walk: null, route: null }

function mapRooms () {
  const rooms = S.world.rooms || []
  if (!MM.cached && rooms.length) {
    let base = 0
    for (const r of rooms) {
      if (typeof r.x !== 'number' || typeof r.y !== 'number') {
        r.x = base % 10; r.y = Math.floor(base / 10); r.y = r.y * 2; r.x = r.x * 2
      }
      base++
    }
    MM.cached = true
  }
  return rooms
}

function mapProj (r, view) {
  const u = view.unit
  const ix = (r.x - r.y) * u
  const iy = (r.x + r.y) * u * 0.5
  return { x: ix + view.ox, y: iy + view.oy }
}

function mapFitView (cw, ch, rooms) {
  const u0 = 1
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const r of rooms) {
    const ix = (r.x - r.y) * u0, iy = (r.x + r.y) * u0 * 0.5
    if (ix < minX) minX = ix; if (ix > maxX) maxX = ix
    if (iy < minY) minY = iy; if (iy > maxY) maxY = iy
  }
  const unit = Math.min(cw / (maxX - minX + 4), ch / (maxY - minY + 4))
  return {
    unit: unit,
    ox: cw / 2 - (minX + maxX) * unit / 2,
    oy: ch / 2 - (minY + maxY) * unit / 2
  }
}

function hexToRgb (hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return [150, 180, 220]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function shade (hex, f) {
  const [r, g, b] = hexToRgb(hex)
  const t = f < 0 ? 0 : 255
  const p = Math.abs(f)
  return `rgb(${Math.round(r + (t - r) * p)},${Math.round(g + (t - g) * p)},${Math.round(b + (t - b) * p)})`
}
function distColor (d) { return S.world?.districts?.[d]?.color || '#29f2c3' }

function convexHull (pts) {
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lo = []
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  const up = []
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p) }
  up.pop(); lo.pop()
  return lo.concat(up)
}

function drawCity (ctx, cw, ch, view, opts) {
  opts = opts || {}
  const rooms = mapRooms()
  const g = ctx.createLinearGradient(0, 0, 0, ch)
  g.addColorStop(0, '#05060c'); g.addColorStop(0.6, '#0a0d18'); g.addColorStop(1, '#0d1220')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, cw, ch)

  const byDist = {}
  for (const r of rooms) (byDist[r.district] ??= []).push(r)

  const hulls = []
  for (const d of Object.keys(byDist)) {
    const pts = byDist[d].map(r => { const p = mapProj(r, view); return { x: p.x, y: p.y } })
    const poly = convexHull(pts)
    hulls.push({ d, poly, col: distColor(d) })
  }
  for (const h of hulls) {
    ctx.beginPath()
    ctx.moveTo(h.poly[0].x, h.poly[0].y)
    for (let i = 1; i < h.poly.length; i++) ctx.lineTo(h.poly[i].x, h.poly[i].y)
    ctx.closePath()
    ctx.fillStyle = h.col + '14'
    ctx.fill()
    ctx.strokeStyle = h.col
    ctx.globalAlpha = 0.28
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  const edges = new Set()
  for (const r of rooms) {
    for (const e of (r.exits || [])) {
      const key = (r.id < e.to ? r.id + '>' + e.to : e.to + '>' + r.id)
      edges.add(key)
    }
  }
  const rIndex = S.roomIndex
  ctx.lineCap = 'round'
  for (const key of edges) {
    const [a, b] = key.split('>')
    const ra = rIndex[a], rb = rIndex[b]
    if (!ra || !rb) continue
    const pa = mapProj(ra, view), pb = mapProj(rb, view)
    ctx.strokeStyle = '#0b0e18'
    ctx.lineWidth = view.unit * 0.42
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke()
    ctx.strokeStyle = '#3d4a66'
    ctx.lineWidth = view.unit * 0.1
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke()
  }

  const sorted = rooms.slice().sort((a, b) => b.x + b.y - (a.x + a.y))
  const step = view.unit
  for (const r of sorted) {
    const p = mapProj(r, view)
    const w = step * 0.5, hh = step * 0.27
    const h = (MAP_H[r.category] ?? 1.5) * step * 0.5
    const top = { x: p.x, y: p.y - hh }, right = { x: p.x + w, y: p.y }
    const bottom = { x: p.x, y: p.y + hh }, left = { x: p.x - w, y: p.y }
    const col = distColor(r.district)
    const cur = opts.cur && opts.cur === r.id
    const hover = opts.hover && opts.hover === r.id
    const inRoute = opts.route && opts.route.includes(r.id)

    ctx.fillStyle = 'rgba(0,0,0,.35)'
    ctx.beginPath()
    ctx.ellipse(p.x, p.y + hh * 0.8, w * 1.15, hh * 1.15, 0, 0, Math.PI * 2)
    ctx.fill()

    const tH = { x: top.x, y: top.y - h }, rH = { x: right.x, y: right.y - h }
    const bH = { x: bottom.x, y: bottom.y - h }, lH = { x: left.x, y: left.y - h }

    ctx.beginPath()
    ctx.moveTo(left.x, left.y); ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(bH.x, bH.y); ctx.lineTo(lH.x, lH.y)
    ctx.closePath(); ctx.fillStyle = shade(col, hover ? 0.5 : 0.18); ctx.fill()

    ctx.beginPath()
    ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(right.x, right.y); ctx.lineTo(rH.x, rH.y); ctx.lineTo(bH.x, bH.y)
    ctx.closePath(); ctx.fillStyle = shade(col, hover ? 0.35 : 0.02); ctx.fill()

    ctx.beginPath()
    ctx.moveTo(tH.x, tH.y); ctx.lineTo(rH.x, rH.y); ctx.lineTo(bH.x, bH.y); ctx.lineTo(lH.x, lH.y)
    ctx.closePath()
    ctx.fillStyle = hover ? shade(col, 0.42) : col
    ctx.fill()
    ctx.strokeStyle = hover ? '#fff' : shade(col, 0.55)
    ctx.lineWidth = hover ? Math.max(1.6, step * 0.09) : Math.max(0.7, step * 0.045)
    ctx.stroke()

    if (inRoute && !cur) {
      ctx.strokeStyle = 'rgba(120,220,255,.55)'
      ctx.lineWidth = Math.max(1, step * 0.06)
      ctx.beginPath(); ctx.arc(p.x, p.y - h * 0.5, w * 0.8, 0, Math.PI * 2); ctx.stroke()
    }
  }

  const myRoom = opts.cur && rIndex[opts.cur]
  if (myRoom) {
    const p = mapProj(myRoom, view)
    const w = step * 0.55
    const pulse = opts.time ? (opts.time % 1.4) / 1.4 : 0.5
    const pr = w * (1 + pulse * 1.4)
    ctx.strokeStyle = '#7dffd9'
    ctx.globalAlpha = 1 - pulse * 0.7
    ctx.lineWidth = Math.max(1.5, step * 0.1)
    ctx.beginPath(); ctx.arc(p.x, p.y - step * 1.9, pr, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
    const beamTop = p.y - step * 3.2
    const grad = ctx.createLinearGradient(0, p.y - step, 0, beamTop)
    grad.addColorStop(0, 'rgba(125,255,217,.9)'); grad.addColorStop(1, 'rgba(125,255,217,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = Math.max(1.5, step * 0.09)
    ctx.beginPath(); ctx.moveTo(p.x, p.y - step); ctx.lineTo(p.x, beamTop); ctx.stroke()
  }

  for (const h of hulls) {
    let cx = 0, cy = 0
    for (const p of h.poly) { cx += p.x; cy += p.y }
    cx /= h.poly.length; cy /= h.poly.length
    ctx.fillStyle = h.col
    ctx.font = `700 ${Math.max(9, view.unit * 1.15)}px Orbitron, sans-serif`
    ctx.textAlign = 'center'
    ctx.shadowColor = h.col; ctx.shadowBlur = view.unit * 1.4
    ctx.fillText((S.world.districts[h.d]?.name || h.d).toUpperCase(), cx, cy + view.unit * 2.6)
    ctx.shadowBlur = 0
  }
}

function mapSizeTo (cv, targetW, targetH) {
  const dpr = window.devicePixelRatio || 1
  if (cv.width !== targetW * dpr || cv.height !== targetH * dpr) {
    cv.width = targetW * dpr; cv.height = targetH * dpr
  }
  cv.style.width = targetW + 'px'; cv.style.height = targetH + 'px'
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

function renderMinimap () {
  const cv = $('#minimap')
  const rooms = mapRooms()
  if (!cv || !rooms.length) return
  const w = cv.parentElement.clientWidth || 200
  const h = 150
  const ctx = mapSizeTo(cv, w, h)
  const view = mapFitView(w, h, rooms)
  drawCity(ctx, w, h, view, { cur: S.room?.id, route: MM.route })
  $('#legend').innerHTML = DIST_ORDER.map(d => {
    const dist = S.world.districts[d]
    return `<span class="lg"><i class="dot" style="background:${dist?.color || '#456'}"></i>${esc(dist?.name || d)}</span>`
  }).join('')
}

function mapHit (ev, cv, view) {
  const rect = cv.getBoundingClientRect()
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
  let best = null, bd = Infinity
  for (const r of mapRooms()) {
    const p = mapProj(r, view)
    const d = Math.hypot(mx - p.x, my - p.y)
    if (d < bd) { bd = d; best = r }
  }
  return bd < view.unit * 0.95 ? best : null
}

function bfsPath (fromId, toId) {
  if (fromId === toId) return []
  const prev = { [fromId]: null }
  const q = [fromId]
  while (q.length) {
    const cur = q.shift()
    const r = S.roomIndex[cur]
    for (const e of (r?.exits || [])) {
      if (!(e.to in prev)) { prev[e.to] = [cur, e.dir]; q.push(e.to) }
    }
  }
  if (!prev[toId]) return null
  const steps = []
  let at = toId
  while (at !== fromId) { const [from, dir] = prev[at]; steps.unshift({ to: at, dir }); at = from }
  return steps
}

function startMapWalk (steps) {
  if (!steps || !steps.length) return
  S.mapWalk = { steps, i: 0 }
  mapWalkStep()
}
function mapWalkStep () {
  const w = S.mapWalk
  if (!w) return
  const s = w.steps[w.i]
  if (!s) { S.mapWalk = null; MM.route = null; toast('You reached your destination.', 'good'); return }
  cmd(s.dir)
  w.expect = s.to
}
function mapRouteCheck (msg) {
  const w = S.mapWalk
  if (!w) return
  if (msg && msg.id === w.expect) {
    w.i++
    mapWalkStep()
  } else if (msg && msg.id !== w.expect) {
    S.mapWalk = null; MM.route = null
    toast('Route interrupted.', 'bad')
  }
}

function openMap () {
  if (!mapRooms().length) return
  const wrap = $('#map-wrap')
  const cv = $('#mapcanvas')
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600
  const rooms = mapRooms()
  MM.cv = cv
  MM.view = mapFitView(w, h, rooms)
  MM.hover = null
  $('#mapmodal').classList.remove('hidden')
  $('#map-legend').innerHTML = DIST_ORDER.map(d => {
    const dist = S.world.districts[d]
    return `<span class="lg"><i class="dot" style="background:${dist?.color || '#456'}"></i><b>${esc(dist?.name || d)}</b></span>`
  }).join('')
  MM.walk = S.room?.id || null
  requestMapFrame()
}
function closeMap () {
  $('#mapmodal').classList.add('hidden')
  if (MM.raf) { cancelAnimationFrame(MM.raf); MM.raf = 0 }
}
function requestMapFrame () {
  cancelAnimationFrame(MM.raf)
  const cv = MM.cv
  const wrap = $('#map-wrap')
  const tick = (t) => {
    if ($('#mapmodal').classList.contains('hidden') || !cv) return
    const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600
    const ctx = mapSizeTo(cv, w, h)
    drawCity(ctx, w, h, MM.view, { cur: S.room?.id, hover: MM.hover, route: MM.route, time: t / 1000 })
    MM.raf = requestAnimationFrame(tick)
  }
  MM.raf = requestAnimationFrame(tick)
}

;(function mapBind () {
  const wrap = $('#map-wrap')
  if (!wrap) return
  const cv = $('#mapcanvas')
  $('#map-close').onclick = () => closeMap()
  $('#mapmodal').addEventListener('click', (e) => { if (e.target === $('#mapmodal')) closeMap() })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#mapmodal').classList.contains('hidden')) closeMap()
  })
  $('#map-fit').onclick = () => {
    const wrapE = $('#map-wrap')
    MM.view = mapFitView(wrapE.clientWidth || 800, wrapE.clientHeight || 600, mapRooms())
  }
  $('#map-follow').onclick = () => {
    const r = S.roomIndex[S.room?.id]
    if (!r) return
    const wrapE = $('#map-wrap')
    const w = wrapE.clientWidth || 800, h = wrapE.clientHeight || 600
    const p = (r.x - r.y) * 1, py = (r.x + r.y) * 1 * 0.5
    MM.view.unit = Math.max(MM.view.unit, 13)
    MM.view.ox = w / 2 - p * MM.view.unit
    MM.view.oy = h / 2 - py * MM.view.unit
  }
  wrappers()
  cv.addEventListener('mousemove', (ev) => {
    if (MM.drag) {
      MM.view.ox += ev.movementX; MM.view.oy += ev.movementY
      MM.moved = true
      return
    }
    MM.hover = mapHit(ev, cv, MM.view)?.id || null
    const tip = $('#map-tip')
    const hit = mapHit(ev, cv, MM.view)
    if (hit) {
      const dist = S.world.districts[hit.district]
      const cur = hit.id === S.room?.id
      tip.innerHTML = `<b>${esc(hit.name)}</b> <span>${esc(dist?.name || hit.district)}</span><i>${cur ? 'YOU ARE HERE' : MM.route && MM.route.includes(hit.id) ? 'ON ROUTE' : 'CLICK TO TRAVEL'}</i>`
      tip.classList.remove('hidden')
      const rect = cv.getBoundingClientRect()
      tip.style.left = (ev.clientX - rect.left + 12) + 'px'
      tip.style.top = (ev.clientY - rect.top + 12) + 'px'
    } else tip.classList.add('hidden')
  })
  cv.addEventListener('mouseleave', () => { MM.hover = null; $('#map-tip').classList.add('hidden') })
  cv.addEventListener('mousedown', (ev) => { MM.drag = { x: ev.clientX, y: ev.clientY }; MM.moved = false })
  window.addEventListener('mouseup', () => { MM.drag = null })
  cv.addEventListener('click', (ev) => {
    if (MM.moved || !S.room) return
    const hit = mapHit(ev, cv, MM.view)
    if (!hit || hit.id === S.room.id || S.mapWalk) return
    const path = bfsPath(S.room.id, hit.id)
    if (!path) { toast('No safe network path there.', 'bad'); return }
    MM.route = path.map(s => s.to)
    toast('Routing to ' + hit.name + '…', 'info')
    startMapWalk(path)
  })
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault()
    const rect = cv.getBoundingClientRect()
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
    const f = ev.deltaY < 0 ? 1.15 : 1 / 1.15
    const v = MM.view
    const wx = (mx - v.ox) / v.unit, wy = (my - v.oy) / v.unit
    v.unit = Math.max(2, Math.min(90, v.unit * f))
    v.ox = mx - wx * v.unit; v.oy = my - wy * v.unit
  }, { passive: false })
})()

function wrappers () {
  $('#qmap-btn').onclick = () => openMap()
  const qo = $('#qmap-open')
  if (qo && !qo.dataset.wired) { qo.dataset.wired = '1'; qo.onclick = () => openMap() }
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
  const ap = (room.objects || []).find(o => o.kind === 'netport')
  if (ap && ap.ready) btns.push('<button class="qbtn gig" data-cmd="breach">BREACH</button>')
  if (ap && !ap.ready) btns.push(`<button class="qbtn" disabled>NET ${ap.cdLeft || 0}s</button>`)
  btns.push('<button class="qbtn" data-cmd="look">LOOK</button>')
  btns.push('<button class="qbtn" id="qmap-open">MAP ▦</button>')
  btns.push('<button class="qbtn" data-cmd="stats">STATS</button>')
  btns.push('<button class="qbtn" id="qsheet-btn">SHEET</button>')
  btns.push('<button class="qbtn" data-cmd="inv">INV</button>')
  btns.push('<button class="qbtn" data-cmd="jobs">JOBS</button>')
  btns.push('<button class="qbtn perk2" id="qperk-btn">PERKS</button>')
  btns.push('<button class="qbtn" data-cmd="help">HELP</button>')
  $('#quickbar').innerHTML = btns.join('')
  bindCmdButtons($('#quickbar'))
  const qo = $('#qmap-open')
  if (qo) qo.onclick = () => openMap()
  const qp = $('#qperk-btn')
  if (qp) qp.onclick = () => openPerks()
  const qs = $('#qsheet-btn')
  if (qs) qs.onclick = () => openSheet()
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

/* ================= perks ================= */
function openPerks () {
  if (!S.char) return
  $('#perksmodal').classList.remove('hidden')
  renderPerks()
}
function renderPerks () {
  const s = S.char
  if (!s) return
  const cls = S.classes[s.cls] || { id: 'solo', name: 'SOLO', color: '#ff5c78' }
  const tree = Object.values(S.classPerkIndex).filter(p => p.cls === cls.id).sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name))
  const owned = new Set(s.perks || [])
  const pts = s.perkPoints || 0
  $('#perks-title').textContent = cls.name.toUpperCase() + ' — CLASS PERKS'
  $('#perks-head').innerHTML = `<span style="color:${cls.color}">◈ ${esc(cls.tagline || cls.name)}</span><em>${owned.size}/${tree.length} learned • ${pts} point${pts === 1 ? '' : 's'}</em>`
  $('#perks-list').innerHTML = tree.map(pr => {
    const got = owned.has(pr.id)
    const gateOk = (s.attrs[pr.attr] || 0) >= pr.attrVal
    const tierGateOk = owned.size >= (S.tierRequirements[pr.tier] || 0)
    const can = !got && pts > 0 && gateOk && tierGateOk
    const note = !gateOk ? ` needs ${(S.world.attrLabels && S.world.attrLabels[pr.attr]) || pr.attr.toUpperCase()} ${pr.attrVal}` : !tierGateOk ? ` learn ${S.tierRequirements[pr.tier]} perks for T${pr.tier}` : ''
    return `<div class="perk-row ${got ? 'got' : gateOk && tierGateOk ? 'open' : 'locked'}" data-tier="${pr.tier}">
      <div class="pk-tier">T${pr.tier}</div>
      <div class="pk-info"><b>${esc(pr.name)}</b><span>${esc(pr.desc)}</span><small>${got ? 'LEARNED' : note || ('gate ' + ((S.world.attrLabels && S.world.attrLabels[pr.attr]) || pr.attr.toUpperCase()) + ' ' + pr.attrVal + ' • 1 point')}</small></div>
      ${can ? `<button class="qbtn" data-perk="${esc(pr.name)}">LEARN</button>` : ''}
    </div>`
  }).join('') || '<div class="empty-note">No perks yet.</div>'
  $('#perks-list').querySelectorAll('[data-perk]').forEach(b => b.onclick = () => {
    cmd('perk ' + b.dataset.perk)
    setTimeout(refreshPerks, 350)
  })
}
function refreshPerks () {
  if (!S.char) return
  const el = $('#perksmodal')
  if (el && !el.classList.contains('hidden')) renderPerks()
}
$('#perks-close').onclick = () => $('#perksmodal').classList.add('hidden')

/* ================= character sheet ================= */
function openSheet () {
  if (!S.char) return
  $('#sheetmodal').classList.remove('hidden')
  renderSheet()
}
function sheetLine (label, value, href) {
  const v = href ? `<a href="${href}" target="_blank" rel="noopener">${value}</a>` : value
  return `<div class="ss-line"><span>${label}</span><b>${v}</b></div>`
}
function renderSheet () {
  const s = S.char
  if (!s) return
  const cls = S.classes[s.cls] || { id: 'solo', name: 'SOLO', color: '#ff5c78', tagline: '' }
  const labels = { body: 'BODY', reflexes: 'REFLEXES', tech: 'TECH', intel: 'INTELLIGENCE', cool: 'COOL' }
  $('#sheet-img').src = `img/class-${s.cls || 'solo'}.jpg`
  const cn = $('#sheet-clsname')
  cn.textContent = cls.name.toUpperCase()
  cn.style.color = cls.color
  cn.style.borderColor = cls.color
  cn.style.boxShadow = `0 0 18px ${cls.color}44`
  $('#sheet-name').textContent = s.name.toUpperCase()
  $('#sheet-ident').textContent = `${cls.name.toUpperCase()} • ${s.lifepathName.toUpperCase()} • ${(s.style || 'entropism').toUpperCase()}`
  $('#sheet-title').textContent = 'RUNNER DATAFILE — ' + s.name.toUpperCase()

  $('#sheet-bars').innerHTML =
    bar('hp', s.hp, s.maxHp, 'HEALTH') +
    bar('stam', s.stam, s.maxStam, 'STAMINA') +
    (s.maxRam > 0 ? bar('ram', s.ram, s.maxRam, 'RAM') : '') +
    bar('xp', s.xp, s.xpToNext, 'XP — LEVEL ' + s.level)

  $('#sheet-attrs').innerHTML = Object.entries(s.attrs).map(([k, v]) => {
    const label = labels[k] || k.toUpperCase()
    return `<div class="attr-mini sheet-attr"><span>${label}</span><i style="width:${Math.min(100, (v / 20) * 100)}%"></i><b>${v}</b></div>`
  }).join('')

  const m = S.itemIndex
  const gear = (slot, label) => {
    const eq = (S.inv?.equip || {})[slot]
    const d = eq ? m[eq.id] : null
    return sheetLine(label, eq ? esc(eq.name) + (d?.dmg ? ` <small>${d.dmg[0]}-${d.dmg[1]}</small>` : d?.armor ? ` <small>+${d.armor} armor</small>` : '') : '— empty —')
  }
  const chrome = S.inv?.cyberware || []
  const qhOwned = S.inv?.quickhacks || []

  $('#sheet-merits').innerHTML =
    sheetLine('LEVEL', s.level) +
    sheetLine('XP', `${s.xp} / ${s.xpToNext}`) +
    sheetLine('EDDIES', s.eddies + '€$') +
    sheetLine('STREET CRED', s.rep) +
    sheetLine('ARMOR', s.dr) +
    sheetLine('CRIT', s.crit + '%') +
    sheetLine('DODGE', s.dodge + '%') +
    sheetLine('CHROME', `${s.capacityUsed}/${s.capacity}`) +
    sheetLine('HUMANITY', s.humanity + '%') +
    sheetLine('KILLS', s.kills) +
    sheetLine('FLATLINES', s.deaths) +
    sheetLine('GIGS DONE', s.gigs_done ?? 0) +
    sheetLine('HACKS RUN', s.hacks ?? 0) +
    sheetLine('BREACHES', s.breaches ?? 0) +
    sheetLine('WEIGHT', `${s.weight}/${s.carryCap}kg`)

  $('#sheet-loadout').innerHTML = gear('hands', 'WEAPON') + gear('chest', 'APRON')

  $('#sheet-chrome-cap').textContent = `${s.capacityUsed}/${s.capacity}`
  $('#sheet-chrome').innerHTML = chrome.length
    ? chrome.map(c => sheetLine(c.slot.toUpperCase(), esc(c.name))).join('') + sheetLine('HUMANITY COST', chrome.reduce((a, c) => a + (c.humanity || 0), 0))
    : '<div class="empty-note">No chrome installed.</div>'

  $('#sheet-qh-count').textContent = qhOwned.length
  $('#sheet-qh').innerHTML = qhOwned.length
    ? qhOwned.map(h => sheetLine(`${S.itemIndex[h.id]?.ram ?? '?'} RAM`, esc(h.name))).join('')
    : '<div class="empty-note">No quickhacks loaded.</div>'

  const perkList = (s.perks || []).map(id => { const d = S.classPerkIndex[id]; return d ? d.name : id })
  const pts = s.perkPoints || 0
  $('#sheet-perk-count').textContent = `${perkList.length} learned • ${pts} point${pts === 1 ? '' : 's'}`
  $('#sheet-perks').innerHTML = perkList.length
    ? perkList.map(n => sheetLine('✓', esc(n))).join('')
    : `<div class="empty-note">No perks. Earn points on level-up. <a href="#" id="sheet-to-perks">OPEN TREE</a></div>`

  const k = $('#sheet-to-perks')
  if (k) k.onclick = (e) => { e.preventDefault(); $('#sheetmodal').classList.add('hidden'); openPerks() }

  $('#sheet-credit').innerHTML = sheetCredit(s.cls)
}
function sheetCredit (cls) {
  const C = {
    solo: { a: 'User-provided', l: "User's own image", n: 'class-solo.jpg', s: 'SOLO panel (bottom-left)' },
    netrunner: { a: 'User-provided', l: "User's own image", n: 'class-netrunner.jpg', s: 'NETRUNNER panel (top-center)' },
    techie: { a: 'User-provided', l: "User's own image", n: 'class-techie.jpg', s: 'TECHIE panel (top-left)' },
    rockerboy: { a: 'User-provided', l: "User's own image", n: 'class-rockerboy.jpg', s: 'ROCKERBOY panel (bottom-right)' },
    nomad: { a: 'User-provided', l: "User's own image", n: 'class-nomad.jpg', s: 'NOMAD panel (top-right)' }
  }
  const c = C[cls] || C.solo
  return `Art: ${c.a} (${c.s}) — ${c.l} — ${c.n}`
}
function refreshSheet () { if ($('#sheetmodal') && !$('#sheetmodal').classList.contains('hidden')) renderSheet() }
$('#sheet-close').onclick = () => $('#sheetmodal').classList.add('hidden')

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

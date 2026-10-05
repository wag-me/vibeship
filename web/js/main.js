// Vibeship 3D: orchestra scena, interazione, agenti e collegamento al server.
import { THREE, disposeGroup, holo } from './lib.js'
import { ROOM, BOUNDS, createWorld, TOD_ORDER } from './world.js'
import { CATALOG, CATEGORIES, catalogFor, buildModel, buildPad } from './models.js'
import { createCharacter, SPECIES, SPECIES_IDS, SHIRTS, OUTFITS } from './characters.js'
import { createFx } from './fx.js'
import { sfx, isMuted, setMuted } from './audio.js'

const $ = (id) => document.getElementById(id)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, k) => a + (b - a) * k
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }
const hashOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

// ---------- Stati ----------
const STATUS = {
  idle:     { icon: '💤', text: 'a riposo' },
  read:     { icon: '📖', text: 'legge e pensa' },
  write:    { icon: '⌨️', text: 'scrive' },
  run:      { icon: '💻', text: 'esegue comandi' },
  web:      { icon: '🌐', text: 'cerca sul web' },
  delegate: { icon: '📨', text: 'delega' },
  error:    { icon: '⚠️', text: 'ha un problema' },
}
const MODE_OF = { read: 'think', write: 'typing', run: 'typing', web: 'think', delegate: 'typing', error: 'alert' }

// ---------- Layout predefiniti (coordinate in metri, rot in radianti) ----------
const DEFAULTS = {
  bridge: [
    ['console', -7, -3.4], ['console', -2.3, -3.4], ['console', 2.4, -3.4], ['console', 7, -3.4],
    ['starmap', 10.2, -6.4], ['replicator', -8.6, -6.4], ['datashelf', -11.4, -3.2, Math.PI / 2],
    ['sofa', -10.6, 2.6, Math.PI / 2], ['lamp', -11.2, 5.8], ['coffeetable', 6.8, 3.0],
    ['armchair', 4.6, 5.0, -0.5], ['plantbig', 10.8, 5.6], ['plant', 11, 1.8], ['bonsai', 7.8, 5.4],
    ['arcade', 11.2, -1.2, -Math.PI / 2], ['holotable', -4.6, 1.2], ['droid', -7.8, 5.2],
  ],
  engine: [
    ['workbench', -6.5, -4.2], ['workbench', -2, -4.2], ['reactor', 6.2, -3.4], ['servers', 10.6, -3.4],
    ['starmap', 2, -6.4], ['crates', -8.3, -6.2], ['sofa', -10.6, 2.4, Math.PI / 2],
    ['plantbig', 10.8, 0.4], ['replicator', -10.8, 6], ['arcade', 4, 5.5, Math.PI], ['scanner', 8.5, 3.4],
    ['droid', -6, 2.6], ['lamp', -11.2, -1.2],
  ],
  habitat: [
    ['console', -6.5, -3.6], ['console', 5, -3.6], ['holotable', 0.2, -3.2], ['scanner', 9.2, 1.6],
    ['bonsai', -8.2, -6.0], ['bonsai', 10.6, 5.6], ['plantbig', -11, 0.4], ['plant', -10.8, 5.6], ['plant', 3, 5.8],
    ['sofa', -10.6, 3.2, Math.PI / 2], ['coffeetable', -6.5, 3.8], ['armchair', -3.6, 4.9, 0.4],
    ['cryopod', 9.4, 4.4], ['replicator', 11, -1.2, -Math.PI / 2], ['droid', 5.4, 5.4], ['datashelf', 3.4, -6.5],
  ],
}
const SCENES = [
  { id: 'bridge', label: 'Plancia', icon: '🚀' },
  { id: 'engine', label: 'Sala macchine', icon: '⚙️' },
  { id: 'habitat', label: 'Serra', icon: '🌿' },
]
// Il portello nell'angolo in fondo a sinistra: da lì gli agenti entrano ed escono dal ponte
const DOOR = { x: -11.2, z: -6.3 }
const DOOR_ZONE = { x0: -12, x1: -10, z0: -7, z1: -5 }
// Il pad di lancio dei subagenti: uguale in ogni luogo, non si può togliere né aggiungere, e non ci si mettono mobili sopra
const PAD = { x: 0, z: 3.4 }
const PAD_ZONE = { x0: -2.1, x1: 2.1, z0: 1.3, z1: 5.5 }
const LOC_LABEL = Object.fromEntries(SCENES.map((s) => [s.id, s.label]))
const TOD_ICON = { auto: '🛰️', normal: '💡', alert: '🚨', dim: '🌙' }
const TOD_LABEL = { auto: 'Automatico', normal: 'Luci normali', alert: 'Allerta rossa', dim: 'Luci soffuse' }

// ---------- Renderer ----------
let renderer
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' })
} catch (e) {
  $('nogl').hidden = false
  throw e
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, 1, 1, 400)
const world = createWorld(scene, renderer)
const fx = createFx(scene)

// ---------- Camera ----------
const cam = { az: 0.63, el: 0.7, zoom: 1, target: new THREE.Vector3(0, 0.8, 0.4) }
const goal = { az: 0.63, el: 0.7, zoom: 1, target: new THREE.Vector3(0, 0.8, 0.4) }
const DEFAULT_GOAL = { az: 0.63, el: 0.7, zoom: 1 }
let viewW = 1, viewH = 1
function baseDistance() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const aspect = viewW / viewH
  return Math.max(22 / (2 * t), 31 / (2 * t * aspect))
}
function applyCamera() {
  const D = baseDistance() * cam.zoom
  const ce = Math.cos(cam.el)
  camera.position.set(cam.target.x + D * Math.sin(cam.az) * ce, cam.target.y + D * Math.sin(cam.el), cam.target.z + D * Math.cos(cam.az) * ce)
  camera.lookAt(cam.target)
}
function resize() {
  const r = $('stage').getBoundingClientRect()
  viewW = Math.max(1, r.width); viewH = Math.max(1, r.height)
  renderer.setSize(viewW, viewH, false)
  camera.aspect = viewW / viewH
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe($('stage'))
resize()

// ---------- Layout e mobili ----------
let layout = { scene: 'bridge', scenes: {} }
let sceneName = 'bridge'
const keyOf = (s) => s + '@3'
function items() {
  const k = keyOf(sceneName)
  if (!layout.scenes[k]) layout.scenes[k] = DEFAULTS[sceneName].map(([type, x, z, rot], i) => ({ id: sceneName + '-d' + i, type, x, z, rot: rot ?? (CATALOG[type]?.work ? Math.PI : 0) }))
  if (layout.scenes[k].some((i) => !CATALOG[i.type])) layout.scenes[k] = layout.scenes[k].filter((i) => CATALOG[i.type]) // tipi non più in catalogo (es. il vecchio pad)
  return layout.scenes[k]
}
const furn = new Map()
const furnLayer = new THREE.Group()
scene.add(furnLayer)
const padGroup = buildPad()
padGroup.position.set(PAD.x, 0, PAD.z)
scene.add(padGroup)

function aabb(it) {
  const d = CATALOG[it.type]
  const c = Math.abs(Math.cos(it.rot)), s = Math.abs(Math.sin(it.rot))
  const hw = (d.w * c + d.d * s) / 2, hd = (d.w * s + d.d * c) / 2
  return { x0: it.x - hw, x1: it.x + hw, z0: it.z - hd, z1: it.z + hd, hw, hd }
}
function clampItem(it) {
  const b = aabb(it)
  it.x = clamp(it.x, BOUNDS.minX + b.hw + 0.05, BOUNDS.maxX - b.hw - 0.05)
  it.z = clamp(it.z, BOUNDS.minZ + b.hd + 0.05, BOUNDS.maxZ - b.hd - 0.05)
}
function overlaps(it) {
  if (CATALOG[it.type].flat) return false
  const a = aabb(it)
  if (a.x0 < DOOR_ZONE.x1 && a.x1 > DOOR_ZONE.x0 && a.z0 < DOOR_ZONE.z1 && a.z1 > DOOR_ZONE.z0) return true // davanti al portello si passa
  if (a.x0 < PAD_ZONE.x1 && a.x1 > PAD_ZONE.x0 && a.z0 < PAD_ZONE.z1 && a.z1 > PAD_ZONE.z0) return true // il pad di lancio resta libero
  for (const o of items()) {
    if (o.id === it.id || CATALOG[o.type].flat) continue
    const b = aabb(o)
    if (a.x0 < b.x1 - 0.05 && a.x1 > b.x0 + 0.05 && a.z0 < b.z1 - 0.05 && a.z1 > b.z0 + 0.05) return true
  }
  return false
}

function spawnFurniture(it, delay = 0) {
  const def = CATALOG[it.type]
  if (!def) return null
  const model = buildModel(it.type)
  const g = model.group
  g.position.set(it.x, 0, it.z)
  g.rotation.y = it.rot
  g.userData.owner = { kind: 'furn', id: it.id }
  furnLayer.add(g)
  const instant = delay < 0
  const f = { id: it.id, item: it, def, model, group: g, tx: it.x, tz: it.z, trot: it.rot, hover: 0, dragging: false, bounceT: 9, delay: instant ? 0 : delay, appearT: instant ? 1 : 0, removing: false }
  model.inner.scale.setScalar(instant ? 1 : 0.001)
  furn.set(it.id, f)
  return f
}
function removeFurnitureNow(f) {
  furnLayer.remove(f.group)
  disposeGroup(f.group)
  furn.delete(f.id)
}
function clearFurniture() {
  for (const f of [...furn.values()]) removeFurnitureNow(f)
}
function populate(animated = true) {
  clearFurniture()
  items().forEach((it, i) => spawnFurniture(it, animated ? i * 0.04 : -1))
}
// Allinea i mobili in scena con il layout (usato dopo aggiornamenti dal server)
function syncFurniture() {
  const list = items()
  const ids = new Set(list.map((i) => i.id))
  for (const f of [...furn.values()]) if (!ids.has(f.id)) removeFurnitureNow(f)
  list.forEach((it) => {
    const f = furn.get(it.id)
    if (!f) spawnFurniture(it, 0)
    else if (!f.dragging) { f.item = it; f.tx = it.x; f.tz = it.z; f.trot = it.rot }
  })
}

// ---------- Selezione, anello, ghost ----------
let selected = null // { kind:'furn', id } | { kind:'agent', key }
let hovered = null
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }))
selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.03; selRing.visible = false; selRing.renderOrder = 3
scene.add(selRing)
const selGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.28, depthWrite: false }))
selGlow.rotation.x = -Math.PI / 2; selGlow.position.y = 0.025; selGlow.visible = false; selGlow.renderOrder = 2
scene.add(selGlow)
const ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#7be3a0', transparent: true, opacity: 0.45, depthWrite: false }))
ghost.rotation.x = -Math.PI / 2; ghost.position.y = 0.035; ghost.visible = false; ghost.renderOrder = 3
scene.add(ghost)

function select(sel) {
  selected = sel
  const f = sel?.kind === 'furn' ? furn.get(sel.id) : null
  $('rot').disabled = !f
  $('del').disabled = !f
  if (sel?.kind === 'agent') { openCard(sel.key); goal.zoom = 0.72 } else { closeCard(); goal.zoom = DEFAULT_GOAL.zoom; goal.target.set(0, 0.8, 0.4) }
}

// ---------- Agenti ----------
const agents = new Map()
const labels = $('labels')
let agentData = []

function makeTag(a) {
  const el = document.createElement('div')
  el.className = 'tag' + (a.kind === 'main' ? ' main' : ' sub')
  el.innerHTML = '<div class="speech" hidden></div><div class="chip" hidden><span class="e"></span><b></b></div><div class="name"></div>'
  labels.appendChild(el)
  return el
}
function ensureAgent(a) {
  let ag = agents.get(a.key)
  if (ag) { ag.data = a; return ag }
  const h = hashOf(a.key)
  const look = a.look || {}
  let species = look.species && SPECIES[look.species] ? look.species : null
  if (!species) {
    // scelta in base all'identificativo, evitando se possibile specie già presenti in stanza
    const used = new Set([...agents.values()].map((x) => x.species))
    for (let i = 0; i < SPECIES_IDS.length; i++) {
      const s = SPECIES_IDS[(h + i) % SPECIES_IDS.length]
      if (!used.has(s) || i === SPECIES_IDS.length - 1) { species = s; break }
    }
  }
  const shirtIdx = a.kind === 'sub' ? 6 : Number.isInteger(look.shirt) ? look.shirt : (h >>> 4) % SHIRTS.length // i subagenti sono cadetti
  const char = createCharacter(species, shirtIdx)
  char.root.userData.owner = { kind: 'agent', key: a.key }
  const loc = a.loc || 'bridge'
  // entra dal portello (angolo in fondo a sinistra)
  char.root.position.set(DOOR.x, 0, DOOR.z)
  char.root.visible = loc === sceneName
  scene.add(char.root)
  ag = { key: a.key, data: a, char, species, yaw: Math.PI * 1.1, moving: false, lift: 0, dragging: false, pin: null, hover: 0, tag: makeTag(a), fxT: 0, activeSince: 0, lastStatus: 'idle', idleSince: performance.now(), cheerUntil: 0, wantSit: false, loc, leaving: false, nextLoc: null, baseScale: a.kind === 'sub' ? 0.82 : 1, mat: null, wasDone: false }
  agents.set(a.key, ag)
  if (a.kind === 'sub' && loc === sceneName) launchMission(ag)
  if (loc === sceneName && a.kind !== 'sub') fx.emit('puff', char.root.position.clone().add(new THREE.Vector3(0, 1, 0)), { size: 1.2, life: 0.7, vel: new THREE.Vector3(0, 0.2, 0), grow: 1.5 })
  return ag
}
function removeAgent(key) {
  const ag = agents.get(key)
  if (!ag) return
  if (ag.data.kind === 'sub' && ag.loc === sceneName && ag.char.root.visible) {
    const p = ag.char.root.position.clone(); p.y = 1
    fx.burst('star', p, 6, 1.4, 0.24)
    fx.emit('puff', p, { size: 1.0, life: 0.6, vel: new THREE.Vector3(0, 0.2, 0), grow: 1.4 })
    sfx.remove()
  }
  scene.remove(ag.char.root)
  disposeGroup(ag.char.root)
  ag.tag.remove()
  agents.delete(key)
  if (selected?.kind === 'agent' && selected.key === key) select(null)
}
function onAgents(list) {
  agentData = list
  const keys = new Set(list.map((a) => a.key))
  for (const k of [...agents.keys()]) if (!keys.has(k)) removeAgent(k)
  const now = performance.now()
  for (const a of list) {
    const ag = ensureAgent(a)
    const newLoc = a.loc || 'bridge'
    if (ag.loc !== newLoc && !(ag.leaving && ag.nextLoc === newLoc)) changeLoc(ag, newLoc)
    if (a.done && (!ag.wasDone || (a.result && !ag.gotResult))) {
      // missione compiuta: il subagente mostra il risultato (se arriva dopo, aggiorna il fumetto)
      const first = !ag.wasDone
      ag.wasDone = true
      if (a.result) ag.gotResult = true
      if (ag.loc === sceneName) {
        const txt = (a.result || '').trim()
        say(ag, txt ? '✔ ' + (txt.length > 130 ? txt.slice(0, 127) + '…' : txt) : '✔ Missione compiuta!', 9000)
        if (first) {
          ag.cheerUntil = now + 2600
          sfx.done()
          const p = ag.char.root.position.clone(); p.y = 1.7
          fx.burst('star', p, 8, 1.6, 0.28)
        }
      }
    }
    if (a.status !== ag.lastStatus) {
      if (ag.lastStatus === 'idle') ag.activeSince = now
      if (a.status === 'idle') {
        ag.idleSince = now
        if (a.kind === 'main' && now - ag.activeSince > 1500) celebrate(ag)
      }
      ag.lastStatus = a.status
    }
  }
  $('count').textContent = list.length + (list.length === 1 ? ' abitante' : ' abitanti')
  updateSceneButtons()
  if (selected?.kind === 'agent') updateCard()
}

// ---- Luoghi: ogni agente sta in un ponte e si vede solo lì ----
function changeLoc(ag, newLoc) {
  ag.pin = null
  if (ag.loc === sceneName) {
    // lo vedo andare verso il portello e uscire
    ag.leaving = true
    ag.nextLoc = newLoc
  } else {
    ag.loc = newLoc
    ag.leaving = false
    if (newLoc === sceneName) enterRoom(ag)
  }
}
function enterRoom(ag) {
  const r = ag.char.root
  r.position.set(DOOR.x, 0, DOOR.z)
  r.visible = true
  ag.yaw = 0.8
  ag.char.state.sit = 0
  fx.emit('puff', r.position.clone().add(new THREE.Vector3(0, 1, 0)), { size: 1.2, life: 0.7, vel: new THREE.Vector3(0, 0.2, 0), grow: 1.5 })
  sfx.select()
}
function finishLeave(ag) {
  const p = ag.char.root.position.clone(); p.y = 1
  fx.emit('puff', p, { size: 1.2, life: 0.7, vel: new THREE.Vector3(0, 0.2, 0), grow: 1.5 })
  ag.loc = ag.nextLoc ?? ag.loc
  ag.leaving = false
  ag.char.root.visible = false
  ag.tag.style.display = 'none'
  if (selected?.kind === 'agent' && selected.key === ag.key) select(null)
  updateSceneButtons()
}
// Dopo un cambio di ponte gli agenti di quel ponte sono già ai loro posti (non devono rifare tutta la strada)
function snapAgents() {
  const targets = computeTargets()
  for (const ag of agents.values()) {
    if (ag.leaving) { ag.loc = ag.nextLoc ?? ag.loc; ag.leaving = false }
    ag.mat = null
    const here = ag.loc === sceneName
    ag.char.root.visible = here
    if (!here) continue
    const tg = targets.get(ag.key)
    if (tg) {
      ag.char.root.position.set(tg.x, 0, tg.z)
      ag.yaw = tg.yaw
      ag.wantSit = tg.sit
      ag.char.state.sit = tg.sit ? 1 : 0
    }
  }
}
function celebrate(ag) {
  ag.cheerUntil = performance.now() + 2600
  sfx.done()
  const p = ag.char.root.position.clone(); p.y = 1.7
  fx.burst('star', p, 9, 1.8, 0.32)
}

// Assegna agenti a postazioni e punti di attesa
const lobby = [[-6, 5.8], [-4, 5.4], [5, 5.8], [6.5, 5.4], [8.5, 5.8], [-8, 5.4], [3.4, 6.3], [-2.9, 6.3]]
function seatWorld(f) {
  const s = f.def.seat, r = f.item.rot
  return { x: f.item.x + Math.cos(r) * s.x + Math.sin(r) * s.z, z: f.item.z - Math.sin(r) * s.x + Math.cos(r) * s.z, yaw: r + Math.PI, sit: !!s.sit, id: f.id }
}
function computeTargets() {
  const stations = [...furn.values()].filter((f) => f.def.work && !f.removing).sort((a, b) => a.item.z - b.item.z || a.item.x - b.item.x)
  const all = [...agents.values()].filter((x) => x.loc === sceneName && !x.leaving)
  const list = all.filter((x) => x.data.kind !== 'sub').sort((a, b) => a.key.localeCompare(b.key))
  const out = new Map(), used = new Set()
  for (const ag of list) {
    if (ag.pin?.station) {
      const f = stations.find((s) => s.id === ag.pin.station)
      if (f && !used.has(f.id)) { used.add(f.id); out.set(ag.key, seatWorld(f)) } else ag.pin = null
    } else if (ag.pin?.x !== undefined) {
      out.set(ag.key, { x: ag.pin.x, z: ag.pin.z, yaw: 0.5, sit: false })
    }
  }
  let li = 0
  for (const ag of list) {
    if (out.has(ag.key)) continue
    const f = stations.find((s) => !used.has(s.id))
    if (f) { used.add(f.id); out.set(ag.key, seatWorld(f)) } else { const [x, z] = lobby[li++ % lobby.length]; out.set(ag.key, { x, z, yaw: 0.3, sit: false, lobby: true }) }
  }
  // i subagenti: in cerchio attorno al pad; a missione finita tornano accanto all'agente principale
  const subs = all.filter((x) => x.data.kind === 'sub').sort((a, b) => a.key.localeCompare(b.key))
  const active = subs.filter((s) => !s.data.done)
  for (const s of subs) {
    const pt = s.data.done ? out.get(s.data.session + ':main') : null
    if (pt) {
      const j = subs.filter((q) => q.data.done && q.data.session === s.data.session).indexOf(s)
      out.set(s.key, { x: pt.x + 1.1 + (j % 2) * 0.75, z: pt.z + 0.2 + Math.floor(j / 2) * 0.75, yaw: pt.yaw, sit: false })
      continue
    }
    const i = Math.max(0, active.indexOf(s))
    const ang = 0.9 + i * ((Math.PI * 2) / Math.max(active.length, 3))
    out.set(s.key, { x: PAD.x + Math.cos(ang) * 1.5, z: PAD.z + Math.sin(ang) * 1.5, yaw: Math.atan2(Math.cos(ang), Math.sin(ang)), sit: false })
  }
  return out
}

function updateAgents(dt, t, now) {
  const targets = computeTargets()
  const v = new THREE.Vector3()
  for (const ag of agents.values()) {
    const here = ag.loc === sceneName
    ag.char.root.visible = here
    if (!here) { ag.tag.style.display = 'none'; continue }
    if (ag.mat?.phase === 'wait') { ag.char.root.visible = false; ag.tag.style.display = 'none'; continue } // il drone non è ancora arrivato
    let tg = targets.get(ag.key)
    if (ag.leaving) tg = { x: DOOR.x, z: DOOR.z, yaw: 2.4, sit: false }
    const r = ag.char.root
    if (ag.leaving && Math.hypot(DOOR.x - r.position.x, DOOR.z - r.position.z) < 0.5) { finishLeave(ag); continue }
    const st = ag.data.status
    let mode = 'idle'
    if (!ag.dragging && tg) {
      const dx = tg.x - r.position.x, dz = tg.z - r.position.z
      const dist = Math.hypot(dx, dz)
      const standing = ag.char.state.sit < 0.3
      if (dist > 0.05) {
        ag.wantSit = false
        if (standing) {
          const step = Math.min(dist, 2.7 * dt)
          r.position.x += (dx / dist) * step; r.position.z += (dz / dist) * step
          ag.yaw += angDiff(ag.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 10)
          ag.moving = true
        } else ag.moving = false
      } else {
        ag.moving = false
        ag.yaw += angDiff(ag.yaw, tg.yaw) * Math.min(1, dt * 6)
        ag.wantSit = tg.sit
      }
    } else { ag.moving = false }

    const asking = ag.data.kind === 'main' && permsData.some((p) => p.session === ag.data.session && !p.decision)
    if (!ag.moving) {
      if (asking) mode = 'alert'
      else if (now < ag.cheerUntil) mode = 'cheer'
      else if (st !== 'idle') mode = MODE_OF[st] ?? 'typing'
      else mode = now - ag.idleSince > 20000 && ag.wantSit ? 'sleep' : 'look'
    }
    ag.char.update(dt, t, { moving: ag.moving, sit: ag.wantSit && !ag.dragging, mode })
    ag.lift = lerp(ag.lift, ag.dragging ? 0.55 : 0, Math.min(1, dt * 14))
    r.position.y += ag.lift
    ag.hover = lerp(ag.hover, hovered?.kind === 'agent' && hovered.key === ag.key ? 1 : 0, Math.min(1, dt * 12))
    let sc = ag.baseScale * (1 + ag.hover * 0.07 + (selected?.kind === 'agent' && selected.key === ag.key ? 0.04 : 0))
    if (ag.mat?.phase === 'materialize') {
      ag.mat.t += dt / 0.7
      sc *= Math.max(0.001, easeOutBack(Math.min(1, ag.mat.t)))
      if (ag.mat.t >= 1) ag.mat = null
    }
    r.scale.setScalar(sc)
    r.rotation.y = ag.yaw

    // effetti di stato
    ag.fxT -= dt
    if (ag.fxT <= 0 && !ag.moving) {
      v.copy(r.position); v.y += 1.9
      if (mode === 'think') { fx.emit('puff', v.clone().add(new THREE.Vector3(0.25, 0, 0)), { size: 0.3, life: 1.4, vel: new THREE.Vector3(0.1, 0.45, 0), grow: 1.1, wob: 0.15 }); ag.fxT = 0.65 }
      else if (mode === 'sleep') { fx.emit('zzz', v.clone().add(new THREE.Vector3(0.3, -0.2, 0)), { size: 0.42, life: 1.9, vel: new THREE.Vector3(0.12, 0.4, 0), wob: 0.2, grow: 0.5 }); ag.fxT = 1.1 }
      else if (mode === 'alert') { fx.emit('alert', v.clone().add(new THREE.Vector3(0, 0.15, 0)), { size: 0.42, life: 1.0, vel: new THREE.Vector3(0, 0.3, 0) }); ag.fxT = 1.0 }
      else if (selected?.kind === 'agent' && selected.key === ag.key) { fx.emit('star', v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.3, (Math.random() - 0.5) * 0.6)), { size: 0.18, life: 1.0, vel: new THREE.Vector3(0, 0.5, 0), spin: 1.2 }); ag.fxT = 0.35 }
    }

    // etichetta
    const tagEl = ag.tag
    v.set(r.position.x, 2.05 * 0.9 + (ag.wantSit ? -0.2 : 0) + ag.lift, r.position.z).project(camera)
    const visible = v.z < 1
    const x = (v.x * 0.5 + 0.5) * viewW, y = (-v.y * 0.5 + 0.5) * viewH
    tagEl.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`
    tagEl.style.display = visible ? '' : 'none'
    tagEl.classList.toggle('sel', selected?.kind === 'agent' && selected.key === ag.key)
    const nm = tagEl.querySelector('.name')
    if (nm.textContent !== ag.data.name) nm.textContent = ag.data.name
    const chip = tagEl.querySelector('.chip')
    const showChip = asking || mode !== 'idle' && mode !== 'look' || st !== 'idle'
    // fumetto con la risposta o un breve feedback
    const sp = tagEl.querySelector('.speech')
    if (ag.say && now < ag.say.until) {
      if (sp.textContent !== ag.say.text) sp.textContent = ag.say.text
      sp.classList.toggle('small', !!ag.say.small)
      sp.hidden = false
    } else if (ag.data.kind === 'sub' && ag.data.task && !ag.data.done) {
      // il compito del subagente resta sul cartellino finché lavora
      const txt = '📋 ' + (ag.data.task.length > 56 ? ag.data.task.slice(0, 55) + '…' : ag.data.task)
      if (sp.textContent !== txt) sp.textContent = txt
      sp.classList.add('small')
      sp.hidden = false
    } else sp.hidden = true
    if (showChip) {
      const s = STATUS[mode === 'sleep' ? 'idle' : mode === 'cheer' ? 'idle' : st] ?? STATUS.idle
      const icon = asking ? '🔔' : mode === 'cheer' ? '🎉' : mode === 'sleep' ? '💤' : s.icon
      const text = asking ? 'chiede il permesso' : mode === 'cheer' ? 'fatto!' : mode === 'sleep' ? 'dorme' : ag.data.detail || s.text
      chip.hidden = false
      chip.querySelector('.e').textContent = icon
      if (chip.querySelector('b').textContent !== text) chip.querySelector('b').textContent = text
    } else chip.hidden = true
  }
}

// ---------- Missioni dei subagenti: pad fisso, drone di lancio, raggio, materializzazione ----------
const drones = []
const links = new Map() // chiave del subagente -> raggio verso l'agente principale
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.2, 28, 1, true), holo(0x4de0ff, 0.9, 0.5))
beam.position.set(PAD.x, 1.6, PAD.z); beam.visible = false
scene.add(beam)
let beamT = 1
const linkMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.55, depthWrite: false })
const linkGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6)
const easeOutBack = (t) => { const x = t - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x }
function makeDrone() {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: '#eef3ff', roughness: 0.4 })))
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#4de0ff' })); eye.position.z = 0.14; g.add(eye)
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 20), new THREE.MeshBasicMaterial({ color: '#7fe8ff' })); ringM.rotation.x = Math.PI / 2; g.add(ringM)
  return g
}
function padFlash() { beamT = 0; beam.visible = true }
function startMaterialize(ag) {
  if (!agents.has(ag.key)) return
  ag.mat = { phase: 'materialize', t: 0 }
  const r = ag.char.root
  r.position.set(PAD.x, 0, PAD.z); r.visible = true
  ag.yaw = 0.4
  padFlash()
  fx.burst('star', new THREE.Vector3(PAD.x, 1.2, PAD.z), 10, 1.6, 0.28)
  sfx.select()
}
// Un subagente appena partito: l'agente principale lancia un drone che atterra sul pad e lo fa materializzare
function launchMission(ag) {
  const parent = mainAgentOf(ag.data.session)
  ag.mat = { phase: 'wait', t: 0 }
  ag.char.root.visible = false
  if (parent && parent.loc === sceneName && parent.char.root.visible) {
    const from = parent.char.root.position.clone(); from.y = 1.5
    const mesh = makeDrone(); mesh.position.copy(from); scene.add(mesh)
    drones.push({ mesh, from, to: new THREE.Vector3(PAD.x, 1.0, PAD.z), t: 0, ag })
    parent.cheerUntil = performance.now() + 1100
    say(parent, 'Missione! 🚀', 1800, true)
    sfx.pick()
  } else startMaterialize(ag)
}
const Y_AXIS = new THREE.Vector3(0, 1, 0)
function updateMissions(dt) {
  if (beam.visible) {
    beamT += dt / 0.9
    beam.material.opacity = Math.max(0, 0.55 * (1 - beamT))
    beam.scale.set(1 + beamT * 0.25, 1, 1 + beamT * 0.25)
    if (beamT >= 1) beam.visible = false
  }
  for (let i = drones.length - 1; i >= 0; i--) {
    const d = drones[i]
    d.t += dt
    const k = Math.min(1, d.t / 1.0)
    d.mesh.position.lerpVectors(d.from, d.to, k)
    d.mesh.position.y += Math.sin(Math.PI * k) * 1.5
    d.mesh.rotation.y += dt * 7
    if (Math.random() < dt * 22) fx.emit('puff', d.mesh.position.clone(), { size: 0.22, life: 0.5, vel: new THREE.Vector3(0, 0.1, 0), grow: 1 })
    if (k >= 1) { scene.remove(d.mesh); drones.splice(i, 1); startMaterialize(d.ag) }
  }
  // raggio luminoso tra ogni subagente e il suo agente principale
  const seen = new Set()
  for (const ag of agents.values()) {
    if (ag.data.kind !== 'sub' || ag.loc !== sceneName || !ag.char.root.visible || ag.mat?.phase === 'wait') continue
    const parent = mainAgentOf(ag.data.session)
    if (!parent || parent.loc !== sceneName || !parent.char.root.visible) continue
    let m = links.get(ag.key)
    if (!m) { m = new THREE.Mesh(linkGeo, linkMat); m.renderOrder = 4; scene.add(m); links.set(ag.key, m) }
    seen.add(ag.key)
    const a = parent.char.root.position, b = ag.char.root.position
    const from = new THREE.Vector3(a.x, 1.5, a.z), to = new THREE.Vector3(b.x, 1.2, b.z)
    const dir = to.clone().sub(from), len = dir.length()
    m.position.copy(from).addScaledVector(dir, 0.5)
    m.scale.set(1, Math.max(0.01, len), 1)
    m.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize())
  }
  for (const [k, m] of links) if (!seen.has(k)) { scene.remove(m); links.delete(k) }
}

// ---------- Aggiornamento mobili ----------
function updateFurniture(dt, t) {
  const k = Math.min(1, dt * 12)
  for (const f of furn.values()) {
    const g = f.group
    g.position.x = lerp(g.position.x, f.tx, k)
    g.position.z = lerp(g.position.z, f.tz, k)
    g.rotation.y += angDiff(g.rotation.y, f.trot) * Math.min(1, dt * 10)
    const hov = hovered?.kind === 'furn' && hovered.id === f.id
    f.hover = lerp(f.hover, hov ? 1 : 0, Math.min(1, dt * 12))
    const ty = f.dragging ? 0.32 : f.def.flat ? 0 : f.hover * 0.07
    g.position.y = lerp(g.position.y, ty, Math.min(1, dt * 14))
    // comparsa con un po' di rimbalzo, poi squash & stretch ai click/drop
    if (f.delay > 0) { f.delay -= dt; f.model.inner.scale.setScalar(0.001) }
    else if (f.appearT < 1) {
      f.appearT = Math.min(1, f.appearT + dt / 0.5)
      const x = f.appearT - 1, c1 = 2.2
      f.model.inner.scale.setScalar(Math.max(0.001, 1 + (c1 + 1) * x * x * x + c1 * x * x))
    } else {
      f.bounceT += dt
      const b = Math.exp(-f.bounceT * 6) * Math.cos(f.bounceT * 20)
      f.model.inner.scale.set(1 - 0.08 * b, 1 + 0.12 * b, 1 - 0.08 * b)
    }
    // oscillazioni (foglie)
    for (const s of f.model.sway) s.obj.rotation[s.axis ?? 'z'] = (s.base ?? 0) + Math.sin(t * s.speed + s.phase) * s.amp
    for (const s of f.model.spin) s.obj.rotation[s.axis ?? 'y'] += s.speed * dt
  }
  // lampeggio LED dei rack
  if (Math.floor(t * 4) !== lastBlink) {
    lastBlink = Math.floor(t * 4)
    for (const f of furn.values()) for (const m of f.model.blink) m.emissiveIntensity = Math.random() > 0.35 ? 1.4 : 0.15
  }
}
let lastBlink = 0

function updateSelection(t) {
  let pos = null, size = 1
  if (selected?.kind === 'furn') {
    const f = furn.get(selected.id)
    if (f) { pos = f.group.position; const b = aabb({ ...f.item, x: 0, z: 0 }); size = Math.max(b.hw, b.hd) + 0.35 }
  } else if (selected?.kind === 'agent') {
    const ag = agents.get(selected.key)
    if (ag) { pos = ag.char.root.position; size = 0.75 }
  }
  selRing.visible = selGlow.visible = !!pos
  if (pos) {
    const p = 1 + Math.sin(t * 4) * 0.04
    selRing.position.set(pos.x, 0.03, pos.z); selGlow.position.set(pos.x, 0.025, pos.z)
    selRing.scale.setScalar(size * p); selGlow.scale.setScalar(size * p * 0.98)
  }
}

// ---------- Interazione ----------
const canvas = $('gl')
const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
function setRay(e) {
  const r = canvas.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  ray.setFromCamera(ndc, camera)
}
function pickOwner(e) {
  setRay(e)
  const roots = [...furn.values()].map((f) => f.group).concat([...agents.values()].filter((a) => a.loc === sceneName).map((a) => a.char.root))
  for (const h of ray.intersectObjects(roots, true)) {
    let o = h.object
    while (o && !o.userData.owner) o = o.parent
    if (o) return o.userData.owner
  }
  return null
}
function floorPoint(e) {
  setRay(e)
  const p = new THREE.Vector3()
  return ray.ray.intersectPlane(floorPlane, p) ? p : null
}

let drag = null // { kind:'furn'|'agent'|'pan'|'orbit', ... }
const tip = $('tip')
function setTip(text, e) {
  if (!text) { tip.classList.remove('on'); return }
  tip.textContent = text
  tip.style.left = e.clientX + 'px'
  tip.style.top = e.clientY + 'px'
  tip.classList.add('on')
}
function describe(o) {
  if (!o) return ''
  if (o.kind === 'furn') return furn.get(o.id)?.def.label ?? ''
  const ag = agents.get(o.key)
  if (!ag) return ''
  const s = STATUS[ag.data.status] ?? STATUS.idle
  return `${ag.data.name}${ag.data.kind === 'sub' ? ' (subagente)' : ''} · ${SPECIES[ag.species]?.label ?? ''} · ${s.text}`
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId) } catch {}
  setTip('')
  if (e.button === 2 || e.button === 1) { drag = { kind: 'orbit', x: e.clientX, y: e.clientY, moved: true }; return }
  const o = pickOwner(e)
  if (o) {
    const p = floorPoint(e)
    if (o.kind === 'furn') {
      const f = furn.get(o.id)
      drag = { kind: 'furn', f, sx: e.clientX, sy: e.clientY, moved: false, off: p ? { x: f.item.x - p.x, z: f.item.z - p.z } : { x: 0, z: 0 }, cand: null }
    } else {
      const ag = agents.get(o.key)
      drag = { kind: 'agent', ag, sx: e.clientX, sy: e.clientY, moved: false }
    }
  } else {
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }
  }
})
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    const o = pickOwner(e)
    const same = (!o && !hovered) || (o && hovered && o.kind === hovered.kind && (o.id === hovered.id) && (o.key === hovered.key))
    if (!same) { hovered = o; if (o) sfx.hover() }
    canvas.style.cursor = o ? 'pointer' : 'default'
    setTip(describe(o), e)
    return
  }
  if (drag.kind === 'orbit') {
    goal.az = clamp(goal.az + (e.clientX - drag.x) * 0.005, 0.3, 1.1)
    goal.el = clamp(goal.el + (e.clientY - drag.y) * 0.004, 0.5, 1.0)
    drag.x = e.clientX; drag.y = e.clientY
    return
  }
  if (drag.kind === 'pan') {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    drag.x = e.clientX; drag.y = e.clientY
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true
    if (drag.moved) {
      const D = baseDistance() * cam.zoom
      const s = (D * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewH
      const right = new THREE.Vector3(Math.cos(cam.az), 0, -Math.sin(cam.az))
      const fwd = new THREE.Vector3(-Math.sin(cam.az), 0, -Math.cos(cam.az))
      goal.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s)
      goal.target.x = clamp(goal.target.x, -9, 9); goal.target.z = clamp(goal.target.z, -6, 6)
    }
    return
  }
  const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy)
  if (!drag.moved && dist > 6) {
    drag.moved = true
    if (drag.kind === 'furn') { drag.f.dragging = true; select({ kind: 'furn', id: drag.f.id }); sfx.pick(); canvas.style.cursor = 'grabbing' }
    else { drag.ag.dragging = true; select({ kind: 'agent', key: drag.ag.key }); sfx.pick(); canvas.style.cursor = 'grabbing' }
  }
  if (!drag.moved) return
  const p = floorPoint(e)
  if (!p) return
  if (drag.kind === 'furn') {
    const it = drag.f.item
    const tmp = { ...it, x: Math.round((p.x + drag.off.x) * 2) / 2, z: Math.round((p.z + drag.off.z) * 2) / 2 }
    clampItem(tmp)
    const valid = !overlaps(tmp)
    drag.cand = { x: tmp.x, z: tmp.z, valid }
    drag.f.tx = tmp.x; drag.f.tz = tmp.z
    const b = aabb(tmp)
    ghost.visible = true
    ghost.position.set(tmp.x, 0.035, tmp.z)
    ghost.scale.set(b.hw * 2, b.hd * 2, 1)
    ghost.material.color.set(valid ? '#7be3a0' : '#ff7a7a')
  } else {
    const tabEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('#scenes .btn')
    document.querySelectorAll('#scenes .btn.drop').forEach((b) => b.classList.remove('drop'))
    if (tabEl && tabEl.dataset.scene !== sceneName) tabEl.classList.add('drop')
    drag.ag.char.root.position.x = clamp(p.x, BOUNDS.minX + 0.5, BOUNDS.maxX - 0.5)
    drag.ag.char.root.position.z = clamp(p.z, BOUNDS.minZ + 0.8, BOUNDS.maxZ - 0.5)
    drag.ag.moving = false
  }
})
function endDrag(e) {
  const d = drag
  drag = null
  ghost.visible = false
  canvas.style.cursor = 'default'
  if (!d) return
  if (d.kind === 'furn') {
    const f = d.f
    f.dragging = false
    if (d.moved && d.cand) {
      if (d.cand.valid) {
        if (f.item.x !== d.cand.x || f.item.z !== d.cand.z) { f.item.x = d.cand.x; f.item.z = d.cand.z; saveLayout() }
        sfx.place()
      } else { toast('Non c\'è spazio qui'); sfx.error() }
      f.tx = f.item.x; f.tz = f.item.z
      f.bounceT = 0
    } else if (!d.moved) {
      select({ kind: 'furn', id: f.id }); f.bounceT = 0; sfx.click()
    }
  } else if (d.kind === 'agent') {
    const ag = d.ag
    ag.dragging = false
    document.querySelectorAll('#scenes .btn.drop').forEach((b) => b.classList.remove('drop'))
    if (d.moved) {
      const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest('#scenes .btn')
      if (tab && tab.dataset.scene && tab.dataset.scene !== sceneName) { sendMove(ag, tab.dataset.scene); ag.char.state.hop = 0.25; return }
      const pos = ag.char.root.position
      let best = null, bd = 2.2
      for (const f of furn.values()) if (f.def.work) { const s = seatWorld(f); const dd = Math.hypot(s.x - pos.x, s.z - pos.z); if (dd < bd) { bd = dd; best = f } }
      if (best) { for (const o of agents.values()) if (o !== ag && o.pin?.station === best.id) o.pin = null; ag.pin = { station: best.id }; toast(`${ag.data.name} → ${best.def.label}`) }
      else { ag.pin = { x: pos.x, z: pos.z }; toast(`${ag.data.name} resta qui`) }
      sfx.place()
      ag.char.state.hop = 0.25
      if (selected?.kind === 'agent') updateCard()
    } else { select({ kind: 'agent', key: ag.key }); sfx.select(); const p = ag.char.root.position.clone(); p.y = 1.9; fx.burst('star', p, 6, 1.2, 0.26) }
  } else if (d.kind === 'pan' && !d.moved) {
    if (selected) select(null)
  }
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)
canvas.addEventListener('pointerleave', () => { if (!drag) { hovered = null; setTip('') } })
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  goal.zoom = clamp(goal.zoom * Math.exp(e.deltaY * 0.0012), 0.35, 1.3)
}, { passive: false })

addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
  if (e.key === 'Escape') { if (!$('catalog').hidden) toggleCatalog(false); else if (!$('spawn').hidden) toggleSpawn(false); else if (selected) select(null) }
  if (typing) return
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected?.kind === 'furn') { removeSelected(); e.preventDefault() }
  if ((e.key === 'r' || e.key === 'R') && selected?.kind === 'furn') rotateSelected()
})

function rotateSelected() {
  if (selected?.kind !== 'furn') return
  const f = furn.get(selected.id)
  if (!f) return
  const tmp = { ...f.item, rot: (f.item.rot + Math.PI / 2) % (Math.PI * 2) }
  clampItem(tmp)
  if (overlaps(tmp)) { toast('Non c\'è spazio per ruotarlo'); sfx.error(); return }
  f.item.rot = tmp.rot; f.item.x = tmp.x; f.item.z = tmp.z
  f.trot = f.item.rot; f.tx = f.item.x; f.tz = f.item.z
  f.bounceT = 0
  sfx.click(); saveLayout()
}
function removeSelected() {
  if (selected?.kind !== 'furn') return
  const f = furn.get(selected.id)
  if (!f) return
  const list = items()
  const i = list.findIndex((x) => x.id === f.id)
  if (i >= 0) list.splice(i, 1)
  const p = f.group.position.clone(); p.y = 0.8
  fx.burst('puff', p, 5, 1.0, 0.7)
  f.removing = true
  removeFurnitureNow(f)
  select(null)
  sfx.remove(); saveLayout()
}
$('rot').onclick = rotateSelected
$('del').onclick = removeSelected
$('reset').onclick = () => {
  if (!confirm('Ripristinare le postazioni e l\'arredo di questo scenario?')) return
  delete layout.scenes[keyOf(sceneName)]
  select(null)
  populate(true)
  sfx.place(); saveLayout()
  toast('Scenario ripristinato')
}

// ---------- Aggiunta mobili ----------
function addFurniture(type) {
  const def = CATALOG[type]
  const list = items()
  const base = { id: sceneName + '-' + Date.now().toString(36) + Math.floor(Math.random() * 99), type, x: 0, z: 0, rot: def.work ? Math.PI : 0 }
  let spot = null
  const zs = [4.2, 2.2, 0.2, -1.8, -3.8, -5.6, 5.8]
  const xs = [0, 2.5, -2.5, 5, -5, 7.5, -7.5, 10, -10]
  outer: for (const z of zs) for (const x of xs) {
    const tmp = { ...base, x, z }
    clampItem(tmp)
    if (!overlaps(tmp)) { spot = tmp; break outer }
  }
  if (!spot) { toast('Non c\'è più posto in questa stanza'); sfx.error(); return }
  list.push(spot)
  const f = spawnFurniture(spot, 0)
  if (f) { f.group.position.set(spot.x, 2.5, spot.z) } // cade dall'alto
  select({ kind: 'furn', id: spot.id })
  sfx.place(); saveLayout()
  toast(`${def.label} aggiunto`)
}

// ---------- Catalogo con anteprime 3D ----------
const previews = new Map()
let previewsStarted = false
function renderPreviews() {
  if (previewsStarted) return
  previewsStarted = true
  let pr
  try { pr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }) } catch { return }
  pr.setPixelRatio(1)
  pr.setSize(184, 184)
  pr.outputColorSpace = THREE.SRGBColorSpace
  pr.toneMapping = THREE.ACESFilmicToneMapping
  const ps = new THREE.Scene()
  ps.add(new THREE.HemisphereLight('#fff4e0', '#e8c9a0', 1.5))
  const dl = new THREE.DirectionalLight('#ffffff', 2.2); dl.position.set(4, 8, 6); ps.add(dl)
  const pc = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  const types = Object.keys(CATALOG)
  let i = 0
  const step = () => {
    if (i >= types.length) { pr.dispose(); pr.forceContextLoss?.(); return }
    const type = types[i++]
    const m = buildModel(type)
    ps.add(m.group)
    const box = new THREE.Box3().setFromObject(m.inner)
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3())
    const dist = Math.max(s.x, s.y * 1.1, s.z) * 2.3 + 0.8
    pc.position.copy(c).add(new THREE.Vector3(0.9, 0.75, 1.15).normalize().multiplyScalar(dist))
    pc.lookAt(c)
    pr.render(ps, pc)
    const url = pr.domElement.toDataURL('image/png')
    previews.set(type, url)
    document.querySelectorAll(`img[data-prev="${type}"]`).forEach((im) => { im.src = url; im.hidden = false; im.nextElementSibling?.remove() })
    ps.remove(m.group); disposeGroup(m.group)
    setTimeout(step, 0)
  }
  step()
}
let catTab = 'work'
function buildCatalog() {
  const tabs = $('tabs')
  tabs.innerHTML = ''
  const avail = catalogFor(sceneName)
  const cats = CATEGORIES.filter((c) => avail.some(([, d]) => d.cat === c.id))
  if (!cats.some((c) => c.id === catTab)) catTab = cats[0]?.id
  for (const c of cats) {
    const b = document.createElement('button')
    b.className = 'btn'; b.setAttribute('role', 'tab'); b.setAttribute('aria-pressed', String(c.id === catTab))
    b.innerHTML = `<span class="ic">${c.icon}</span><span>${c.label}</span>`
    b.onclick = () => { catTab = c.id; sfx.click(); buildCatalog() }
    tabs.appendChild(b)
  }
  const grid = $('grid')
  grid.innerHTML = ''
  for (const [type, d] of avail.filter(([, d]) => d.cat === catTab)) {
    const b = document.createElement('button')
    b.className = 'card'
    const url = previews.get(type)
    b.innerHTML = (url ? `<img alt="" data-prev="${type}" src="${url}">` : `<img alt="" data-prev="${type}" hidden><div class="ph">🪑</div>`) + `<span>${d.label}</span>`
    b.onclick = () => addFurniture(type)
    grid.appendChild(b)
  }
}
function toggleCatalog(open) {
  const c = $('catalog')
  const willOpen = open ?? c.hidden
  c.hidden = !willOpen
  $('add-btn').setAttribute('aria-expanded', String(willOpen))
  if (willOpen) { if (!$('spawn').hidden) toggleSpawn(false); buildCatalog(); renderPreviews(); sfx.click() }
}
$('add-btn').onclick = () => toggleCatalog()
$('cat-close').onclick = () => toggleCatalog(false)

// ---------- Scelta del personaggio per un nuovo agente ----------
const spawnLook = { species: null, shirt: null } // null = casuale
let lookThumbs = new Map()
let lookBuilt = false
function makeThumbs(shirtIdx) {
  const out = new Map()
  let pr
  try { pr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }) } catch { return out }
  pr.setPixelRatio(1)
  pr.setSize(150, 150)
  pr.outputColorSpace = THREE.SRGBColorSpace
  pr.toneMapping = THREE.ACESFilmicToneMapping
  const ps = new THREE.Scene()
  ps.add(new THREE.HemisphereLight('#fff4e0', '#e8c9a0', 1.6))
  const dl = new THREE.DirectionalLight('#ffffff', 2.2); dl.position.set(3, 6, 5); ps.add(dl)
  const pc = new THREE.PerspectiveCamera(26, 1, 0.1, 50)
  pc.position.set(1.2, 1.1, 3.8); pc.lookAt(0, 0.88, 0)
  for (const id of SPECIES_IDS) {
    const ch = createCharacter(id, shirtIdx)
    ch.root.rotation.y = 0.35
    ch.update(0, 0, { moving: false, sit: false, mode: 'idle' })
    ps.add(ch.root)
    pr.render(ps, pc)
    out.set(id, pr.domElement.toDataURL('image/png'))
    ps.remove(ch.root); disposeGroup(ch.root)
  }
  pr.dispose(); pr.forceContextLoss?.()
  return out
}
function renderLookUI() {
  const box = $('sp-species')
  const opts = [{ id: null, label: 'Casuale' }, ...SPECIES_IDS.map((id) => ({ id, label: SPECIES[id].label }))]
  box.replaceChildren(...opts.map((o) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sp-opt'
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-pressed', String(spawnLook.species === o.id))
    const url = o.id ? lookThumbs.get(o.id) : null
    if (url) { const im = document.createElement('img'); im.alt = ''; im.src = url; b.appendChild(im) }
    else { const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = o.id ? '🐾' : '🎲'; b.appendChild(ph) }
    b.appendChild(Object.assign(document.createElement('span'), { textContent: o.label }))
    b.onclick = () => { spawnLook.species = o.id; sfx.click(); renderLookUI() }
    return b
  }))
  const sh = $('sp-shirts')
  sh.replaceChildren(...SHIRTS.map((hex, i) => {
    const d = document.createElement('button')
    d.type = 'button'
    d.className = 'dot'
    d.style.background = hex
    d.title = OUTFITS[i].name
    d.setAttribute('aria-label', 'Divisa: ' + OUTFITS[i].name)
    d.setAttribute('aria-pressed', String(spawnLook.shirt === i))
    d.onclick = () => {
      spawnLook.shirt = spawnLook.shirt === i ? null : i // un secondo clic torna a "casuale"
      sfx.click()
      lookThumbs = makeThumbs(spawnLook.shirt ?? 0)
      renderLookUI()
    }
    return d
  }))
}
function buildLookUI() {
  if (lookBuilt) return
  lookBuilt = true
  renderLookUI() // subito, con segnaposto
  setTimeout(() => { lookThumbs = makeThumbs(spawnLook.shirt ?? 0); renderLookUI() }, 30)
}

// ---------- Nuovo agente (apre un terminale con la mod) ----------
async function loadDirs(p) {
  const box = $('sp-dirs')
  if (!TOKEN) { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'none', textContent: 'Apri la finestra con /vibeship per avviare nuovi agenti.' })); return }
  try {
    const r = await fetch('/api/dirs?path=' + encodeURIComponent(p), { headers: { 'x-token': TOKEN } })
    if (r.status === 401) { toast('Finestra non più autorizzata: chiudila e rilancia /vibeship'); return }
    const d = await r.json()
    if (!r.ok) { toast(d.error || 'Cartella non leggibile'); return }
    renderDirs(d)
  } catch { toast('Server non raggiungibile') }
}
function dirButton(label, path) {
  const b = document.createElement('button')
  b.type = 'button'
  b.setAttribute('role', 'listitem')
  b.textContent = label
  b.onclick = () => { sfx.click(); loadDirs(path) }
  return b
}
function renderDirs(d) {
  $('sp-path').value = d.path
  const box = $('sp-dirs')
  const items = []
  if (d.parent !== null) items.push(dirButton('⬆️  Cartella superiore', d.parent))
  for (const x of d.dirs) items.push(dirButton('📁  ' + x.name, x.path))
  if (!d.dirs.length) items.push(Object.assign(document.createElement('div'), { className: 'none', textContent: 'Nessuna sottocartella.' }))
  box.replaceChildren(...items)
  const rec = $('sp-recent')
  rec.replaceChildren(...(d.recent ?? []).map((p) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chipbtn'
    b.textContent = '🕘 ' + (p.split(/[\\/]/).filter(Boolean).pop() || p)
    b.title = p
    b.onclick = () => { sfx.click(); loadDirs(p) }
    return b
  }))
}
let spawnLoc = null
function renderLocUI() {
  const box = $('sp-locs')
  box.replaceChildren(...SCENES.map((s) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chipbtn'
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-pressed', String(s.id === (spawnLoc ?? sceneName)))
    b.textContent = s.icon + ' ' + s.label
    b.onclick = () => { spawnLoc = s.id; sfx.click(); renderLocUI() }
    return b
  }))
}
// Nuovo progetto: crea una cartella nuova dentro quella che sto guardando e la seleziona
function toggleNewProject(open) {
  const f = $('np-form')
  const willOpen = open ?? f.hidden
  f.hidden = !willOpen
  $('np-toggle').setAttribute('aria-expanded', String(willOpen))
  if (willOpen) $('np-name').focus({ preventScroll: true })
}
$('np-toggle').onclick = () => { sfx.click(); toggleNewProject() }
$('np-form').onsubmit = async (ev) => {
  ev.preventDefault()
  const name = $('np-name').value.trim()
  const parent = $('sp-path').value.trim()
  if (!name) { toast('Scrivi il nome del progetto'); return }
  if (!parent) { toast('Scegli prima la cartella dove crearlo'); return }
  if (!TOKEN) { toast('Apri la finestra con /vibeship per creare cartelle'); return }
  try {
    const r = await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ parent, name, git: $('np-git').checked }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) toast('Finestra non più autorizzata: chiudila e rilancia /vibeship')
    else if (!r.ok) { toast(d.error || 'Non sono riuscito a creare la cartella'); sfx.error() }
    else {
      sfx.place()
      toast('📁 Creato ' + name + (d.git ? ' (con git)' : ''))
      $('np-name').value = ''
      toggleNewProject(false)
      if (!$('sp-name').value.trim()) $('sp-name').placeholder = name
      loadDirs(d.path)
    }
  } catch { toast('Server non raggiungibile') }
}
let spawnLoaded = false
function toggleSpawn(open) {
  const el = $('spawn')
  const willOpen = open ?? el.hidden
  el.hidden = !willOpen
  $('agent-btn').setAttribute('aria-expanded', String(willOpen))
  if (willOpen) {
    toggleCatalog(false)
    sfx.click()
    buildLookUI()
    spawnLoc = sceneName
    renderLocUI()
    if (!spawnLoaded || !$('sp-path').value) { spawnLoaded = true; loadDirs('~') }
    $('sp-name').focus({ preventScroll: true })
  }
}
$('agent-btn').onclick = () => toggleSpawn()
$('sp-close').onclick = () => toggleSpawn(false)
$('sp-form').onsubmit = (e) => { e.preventDefault(); loadDirs($('sp-path').value.trim()) }
$('sp-go').onclick = async () => {
  const cwd = $('sp-path').value.trim()
  if (!cwd) { toast('Scegli una cartella'); return }
  if (!TOKEN) { toast('Apri la finestra con /vibeship per avviare nuovi agenti'); return }
  $('sp-go').disabled = true
  try {
    const r = await fetch('/api/spawn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ cwd, name: $('sp-name').value.trim(), species: spawnLook.species, shirt: spawnLook.shirt, loc: spawnLoc ?? sceneName }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) toast('Finestra non più autorizzata: chiudila e rilancia /vibeship')
    else if (!r.ok) toast(d.error || 'Non sono riuscito ad avviarlo')
    else { sfx.place(); toast('🚀 Sto aprendo un nuovo terminale: l\'abitante arriva tra pochi secondi'); $('sp-name').value = ''; toggleSpawn(false) }
  } catch { toast('Server non raggiungibile') }
  $('sp-go').disabled = false
}

// ---------- Scenari ----------
function buildSceneButtons() {
  const wrap = $('scenes')
  wrap.innerHTML = ''
  for (const s of SCENES) {
    const b = document.createElement('button')
    b.className = 'btn'
    b.dataset.scene = s.id
    b.innerHTML = `<span class="ic">${s.icon}</span><span class="lbl">${s.label}</span><span class="badge" hidden></span>`
    b.onclick = () => { if (s.id !== sceneName) switchScene(s.id, true) }
    wrap.appendChild(b)
  }
  updateSceneButtons()
}
// Aggiorna quale luogo è aperto e quanti agenti ci sono in ciascuno (con 🔔 se qualcuno aspetta un permesso)
function updateSceneButtons() {
  const mains = agentData.filter((a) => a.kind === 'main')
  for (const b of document.querySelectorAll('#scenes .btn')) {
    const id = b.dataset.scene
    b.setAttribute('aria-pressed', String(id === sceneName))
    const here = mains.filter((a) => (a.loc || 'bridge') === id)
    const asking = permsData.some((p) => !p.decision && here.some((a) => a.session === p.session))
    const badge = b.querySelector('.badge')
    badge.hidden = here.length === 0
    badge.textContent = (asking ? '🔔' : '') + here.length
    badge.classList.toggle('ring', asking)
    b.title = here.length ? here.map((a) => a.name).join(', ') : 'Nessun agente qui'
  }
}
let switching = false
function switchScene(name, save) {
  if (switching) return
  switching = true
  sfx.click()
  canvas.classList.add('fade')
  setTimeout(() => {
    sceneName = name
    layout.scene = name
    world.setScene(name)
    select(null)
    populate(true)
    snapAgents()
    buildSceneButtons()
    if (!$('catalog').hidden) buildCatalog()
    canvas.classList.remove('fade')
    switching = false
    if (save) saveLayout()
  }, 260)
}

// ---------- Luci della nave e suoni ----------
function updateTodButton() {
  $('tod').querySelector('.ic').textContent = TOD_ICON[world.tod]
  $('tod').setAttribute('data-tip', 'Luci: ' + TOD_LABEL[world.tod])
}
$('tod').onclick = () => { world.cycleTOD(); updateTodButton(); sfx.click(); toast('Luci: ' + TOD_LABEL[world.tod]) }
function updateSnd() {
  $('snd').querySelector('.ic').textContent = isMuted() ? '🔇' : '🔊'
  $('snd').setAttribute('aria-pressed', String(!isMuted()))
}
$('snd').onclick = () => { setMuted(!isMuted()); updateSnd() }

// ---------- Toast ----------
let toastTimer = null
function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400)
}

// ---------- Scheda agente (chat / stop) ----------
const qs = new URLSearchParams(location.search)
let TOKEN = qs.get('t') || ''
try { if (TOKEN) sessionStorage.setItem('ao-token', TOKEN); else TOKEN = sessionStorage.getItem('ao-token') || '' } catch {}
if (qs.has('t')) history.replaceState(null, '', location.pathname)

function openCard(key) { $('card').hidden = false; updateCard(true) }
function closeCard() { $('card').hidden = true }
function updateCard(focus) {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag) { closeCard(); return }
  const a = ag.data
  const st = STATUS[a.status] ?? STATUS.idle
  $('card-name').textContent = a.name
  $('card-sp').textContent = (SPECIES[ag.species]?.label ?? '') + ' · ' + (ag.char.outfit?.name ?? '') + (a.kind === 'main' ? ' · assistente principale' : ' · subagente')
  $('card-ic').textContent = st.icon
  $('card-st').textContent = st.text + (a.detail ? ' · ' + a.detail : '')
  const isMain = a.kind === 'main'
  $('card-form').style.display = isMain ? '' : 'none'
  $('card-stop').style.display = isMain ? '' : 'none'
  $('card-end').style.display = isMain ? '' : 'none'
  $('card-note').textContent = isMain
    ? (TOKEN ? 'Qui vedi la conversazione: i tuoi messaggi arrivano a Claude come se li scrivessi nel terminale.' : 'Apri questa finestra con /vibeship per abilitare chat e stop.')
    : 'I subagenti non ricevono messaggi: parla con Claude, che li coordina.'
  $('card-move').replaceChildren(...SCENES.map((s) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn'
    b.setAttribute('aria-pressed', String(s.id === ag.loc))
    b.textContent = s.icon + ' ' + s.label
    b.onclick = () => { if (s.id !== ag.loc) sendMove(ag, s.id) }
    return b
  }))
  renderChat(!!focus)
  if (focus && isMain) $('card-text').focus({ preventScroll: true })
}
async function sendCommand(kind, text) {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag) return
  if (!TOKEN) { toast('Apri la finestra con /vibeship per inviare comandi'); return }
  try {
    const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: ag.data.session, kind, text }) })
    if (r.status === 401) toast('Finestra non più autorizzata: chiudila e rilancia /vibeship')
    else if (!r.ok) toast('Comando non valido')
    else { toast(kind === 'say' ? 'Messaggio inviato ✉️' : kind === 'close' ? 'Chiudo l\'agente…' : 'Stop inviato ✋'); ag.char.state.hop = 0.3; sfx.click() }
  } catch { toast('Server non raggiungibile') }
}
async function sendMove(ag, loc) {
  if (!TOKEN) { toast('Apri la finestra con /vibeship per spostare gli agenti'); return }
  try {
    const r = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: ag.data.session, loc }) })
    if (r.status === 401) toast('Finestra non più autorizzata: chiudila e rilancia /vibeship')
    else if (!r.ok) toast('Non riesco a spostarlo')
    else { sfx.place(); toast(ag.data.name + ' → ' + LOC_LABEL[loc]) }
  } catch { toast('Server non raggiungibile') }
}
$('card-close').onclick = () => select(null)
$('card-stop').onclick = () => sendCommand('stop')
$('card-end').onclick = () => {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag) return
  if (!confirm('Chiudere ' + ag.data.name + '?\nLa sessione di Claude Code verrà terminata e il lavoro in corso si interrompe.')) return
  sendCommand('close')
}
$('card-form').onsubmit = (ev) => {
  ev.preventDefault()
  const inp = $('card-text')
  const text = inp.value.trim()
  if (!text) return
  sendCommand('say', text)
  inp.value = ''
}

// ---------- Conversazione, risposte e permessi ----------
let chatData = {}
let permsData = []
const seenAssistant = new Map() // sessione -> id dell'ultima risposta già vista
const msgStates = new Map() // id messaggio -> ultimo stato visto
let chatInit = false
const STATE_LABEL = { queued: '⏳ in coda', sent: '✉️ consegnato a Claude', working: '💭 Claude ci sta lavorando', done: '✓ completato', aborted: '✋ interrotto', error: '⚠️ non riuscito' }
const mainAgentOf = (session) => agents.get(session + ':main')
function say(ag, text, ms = 9000, small = false) { ag.say = { text, until: performance.now() + ms, small } }

function onChat(data) {
  chatData = data || {}
  for (const [session, list] of Object.entries(chatData)) {
    const ag = mainAgentOf(session)
    for (const m of list) {
      if (m.role !== 'user') continue
      if (msgStates.get(m.id) === m.state) continue
      msgStates.set(m.id, m.state)
      if (!chatInit || !ag || m.via !== 'window') continue
      // feedback visivo nel mondo 3D mentre il messaggio avanza
      if (m.state === 'sent') { say(ag, 'Ricevuto! 📨', 2600, true); ag.char.state.hop = 0.25; sfx.select() }
      else if (m.state === 'working') say(ag, 'Ci lavoro subito…', 2600, true)
      else if (m.state === 'error') { say(ag, 'Non ci sono riuscito 😿', 4000, true); sfx.error() }
    }
    const lastA = [...list].reverse().find((m) => m.role === 'assistant')
    if (lastA && seenAssistant.get(session) !== lastA.id) {
      seenAssistant.set(session, lastA.id)
      if (chatInit && ag) {
        say(ag, lastA.text.length > 140 ? lastA.text.slice(0, 137) + '…' : lastA.text, 11000)
        ag.char.state.hop = 0.25
        sfx.done()
        if (!(selected?.kind === 'agent' && selected.key === ag.key)) toast('💬 ' + ag.data.name + (ag.loc !== sceneName ? ' (' + (LOC_LABEL[ag.loc] ?? '') + ')' : '') + ' ha risposto')
      }
    }
  }
  chatInit = true
  if (selected?.kind === 'agent') renderChat()
}

let chatSig = ''
function renderChat(force) {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  const box = $('chat')
  if (!ag || ag.data.kind !== 'main') { box.replaceChildren(); box.style.display = 'none'; chatSig = ''; return }
  box.style.display = ''
  const list = chatData[ag.data.session] ?? []
  const sig = ag.key + '|' + list.map((m) => m.id + m.state).join('|')
  if (sig === chatSig && !force) return
  chatSig = sig
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  box.replaceChildren(...list.map((m) => {
    const d = document.createElement('div')
    d.className = 'msg ' + m.role + (m.role === 'user' && m.state === 'error' ? ' err' : '')
    const t = document.createElement('div')
    t.textContent = m.text
    d.appendChild(t)
    const sm = document.createElement('small')
    if (m.role === 'user') {
      sm.textContent = (m.via === 'terminal' ? '🖥️ dal terminale · ' : '') + (STATE_LABEL[m.state] ?? '')
      if (m.state === 'queued' || m.state === 'working') sm.classList.add('dots')
    } else {
      const when = new Date(m.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      sm.textContent = '🐾 ' + ag.data.name + ' · ' + when
    }
    d.appendChild(sm)
    return d
  }))
  if (stick || force) box.scrollTop = box.scrollHeight
}

const permEls = new Map()
function onPerms(list) {
  const known = new Set(permsData.map((p) => p.id))
  permsData = list
  world.setAlert(list.some((p) => !p.decision)) // la nave va in allerta mentre un agente aspetta
  setTimeout(updateSceneButtons, 0)
  for (const p of list) {
    if (known.has(p.id) || p.decision) continue
    sfx.error()
    const ag = mainAgentOf(p.session)
    if (ag) say(ag, 'Posso? 🔔', 5000, true)
  }
  renderPerms()
}
function buildPerm(p) {
  const el = document.createElement('div')
  el.className = 'ask'
  el.setAttribute('role', 'alertdialog')
  const ag = mainAgentOf(p.session)
  el.innerHTML = '<h3><span class="bell">🔔</span><span class="ttl"></span></h3><code></code><div class="why"></div><div class="row"><button class="btn ok" data-d="allow">✓ Consenti</button><button class="btn danger" data-d="deny">✕ Nega</button></div><div class="bar"></div>'
  el.querySelector('.ttl').textContent = (ag?.data.name ?? 'Claude') + (ag ? ' (' + (LOC_LABEL[ag.loc] ?? '') + ')' : '') + ' vuole usare ' + p.tool
  el.querySelector('code').textContent = p.summary || '(nessun dettaglio)'
  const why = p.reason ? (p.reason.length > 100 ? p.reason.slice(0, 99) + '…' : p.reason) + ' · ' : ''
  el.querySelector('.why').textContent = why + 'Senza risposta entro 30 secondi, la domanda passa al terminale.'
  el.querySelectorAll('button').forEach((b) => { b.onclick = () => answerPerm(p.id, b.dataset.d) })
  const bar = el.querySelector('.bar')
  const elapsed = Math.max(0, (Date.now() - p.ts) / 1000)
  bar.style.animation = 'shrink 30s linear forwards'
  bar.style.animationDelay = '-' + elapsed.toFixed(1) + 's'
  return el
}
function renderPerms() {
  const box = $('perm')
  const ids = new Set(permsData.map((p) => p.id))
  for (const [id, el] of permEls) if (!ids.has(id)) { el.remove(); permEls.delete(id) }
  for (const p of permsData) {
    let el = permEls.get(p.id)
    if (!el) { el = buildPerm(p); permEls.set(p.id, el); box.appendChild(el) }
    if (p.decision && !el.classList.contains('done')) {
      el.classList.add('done')
      const row = el.querySelector('.row')
      row.textContent = ''
      const r = document.createElement('span')
      r.className = 'res'
      r.textContent = p.decision === 'allow' ? '✓ Consentito' : '✕ Negato'
      row.appendChild(r)
      el.querySelector('.bar')?.remove()
    }
  }
}
async function answerPerm(id, decision) {
  if (!TOKEN) { toast('Apri la finestra con /vibeship per rispondere'); return }
  try {
    const r = await fetch('/api/permission', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ id, decision }) })
    if (r.status === 401) toast('Finestra non più autorizzata: chiudila e rilancia /vibeship')
    else if (!r.ok) toast('La richiesta non c\'è più (risposta già data o scaduta)')
    else sfx[decision === 'allow' ? 'place' : 'remove']()
  } catch { toast('Server non raggiungibile') }
}

// ---------- Server ----------
let saveTimer = null
let savePending = false
let warnedNoToken = false
const LS_KEY = 'ao-layout3'
function loadLocalLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    for (const k of Object.keys(saved)) if (k.endsWith('@3') && Array.isArray(saved[k])) layout.scenes[k] = saved[k]
  } catch {}
}
function saveLayout() {
  clearTimeout(saveTimer)
  savePending = true
  // copia di riserva nel browser: funziona anche senza token
  try {
    const mine = {}
    for (const k of Object.keys(layout.scenes)) if (k.endsWith('@3')) mine[k] = layout.scenes[k]
    localStorage.setItem(LS_KEY, JSON.stringify(mine))
  } catch {}
  if (!TOKEN && !warnedNoToken) { warnedNoToken = true; toast('Salvato solo in questo browser: apri la finestra con /vibeship per condividerlo') }
  saveTimer = setTimeout(() => {
    fetch('/api/layout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify(layout) })
      .catch(() => {})
      .finally(() => { savePending = false })
  }, 200)
}
const conn = $('conn')
function connect() {
  const es = new EventSource('/stream')
  es.onopen = () => { conn.className = 'pill ok'; conn.textContent = 'collegato' }
  es.onerror = () => { conn.className = 'pill'; conn.textContent = 'server non raggiungibile, riprovo…' }
  es.onmessage = (m) => {
    const data = JSON.parse(m.data)
    onAgents(data.agents ?? [])
    onChat(data.chat)
    onPerms(data.perms ?? [])
    const l = data.layout
    if (!l || !l.scenes || drag?.moved || savePending) return
    const before = JSON.stringify(layout.scenes[keyOf(sceneName)] ?? null)
    const mine = layout.scenes
    layout.scenes = l.scenes
    // gli scenari che il server non ha ancora restano quelli locali
    for (const k of Object.keys(mine)) if (k.endsWith('@3') && !layout.scenes[k]) layout.scenes[k] = mine[k]
    const after = JSON.stringify(layout.scenes[keyOf(sceneName)] ?? null)
    if (l.scene && l.scene !== sceneName && SCENES.some((s) => s.id === l.scene)) { switchScene(l.scene, false); return }
    if (before !== after && after !== 'null') syncFurniture()
  }
}

// ---------- Ciclo principale ----------
let T = 0
function tick(dt) {
  T += dt
  const now = performance.now()
  const k = 1 - Math.exp(-dt * 6)
  // la camera segue l'agente selezionato
  if (selected?.kind === 'agent') {
    const ag = agents.get(selected.key)
    if (ag) { goal.target.set(clamp(ag.char.root.position.x * 0.7, -9, 9), 0.9, clamp(ag.char.root.position.z * 0.7, -6, 6)) }
  }
  cam.az = lerp(cam.az, goal.az, k); cam.el = lerp(cam.el, goal.el, k); cam.zoom = lerp(cam.zoom, goal.zoom, k)
  cam.target.lerp(goal.target, k)
  applyCamera()
  world.update(dt, T, camera)
  updateFurniture(dt, T)
  updateAgents(dt, T, now)
  updateMissions(dt)
  updateSelection(T)
  fx.update(dt)
  renderer.render(scene, camera)
}
let last = performance.now()
function loop(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000)
  last = ts
  tick(dt)
  requestAnimationFrame(loop)
}

// ---------- Avvio ----------
sceneName = 'bridge'
loadLocalLayout()
world.setScene('bridge')
populate(true)
buildSceneButtons()
updateTodButton()
updateSnd()
connect()
requestAnimationFrame(loop)

// Aiuti per test e debug (anche quando il browser mette in pausa requestAnimationFrame)
window.__ao = {
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt) },
  THREE, scene, camera, renderer, world, agents, furn, layout: () => layout, items, select, addFurniture, switchScene, goal, cam,
  get selected() { return selected },
}

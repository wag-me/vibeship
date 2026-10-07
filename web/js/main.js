// Vibeship 3D: orchestrates scene, interaction, agents and the connection to the server.
import { THREE, disposeGroup, holo } from './lib.js'
import { ROOM, BOUNDS, createWorld, TOD_ORDER } from './world.js'
import { CATALOG, CATEGORIES, catalogFor, buildModel, buildPad } from './models.js'
import { createCharacter, SPECIES, SPECIES_IDS, SHIRTS, OUTFITS } from './characters.js'
import { createFx } from './fx.js'
import { sfx, isMuted, setMuted } from './audio.js'
import { renderMarkdown, plainText } from './markdown.js'

const $ = (id) => document.getElementById(id)
// Launch trailer (/?trailer): a scripted, deterministic 30-second film played by this same window (see js/trailer/)
const CINEMA = new URLSearchParams(location.search).has('trailer')
let cinematic = null // set by the trailer director: { update(dt) -> dt }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, k) => a + (b - a) * k
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }
const hashOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

// ---------- States ----------
const STATUS = {
  idle:     { icon: '💤', text: 'idle' },
  read:     { icon: '📖', text: 'reading and thinking' },
  write:    { icon: '⌨️', text: 'writing' },
  run:      { icon: '💻', text: 'running commands' },
  web:      { icon: '🌐', text: 'searching the web' },
  delegate: { icon: '📨', text: 'delegating' },
  error:    { icon: '⚠️', text: 'has a problem' },
}
const MODE_OF = { read: 'think', write: 'typing', run: 'typing', web: 'think', delegate: 'typing', error: 'alert' }

// ---------- Default layouts (coordinates in meters, rot in radians) ----------
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
  { id: 'bridge', label: 'Bridge', icon: '🚀' },
  { id: 'engine', label: 'Engine room', icon: '⚙️' },
  { id: 'habitat', label: 'Greenhouse', icon: '🌿' },
]
// The hatch in the back-left corner: agents enter and leave the deck through it
const DOOR = { x: -11.2, z: -6.3 }
const DOOR_ZONE = { x0: -12, x1: -10, z0: -7, z1: -5 }
// The subagent launch pad: the same in every location, it cannot be removed or added, and no furniture goes on it
const PAD = { x: 0, z: 3.4 }
const PAD_ZONE = { x0: -2.1, x1: 2.1, z0: 1.3, z1: 5.5 }
const LOC_LABEL = Object.fromEntries(SCENES.map((s) => [s.id, s.label]))
const TOD_ICON = { auto: '🛰️', normal: '💡', alert: '🚨', dim: '🌙' }
const TOD_LABEL = { auto: 'Automatic', normal: 'Normal lights', alert: 'Red alert', dim: 'Dimmed lights' }

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

// ---------- Layout and furniture ----------
let layout = { scene: 'bridge', scenes: {} }
let sceneName = 'bridge'
const keyOf = (s) => s + '@3'
function items() {
  const k = keyOf(sceneName)
  if (!layout.scenes[k]) layout.scenes[k] = DEFAULTS[sceneName].map(([type, x, z, rot], i) => ({ id: sceneName + '-d' + i, type, x, z, rot: rot ?? (CATALOG[type]?.work ? Math.PI : 0) }))
  if (layout.scenes[k].some((i) => !CATALOG[i.type])) layout.scenes[k] = layout.scenes[k].filter((i) => CATALOG[i.type]) // types no longer in the catalog (e.g. the old pad)
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
  if (a.x0 < DOOR_ZONE.x1 && a.x1 > DOOR_ZONE.x0 && a.z0 < DOOR_ZONE.z1 && a.z1 > DOOR_ZONE.z0) return true // the area in front of the hatch stays clear
  if (a.x0 < PAD_ZONE.x1 && a.x1 > PAD_ZONE.x0 && a.z0 < PAD_ZONE.z1 && a.z1 > PAD_ZONE.z0) return true // the launch pad stays free
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
// Aligns the furniture in the scene with the layout (used after updates from the server)
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

// ---------- Selection, ring, ghost ----------
let editMode = false // furniture and agents can only be moved, added or removed in edit mode
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

let manualCam = false // WASD took the camera away from the selected agent
function select(sel) {
  selected = sel
  manualCam = false
  const f = sel?.kind === 'furn' ? furn.get(sel.id) : null
  $('rot').disabled = !f || !editMode
  $('del').disabled = !f || !editMode
  $('seatbar').hidden = !(f && f.def.work)
  if (sel?.kind === 'agent') { openCard(sel.key); goal.zoom = 0.72 } else { closeCard(); goal.zoom = DEFAULT_GOAL.zoom; goal.target.set(0, 0.8, 0.4) }
}

// ---------- Agents ----------
const agents = new Map()
const labels = $('labels')
let agentData = []

function makeTag(a) {
  const el = document.createElement('div')
  el.className = 'tag' + (a.kind === 'main' ? ' main' : ' sub')
  el.innerHTML = '<div class="speech" hidden></div><div class="chip" hidden><span class="e"></span><b></b></div><div class="name"></div>'
  el._name = el.querySelector('.name'); el._chip = el.querySelector('.chip'); el._speech = el.querySelector('.speech')
  el._icon = el._chip.querySelector('.e'); el._text = el._chip.querySelector('b')
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
    // chosen from the identifier, avoiding species already in the room when possible
    const used = new Set([...agents.values()].map((x) => x.species))
    for (let i = 0; i < SPECIES_IDS.length; i++) {
      const s = SPECIES_IDS[(h + i) % SPECIES_IDS.length]
      if (!used.has(s) || i === SPECIES_IDS.length - 1) { species = s; break }
    }
  }
  const shirtIdx = a.kind === 'sub' ? 6 : Number.isInteger(look.shirt) ? look.shirt : (h >>> 4) % SHIRTS.length // subagents are cadets
  const char = createCharacter(species, shirtIdx)
  char.root.userData.owner = { kind: 'agent', key: a.key }
  const loc = a.loc || 'bridge'
  // an agent launched from a station sits there once it arrives
  let pin = null
  if (a.kind === 'main' && pendingSeat && performance.now() < pendingSeat.until && loc === pendingSeat.scene) { pin = { station: pendingSeat.id }; pendingSeat = null }
  // enters through the hatch (back-left corner)
  char.root.position.set(DOOR.x, 0, DOOR.z)
  char.root.visible = loc === sceneName
  scene.add(char.root)
  ag = { key: a.key, data: a, char, species, yaw: Math.PI * 1.1, moving: false, lift: 0, dragging: false, pin, hover: 0, tag: makeTag(a), fxT: 0, activeSince: 0, lastStatus: 'idle', idleSince: performance.now(), cheerUntil: 0, wantSit: false, loc, leaving: false, nextLoc: null, baseScale: a.kind === 'sub' ? 0.82 : 1, mat: null, wasDone: false }
  agents.set(a.key, ag)
  if (a.kind === 'sub' && loc === sceneName) launchMission(ag)
  if (loc === sceneName && a.kind !== 'sub') fx.emit('puff', char.root.position.clone().add(new THREE.Vector3(0, 1, 0)), { size: 1.2, life: 0.7, vel: new THREE.Vector3(0, 0.2, 0), grow: 1.5 })
  return ag
}
function removeAgent(key) {
  const ag = agents.get(key)
  if (!ag) return
  endTask(ag)
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
      // mission accomplished: the subagent shows the result (if it arrives later, the bubble is updated)
      const first = !ag.wasDone
      ag.wasDone = true
      if (a.result) ag.gotResult = true
      if (ag.loc === sceneName) {
        const txt = plainText(a.result || '')
        say(ag, txt ? '✔ ' + (txt.length > 130 ? txt.slice(0, 127) + '…' : txt) : '✔ Mission accomplished!', 9000)
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
  // the crew are the sessions; subagents are counted apart, so 4 sessions with 2 missions out read "4 residents · 2 subagents"
  const subs = list.filter((a) => a.kind === 'sub').length, mains = list.length - subs
  $('count').textContent = mains + (mains === 1 ? ' resident' : ' residents') + (subs ? ' · ' + subs + (subs === 1 ? ' subagent' : ' subagents') : '')
  updateSceneButtons()
  if (selected?.kind === 'agent') updateCard()
}

// ---- Locations: each agent is on one deck and is only visible there ----
function changeLoc(ag, newLoc) {
  ag.pin = null
  if (ag.loc === sceneName) {
    // I see it walk to the hatch and leave
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
// After a deck change the agents on that deck are already at their places (they do not have to walk the whole way again)
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

// Assigns agents to stations and waiting spots
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
  // subagents: in a circle around the pad; when the mission is over they return next to the main agent
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

// ---------- Life in the room: subagents roam while their task runs; idle agents without a station do too ----------
// An agent with nothing to do picks one of: sit on a free seat (sofa, armchair), go and look at an object, or stroll.
const claims = new Map() // seat key -> agent key (a seat takes one agent)
const inZone = (x, z, Z) => x > Z.x0 && x < Z.x1 && z > Z.z0 && z < Z.z1
function endTask(ag) {
  if (!ag.task) return
  if (ag.task.seatKey) claims.delete(ag.task.seatKey)
  ag.task = null
  ag.nextTaskAt = performance.now() + 600 + Math.random() * 2400
}
function restSeats() {
  const out = []
  for (const f of furn.values()) {
    if (!f.def.rest || f.removing || f.dragging) continue
    const r = f.item.rot, c = Math.cos(r), sn = Math.sin(r)
    f.def.rest.forEach((p, i) => out.push({ key: f.id + '#' + i, furnId: f.id, x: f.item.x + c * p.x + sn * p.z, z: f.item.z - sn * p.x + c * p.z, yaw: r }))
  }
  return out
}
function pickTask(ag) {
  const roll = Math.random()
  const seats = restSeats().filter((s) => !claims.has(s.key))
  if (roll < 0.45 && seats.length) {
    const s = seats[Math.floor(Math.random() * seats.length)]
    claims.set(s.key, ag.key)
    return { type: 'sit', seatKey: s.key, furnId: s.furnId, target: { x: s.x, z: s.z, yaw: s.yaw, sit: true }, dwell: 6000 + Math.random() * 9000, at: 0 }
  }
  if (roll < 0.8) {
    const list = [...furn.values()].filter((f) => !f.def.flat && !f.removing && !f.dragging)
    if (list.length) {
      const f = list[Math.floor(Math.random() * list.length)]
      const a = aabb(f.item)
      let dx = -f.item.x, dz = -f.item.z
      const l = Math.hypot(dx, dz) || 1
      dx /= l; dz /= l // stands on the side facing the middle of the room
      const d = Math.max(a.hw, a.hd) + 0.95
      const x = clamp(f.item.x + dx * d, BOUNDS.minX + 0.6, BOUNDS.maxX - 0.6), z = clamp(f.item.z + dz * d, BOUNDS.minZ + 0.8, BOUNDS.maxZ - 0.6)
      return { type: 'look', furnId: f.id, target: { x, z, yaw: Math.atan2(f.item.x - x, f.item.z - z), sit: false }, dwell: 3500 + Math.random() * 4500, at: 0 }
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = -9 + Math.random() * 18, z = -4.5 + Math.random() * 10
    if (inZone(x, z, PAD_ZONE) || inZone(x, z, DOOR_ZONE)) continue
    return { type: 'walk', target: { x, z, yaw: Math.random() * Math.PI * 2, sit: false }, dwell: 600 + Math.random() * 1800, at: 0 }
  }
  return null
}
// Where this agent should be going because of its free time, or null when it has real business (work, leaving, being moved)
function lifeTargetFor(ag, tg, now) {
  const sub = ag.data.kind === 'sub'
  const free = !ag.leaving && !ag.dragging && !ag.hold && !ag.pin && !ag.mat && (sub ? !ag.data.done : ag.data.status === 'idle' && !!tg?.lobby)
  if (!free) { endTask(ag); return null }
  if (ag.task?.furnId && !furn.has(ag.task.furnId)) endTask(ag)
  if (!ag.task) {
    if (now < (ag.nextTaskAt ?? 0) || (!sub && now - ag.idleSince < 5000)) return null
    ag.task = pickTask(ag)
    if (!ag.task) return null
  }
  const t = ag.task, p = ag.char.root.position
  if (!t.at && Math.hypot(t.target.x - p.x, t.target.z - p.z) < 0.08 && (!t.target.sit || ag.char.state.sit > 0.9)) t.at = now
  if (t.at && now - t.at > t.dwell) { endTask(ag); return null }
  return t.target
}

function updateAgents(dt, t, now) {
  const targets = computeTargets()
  const v = new THREE.Vector3()
  for (const ag of agents.values()) {
    const here = ag.loc === sceneName
    ag.char.root.visible = here
    if (!here) { endTask(ag); ag.tag.style.display = 'none'; continue }
    if (ag.mat?.phase === 'wait') { ag.char.root.visible = false; ag.tag.style.display = 'none'; continue } // the drone has not arrived yet
    let tg = targets.get(ag.key)
    if (ag.hold && !ag.leaving) tg = { x: ag.hold.x, z: ag.hold.z, yaw: ag.yaw, sit: false }
    if (ag.leaving) tg = { x: DOOR.x, z: DOOR.z, yaw: 2.4, sit: false }
    const lifeTarget = lifeTargetFor(ag, tg, now)
    if (lifeTarget) tg = lifeTarget
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
    // the question moved to the terminal: it stays marked until it is answered there
    const parkedHere = !asking && ag.data.kind === 'main' && parkedData.some((p) => p.session === ag.data.session)
    if (!ag.moving) {
      if (asking || parkedHere) mode = 'alert'
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

    // status effects
    ag.fxT -= dt
    if (ag.fxT <= 0 && !ag.moving) {
      v.copy(r.position); v.y += 1.9
      if (mode === 'think') { fx.emit('puff', v.clone().add(new THREE.Vector3(0.25, 0, 0)), { size: 0.3, life: 1.4, vel: new THREE.Vector3(0.1, 0.45, 0), grow: 1.1, wob: 0.15 }); ag.fxT = 0.65 }
      else if (mode === 'sleep') { fx.emit('zzz', v.clone().add(new THREE.Vector3(0.3, -0.2, 0)), { size: 0.42, life: 1.9, vel: new THREE.Vector3(0.12, 0.4, 0), wob: 0.2, grow: 0.5 }); ag.fxT = 1.1 }
      else if (mode === 'alert') { fx.emit('alert', v.clone().add(new THREE.Vector3(0, 0.15, 0)), { size: 0.42, life: 1.0, vel: new THREE.Vector3(0, 0.3, 0) }); ag.fxT = 1.0 }
      else if (selected?.kind === 'agent' && selected.key === ag.key) { fx.emit('star', v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.3, (Math.random() - 0.5) * 0.6)), { size: 0.18, life: 1.0, vel: new THREE.Vector3(0, 0.5, 0), spin: 1.2 }); ag.fxT = 0.35 }
    }

    // label
    const tagEl = ag.tag
    v.set(r.position.x, 2.05 * 0.9 + (ag.wantSit ? -0.2 : 0) + ag.lift, r.position.z).project(camera)
    const visible = v.z < 1
    const x = (v.x * 0.5 + 0.5) * viewW, y = (-v.y * 0.5 + 0.5) * viewH
    const tr = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`
    if (tagEl._tr !== tr) { tagEl._tr = tr; tagEl.style.transform = tr } // a style write only when it moved
    tagEl.style.display = visible ? '' : 'none'
    tagEl.classList.toggle('sel', selected?.kind === 'agent' && selected.key === ag.key)
    tagEl.classList.toggle('wait', asking || parkedHere)
    const nm = tagEl._name
    if (nm.textContent !== ag.data.name) nm.textContent = ag.data.name
    const chip = tagEl._chip
    const showChip = asking || parkedHere || mode !== 'idle' && mode !== 'look' || st !== 'idle'
    // bubble with the reply or a short feedback
    const sp = tagEl._speech
    if (ag.say && now < ag.say.until) {
      if (sp.textContent !== ag.say.text) sp.textContent = ag.say.text
      sp.classList.toggle('small', !!ag.say.small)
      sp.hidden = false
    } else if (ag.data.kind === 'sub' && ag.data.task && !ag.data.done) {
      // the subagent's task stays on its tag while it works
      const txt = '📋 ' + (ag.data.task.length > 56 ? ag.data.task.slice(0, 55) + '…' : ag.data.task)
      if (sp.textContent !== txt) sp.textContent = txt
      sp.classList.add('small')
      sp.hidden = false
    } else sp.hidden = true
    if (showChip) {
      const s = STATUS[mode === 'sleep' ? 'idle' : mode === 'cheer' ? 'idle' : st] ?? STATUS.idle
      const icon = asking ? '🔔' : parkedHere ? '🖥️' : mode === 'cheer' ? '🎉' : mode === 'sleep' ? '💤' : s.icon
      const text = asking ? 'asks for permission' : parkedHere ? 'waiting in the terminal' : mode === 'cheer' ? 'done!' : mode === 'sleep' ? 'sleeping' : ag.data.detail || s.text
      chip.hidden = false
      if (tagEl._icon.textContent !== icon) tagEl._icon.textContent = icon
      if (tagEl._text.textContent !== text) tagEl._text.textContent = text
    } else chip.hidden = true
  }
}

// ---------- Subagent missions: fixed pad, launch drone, beam, materialization ----------
const drones = []
const links = new Map() // subagent key -> beam to the main agent
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.2, 28, 1, true), holo(0x4de0ff, 0.9, 0.5))
beam.position.set(PAD.x, 1.6, PAD.z); beam.visible = false
scene.add(beam)
let beamT = 1
const linkMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.55, depthWrite: false })
const linkGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6)
const easeOutBack = (t) => { const x = t - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x }
const DRONE = {
  body: new THREE.SphereGeometry(0.17, 14, 10), eye: new THREE.SphereGeometry(0.07, 10, 8), ring: new THREE.TorusGeometry(0.24, 0.025, 6, 20),
  bodyMat: new THREE.MeshStandardMaterial({ color: '#eef3ff', roughness: 0.4 }), eyeMat: new THREE.MeshBasicMaterial({ color: '#4de0ff' }), ringMat: new THREE.MeshBasicMaterial({ color: '#7fe8ff' }),
}
function makeDrone() { // shared parts: a drone is made for every launch
  const g = new THREE.Group()
  g.add(new THREE.Mesh(DRONE.body, DRONE.bodyMat))
  const eye = new THREE.Mesh(DRONE.eye, DRONE.eyeMat); eye.position.z = 0.14; g.add(eye)
  const ringM = new THREE.Mesh(DRONE.ring, DRONE.ringMat); ringM.rotation.x = Math.PI / 2; g.add(ringM)
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
// A freshly started subagent: the main agent launches a drone that lands on the pad and makes it materialize
function launchMission(ag) {
  const parent = mainAgentOf(ag.data.session)
  ag.mat = { phase: 'wait', t: 0 }
  ag.char.root.visible = false
  if (parent && parent.loc === sceneName && parent.char.root.visible) {
    const from = parent.char.root.position.clone(); from.y = 1.5
    const mesh = makeDrone(); mesh.position.copy(from); scene.add(mesh)
    drones.push({ mesh, from, to: new THREE.Vector3(PAD.x, 1.0, PAD.z), t: 0, ag })
    parent.cheerUntil = performance.now() + 1100
    say(parent, 'Mission! 🚀', 1800, true)
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
  // light beam between each subagent and its main agent
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

// ---------- Furniture update ----------
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
    // appears with a bit of bounce, then squash & stretch on click/drop
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
    // swaying (leaves)
    for (const s of f.model.sway) s.obj.rotation[s.axis ?? 'z'] = (s.base ?? 0) + Math.sin(t * s.speed + s.phase) * s.amp
    for (const s of f.model.spin) s.obj.rotation[s.axis ?? 'y'] += s.speed * dt
  }
  // rack LED blinking
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

// ---------- Interaction ----------
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
  return `${ag.data.name}${ag.data.kind === 'sub' ? ' (subagent)' : ''} · ${SPECIES[ag.species]?.label ?? ''} · ${s.text}`
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId) } catch {}
  setTip('')
  if (pendingAsk) resolveAsk(false) // starting something else drops a move that was not confirmed
  if (e.button === 2 || e.button === 1) { drag = { kind: 'orbit', x: e.clientX, y: e.clientY, moved: true }; return }
  const o = pickOwner(e)
  if (o && !editMode) {
    // outside edit mode a click selects, a drag moves the view: nothing gets moved by accident
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, click: o }
  } else if (o) {
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
      const cand = d.cand
      const back = () => { f.tx = f.item.x; f.tz = f.item.z; f.bounceT = 0 }
      if (!cand.valid) { toast('No room here'); sfx.error(); back() }
      else if (f.item.x !== cand.x || f.item.z !== cand.z) {
        // the furniture waits at the new spot until the move is confirmed
        f.tx = cand.x; f.tz = cand.z
        askConfirm('Move ' + f.def.label + ' here?', () => { f.item.x = cand.x; f.item.z = cand.z; f.bounceT = 0; saveLayout(); sfx.place() }, back)
      } else back()
    } else if (!d.moved) {
      select({ kind: 'furn', id: f.id }); f.bounceT = 0; sfx.click()
    }
  } else if (d.kind === 'agent') {
    const ag = d.ag
    ag.dragging = false
    document.querySelectorAll('#scenes .btn.drop').forEach((b) => b.classList.remove('drop'))
    if (d.moved) {
      const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest('#scenes .btn')
      if (tab && tab.dataset.scene && tab.dataset.scene !== sceneName) {
        const to = tab.dataset.scene
        askConfirm('Move ' + ag.data.name + ' to ' + (LOC_LABEL[to] ?? to) + '?', () => { sendMove(ag, to); ag.char.state.hop = 0.25 })
        return
      }
      const pos = ag.char.root.position.clone()
      let best = null, bd = 2.2
      for (const f of furn.values()) if (f.def.work) { const s = seatWorld(f); const dd = Math.hypot(s.x - pos.x, s.z - pos.z); if (dd < bd) { bd = dd; best = f } }
      ag.hold = { x: pos.x, z: pos.z } // stays where it was dropped until the move is confirmed
      askConfirm(best ? 'Seat ' + ag.data.name + ' at ' + best.def.label + '?' : 'Leave ' + ag.data.name + ' here?', () => {
        ag.hold = null
        if (best) { for (const o of agents.values()) if (o !== ag && o.pin?.station === best.id) o.pin = null; ag.pin = { station: best.id }; toast(`${ag.data.name} → ${best.def.label}`) }
        else { ag.pin = { x: pos.x, z: pos.z }; toast(`${ag.data.name} stays here`) }
        sfx.place()
        ag.char.state.hop = 0.25
        if (selected?.kind === 'agent') updateCard()
      }, () => { ag.hold = null })
    } else { select({ kind: 'agent', key: ag.key }); sfx.select(); const p = ag.char.root.position.clone(); p.y = 1.9; fx.burst('star', p, 6, 1.2, 0.26) }
  } else if (d.kind === 'pan' && !d.moved) {
    const o = d.click
    if (o?.kind === 'furn' && furn.get(o.id)) { select({ kind: 'furn', id: o.id }); furn.get(o.id).bounceT = 0; sfx.click() }
    else if (o?.kind === 'agent' && agents.get(o.key)) {
      const ag = agents.get(o.key)
      select({ kind: 'agent', key: o.key }); sfx.select()
      const p = ag.char.root.position.clone(); p.y = 1.9; fx.burst('star', p, 6, 1.2, 0.26)
    } else if (selected) select(null)
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
  if (pendingAsk && e.key === 'Escape') { resolveAsk(false); return }
  if (pendingAsk && e.key === 'Enter' && !typing) { resolveAsk(true); e.preventDefault(); return }
  if (e.key === 'Escape') { if (!$('catalog').hidden) toggleCatalog(false); else if (!$('spawn').hidden) toggleSpawn(false); else if (selected) select(null) }
  if (typing) return
  if (!e.ctrlKey && !e.metaKey && !e.altKey && CAM_KEYS[e.code]) { camKeys.add(CAM_KEYS[e.code]); e.preventDefault() }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected?.kind === 'furn') { removeSelected(); e.preventDefault() }
  if ((e.key === 'r' || e.key === 'R') && selected?.kind === 'furn') rotateSelected()
})

// ---- Move the view with WASD / arrow keys (relative to the camera direction) ----
const CAM_KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' }
const camKeys = new Set()
addEventListener('keyup', (e) => { if (CAM_KEYS[e.code]) camKeys.delete(CAM_KEYS[e.code]) })
addEventListener('blur', () => camKeys.clear())
function moveCamera(dt) {
  if (!camKeys.size) return
  const fwd = (camKeys.has('f') ? 1 : 0) - (camKeys.has('b') ? 1 : 0)
  const side = (camKeys.has('r') ? 1 : 0) - (camKeys.has('l') ? 1 : 0)
  if (!fwd && !side) return
  const len = Math.hypot(fwd, side)
  const v = 11 * goal.zoom * dt / len
  goal.target.x = clamp(goal.target.x + (Math.cos(cam.az) * side - Math.sin(cam.az) * fwd) * v, -9, 9)
  goal.target.z = clamp(goal.target.z + (-Math.sin(cam.az) * side - Math.cos(cam.az) * fwd) * v, -6, 6)
  manualCam = true
}

function needEdit() {
  if (editMode) return false
  toast('Turn on Edit mode (✏️) first')
  return true
}
function rotateSelected() {
  if (needEdit()) return
  if (selected?.kind !== 'furn') return
  const f = furn.get(selected.id)
  if (!f) return
  const tmp = { ...f.item, rot: (f.item.rot + Math.PI / 2) % (Math.PI * 2) }
  clampItem(tmp)
  if (overlaps(tmp)) { toast('No room to rotate it'); sfx.error(); return }
  f.item.rot = tmp.rot; f.item.x = tmp.x; f.item.z = tmp.z
  f.trot = f.item.rot; f.tx = f.item.x; f.tz = f.item.z
  f.bounceT = 0
  sfx.click(); saveLayout()
}
function removeSelected() {
  if (needEdit()) return
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
  if (needEdit()) return
  if (!confirm('Reset the stations and furniture of this scene?')) return
  delete layout.scenes[keyOf(sceneName)]
  select(null)
  populate(true)
  sfx.place(); saveLayout()
  toast('Scene reset')
}

// ---------- Adding furniture ----------
function addFurniture(type) {
  if (needEdit()) return
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
  if (!spot) { toast('No more room in this location'); sfx.error(); return }
  list.push(spot)
  const f = spawnFurniture(spot, 0)
  if (f) { f.group.position.set(spot.x, 2.5, spot.z) } // drops from above
  select({ kind: 'furn', id: spot.id })
  sfx.place(); saveLayout()
  toast(`${def.label} added`)
}

// ---------- Catalog with 3D previews ----------
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
  if (willOpen) { if (!$('spawn').hidden) toggleSpawn(false); closeAgentCard(); buildCatalog(); renderPreviews(); sfx.click() }
}
$('add-btn').onclick = () => toggleCatalog()
$('cat-close').onclick = () => toggleCatalog(false)

// ---------- Character choice for a new agent ----------
const spawnLook = { species: null, shirt: null } // null = random
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
  const opts = [{ id: null, label: 'Random' }, ...SPECIES_IDS.map((id) => ({ id, label: SPECIES[id].label }))]
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
    d.setAttribute('aria-label', 'Uniform: ' + OUTFITS[i].name)
    d.setAttribute('aria-pressed', String(spawnLook.shirt === i))
    d.onclick = () => {
      spawnLook.shirt = spawnLook.shirt === i ? null : i // a second click goes back to "random"
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
  renderLookUI() // right away, with placeholders
  setTimeout(() => { lookThumbs = makeThumbs(spawnLook.shirt ?? 0); renderLookUI() }, 30)
}

// ---------- New agent (opens a terminal with the mod) ----------
async function loadDirs(p) {
  const box = $('sp-dirs')
  if (!TOKEN) { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'none', textContent: 'Open the window with /vibeship to launch new agents.' })); return }
  try {
    const r = await fetch('/api/dirs?path=' + encodeURIComponent(p), { headers: { 'x-token': TOKEN } })
    if (r.status === 401) { toast('Window no longer authorized: close it and run /vibeship again'); return }
    const d = await r.json()
    if (!r.ok) { toast(d.error || 'Folder not readable'); return }
    renderDirs(d)
  } catch { toast('Server unreachable') }
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
  if (d.parent !== null) items.push(dirButton('⬆️  Parent folder', d.parent))
  for (const x of d.dirs) items.push(dirButton('📁  ' + x.name, x.path))
  if (!d.dirs.length) items.push(Object.assign(document.createElement('div'), { className: 'none', textContent: 'No subfolders.' }))
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
// New project: creates a new folder inside the one being viewed and selects it
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
  if (!name) { toast('Enter the project name'); return }
  if (!parent) { toast('First choose the folder to create it in'); return }
  if (!TOKEN) { toast('Open the window with /vibeship to create folders'); return }
  try {
    const r = await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ parent, name, git: $('np-git').checked }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) toast('Window no longer authorized: close it and run /vibeship again')
    else if (!r.ok) { toast(d.error || 'Could not create the folder'); sfx.error() }
    else {
      sfx.place()
      toast('📁 Created ' + name + (d.git ? ' (with git)' : ''))
      $('np-name').value = ''
      toggleNewProject(false)
      if (!$('sp-name').value.trim()) $('sp-name').placeholder = name
      loadDirs(d.path)
    }
  } catch { toast('Server unreachable') }
}
// ---- Statistics ----
let statsDays = 14
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
const statsEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
function statsRows(items, label, value, max) {
  const box = statsEl('div', 'rows')
  if (!items.length) return statsEl('div', 'none', 'No data in this period.')
  for (const it of items) {
    const r = statsEl('div', 'r')
    r.append(statsEl('span', 'n', label(it)), statsEl('span', 'v', value(it)))
    const m = statsEl('div', 'm'), i = statsEl('i')
    i.style.width = Math.max(2, Math.round((100 * it._v) / max)) + '%'
    m.append(i)
    r.append(m)
    box.append(r)
  }
  return box
}
function renderStats(s) {
  const body = $('st-body')
  const kpi = (v, l, sub) => { const k = statsEl('div', 'kpi'); k.append(statsEl('b', '', v), statsEl('span', '', l)); if (sub) k.append(statsEl('small', '', sub)); return k }
  const kp = statsEl('div', 'kpis')
  kp.append(
    kpi(fmtN(s.range.input + s.range.output), 'tokens (' + s.days + ' d)', 'in ' + fmtN(s.range.input) + ' · out ' + fmtN(s.range.output)),
    kpi(fmtN(s.today.input + s.today.output), 'tokens today', 'in ' + fmtN(s.today.input) + ' · out ' + fmtN(s.today.output)),
    kpi(String(s.range.sessions), 'sessions (' + s.days + ' d)', s.total.sessions + ' in total'),
    kpi(fmtN(s.range.messages), 'replies', fmtN(s.range.tools) + ' tools used'),
    kpi(fmtN(s.range.cacheRead), 'cache read', 'written ' + fmtN(s.range.cacheWrite)),
    kpi(s.live.agents + (s.live.subagents ? ' + ' + s.live.subagents : ''), 'active agents', s.live.subagents ? 'plus subagents' : ''),
  )
  const peak = Math.max(1, ...s.series.map((d) => d.input + d.output))
  const bars = statsEl('div', 'bars')
  for (const d of s.series) {
    const col = statsEl('div', 'col')
    col.title = d.day + ': in ' + fmtN(d.input) + ' · out ' + fmtN(d.output) + ' · ' + d.sessions + ' sessions'
    const inp = statsEl('div', 'inp'), out = statsEl('div', 'out')
    inp.style.height = (100 * d.input) / peak + '%'
    out.style.height = (100 * d.output) / peak + '%'
    col.append(out, inp)
    bars.append(col)
  }
  const legend = statsEl('div', 'legend')
  const lg = (c, t) => { const s2 = statsEl('span'); const i = statsEl('i'); i.style.background = c; s2.append(i, t); return s2 }
  legend.append(lg('var(--leaf)', 'tokens in'), lg('var(--berry)', 'tokens out'))
  const withV = (items, f) => { items.forEach((x) => (x._v = f(x))); return items }
  const tok = (x) => x.input + x.output
  const proj = withV(s.projects, tok), mod = withV(s.models, tok), tl = withV(s.tools, (x) => x.count)
  body.replaceChildren(
    kp,
    statsEl('h3', '', 'Tokens per day'), bars, legend,
    statsEl('h3', '', 'Projects'), statsRows(proj, (x) => x.name, (x) => fmtN(tok(x)) + ' · ' + x.sessions + ' sess.', Math.max(1, ...proj.map((x) => x._v))),
    statsEl('h3', '', 'Models'), statsRows(mod, (x) => x.name, (x) => fmtN(tok(x)) + ' · ' + x.messages + ' replies', Math.max(1, ...mod.map((x) => x._v))),
    statsEl('h3', '', 'Most used tools'), statsRows(tl, (x) => x.name, (x) => String(x.count), Math.max(1, ...tl.map((x) => x._v))),
  )
}
async function loadStats() {
  const body = $('st-body')
  if (!TOKEN) { body.replaceChildren(statsEl('div', 'none', 'Open the window with /vibeship to see the statistics.')); return }
  try {
    const r = await fetch('/api/stats?days=' + statsDays, { headers: { 'x-token': TOKEN } })
    if (!r.ok) throw new Error()
    renderStats(await r.json())
  } catch { body.replaceChildren(statsEl('div', 'none', 'Statistics not available.')) }
}
function toggleStats(open) {
  const el = $('stats')
  const willOpen = open ?? el.hidden
  el.hidden = !willOpen
  $('stats-btn').setAttribute('aria-expanded', String(willOpen))
  if (willOpen) { toggleCatalog(false); toggleSpawn(false); toggleFiles(false); closeAgentCard(); sfx.click(); loadStats() }
}
$('stats-btn').onclick = () => toggleStats()
// any other button in the top bar closes the statistics panel
document.querySelector('header').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (b && b.id !== 'stats-btn') toggleStats(false)
  if (b) toggleFiles(false)
})
$('st-close').onclick = () => toggleStats(false)
$('st-range').onclick = (e) => {
  const b = e.target.closest('button[data-days]')
  if (!b) return
  statsDays = Number(b.dataset.days)
  for (const x of $('st-range').children) x.setAttribute('aria-pressed', String(x === b))
  loadStats()
}
setInterval(() => { if (!$('stats').hidden) loadStats() }, 15000)

let spawnLoaded = false
function toggleSpawn(open) {
  const el = $('spawn')
  const willOpen = open ?? el.hidden
  el.hidden = !willOpen
  $('agent-btn').setAttribute('aria-expanded', String(willOpen))
  if (willOpen) {
    toggleCatalog(false)
    toggleStats(false)
    closeAgentCard()
    sfx.click()
    buildLookUI()
    spawnLoc = sceneName
    renderLocUI()
    if (!spawnLoaded || !$('sp-path').value) { spawnLoaded = true; loadDirs('~') }
    $('sp-name').focus({ preventScroll: true })
  }
}
// "Add an agent at this station": the next new agent that arrives sits at the selected station
let pendingSeat = null // { id, scene, until }
$('agent-btn').onclick = () => { pendingSeat = null; toggleSpawn() }

// ---- Resume a recent session (tab of the Agent panel) ----
let rsData = []
function setSpawnTab(tab) {
  $('sp-new').hidden = tab !== 'new'
  $('sp-resume').hidden = tab !== 'resume'
  for (const b of $('sp-tabs').children) b.setAttribute('aria-pressed', String(b.dataset.tab === tab))
  if (tab === 'resume') { loadSessions(); $('rs-q').focus({ preventScroll: true }) }
}
$('sp-tabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) { sfx.click(); setSpawnTab(b.dataset.tab) } }
const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'
}
async function loadSessions() {
  const box = $('rs-list')
  const note = (t) => box.replaceChildren(Object.assign(document.createElement('div'), { className: 'none', textContent: t }))
  if (!TOKEN) { note('Open the window with /vibeship to resume sessions.'); return }
  if (!rsData.length) note('Loading…')
  try {
    const r = await fetch('/api/sessions', { headers: { 'x-token': TOKEN } })
    if (r.status === 401) { note('Window no longer authorized: close it and run /vibeship again'); return }
    const d = await r.json()
    if (!r.ok) { note(d.error || 'Sessions not available'); return }
    rsData = d.sessions ?? []
    renderSessions()
  } catch { note('Server unreachable') }
}
function renderSessions() {
  const box = $('rs-list')
  const q = $('rs-q').value.trim().toLowerCase()
  const list = rsData.filter((x) => !q || (x.title + ' ' + x.project).toLowerCase().includes(q))
  if (!list.length) { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'none', textContent: rsData.length ? 'No session matches.' : 'No sessions yet.' })); return }
  box.replaceChildren(...list.map((x) => {
    const row = document.createElement('div')
    row.className = 'rs-row'
    row.setAttribute('role', 'listitem')
    const t = document.createElement('div'); t.className = 'rs-title'; t.textContent = x.title; t.title = x.title
    const m = document.createElement('div'); m.className = 'rs-meta'; m.title = x.cwd
    m.textContent = '📁 ' + x.project + ' · ' + ago(x.lastAt) + ' · ' + fmtSize(x.size)
    const b = document.createElement('button')
    b.type = 'button'
    if (x.live) {
      const tag = document.createElement('span'); tag.className = 'live'; tag.textContent = ' · aboard now'; m.append(tag)
      b.className = 'btn'; b.textContent = '👁 Show'
      b.onclick = () => showSessionAgent(x.id)
    } else {
      b.className = 'btn primary'; b.textContent = '↩ Resume'
      b.onclick = () => resumeSession(x.id, b)
    }
    row.append(t, m, b)
    return row
  }))
}
$('rs-q').oninput = renderSessions
async function resumeSession(id, btn) {
  if (!TOKEN) { toast('Open the window with /vibeship to resume sessions'); return }
  btn.disabled = true
  try {
    const r = await fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ id }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) toast('Window no longer authorized: close it and run /vibeship again')
    else if (!r.ok) toast(d.error || 'Could not resume it')
    else { sfx.place(); toast('↩ Resuming in a new terminal: the resident comes back in a few seconds'); toggleSpawn(false) }
  } catch { toast('Server unreachable') }
  btn.disabled = false
}
function showSessionAgent(session) {
  const ag = agents.get(session + ':main')
  if (!ag) { toast('It is open, but not aboard yet'); return }
  toggleSpawn(false)
  if (ag.loc !== sceneName) { switchScene(ag.loc, true); setTimeout(() => select({ kind: 'agent', key: ag.key }), 320) }
  else select({ kind: 'agent', key: ag.key })
}
$('sp-close').onclick = () => { pendingSeat = null; toggleSpawn(false) }
$('seat-add').onclick = () => {
  const f = selected?.kind === 'furn' ? furn.get(selected.id) : null
  if (!f || !f.def.work) return
  pendingSeat = { id: f.id, scene: sceneName, until: 0 }
  toggleSpawn(true)
  toast('Choose character and folder: the new agent will sit at this station')
}
$('sp-form').onsubmit = (e) => { e.preventDefault(); loadDirs($('sp-path').value.trim()) }
$('sp-go').onclick = async () => {
  const cwd = $('sp-path').value.trim()
  if (!cwd) { toast('Choose a folder'); return }
  if (!TOKEN) { toast('Open the window with /vibeship to launch new agents'); return }
  $('sp-go').disabled = true
  try {
    const r = await fetch('/api/spawn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ cwd, name: $('sp-name').value.trim(), species: spawnLook.species, shirt: spawnLook.shirt, loc: spawnLoc ?? sceneName }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) toast('Window no longer authorized: close it and run /vibeship again')
    else if (!r.ok) toast(d.error || 'Could not launch it')
    else { if (pendingSeat) pendingSeat.until = performance.now() + 120000; sfx.place(); toast('🚀 Opening a new terminal: the resident arrives in a few seconds'); $('sp-name').value = ''; toggleSpawn(false) }
  } catch { toast('Server unreachable') }
  $('sp-go').disabled = false
}

// ---------- Scenes ----------
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
// Updates which location is open and how many agents are in each (with 🔔 if someone is waiting for a permission,
// in the window or in the terminal)
function updateSceneButtons() {
  const mains = agentData.filter((a) => a.kind === 'main')
  const waiting = [...permsData.filter((p) => !p.decision), ...parkedData]
  for (const b of document.querySelectorAll('#scenes .btn')) {
    const id = b.dataset.scene
    b.setAttribute('aria-pressed', String(id === sceneName))
    const here = mains.filter((a) => (a.loc || 'bridge') === id)
    const asking = waiting.some((p) => here.some((a) => a.session === p.session))
    const badge = b.querySelector('.badge')
    badge.hidden = here.length === 0
    badge.textContent = (asking ? '🔔' : '') + here.length
    badge.classList.toggle('ring', asking)
    b.title = here.length ? here.map((a) => a.name).join(', ') : 'No agents here'
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

// ---------- Ship lights and sounds ----------
function updateTodButton() {
  $('tod').querySelector('.ic').textContent = TOD_ICON[world.tod]
  $('tod').setAttribute('data-tip', 'Lights: ' + TOD_LABEL[world.tod])
}
$('tod').onclick = () => { world.cycleTOD(); updateTodButton(); sfx.click(); toast('Lights: ' + TOD_LABEL[world.tod]) }
function updateSnd() {
  $('snd').querySelector('.ic').textContent = isMuted() ? '🔇' : '🔊'
  $('snd').setAttribute('aria-pressed', String(!isMuted()))
}
$('snd').onclick = () => { setMuted(!isMuted()); updateSnd() }

// ---------- Confirm bar: moves are applied only after the user confirms ----------
let pendingAsk = null // { yes, no }
function askConfirm(text, yes, no) {
  if (editMode) { yes?.(); return } // in edit mode moves apply right away
  if (pendingAsk) resolveAsk(false)
  pendingAsk = { yes, no }
  $('ask-text').textContent = text
  $('askbar').hidden = false
  $('ask-yes').focus({ preventScroll: true })
}
function resolveAsk(ok) {
  const p = pendingAsk
  if (!p) return
  pendingAsk = null
  $('askbar').hidden = true
  if (ok) p.yes?.(); else p.no?.()
}
$('ask-yes').onclick = () => resolveAsk(true)
$('ask-no').onclick = () => resolveAsk(false)

// ---------- Edit mode ----------
function setEditMode(on, quiet) {
  editMode = on
  $('edit-btn').setAttribute('aria-pressed', String(on))
  $('add-btn').disabled = !on
  $('reset').disabled = !on
  const f = selected?.kind === 'furn'
  $('rot').disabled = !f || !on
  $('del').disabled = !f || !on
  if (!on) { toggleCatalog(false); resolveAsk(false); ghost.visible = false }
  if (!quiet) { sfx.click(); toast(on ? 'Edit mode on: drag furniture and agents, add or remove furniture' : 'Edit mode off: nothing can be moved by accident') }
}
$('edit-btn').onclick = () => setEditMode(!editMode)

// ---------- New version notice (footer) ----------
const UPDATE_CMDS = 'claude plugin marketplace update vibeship\nclaude plugin update vibeship@vibeship'
let updateData = null
function renderUpdate(u) {
  updateData = u ?? null
  let hidden = ''
  try { hidden = localStorage.getItem('vs-update-hidden') || '' } catch {}
  $('upd').hidden = !u || hidden === u.latest
  if (u) $('upd-text').textContent = '⬆️ Vibeship ' + u.latest + ' is out'
}
$('upd-how').onclick = async () => {
  try { await navigator.clipboard.writeText(UPDATE_CMDS); toast('Copied: run it in a terminal, then restart Claude Code') }
  catch { toast('In a terminal: claude plugin update vibeship@vibeship, then restart Claude Code') }
}
$('upd-x').onclick = () => { try { if (updateData) localStorage.setItem('vs-update-hidden', updateData.latest) } catch {} $('upd').hidden = true }

// ---------- Toast ----------
let toastTimer = null
function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400)
}

// ---------- Agent card (chat / stop) ----------
const qs = new URLSearchParams(location.search)
let TOKEN = qs.get('t') || ''
try { if (TOKEN) sessionStorage.setItem('ao-token', TOKEN); else TOKEN = sessionStorage.getItem('ao-token') || '' } catch {}
if (qs.has('t')) history.replaceState(null, '', location.pathname)

function openCard(key) {
  $('card').hidden = false
  updateCard(true)
  const a = agents.get(key)
  if (a?.data.kind === 'main') loadCmds(a.data.session)
}
function closeCard() { $('card').hidden = true }
// another panel is opening: deselect the agent so its card doesn't stay open underneath
function closeAgentCard() { if (selected?.kind === 'agent') select(null) }
function updateCard(focus) {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag) { closeCard(); return }
  const a = ag.data
  const st = STATUS[a.status] ?? STATUS.idle
  if (!renaming) $('card-name').textContent = a.name
  $('card-rename').style.display = a.kind === 'main' ? '' : 'none'
  $('card-sp').textContent = (SPECIES[ag.species]?.label ?? '') + ' · ' + (ag.char.outfit?.name ?? '') + (a.kind === 'main' ? ' · main assistant' : ' · subagent')
  $('card-ic').textContent = st.icon
  $('card-st').textContent = st.text + (a.detail ? ' · ' + a.detail : '')
  const isMain = a.kind === 'main'
  $('card-form').style.display = isMain ? '' : 'none'
  $('cbar').style.display = isMain ? '' : 'none'
  $('atts').style.display = isMain ? '' : 'none'
  if (!isMain) $('cmenu').hidden = true
  updateModelChip()
  $('card-stop').style.display = isMain ? '' : 'none'
  $('card-end').style.display = isMain ? '' : 'none'
  $('card-note').textContent = isMain
    ? (TOKEN ? 'Here you see the conversation: your messages reach Claude as if you typed them in the terminal. Commands starting with / (like /model) work too.' : 'Open this window with /vibeship to enable chat and stop.')
    : 'Subagents do not receive messages: talk to Claude, who coordinates them.'
  $('card-move').replaceChildren(...SCENES.map((s) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn'
    b.setAttribute('aria-pressed', String(s.id === ag.loc))
    b.textContent = s.icon + ' ' + s.label
    b.onclick = () => { if (s.id !== ag.loc) sendMove(ag, s.id) }
    return b
  }))
  $('card-files').style.display = isMain ? '' : 'none'
  actsSig = ''
  renderActs()
  portsSig = ''
  renderPorts()
  renderChat(!!focus)
  if (focus && isMain) $('card-text').focus({ preventScroll: true })
}
// ---------- Activity feed + Files panel ----------
let actsData = {} // session -> finished actions (from the server)
let roots = {} // session -> name of the working folder
const ACT_ICON = { read: '📄', write: '✏️', run: '▶️', web: '🌐', delegate: '🛰️' }
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
const fmtAgo = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h' }

let actsSig = ''
function renderActs() {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  const box = $('acts-box')
  if (!ag || ag.data.kind !== 'main') { box.hidden = true; actsSig = ''; return }
  box.hidden = false
  const list = (actsData[ag.data.session] ?? []).slice(-25).reverse()
  const sig = ag.key + '|' + list.map((a) => a.id).join(',')
  if (sig === actsSig) return
  actsSig = sig
  if (!list.length) { $('acts').replaceChildren(mk('div', 'none', 'Nothing yet: actions show up here as Claude finishes them.')); return }
  $('acts').replaceChildren(...list.map((a) => {
    const row = mk(a.rel && a.kind !== 'run' ? 'button' : 'div', 'act' + (a.ok ? '' : ' bad'))
    if (row.tagName === 'BUTTON') { row.type = 'button'; row.title = 'Open ' + a.rel; row.onclick = () => openFiles(ag.data.session, a.rel, true) }
    row.appendChild(mk('span', '', a.ok ? ACT_ICON[a.kind] ?? '▶️' : '⚠️'))
    row.appendChild(mk('span', 's', (a.agent && a.agent !== ag.data.name ? a.agent + ' · ' : '') + (a.rel ?? a.summary) + (a.ok ? '' : ' — ' + (a.error || 'failed'))))
    if (a.add) row.appendChild(mk('span', 'plus', '+' + a.add))
    if (a.del) row.appendChild(mk('span', 'minus', '−' + a.del))
    row.appendChild(mk('small', '', fmtAgo(a.ts)))
    return row
  }))
}
setInterval(() => { actsSig = ''; if (!$('card').hidden) renderActs() }, 15000) // keeps the "2m ago" labels fresh

// ---------- Servers: ports the agents are listening on ----------
let portsData = {} // session -> [{ port, proc, http, title, url }]
let orphansData = [] // servers left running by sessions that have ended (same, plus from)
function portRow(p, from) {
  const row = mk('div', 'port')
  row.appendChild(mk('span', 'dot' + (p.http ? ' http' : '')))
  row.appendChild(mk('b', '', ':' + p.port))
  const s = mk('span', 's', [p.title || (p.http ? 'web page' : 'not a web page'), p.proc, from && 'from ' + from].filter(Boolean).join(' · '))
  s.title = s.textContent
  row.appendChild(s)
  if (p.http) {
    const b = mk('button', '', 'Open ↗')
    b.type = 'button'
    b.title = 'Open ' + p.url + ' in the browser'
    b.onclick = () => window.open(p.url, '_blank', 'noopener')
    row.appendChild(b)
  }
  return row
}
let portsSig = ''
function renderPorts() {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  const list = ag?.data.kind === 'main' ? portsData[ag.data.session] ?? [] : []
  $('ports-box').hidden = !list.length // most agents never start a server: no empty section for them
  const sig = (ag?.key ?? '') + '|' + JSON.stringify(list)
  if (sig !== portsSig) { portsSig = sig; $('ports').replaceChildren(...list.map((p) => portRow(p))) }
  const n = orphansData.length
  $('orph').hidden = !n
  $('orph').textContent = '🔌 ' + n + (n === 1 ? ' server' : ' servers') + ' left running'
  if (!n) toggleOrphans(false)
  $('orph-list').replaceChildren(...orphansData.map((p) => portRow(p, p.from)))
}
function toggleOrphans(open) {
  const el = $('orph-pop')
  el.hidden = !(open ?? el.hidden)
  $('orph').setAttribute('aria-expanded', String(!el.hidden))
}
$('orph').onclick = () => { toggleOrphans(); sfx.click() }
$('orph-close').onclick = () => toggleOrphans(false)

let fl = { session: null, rel: '', file: null }
async function flGet(kind, session, rel) {
  const r = await fetch('/api/' + kind + '?session=' + encodeURIComponent(session) + '&path=' + encodeURIComponent(rel), { headers: { 'x-token': TOKEN } })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status === 401 ? 'Window no longer authorized: close it and run /vibeship again' : d.error || 'Not available')
  return d
}
function flCrumbs() {
  const parts = fl.rel ? fl.rel.split('/') : []
  const root = mk('button', '', '📁 ' + (roots[fl.session] ?? 'project'))
  root.type = 'button'; root.onclick = () => openFiles(fl.session, '')
  const out = [root]
  parts.forEach((p, i) => {
    out.push(mk('span', '', '/'))
    const b = mk('button', '', p); b.type = 'button'
    const target = parts.slice(0, i + 1).join('/')
    b.onclick = () => openFiles(fl.session, target)
    out.push(b)
  })
  $('fl-crumbs').replaceChildren(...out)
}
async function openFiles(session, rel, asFile) {
  if (!TOKEN) { toast('Open the window with /vibeship to browse files'); return }
  toggleFiles(true, true)
  fl.session = session
  const hot = new Map()
  for (const a of actsData[session] ?? []) if (a.rel && (a.kind === 'write' || a.kind === 'read')) hot.set(a.rel, a.kind === 'write' || hot.get(a.rel) === 'write' ? 'write' : 'read')
  try {
    if (asFile) {
      const f = await flGet('file', session, rel)
      fl.rel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      flCrumbs()
      $('fl-list').hidden = true; $('fl-view').hidden = false
      $('fv-name').textContent = f.name
      $('fv-meta').textContent = fmtSize(f.size) + (f.truncated ? ' · showing the first 256 KB' : '')
      $('fv-text').textContent = f.blocked ?? f.text
      $('fv-text').scrollTop = 0
      $('fv-back').onclick = () => openFiles(session, fl.rel)
      return
    }
    const d = await flGet('files', session, rel)
    fl.rel = d.rel === '.' ? '' : d.rel
    flCrumbs()
    $('fl-view').hidden = true; $('fl-list').hidden = false
    const rows = d.entries.map((e) => {
      const p = (fl.rel ? fl.rel + '/' : '') + e.name
      const b = mk('button', hot.has(p) && !e.dir ? 'hot' : '')
      b.type = 'button'
      b.appendChild(mk('span', '', e.dir ? '📁' : '📄'))
      b.appendChild(mk('span', 'nm', e.name))
      if (hot.get(p)) b.appendChild(mk('small', 'tag', hot.get(p) === 'write' ? 'changed' : 'read'))
      if (!e.dir) b.appendChild(mk('small', '', fmtSize(e.size)))
      b.onclick = () => openFiles(session, p, !e.dir)
      return b
    })
    $('fl-list').replaceChildren(...(rows.length ? rows : [mk('div', 'none', 'Empty folder')]), ...(d.more ? [mk('div', 'none', 'Showing the first 500 items')] : []))
  } catch (e) {
    $('fl-list').hidden = false; $('fl-view').hidden = true
    $('fl-list').replaceChildren(mk('div', 'none', e.message))
  }
}
function toggleFiles(open, keep) {
  const el = $('files')
  const willOpen = open ?? el.hidden
  el.hidden = !willOpen
  if (willOpen) { toggleCatalog(false); toggleSpawn(false); toggleStats(false); if (!keep) sfx.click() }
}
$('fl-close').onclick = () => toggleFiles(false)
$('card-files').onclick = () => {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (ag?.data.kind === 'main') openFiles(ag.data.session, '')
}

async function sendCommand(kind, text) {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag) return
  if (!TOKEN) { toast('Open the window with /vibeship to send commands'); return }
  try {
    const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: ag.data.session, kind, text }) })
    if (r.status === 401) toast('Window no longer authorized: close it and run /vibeship again')
    else if (!r.ok) toast('Invalid command')
    else { toast(kind === 'say' ? 'Message sent ✉️' : kind === 'close' ? 'Closing the agent…' : 'Stop sent ✋'); ag.char.state.hop = 0.3; sfx.click() }
  } catch { toast('Server unreachable') }
}
async function sendMove(ag, loc) {
  if (!TOKEN) { toast('Open the window with /vibeship to move agents'); return }
  try {
    const r = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: ag.data.session, loc }) })
    if (r.status === 401) toast('Window no longer authorized: close it and run /vibeship again')
    else if (!r.ok) toast('Cannot move it')
    else { sfx.place(); toast(ag.data.name + ' → ' + LOC_LABEL[loc]) }
  } catch { toast('Server unreachable') }
}
$('card-close').onclick = () => select(null)
$('card-stop').onclick = () => sendCommand('stop')
$('card-end').onclick = () => {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag) return
  if (!confirm('Close ' + ag.data.name + '?\nThe Claude Code session will be terminated and any work in progress will stop.')) return
  sendCommand('close')
}
$('card-form').onsubmit = (ev) => {
  ev.preventDefault()
  const inp = $('card-text')
  let text = inp.value.trim()
  if (!text && !atts.length && !webOn) return
  if (/^\/model\s*$/i.test(text)) { inp.value = ''; showModelPicker(); return } // the terminal selector cannot be shown here: pick in the window instead
  text = composeMessage(text)
  sendCommand('say', text)
  inp.value = ''
  atts = []; webOn = false; renderAtts()
  $('cmdlist').hidden = true
  $('cmenu').hidden = true
}

// ---- Rename the selected agent ----
let renaming = false
async function sendRename(name) {
  const s = selSession()
  if (!s) return
  if (!TOKEN) { toast('Open the window with /vibeship to rename agents'); return }
  try {
    const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: s, kind: 'rename', value: name }) })
    if (!r.ok) toast('That name is not valid')
    else sfx.place()
  } catch { toast('Server unreachable') }
}
function startRename() {
  const ag = selected?.kind === 'agent' ? agents.get(selected.key) : null
  if (!ag || ag.data.kind !== 'main' || renaming) return
  renaming = true
  const h = $('card-name'), old = ag.data.name
  const inp = document.createElement('input')
  inp.maxLength = 40
  inp.value = old.replace(/ #\d+$/, '')
  inp.setAttribute('aria-label', 'Agent name')
  h.replaceChildren(inp)
  inp.focus(); inp.select()
  let done = false
  const finish = (save) => {
    if (done) return
    done = true
    renaming = false
    const v = inp.value.trim()
    if (save && v && v !== old.replace(/ #\d+$/, '')) sendRename(v)
    updateCard()
  }
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.stopPropagation(); finish(false) } }
  inp.onblur = () => finish(true)
}
$('card-rename').onclick = startRename
$('card-name').ondblclick = startRename

// ---- Toolbar under the chat input: attachments, commands, and the model in use ----
let infoData = {} // session -> { model }
let atts = [] // { kind: 'file', name, path } uploaded from the computer | { kind: 'ctx', rel } a project file
let webOn = false // "Browse the web" is added to the message
const selSession = () => (selected?.kind === 'agent' ? agents.get(selected.key)?.data.session : null)
function friendlyModel(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[.*\])?$/.exec(String(id || ''))
  return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '') + (m[4] ?? '') : String(id || '')
}
function updateModelChip() {
  const s = selSession()
  const id = s ? infoData[s]?.model : ''
  $('cb-model').hidden = !id
  $('cb-model-name').textContent = friendlyModel(id)
  $('cb-model').title = id || ''
}
async function sendModel(id) {
  const s = selSession()
  if (!s) return
  if (!TOKEN) { toast('Open the window with /vibeship to switch model'); return }
  try {
    const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: s, kind: 'model', value: id }) })
    if (!r.ok) toast('Invalid model')
    else { sfx.click(); toast('Switching to ' + id + '…') }
  } catch { toast('Server unreachable') }
}
function composeMessage(text) {
  if (text.startsWith('/')) return text // a command must stay exactly as typed
  const files = atts.filter((a) => a.kind === 'file'), ctx = atts.filter((a) => a.kind === 'ctx')
  let out = (webOn ? 'Browse the web if it helps. ' : '') + (text || 'Please look at what I attached.')
  if (files.length) out += '\n\nAttached files (read them with the Read tool):\n' + files.map((f) => '- ' + f.path).join('\n')
  if (ctx.length) out += '\n\nContext files in the project:\n' + ctx.map((c) => '- ' + c.rel).join('\n')
  return out
}
function renderAtts() {
  const box = $('atts')
  const chip = (label, title, onRemove) => {
    const c = document.createElement('span'); c.className = 'chip2'; c.title = title
    const t = document.createElement('span'); t.textContent = label
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove ' + label); x.onclick = onRemove
    c.append(t, x)
    return c
  }
  const chips = atts.map((a, i) => chip((a.kind === 'file' ? '📎 ' : '📄 ') + (a.name ?? a.rel), a.path ?? a.rel, () => { atts.splice(i, 1); renderAtts() }))
  if (webOn) chips.push(chip('🌐 Browse the web', 'Claude may search the web for this message', () => { webOn = false; renderAtts() }))
  box.replaceChildren(...chips)
  box.hidden = !chips.length
}
async function uploadFiles(files) {
  const s = selSession()
  if (!s || !files.length) return
  if (!TOKEN) { toast('Open the window with /vibeship to attach files'); return }
  for (const f of files) {
    if (f.size > 8 * 1024 * 1024) { toast(f.name + ' is bigger than 8 MB'); continue }
    try {
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = rej; fr.readAsDataURL(f) })
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session: s, name: f.name, data }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.error || 'Upload failed'); continue }
      atts.push({ kind: 'file', name: d.name, path: d.path })
      renderAtts()
    } catch { toast('Upload failed') }
  }
  sfx.place()
}
// pick a project file to add as context (browse folders with the same API as the Files panel)
async function showContextPicker(rel = '') {
  const s = selSession()
  const box = $('cmdlist')
  if (!s) return
  if (!TOKEN) { toast('Open the window with /vibeship to add context'); return }
  try {
    const d = await flGet('files', s, rel)
    const here = d.rel === '.' ? '' : d.rel
    const row = (icon, label, onPick) => { const b = document.createElement('button'); b.type = 'button'; const n = document.createElement('b'); n.textContent = icon + ' ' + label; b.append(n); b.onmousedown = (e) => { e.preventDefault(); onPick() }; return b }
    const head = document.createElement('div')
    head.textContent = 'Add context: ' + (here || 'project root')
    head.style.cssText = 'font-size:11.5px;color:var(--muted);padding:2px 9px 4px'
    const rows = []
    if (here) rows.push(row('⬆️', '..', () => showContextPicker(here.includes('/') ? here.slice(0, here.lastIndexOf('/')) : '')))
    for (const e of d.entries) {
      const p = (here ? here + '/' : '') + e.name
      rows.push(e.dir ? row('📁', e.name, () => showContextPicker(p)) : row('📄', e.name, () => {
        if (!atts.some((a) => a.kind === 'ctx' && a.rel === p)) atts.push({ kind: 'ctx', rel: p })
        renderAtts(); box.hidden = true; sfx.place(); $('card-text').focus()
      }))
    }
    box._hits = null
    box.replaceChildren(head, ...(rows.length ? rows : [Object.assign(document.createElement('div'), { textContent: 'Empty folder' })]))
    box.hidden = false
  } catch (e) { toast(e.message) }
}
function closeMenu() { $('cmenu').hidden = true; $('cb-plus').setAttribute('aria-expanded', 'false') }
$('cb-plus').onclick = () => {
  const open = $('cmenu').hidden
  $('cmenu').hidden = !open
  $('cb-plus').setAttribute('aria-expanded', String(open))
  $('cmdlist').hidden = true
  sfx.click()
}
$('cm-upload').onclick = () => { closeMenu(); $('cb-file').click() }
$('cb-file').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; uploadFiles(files) }
$('cm-context').onclick = () => { closeMenu(); showContextPicker('') }
$('cm-web').onclick = () => { closeMenu(); webOn = true; renderAtts(); sfx.click(); $('card-text').focus() }
$('cb-slash').onclick = () => {
  closeMenu()
  const inp = $('card-text')
  if (!inp.value.startsWith('/')) inp.value = '/'
  inp.focus()
  cmdSel = 0
  renderCmds()
  sfx.click()
}
$('cb-model').onclick = () => { closeMenu(); showModelPicker() }
addEventListener('pointerdown', (e) => { if (!$('cmenu').hidden && !e.target.closest('#cmenu, #cb-plus')) closeMenu() })

// Model chooser: /model on its own opens a selector in the terminal, so the window offers its own
const MODEL_CHOICES = [
  ['opus', 'Opus 5.5', 'Complex work and everyday tasks'],
  ['sonnet', 'Sonnet 5.5', 'Most efficient for simpler tasks'],
  ['haiku', 'Haiku 4.5', 'Fastest, for quick tasks'],
  ['fable', 'Fable 5.1', 'Most capable'],
]
function showModelPicker() {
  const box = $('cmdlist')
  box._hits = null
  const head = document.createElement('div')
  head.textContent = 'Switch model for this session'
  head.style.cssText = 'font-size:11.5px;color:var(--muted);padding:2px 9px 4px'
  box.replaceChildren(head, ...MODEL_CHOICES.map(([id, label, desc]) => {
    const b = document.createElement('button')
    b.type = 'button'
    const n = document.createElement('b'); n.textContent = label
    const d = document.createElement('span'); d.textContent = desc
    b.append(n, d)
    b.onmousedown = (e) => { e.preventDefault(); box.hidden = true; sendModel(id) }
    if (selSession() && friendlyModel(infoData[selSession()]?.model).toLowerCase().startsWith(label.split(' ')[0].toLowerCase())) b.style.fontWeight = '900', n.textContent = '✓ ' + label
    return b
  }))
  box.hidden = false
}

// ---- Slash commands in the chat: suggestions from the session's command list ----
let cmdList = []
let cmdSel = 0
async function loadCmds(session) {
  if (!TOKEN) return
  const get = async () => {
    try {
      const r = await fetch('/api/commands?session=' + encodeURIComponent(session), { headers: { 'x-token': TOKEN } })
      if (r.ok) cmdList = (await r.json()).commands || []
    } catch {}
  }
  await get()
  try { await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ session, kind: 'commands' }) }) } catch {}
  setTimeout(get, 1500) // the mod refreshes the list on its next poll
}
function pickCmd(name) {
  const inp = $('card-text')
  inp.value = '/' + name + ' '
  $('cmdlist').hidden = true
  inp.focus()
}
function renderCmds() {
  const box = $('cmdlist')
  const m = /^\/([\w:.-]*)$/.exec($('card-text').value)
  if (!m) { box.hidden = true; box._hits = null; return }
  const q = m[1].toLowerCase()
  const rank = (c) => (c.name.toLowerCase().startsWith(q) ? 0 : 1)
  const hits = cmdList.filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 30)
  if (!hits.length) { box.hidden = true; box._hits = null; return }
  cmdSel = Math.min(cmdSel, hits.length - 1)
  box._hits = hits
  box.replaceChildren(...hits.map((c, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'option')
    b.setAttribute('aria-selected', String(i === cmdSel))
    const n = document.createElement('b'); n.textContent = '/' + c.name
    const d = document.createElement('span'); d.textContent = c.description
    b.append(n, d)
    b.onmousedown = (e) => { e.preventDefault(); pickCmd(c.name) }
    return b
  }))
  box.hidden = false
  box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}
$('card-text').addEventListener('input', () => { cmdSel = 0; renderCmds() })
$('card-text').addEventListener('keydown', (e) => {
  const box = $('cmdlist')
  if (box.hidden || !box._hits) return
  const typed = $('card-text').value.slice(1)
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + box._hits.length) % box._hits.length; renderCmds(); e.preventDefault() }
  else if (e.key === 'Tab' || (e.key === 'Enter' && !box._hits.some((c) => c.name === typed))) { pickCmd(box._hits[cmdSel].name); e.preventDefault() }
  else if (e.key === 'Escape') { box.hidden = true; e.stopPropagation() }
})
// Enter sends, Shift+Enter starts a new line (registered after the suggestions handler, which may consume Enter)
$('card-text').addEventListener('keydown', (e) => {
  if (!e.repeat && !e.ctrlKey && !e.metaKey) {
    if (e.key === ' ' || e.key === 'Enter') sfx.keyBig()
    else if (e.key === 'Backspace' || e.key === 'Delete') sfx.keyBack()
    else if (e.key.length === 1) sfx.key()
  }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return
  e.preventDefault()
  $('card-form').requestSubmit()
})
$('card-text').addEventListener('keyup', (e) => {
  if (e.ctrlKey || e.metaKey) return
  if (e.key === ' ' || e.key === 'Enter') sfx.keyUp(true)
  else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') sfx.keyUp(false)
})

// ---- Resizable agent card: drag the corner grip (anchored bottom-right, so it grows up and left) ----
const CARD_SIZE_KEY = 'ao-card-size'
function applyCardSize(s) {
  const card = $('card')
  if (s?.w) card.style.setProperty('--card-w', s.w + 'px'); else card.style.removeProperty('--card-w')
  // a real height, not just a cap: otherwise a short conversation would not let the card grow
  $('chat').style.height = s?.h ? s.h + 'px' : ''
  $('chat').style.maxHeight = s?.h ? 'none' : ''
}
try { applyCardSize(JSON.parse(localStorage.getItem(CARD_SIZE_KEY) || 'null')) } catch {}
$('card-grip').addEventListener('pointerdown', (e) => {
  e.preventDefault()
  const grip = e.currentTarget
  grip.setPointerCapture(e.pointerId)
  const x0 = e.clientX, y0 = e.clientY
  const w0 = $('card').getBoundingClientRect().width
  const h0 = $('chat').getBoundingClientRect().height
  let size = null
  const move = (ev) => {
    size = { w: Math.round(clamp(w0 - (ev.clientX - x0), 340, innerWidth - 28)), h: Math.round(clamp(h0 - (ev.clientY - y0), 120, innerHeight - 260)) }
    applyCardSize(size)
  }
  const up = () => {
    grip.removeEventListener('pointermove', move)
    grip.removeEventListener('pointerup', up)
    grip.removeEventListener('pointercancel', up)
    if (size) try { localStorage.setItem(CARD_SIZE_KEY, JSON.stringify(size)) } catch {}
  }
  grip.addEventListener('pointermove', move)
  grip.addEventListener('pointerup', up)
  grip.addEventListener('pointercancel', up)
})
$('card-grip').addEventListener('dblclick', () => {
  applyCardSize(null)
  try { localStorage.removeItem(CARD_SIZE_KEY) } catch {}
})

// ---------- Conversation, replies and permissions ----------
let chatData = {}
let permsData = []
const seenAssistant = new Map() // session -> id of the last reply already seen
const msgStates = new Map() // message id -> last state seen
let chatInit = false
const STATE_LABEL = { queued: '⏳ queued', sent: '✉️ delivered to Claude', working: '💭 Claude is working on it', done: '✓ completed', aborted: '✋ interrupted', error: '⚠️ failed' }
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
      // visual feedback in the 3D world as the message progresses
      if (m.state === 'sent') { say(ag, 'Got it! 📨', 2600, true); ag.char.state.hop = 0.25; sfx.select() }
      else if (m.state === 'working') say(ag, 'On it…', 2600, true)
      else if (m.state === 'error') { say(ag, 'I could not do it 😿', 4000, true); sfx.error() }
    }
    const lastA = [...list].reverse().find((m) => m.role === 'assistant')
    if (lastA && seenAssistant.get(session) !== lastA.id) {
      seenAssistant.set(session, lastA.id)
      if (chatInit && ag) {
        const plain = plainText(lastA.text)
        say(ag, plain.length > 140 ? plain.slice(0, 137) + '…' : plain, 11000)
        ag.char.state.hop = 0.25
        sfx.done()
        if (!(selected?.kind === 'agent' && selected.key === ag.key)) toast('💬 ' + ag.data.name + (ag.loc !== sceneName ? ' (' + (LOC_LABEL[ag.loc] ?? '') + ')' : '') + ' replied')
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
    if (m.role === 'assistant') { t.className = 'md'; t.appendChild(renderMarkdown(m.text)) } // Claude's replies are Markdown
    else t.textContent = m.text
    d.appendChild(t)
    const sm = document.createElement('small')
    if (m.role === 'user') {
      sm.textContent = (m.via === 'terminal' ? '🖥️ from the terminal · ' : '') + (STATE_LABEL[m.state] ?? '')
      if (m.state === 'queued' || m.state === 'working') sm.classList.add('dots')
    } else {
      const when = new Date(m.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
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
  world.setAlert(list.some((p) => !p.decision)) // the ship goes on alert while an agent is waiting
  setTimeout(updateSceneButtons, 0)
  for (const p of list) {
    if (known.has(p.id) || p.decision) continue
    sfx.error()
    const ag = mainAgentOf(p.session)
    if (ag) say(ag, 'May I? 🔔', 5000, true)
  }
  renderPerms()
  updateWaitingTitle()
}
// Questions that moved to the terminal and are still unanswered there
let parkedData = []
function onParked(list) {
  const known = new Set(parkedData.map((p) => p.id))
  parkedData = list
  setTimeout(updateSceneButtons, 0)
  for (const p of list) {
    if (known.has(p.id)) continue
    const ag = mainAgentOf(p.session)
    if (ag) toast('🖥️ ' + ag.data.name + (ag.loc !== sceneName ? ' (' + (LOC_LABEL[ag.loc] ?? '') + ')' : '') + ' is waiting for you in the terminal')
  }
  updateWaitingTitle()
}
// The window title counts the agents waiting for an answer, so it shows on the taskbar too
const BASE_TITLE = document.title
function updateWaitingTitle() {
  const n = new Set([...permsData.filter((p) => !p.decision), ...parkedData].map((p) => p.session)).size
  const t = n ? '🔔 ' + n + ' waiting · ' + BASE_TITLE : BASE_TITLE
  if (document.title !== t) document.title = t
}
function buildPerm(p) {
  const el = document.createElement('div')
  el.className = 'ask'
  el.setAttribute('role', 'alertdialog')
  const ag = mainAgentOf(p.session)
  el.innerHTML = '<h3><span class="bell">🔔</span><span class="ttl"></span></h3><code></code><div class="why"></div><div class="row"><button class="btn ok" data-d="allow">✓ Allow</button><button class="btn ok" data-d="allow_session" title="Stop asking about this tool until the session ends" hidden>✓ Allow all session</button><button class="btn danger" data-d="deny">✕ Deny</button></div><div class="bar"></div>'
  // a blanket allow is offered only for tools that cannot run commands or change files
  const RISKY = /^(Bash|PowerShell|Write|Edit|NotebookEdit|mcp__)/
  if (!RISKY.test(p.tool)) el.querySelector('[data-d="allow_session"]').hidden = false
  el.querySelector('.ttl').textContent = (ag?.data.name ?? 'Claude') + (ag ? ' (' + (LOC_LABEL[ag.loc] ?? '') + ')' : '') + ' wants to use ' + p.tool
  el.querySelector('code').textContent = p.summary || '(no details)'
  const why = p.reason ? (p.reason.length > 100 ? p.reason.slice(0, 99) + '…' : p.reason) + ' · ' : ''
  el.querySelector('.why').textContent = why + 'With no answer within 30 seconds, the question moves to the terminal.'
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
      r.textContent = String(p.decision).startsWith('allow') ? (p.decision === 'allow_session' ? '✓ Allowed for this session' : '✓ Allowed') : '✕ Denied'
      row.appendChild(r)
      el.querySelector('.bar')?.remove()
    }
  }
}
async function answerPerm(id, decision) {
  if (!TOKEN) { toast('Open the window with /vibeship to answer'); return }
  try {
    const r = await fetch('/api/permission', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify({ id, decision }) })
    if (r.status === 401) toast('Window no longer authorized: close it and run /vibeship again')
    else if (!r.ok) toast('The request is gone (already answered or expired)')
    else sfx[decision.startsWith('allow') ? 'place' : 'remove']()
  } catch { toast('Server unreachable') }
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
// While a save is pending, snapshots from the server (which may still hold the previous layout) are not applied.
// Only the latest save clears the flag: an earlier request finishing must not reopen the door to a stale layout.
let saveSeq = 0
function saveLayout() {
  clearTimeout(saveTimer)
  savePending = true
  const seq = ++saveSeq
  // backup copy in the browser: works even without a token
  try {
    const mine = {}
    for (const k of Object.keys(layout.scenes)) if (k.endsWith('@3')) mine[k] = layout.scenes[k]
    localStorage.setItem(LS_KEY, JSON.stringify(mine))
  } catch {}
  if (!TOKEN && !warnedNoToken) { warnedNoToken = true; toast('Saved only in this browser: open the window with /vibeship to share it') }
  saveTimer = setTimeout(() => {
    fetch('/api/layout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify(layout) })
      .catch(() => {})
      .finally(() => { if (seq === saveSeq) savePending = false })
  }, 200)
}
const conn = $('conn')
function connect() {
  const es = new EventSource('/stream')
  es.onopen = () => { conn.className = 'pill ok'; conn.textContent = 'connected' }
  es.onerror = () => { conn.className = 'pill'; conn.textContent = 'server unreachable, retrying…' }
  es.onmessage = (m) => {
    const data = JSON.parse(m.data)
    onAgents(data.agents ?? [])
    onChat(data.chat)
    onPerms(data.perms ?? [])
    onParked(data.parked ?? [])
    renderUpdate(data.update)
    infoData = data.info ?? {}
    updateModelChip()
    actsData = data.acts ?? {}
    roots = data.roots ?? {}
    renderActs()
    portsData = data.ports ?? {}
    orphansData = data.orphans ?? []
    renderPorts()
    const l = data.layout
    if (!l || !l.scenes || drag?.moved || savePending) return
    const before = JSON.stringify(layout.scenes[keyOf(sceneName)] ?? null)
    const mine = layout.scenes
    layout.scenes = l.scenes
    // scenes the server does not have yet stay as the local ones
    for (const k of Object.keys(mine)) if (k.endsWith('@3') && !layout.scenes[k]) layout.scenes[k] = mine[k]
    const after = JSON.stringify(layout.scenes[keyOf(sceneName)] ?? null)
    if (l.scene && l.scene !== sceneName && SCENES.some((s) => s.id === l.scene)) { switchScene(l.scene, false); return }
    // the layout objects were just replaced: the furniture in the scene must edit the new ones, or later changes are never saved
    const list = items()
    for (const f of furn.values()) { const it = list.find((i) => i.id === f.id); if (it) f.item = it }
    if (before !== after && after !== 'null') syncFurniture()
  }
}

// ---------- Main loop ----------
let T = 0
function tick(dt) {
  if (cinematic) dt = cinematic.update(dt) // the trailer owns the clock, the script and the camera
  T += dt
  const now = performance.now()
  const k = 1 - Math.exp(-dt * 6)
  // the camera follows the selected agent
  if (!cinematic) moveCamera(dt)
  if (selected?.kind === 'agent' && !manualCam && !cinematic) {
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
// Frame pacing: full speed while the window has the focus. In the background (the usual case: the window sits next
// to the terminal) it draws about 24 frames a second, which looks the same for this scene and costs far less power.
// If the GPU cannot keep up at full resolution, the picture gets slightly softer instead of stuttering.
const MAX_PIXEL_RATIO = Math.min(devicePixelRatio || 1, 2)
let pixelRatio = MAX_PIXEL_RATIO, slowFor = 0
let last = performance.now()
function loop(ts) {
  requestAnimationFrame(loop)
  const background = !CINEMA && !document.hasFocus() // the trailer keeps full speed (and full resolution) while it is captured
  if (background && ts - last < 1000 / 24 - 2) return
  const dt = Math.min(0.05, (ts - last) / 1000)
  last = ts
  tick(dt)
  if (background || CINEMA) return
  slowFor = dt > 1 / 40 ? slowFor + dt : Math.max(0, slowFor - dt * 0.5)
  if (slowFor > 2 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); slowFor = 0 }
}

// ---------- Startup ----------
sceneName = 'bridge'
if (!CINEMA) loadLocalLayout() // the trailer always films the default ship
world.setScene('bridge')
populate(true)
buildSceneButtons()
updateTodButton()
updateSnd()
setEditMode(false, true)
if (CINEMA) {
  // instead of the server, the trailer's scripted session feeds the same handlers with the same snapshots
  setMuted(true, false) // the film has its own soundtrack (with the same sounds)
  import('./trailer/director.js').then((m) => {
    cinematic = m.startTrailer({
      THREE, scene, camera, renderer, world, fx, cam, goal, agents, furn, seatWorld, say, select, applyCamera,
      onAgents, onPerms, onChat, PAD, DOOR, stage: $('stage'), canvas, render: () => renderer.render(scene, camera),
    })
  })
} else connect()
requestAnimationFrame(loop)

// Test and debug helpers (also when the browser pauses requestAnimationFrame)
window.__ao = {
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt) },
  THREE, scene, camera, renderer, world, agents, furn, layout: () => layout, items, select, addFurniture, switchScene, goal, cam,
  get selected() { return selected },
}

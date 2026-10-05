// Catalog of the spaceship furniture: procedural low-poly models, "space toy" style.
// Convention: the "front" of the object faces +z. Units ≈ meters.
import { THREE, mat, glow, holo, box, cyl, sph, capsule, blob, bake } from './lib.js'

const METAL = '#b9c3dc', METAL_D = '#6f7b99', DARK = '#2a3150', NAVY = '#161d3a', WHITE = '#eef3ff'
const CYAN = 0x4de0ff, PINK = 0xff7ad9, AMBER = 0xffc65a, GREEN = 0x6dffb0, VIOLET = 0xb08cff

// ---------- Pezzi riusabili ----------
// Pilot seat: the backrest is on the +z side (away from the desk)
function addSeat(g, x, z, color = '#3fb5d6') {
  const c = new THREE.Group()
  cyl(c, 0.06, 0.06, 0.4, '#58648a', 0, 0.22, 0, 8)
  cyl(c, 0.34, 0.3, 0.05, '#58648a', 0, 0.03, 0, 6)
  cyl(c, 0.38, 0.36, 0.14, color, 0, 0.47, 0, 22)
  box(c, 0.62, 0.7, 0.12, color, 0, 0.88, 0.34, 0.06)
  box(c, 0.36, 0.22, 0.12, color, 0, 1.35, 0.34, 0.06)
  box(c, 0.1, 0.1, 0.5, '#58648a', 0.4, 0.68, 0.02, 0.03)
  box(c, 0.1, 0.1, 0.5, '#58648a', -0.4, 0.68, 0.02, 0.03)
  c.position.set(x, 0, z)
  g.add(c)
}

// Holographic screen with frame and data lines
function screen(g, x, y, z, w, h, ry = 0, color = CYAN) {
  const s = new THREE.Group()
  box(s, w + 0.08, h + 0.08, 0.04, '#222a48', 0, 0, 0, 0.02)
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow(color, 0.55))
  pane.position.z = 0.03
  s.add(pane)
  for (let i = 0; i < 4; i++) {
    const lw = w * (0.3 + 0.13 * ((i * 3) % 4))
    const l = new THREE.Mesh(new THREE.PlaneGeometry(lw, 0.03), mat('#f4fbff'))
    l.position.set(-w / 2 + 0.08 + lw / 2, h / 2 - 0.1 - i * h * 0.2, 0.034)
    s.add(l)
  }
  s.position.set(x, y, z); s.rotation.y = ry
  g.add(s)
}
function mug(g, x, y, z, color = '#ff9fb2') {
  cyl(g, 0.075, 0.065, 0.14, color, x, y + 0.07, z, 14)
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 12), mat(color))
  h.position.set(x + 0.085, y + 0.07, z)
  g.add(h)
}
function stripe(g, w, x, y, z, color = CYAN, h = 0.06) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow(color, 0.9))
  m.position.set(x, y, z)
  g.add(m)
}
function ringGlow(g, r, tube, color, y, base = 0.9) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 44), glow(color, base))
  m.rotation.x = Math.PI / 2; m.position.y = y
  g.add(m)
}

// ---------- Lavoro ----------
const B = {}

B.console = () => {
  const g = new THREE.Group()
  box(g, 2.3, 0.1, 1.0, DARK, 0, 0.86, 0, 0.05)
  box(g, 2.1, 0.78, 0.8, METAL_D, 0, 0.4, -0.04, 0.06)
  stripe(g, 1.9, 0, 0.62, 0.365)
  screen(g, 0, 1.3, -0.32, 1.0, 0.6)
  screen(g, -0.88, 1.22, -0.2, 0.7, 0.45, 0.55, GREEN)
  screen(g, 0.88, 1.22, -0.2, 0.7, 0.45, -0.55, PINK)
  cyl(g, 0.03, 0.03, 0.4, '#58648a', 0, 1.05, -0.32, 8)
  const cols = ['#ff6b6b', '#ffd24a', '#6dffb0', '#6ab8ff', '#ff9ff3', '#ffd24a']
  for (let i = 0; i < 6; i++) box(g, 0.13, 0.04, 0.1, cols[i], -0.45 + i * 0.18, 0.93, 0.28, 0.015)
  cyl(g, 0.025, 0.03, 0.14, '#58648a', 0.8, 1.0, 0.22, 8)
  sph(g, 0.055, '#ff6b6b', 0.8, 1.09, 0.22)
  mug(g, -0.85, 0.91, 0.25, '#ffd27a')
  addSeat(g, 0, 1.15, '#3fb5d6')
  return { group: g }
}

B.holotable = () => {
  const g = new THREE.Group(), spin = []
  cyl(g, 0.78, 0.88, 0.18, DARK, 0, 0.09, 0, 26)
  cyl(g, 0.45, 0.6, 0.7, METAL_D, 0, 0.5, 0, 20)
  cyl(g, 0.95, 0.85, 0.1, METAL, 0, 0.9, 0, 30)
  ringGlow(g, 0.86, 0.03, CYAN, 0.96)
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 24, 1, true), holo(CYAN, 0.7, 0.16))
  beam.rotation.x = Math.PI; beam.position.y = 1.4; g.add(beam)
  const planet = new THREE.Group(); planet.position.y = 1.62
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 12), holo(0x6ab8ff, 0.9, 0.55)))
  const land = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), holo(GREEN, 0.9, 0.7)); land.position.set(0.18, 0.1, 0.18); planet.add(land)
  const land2 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), holo(GREEN, 0.9, 0.7)); land2.position.set(-0.2, -0.1, 0.16); planet.add(land2)
  const rg = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.015, 6, 36), holo(AMBER, 0.9, 0.7)); rg.rotation.x = 1.25; rg.rotation.y = 0.3; planet.add(rg)
  g.add(planet)
  spin.push({ obj: planet, speed: 0.7, axis: 'y' })
  return { group: g, spin }
}

B.starmap = () => {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) { box(g, 0.08, 1.9, 0.08, DARK, sx * 0.98, 0.95, -0.1, 0.03); box(g, 0.3, 0.06, 0.5, DARK, sx * 0.98, 0.03, -0.1, 0.03) }
  box(g, 2.06, 1.24, 0.06, NAVY, 0, 1.35, -0.1, 0.03)
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.08), holo(CYAN, 0.45, 0.22)); pane.position.set(0, 1.35, -0.06); g.add(pane)
  const pts = [[-0.7, 1.7], [-0.35, 1.45], [0.0, 1.62], [0.35, 1.3], [0.7, 1.55], [0.5, 1.0], [-0.1, 1.05], [-0.6, 1.1]]
  const starMat = glow(0xfff2b0, 0.95)
  pts.forEach(([x, y], i) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.045 + (i % 3) * 0.012, 8, 6), starMat); s.position.set(x, y, -0.05); g.add(s) })
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
    const l = box(g, Math.hypot(x2 - x1, y2 - y1), 0.012, 0.01, '#7fe8ff', (x1 + x2) / 2, (y1 + y2) / 2, -0.05, 0.004)
    l.rotation.z = Math.atan2(y2 - y1, x2 - x1)
  }
  return { group: g }
}

B.workbench = () => {
  const g = new THREE.Group()
  box(g, 2.3, 0.12, 1.0, METAL_D, 0, 0.86, 0, 0.05)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.1, 0.82, 0.1, DARK, sx * 1.04, 0.41, sz * 0.42, 0.03)
  box(g, 2.1, 0.06, 0.9, DARK, 0, 0.3, 0, 0.02)
  box(g, 0.6, 0.62, 0.8, DARK, 0.75, 0.5, 0, 0.04)
  box(g, 2.0, 0.9, 0.06, '#39425f', 0, 1.5, -0.46, 0.03)
  const cols = ['#ff6b6b', '#6ab8ff', '#ffd24a', '#6dffb0', '#c79aff', '#ff9ff3']
  cols.forEach((c, i) => box(g, 0.07, 0.34 + (i % 3) * 0.1, 0.03, c, -0.8 + i * 0.3, 1.55, -0.42, 0.015))
  cyl(g, 0.12, 0.14, 0.08, DARK, -0.55, 0.96, -0.1, 12)
  box(g, 0.08, 0.5, 0.08, '#ffb02e', -0.55, 1.25, -0.1, 0.03).rotation.z = 0.25
  sph(g, 0.07, '#58648a', -0.62, 1.5, -0.1)
  box(g, 0.07, 0.4, 0.07, '#ffb02e', -0.42, 1.66, -0.1, 0.03).rotation.z = -0.9
  box(g, 0.1, 0.05, 0.05, '#58648a', -0.22, 1.78, -0.1, 0.02)
  for (let i = 0; i < 3; i++) box(g, 0.22, 0.16, 0.3, cols[(i + 2) % 6], 0.1 + i * 0.28, 0.99, -0.2, 0.03)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(AMBER, 0.9)); lamp.position.set(0.85, 1.02, 0.25); g.add(lamp)
  box(g, 0.5, 0.025, 0.07, '#d8dff0', 0.1, 0.94, 0.25, 0.01)
  return { group: g }
}

B.reactor = () => {
  const g = new THREE.Group(), spin = []
  cyl(g, 0.88, 0.95, 0.3, DARK, 0, 0.15, 0, 26)
  cyl(g, 0.62, 0.7, 0.14, METAL_D, 0, 0.37, 0, 22)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 2.3, 24, 1, true), holo(CYAN, 0.5, 0.2)); tube.position.y = 1.58; g.add(tube)
  cyl(g, 0.66, 0.6, 0.14, METAL_D, 0, 2.78, 0, 22)
  cyl(g, 0.5, 0.66, 0.2, DARK, 0, 2.95, 0, 22)
  const core = new THREE.Group(); core.position.y = 1.58
  core.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.1, 14), glow(CYAN, 1.2)))
  for (const y of [-0.7, 0, 0.7]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 24), glow(0xb6f6ff, 1.1)); r.rotation.x = Math.PI / 2; r.position.y = y; core.add(r) }
  g.add(core)
  spin.push({ obj: core, speed: 1.4, axis: 'y' })
  for (const a of [0.8, 2.4, 4.0, 5.5]) cyl(g, 0.05, 0.05, 2.3, METAL, Math.cos(a) * 0.74, 1.6, Math.sin(a) * 0.74, 8)
  stripe(g, 1.2, 0, 0.36, 0.78, AMBER, 0.05)
  return { group: g, spin }
}

B.scanner = () => {
  const g = new THREE.Group()
  box(g, 1.4, 0.1, 0.85, '#d6def2', 0, 0.84, 0, 0.04)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.08, 0.8, 0.08, METAL_D, sx * 0.62, 0.4, sz * 0.32, 0.02)
  cyl(g, 0.3, 0.32, 0.06, DARK, 0, 0.92, -0.05, 18)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), holo(CYAN, 0.6, 0.3)); dome.position.set(0, 0.95, -0.05); g.add(dome)
  const sample = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow(GREEN, 1.0)); sample.position.set(0, 1.04, -0.05); g.add(sample)
  box(g, 0.1, 0.55, 0.1, '#ff6b6b', 0.5, 1.2, -0.25, 0.03)
  box(g, 0.5, 0.07, 0.07, '#ff6b6b', 0.3, 1.46, -0.25, 0.03).rotation.z = 0.2
  screen(g, -0.45, 1.3, -0.25, 0.5, 0.36, 0.35, VIOLET)
  addSeat(g, 0, 1.0, '#9d7bd8')
  return { group: g }
}

B.servers = () => {
  const g = new THREE.Group(), blink = []
  box(g, 0.95, 2.05, 0.9, '#2c3354', 0, 1.03, 0, 0.06)
  for (let i = 0; i < 6; i++) {
    box(g, 0.8, 0.22, 0.04, '#46507a', 0, 0.3 + i * 0.28, 0.45, 0.02)
    for (let j = 0; j < 3; j++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), glow([GREEN, AMBER, CYAN][(i + j) % 3], 1.1))
      led.position.set(-0.28 + j * 0.09, 0.3 + i * 0.28, 0.475)
      g.add(led); blink.push(led.material)
    }
  }
  return { group: g, blink }
}

// ---------- Relax ----------
function sofaLike(w, color, light) {
  const g = new THREE.Group()
  box(g, w, 0.42, 1.0, color, 0, 0.32, 0, 0.14)
  box(g, w, 0.78, 0.3, color, 0, 0.78, -0.37, 0.15)
  for (const sx of [-1, 1]) box(g, 0.3, 0.62, 1.0, color, sx * (w / 2 - 0.15), 0.55, 0, 0.14)
  const n = w > 1.5 ? 3 : 1
  const cw = (w - 0.6) / n
  for (let i = 0; i < n; i++) box(g, cw - 0.04, 0.16, 0.74, light, -((w - 0.6) / 2) + cw * (i + 0.5), 0.6, 0.1, 0.08)
  box(g, w - 0.2, 0.06, 0.8, DARK, 0, 0.06, 0, 0.03)
  stripe(g, w - 0.4, 0, 0.1, 0.5, CYAN, 0.05)
  return g
}
B.sofa = () => {
  const g = sofaLike(2.4, '#4a8fd0', '#74b6f0')
  box(g, 0.38, 0.38, 0.12, '#ff9fb2', -0.7, 0.88, 0.0, 0.06).rotation.set(-0.3, 0.3, 0.15)
  box(g, 0.34, 0.34, 0.12, '#ffd27a', 0.75, 0.86, 0.02, 0.06).rotation.set(-0.25, -0.35, -0.2)
  return { group: g }
}
B.armchair = () => {
  const g = sofaLike(1.15, '#46bfae', '#74e0cf')
  box(g, 0.32, 0.32, 0.12, '#ffd27a', 0.1, 0.82, 0.0, 0.06).rotation.set(-0.3, 0.1, 0.4)
  return { group: g }
}
B.coffeetable = () => {
  const g = new THREE.Group()
  cyl(g, 0.62, 0.62, 0.07, '#dfe6f8', 0, 0.45, 0, 28)
  cyl(g, 0.2, 0.28, 0.4, METAL_D, 0, 0.22, 0, 14)
  ringGlow(g, 0.55, 0.025, PINK, 0.41)
  mug(g, 0.2, 0.485, 0.15, '#ffd27a')
  box(g, 0.34, 0.03, 0.22, '#7fe8ff', -0.25, 0.5, -0.1, 0.012).rotation.y = -0.4
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), holo(GREEN, 0.9, 0.6)); orb.position.set(0.25, 0.6, -0.25); g.add(orb)
  return { group: g }
}
B.datashelf = () => {
  const g = new THREE.Group()
  box(g, 1.7, 2.05, 0.44, DARK, 0, 1.025, 0, 0.05)
  box(g, 1.54, 1.9, 0.38, '#1c2442', 0, 1.025, 0.04, 0.02)
  for (let i = 0; i < 5; i++) box(g, 1.56, 0.05, 0.4, METAL_D, 0, 0.1 + i * 0.47, 0.03, 0.015)
  const cols = ['#ff6b6b', '#6ab8ff', '#ffd24a', '#6dffb0', '#c79aff', '#ff9ff3', '#4de0ff']
  for (let r = 0; r < 4; r++) {
    let x = -0.7
    for (let i = 0; i < 9 && x < 0.6; i++) {
      const w = 0.08 + ((i * 7 + r * 3) % 4) * 0.025, h = 0.26 + ((i * 5 + r) % 4) * 0.05
      box(g, w, h, 0.22, cols[(i + r * 2) % cols.length], x + w / 2, 0.15 + r * 0.47 + h / 2 + 0.01, 0.06, 0.012)
      x += w + 0.015
    }
  }
  stripe(g, 1.4, 0, 1.98, 0.23, CYAN, 0.04)
  return { group: g }
}
B.lamp = () => {
  const g = new THREE.Group()
  cyl(g, 0.22, 0.25, 0.05, DARK, 0, 0.025, 0, 20)
  cyl(g, 0.025, 0.025, 1.0, METAL_D, 0, 0.55, 0, 8)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 14), glow(0xb6f6ff, 1.0)); tube.position.y = 1.4; g.add(tube)
  for (const y of [0.98, 1.82]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 16), mat('#58648a')); t.rotation.x = Math.PI / 2; t.position.y = y; g.add(t) }
  return { group: g }
}

// ---------- Natura ----------
function leaf(parent, color, x, y, z, sx, sy, sz, rz = 0, ry = 0) {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, z); pivot.rotation.set(0, ry, rz)
  sph(pivot, 0.5, color, 0, sy * 0.5, 0, sx, sy, sz)
  parent.add(pivot)
  return pivot
}
B.plant = () => {
  const g = new THREE.Group(), sway = []
  cyl(g, 0.24, 0.17, 0.3, WHITE, 0, 0.15, 0, 16)
  cyl(g, 0.25, 0.25, 0.04, '#46bfae', 0, 0.31, 0, 16)
  const cols = ['#4fd07a', '#7be092', '#3fb870']
  const tufts = [new THREE.Group(), new THREE.Group()]
  for (const t of tufts) { t.position.y = 0.33; g.add(t) }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    leaf(tufts[i % 2], cols[i % 3], Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, 0.26, 0.6 + (i % 3) * 0.12, 0.1, Math.cos(a) * 0.5, -a)
  }
  tufts.forEach((t, i) => { bake(t); sway.push({ obj: t, base: 0, amp: 0.05, speed: 1.4 + i * 0.5, phase: i * 2 }) })
  return { group: g, sway }
}
B.plantbig = () => {
  const g = new THREE.Group(), sway = []
  cyl(g, 0.4, 0.3, 0.55, WHITE, 0, 0.28, 0, 20)
  cyl(g, 0.42, 0.42, 0.05, '#4de0ff', 0, 0.57, 0, 20)
  stripe(g, 0.7, 0, 0.3, 0.38, CYAN, 0.04)
  const cols = ['#34c07a', '#4fd07a', '#2aa86a', '#7be092']
  const tufts = [new THREE.Group(), new THREE.Group()]
  for (const t of tufts) { t.position.y = 0.58; g.add(t) }
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + (i % 2) * 0.3
    const tilt = 0.5 + (i % 3) * 0.28
    const p = leaf(tufts[i % 2], cols[i % 4], Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12, 0.5, 1.15 + (i % 4) * 0.2, 0.12, 0, -a + Math.PI / 2)
    p.rotation.z = Math.cos(a) * tilt * 0.6; p.rotation.x = -Math.sin(a) * tilt * 0.6
  }
  tufts.forEach((t, i) => { bake(t); sway.push({ obj: t, base: 0, amp: 0.035, speed: 1.1 + i * 0.4, phase: i * 2.5 }) })
  return { group: g, sway }
}
B.bonsai = () => {
  const g = new THREE.Group(), sway = []
  cyl(g, 0.55, 0.6, 0.14, DARK, 0, 0.07, 0, 24)
  cyl(g, 0.12, 0.17, 0.7, '#9a6a3d', 0, 0.5, 0, 10)
  const crown = new THREE.Group(); crown.position.y = 0.85
  sph(crown, 0.4, '#4fd07a', 0, 0.2, 0, 1.1, 0.8, 1.1)
  sph(crown, 0.28, '#7be092', 0.25, 0.4, 0.1)
  sph(crown, 0.26, '#34c07a', -0.22, 0.34, -0.1)
  sph(crown, 0.05, '#ff9fb2', 0.34, 0.25, 0.3); sph(crown, 0.05, '#ffe27a', -0.3, 0.2, 0.3)
  bake(crown)
  g.add(crown)
  sway.push({ obj: crown, base: 0, amp: 0.03, speed: 1.0, phase: 0 })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.66, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), holo(0xbfe9ff, 0.25, 0.14)); dome.position.y = 0.14; dome.scale.y = 1.7; g.add(dome)
  ringGlow(g, 0.6, 0.02, CYAN, 0.15)
  return { group: g, sway }
}

// ---------- Svago ----------
B.replicator = () => {
  const g = new THREE.Group()
  box(g, 0.95, 1.5, 0.7, '#dfe6f8', 0, 0.78, 0, 0.1)
  box(g, 0.7, 0.45, 0.06, '#0e1430', 0, 1.05, 0.34, 0.03)
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), holo(AMBER, 0.9, 0.55)); win.position.set(0, 1.05, 0.375); g.add(win)
  box(g, 0.62, 0.05, 0.3, METAL_D, 0, 0.82, 0.42, 0.02)
  mug(g, 0, 0.84, 0.42, '#ff9fb2')
  for (let i = 0; i < 4; i++) box(g, 0.12, 0.08, 0.04, ['#ff6b6b', '#ffd24a', '#6dffb0', '#6ab8ff'][i], -0.27 + i * 0.18, 1.4, 0.36, 0.015)
  stripe(g, 0.7, 0, 0.3, 0.355, CYAN, 0.05)
  return { group: g }
}
B.arcade = () => {
  const g = new THREE.Group()
  box(g, 0.95, 1.75, 0.85, '#5b3fb0', 0, 0.88, 0, 0.1)
  box(g, 0.99, 0.34, 0.89, '#ffcf4a', 0, 1.92, 0, 0.08).material = glow(0xffcf4a, 0.75)
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.5), glow(0x6af0ff, 0.7))
  scr.position.set(0, 1.28, 0.44); scr.rotation.x = -0.18; g.add(scr)
  box(g, 0.95, 0.12, 0.5, '#3f2c80', 0, 0.8, 0.5, 0.05).rotation.x = 0.28
  cyl(g, 0.02, 0.02, 0.13, '#dddddd', -0.2, 0.93, 0.53, 8)
  sph(g, 0.055, '#ff6b6b', -0.2, 1.0, 0.53)
  for (const [x, c] of [[0.05, '#5aa9e6'], [0.18, '#f2c14e'], [0.31, '#58b368']]) cyl(g, 0.045, 0.045, 0.03, c, x, 0.88, 0.54, 12)
  return { group: g }
}
B.pad = () => {
  const g = new THREE.Group()
  cyl(g, 1.8, 1.8, 0.05, '#2a3150', 0, 0.025, 0, 40).castShadow = false
  cyl(g, 1.45, 1.45, 0.06, '#39426a', 0, 0.03, 0, 40).castShadow = false
  ringGlow(g, 1.6, 0.04, CYAN, 0.07)
  ringGlow(g, 1.0, 0.025, PINK, 0.07, 0.8)
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1), glow(AMBER, 0.8))
    t.rotation.x = -Math.PI / 2; t.rotation.z = (i * Math.PI) / 2
    t.position.set(Math.cos((i * Math.PI) / 2) * 0.55, 0.07, Math.sin((i * Math.PI) / 2) * 0.55)
    g.add(t)
  }
  return { group: g, flat: true, noBlob: true }
}
B.crates = () => {
  const g = new THREE.Group()
  const crate = (x, y, z, w, h, d, rot = 0) => {
    const c = new THREE.Group()
    box(c, w, h, d, '#7a869e', 0, 0, 0, 0.05)
    box(c, w + 0.02, 0.07, d + 0.02, '#ffd24a', 0, h / 2 - 0.12, 0, 0.015)
    box(c, w + 0.02, 0.07, d + 0.02, '#ffd24a', 0, -h / 2 + 0.12, 0, 0.015)
    box(c, 0.1, 0.1, 0.02, '#ff6b6b', w / 4, 0, d / 2 + 0.005, 0.01)
    c.position.set(x, y + h / 2, z); c.rotation.y = rot; g.add(c)
  }
  crate(0, 0, 0, 0.7, 0.55, 0.6)
  crate(0.05, 0.55, 0, 0.6, 0.45, 0.55, 0.2)
  crate(0.75, 0, 0.1, 0.5, 0.4, 0.5, -0.3)
  return { group: g }
}
B.droid = () => {
  const g = new THREE.Group(), sway = []
  cyl(g, 0.3, 0.3, 0.06, DARK, 0, 0.03, 0, 18)
  sph(g, 0.34, '#eef3ff', 0, 0.5, 0, 1, 1.05, 1)
  box(g, 0.5, 0.09, 0.02, '#4de0ff', 0, 0.55, 0.33, 0.01)
  const head = new THREE.Group(); head.position.y = 0.98
  sph(head, 0.26, '#eef3ff', 0, 0, 0, 1, 0.9, 1)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), glow(CYAN, 1.2)); eye.position.set(0, 0.02, 0.2); head.add(eye)
  sph(head, 0.045, '#222a48', 0, 0.02, 0.29)
  cyl(head, 0.015, 0.015, 0.22, METAL_D, 0.1, 0.3, 0, 6)
  sph(head, 0.04, '#ff6b6b', 0.1, 0.42, 0)
  sph(head, 0.08, '#4a8fd0', -0.24, 0.0, 0, 0.5, 1, 1)
  sph(head, 0.08, '#4a8fd0', 0.24, 0.0, 0, 0.5, 1, 1)
  g.add(head)
  sway.push({ obj: head, base: 0, amp: 0.5, speed: 0.8, phase: 0, axis: 'y' })
  for (const sx of [-1, 1]) capsule(g, 0.04, 0.2, '#b9c3dc', sx * 0.38, 0.52, 0.02).rotation.z = sx * 0.4
  return { group: g, sway }
}
B.cryopod = () => {
  const g = new THREE.Group()
  box(g, 2.2, 0.3, 1.0, DARK, 0, 0.15, 0, 0.1)
  box(g, 2.0, 0.25, 0.8, METAL_D, 0, 0.42, 0, 0.1)
  const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.3, 6, 16), holo(0xbfe9ff, 0.4, 0.22)); glass.rotation.z = Math.PI / 2; glass.position.y = 0.85; g.add(glass)
  const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 6, 12), glow(CYAN, 0.55)); inner.rotation.z = Math.PI / 2; inner.position.y = 0.78; g.add(inner)
  stripe(g, 1.6, 0, 0.35, 0.51, GREEN, 0.05)
  for (const sx of [-1, 1]) box(g, 0.12, 0.5, 0.12, METAL, sx * 0.95, 0.55, 0, 0.04)
  return { group: g }
}

// ---------- Catalogo ----------
// w/d = footprint (before rotation); seat = where the agent stands (local system), sit = seated
export const CATALOG = {
  console:    { label: 'Command console', cat: 'work', w: 2.4, d: 1.1, work: true, seat: { x: 0, z: 1.15, sit: true }, scenes: ['bridge', 'engine', 'habitat'] },
  holotable:  { label: 'Holographic table',  cat: 'work', w: 1.9, d: 1.9, work: true, seat: { x: 0, z: 1.45, sit: false }, scenes: ['bridge', 'habitat'] },
  starmap:    { label: 'Star map',     cat: 'work', w: 2.2, d: 0.6, scenes: ['bridge', 'engine', 'habitat'] },
  workbench:  { label: 'Engineering bench',   cat: 'work', w: 2.4, d: 1.1, work: true, seat: { x: 0, z: 1.0, sit: false }, scenes: ['engine'] },
  reactor:    { label: 'Energy core',  cat: 'work', w: 1.9, d: 1.9, work: true, seat: { x: 0, z: 1.6, sit: false }, scenes: ['engine'] },
  servers:    { label: 'Data rack',          cat: 'work', w: 1.0, d: 1.0, work: true, seat: { x: 0, z: 0.95, sit: false }, scenes: ['bridge', 'engine'] },
  scanner:    { label: 'Scanner station', cat: 'work', w: 1.5, d: 0.9, work: true, seat: { x: 0, z: 1.0, sit: true }, scenes: ['habitat', 'engine'] },

  sofa:       { label: 'Sofa',             cat: 'relax', w: 2.4, d: 1.0, rest: [{ x: -0.7, z: 0.1 }, { x: 0.7, z: 0.1 }] }, // rest = seats an idle agent can take (local coordinates, facing +z)
  armchair:   { label: 'Armchair',           cat: 'relax', w: 1.15, d: 1.0, rest: [{ x: 0, z: 0.1 }] },
  coffeetable:{ label: 'Antigrav coffee table',  cat: 'relax', w: 1.3, d: 1.3 },
  datashelf:  { label: 'Data shelf',      cat: 'relax', w: 1.7, d: 0.5 },
  lamp:       { label: 'Neon lamp',    cat: 'relax', w: 0.6, d: 0.6 },

  plant:      { label: 'Small plant',     cat: 'nature', w: 0.6, d: 0.6 },
  plantbig:   { label: 'Large plant',      cat: 'nature', w: 0.9, d: 0.9 },
  bonsai:     { label: 'Domed bonsai',   cat: 'nature', w: 1.3, d: 1.3 },

  replicator: { label: 'Replicator',        cat: 'fun', w: 1.0, d: 0.8 },
  arcade:     { label: 'Arcade',             cat: 'fun', w: 1.0, d: 0.9 },
  crates:     { label: 'Supply crates', cat: 'fun', w: 1.5, d: 0.8 },
  droid:      { label: 'Onboard droid',    cat: 'fun', w: 0.9, d: 0.9 },
  cryopod:    { label: 'Cryo pod', cat: 'fun', w: 2.3, d: 1.1 },
}
export const CATEGORIES = [
  { id: 'work', label: 'Work', icon: '🛰️' },
  { id: 'relax', label: 'Relax', icon: '🛋️' },
  { id: 'nature', label: 'Nature', icon: '🌿' },
  { id: 'fun', label: 'Fun', icon: '🎮' },
]
export const catalogFor = (scene) => Object.entries(CATALOG).filter(([, d]) => !d.scenes || d.scenes.includes(scene))

// Creates the 3D model of a type. Returns { group, inner, sway, spin, blink, def }
export function buildModel(type) {
  const def = CATALOG[type]
  const made = B[type]()
  // merges the static parts into a single mesh; animated parts and glowing materials stay separate
  const moving = [...(made.sway ?? []), ...(made.spin ?? [])].map((s) => s.obj)
  bake(made.group, (m) => { for (let o = m; o; o = o.parent) if (moving.includes(o)) return true; return false })
  const group = new THREE.Group()
  group.add(made.group)
  if (!made.noBlob) group.add(blob(def.w + 0.5, def.d + 0.5))
  return { group, inner: made.group, sway: made.sway ?? [], spin: made.spin ?? [], blink: made.blink ?? [], def }
}

// The subagent launch pad: fixed, the same in every location, not in the catalog
export function buildPad() {
  const made = B.pad()
  bake(made.group)
  const g = new THREE.Group()
  g.add(made.group)
  return g
}

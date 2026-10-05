// Environment: a diorama-style spaceship deck (octagonal hull, portholes, superstructures), space and ship lights.
import { THREE, mat, glow, glowMats, box, cyl, sph, rand, bakeShared, disposeGroup } from './lib.js'

// Play area (where objects can be placed)
export const ROOM = { w: 24, d: 14, wallH: 4.2 }
export const BOUNDS = { minX: -ROOM.w / 2, maxX: ROOM.w / 2, minZ: -ROOM.d / 2, maxZ: ROOM.d / 2 }

// Hull: octagon with rounded corners, a bit larger than the play area
const HX = 13.2, HZ = 8.2, CH = 2.4
const PLAN = [
  [-HX + CH, -HZ], [HX - CH, -HZ], [HX, -HZ + CH], [HX, HZ - CH],
  [HX - CH, HZ], [-HX + CH, HZ], [-HX, HZ - CH], [-HX, -HZ + CH],
]
const WALL_T = 0.34

// ---------- Texture procedurali ----------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]) }
  t.anisotropy = 8
  return t
}
const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()
// The platform UVs are in meters: 0.25 = one tile every 4 m
const REP = [0.25, 0.25]

const FLOORS = {
  // Bridge: midnight-blue plates with cyan lines
  bridge: () => canvasTex(512, 512, (g, s) => {
    const r = rand(3)
    const n = 4, t = s / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = mix('#1a2244', '#232d58', r())
      g.fillRect(x * t, y * t, t, t)
      g.strokeStyle = '#34428a'; g.lineWidth = 4; g.strokeRect(x * t + 2, y * t + 2, t - 4, t - 4)
      g.strokeStyle = 'rgba(80,220,255,0.28)'; g.lineWidth = 2
      g.beginPath(); g.moveTo(x * t + 14, y * t + t / 2); g.lineTo(x * t + t - 14, y * t + t / 2); g.stroke()
      g.fillStyle = '#4a5aa8'
      for (const [dx, dy] of [[10, 10], [t - 10, 10], [10, t - 10], [t - 10, t - 10]]) { g.beginPath(); g.arc(x * t + dx, y * t + dy, 3, 0, 7); g.fill() }
    }
  }, REP),
  // Engine room: grey diamond-plate with orange markings
  engine: () => canvasTex(512, 512, (g, s) => {
    g.fillStyle = '#3a3f4b'; g.fillRect(0, 0, s, s)
    g.strokeStyle = 'rgba(160,172,196,0.35)'; g.lineWidth = 3
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const cx = x * 32 + (y % 2 ? 16 : 0), cy = y * 32 + 16
      g.beginPath(); g.moveTo(cx - 9, cy - 3); g.lineTo(cx + 9, cy + 3); g.stroke()
    }
    g.strokeStyle = '#2a2e38'; g.lineWidth = 6; g.strokeRect(3, 3, s - 6, s - 6)
    g.fillStyle = '#e0872e'; g.fillRect(0, 0, 40, 8); g.fillRect(0, 0, 8, 40)
  }, REP),
  // Greenhouse: light tiles with green veining
  habitat: () => canvasTex(512, 512, (g, s) => {
    const r = rand(9)
    g.fillStyle = '#dce6e2'; g.fillRect(0, 0, s, s)
    const n = 4, t = s / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = mix('#d4e0db', '#e8f0ec', r()); g.fillRect(x * t + 3, y * t + 3, t - 6, t - 6)
    }
    g.strokeStyle = '#8fb8aa'; g.lineWidth = 4
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke() }
    g.fillStyle = 'rgba(90,190,140,0.3)'
    for (let i = 0; i < 10; i++) { g.beginPath(); g.ellipse(r() * s, r() * s, 10, 4, r() * 3, 0, 7); g.fill() }
  }, REP),
}
// Hull plating: panels with lines and rivets
const hullTexture = () => canvasTex(256, 256, (g, s) => {
  g.fillStyle = '#9aa3bb'; g.fillRect(0, 0, s, s)
  g.strokeStyle = 'rgba(30,40,70,0.55)'; g.lineWidth = 3
  g.strokeRect(2, 2, s - 4, s - 4)
  g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s / 2); g.stroke()
  g.fillStyle = 'rgba(30,40,70,0.6)'
  for (const [x, y] of [[12, 12], [s - 12, 12], [12, s / 2 - 12], [s - 12, s / 2 - 12], [12, s / 2 + 12], [s - 12, s / 2 + 12], [12, s - 12], [s - 12, s - 12]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill() }
}, [0.5, 0.5])
// Pannelli solari
const solarTexture = () => canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#1b2f6e'; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#5a86e0'; g.lineWidth = 2
  for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke() }
  for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
  g.fillStyle = 'rgba(160,210,255,0.25)'; g.fillRect(0, 0, w, 6)
}, [1, 1])

const THEMES = {
  bridge:  { wall: '#3a4878', trim: '#8da0cf', dado: '#27325a', side: '#3a4670', hull: '#6f7ca8' },
  engine:  { wall: '#5f6572', trim: '#e0872e', dado: '#444a56', side: '#4d525e', hull: '#7d8494' },
  habitat: { wall: '#e3ede8', trim: '#4aa8a0', dado: '#bcd6cf', side: '#9fbfb8', hull: '#9fc2bb' },
}

// ---------- Ship light modes ----------
const C = (h) => new THREE.Color(h)
const MODES = {
  normal: { hemiS: C('#c9dcff'), hemiG: C('#7d89b3'), hemiI: 1.3,  sun: C('#eaf2ff'), sunI: 2.2, sunPos: [9, 20, 11], exp: 1.08, night: 0.35, accent: C('#4de0ff') },
  alert:  { hemiS: C('#ffa89c'), hemiG: C('#8a4a55'), hemiI: 1.15, sun: C('#ff9080'), sunI: 1.8, sunPos: [9, 20, 11], exp: 1.05, night: 1.0,  accent: C('#ff4a4a') },
  dim:    { hemiS: C('#9a92e0'), hemiG: C('#5f5390'), hemiI: 1.0,  sun: C('#bdaeff'), sunI: 1.2, sunPos: [6, 18, 12], exp: 1.2,  night: 1.0,  accent: C('#c78bff') },
}
export const TOD_ORDER = ['auto', 'normal', 'alert', 'dim']

function spaceTexture() {
  return canvasTex(2048, 1024, (g, w, h) => {
    const r = rand(21)
    const bg = g.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#03041a'); bg.addColorStop(0.5, '#0a1034'); bg.addColorStop(1, '#03041a')
    g.fillStyle = bg; g.fillRect(0, 0, w, h)
    const nebula = ['rgba(150,80,255,', 'rgba(60,200,230,', 'rgba(255,90,170,', 'rgba(80,120,255,']
    for (let i = 0; i < 12; i++) {
      const x = r() * w, y = h * (0.2 + r() * 0.6), rad = 160 + r() * 260
      // drawn again one texture width to each side so it wraps around the seam (no hard edge)
      for (const dx of [-w, 0, w]) {
        const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad)
        gr.addColorStop(0, nebula[i % 4] + '0.22)'); gr.addColorStop(1, nebula[i % 4] + '0)')
        g.fillStyle = gr; g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2)
      }
    }
  })
}
function planetTexture(a, b, seed) {
  return canvasTex(512, 256, (g, w, h) => {
    const r = rand(seed)
    for (let y = 0; y < h; y += 6) {
      g.fillStyle = mix(a, b, 0.5 + 0.5 * Math.sin(y * 0.09 + r() * 1.5))
      g.fillRect(0, y, w, 6)
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 40, 3 + r() * 5, 0, 0, 7); g.fill() }
  })
}

// Hull outline (octagon) as a Shape; sy = -z because it is later rotated flat
function hullShape(scale = 1) {
  const s = new THREE.Shape()
  PLAN.forEach(([x, z], i) => { const px = x * scale, py = -z * scale; if (i === 0) s.moveTo(px, py); else s.lineTo(px, py) })
  s.closePath()
  return s
}

export function createWorld(scene, renderer) {
  const root = new THREE.Group()
  scene.add(root)
  scene.background = new THREE.Color('#03041a')

  // ----- Luci -----
  const hemi = new THREE.HemisphereLight('#c9dcff', '#7d89b3', 1.3)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight('#eaf2ff', 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = -19; sc.right = 19; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 80
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 5
  scene.add(sun, sun.target)
  const fill = new THREE.DirectionalLight('#9fb8ff', 0.4)
  fill.position.set(-10, 8, 14)
  scene.add(fill)

  // ----- Space: backdrop that follows the camera (as if infinitely far away) -----
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), new THREE.MeshBasicMaterial({ map: spaceTexture(), side: THREE.BackSide, fog: false }))
  scene.add(sky)
  const R = rand(5)
  const qDef = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(23.1, 33.9, 32.1), new THREE.Vector3(0, 0.8, 0.4), new THREE.Vector3(0, 1, 0)))
  const space = new THREE.Group()
  space.quaternion.copy(qDef)
  scene.add(space)
  const starPos = [], starCol = []
  const tints = [new THREE.Color('#ffffff'), new THREE.Color('#cfe0ff'), new THREE.Color('#ffe9c0'), new THREE.Color('#ffd0e0')]
  for (let i = 0; i < 4200; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, rr = Math.sqrt(1 - u * u)
    starPos.push(Math.cos(a) * rr * 170, u * 170, Math.sin(a) * rr * 170)
    const c = tints[Math.floor(R() * 4)].clone().multiplyScalar(0.45 + R() * 0.55)
    starCol.push(c.r, c.g, c.b)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starCol, 3))
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }))
  scene.add(stars)
  const giant = new THREE.Mesh(new THREE.SphereGeometry(11, 40, 24), new THREE.MeshStandardMaterial({ map: planetTexture('#e8946a', '#f5d0a0', 4), roughness: 1, emissive: '#e8946a', emissiveIntensity: 0.12 }))
  giant.position.set(-38, 24, -150)
  space.add(giant)
  const ring = new THREE.Mesh(new THREE.RingGeometry(15, 23, 80), new THREE.MeshBasicMaterial({ color: '#d9c7a0', transparent: true, opacity: 0.5, side: THREE.DoubleSide }))
  ring.rotation.set(1.1, 0, 0.35)
  ring.position.copy(giant.position)
  space.add(ring)
  const blue = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 20), new THREE.MeshStandardMaterial({ map: planetTexture('#3aa0d8', '#7be0c8', 8), roughness: 1, emissive: '#2a80c0', emissiveIntensity: 0.18 }))
  blue.position.set(46, 26, -165)
  space.add(blue)
  const halo = new THREE.Mesh(new THREE.SphereGeometry(7.6, 32, 20), new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.14, side: THREE.BackSide }))
  halo.position.copy(blue.position)
  space.add(halo)
  const moon = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), new THREE.MeshStandardMaterial({ color: '#b8bcc8', roughness: 1 }))
  moon.position.set(-4, 38, -165)
  space.add(moon)
  const asteroids = []
  const astMat = new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: 1, flatShading: true })
  for (let i = 0; i < 18; i++) {
    const a = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + R() * 1.8, 0), astMat)
    a.position.set(-150 + R() * 300, -60 + R() * 120, -90 - R() * 60)
    a.rotation.set(R() * 6, R() * 6, R() * 6)
    space.add(a)
    asteroids.push({ a, v: 0.5 + R() * 1.1, rx: (R() - 0.5) * 0.6, ry: (R() - 0.5) * 0.6 })
  }

  // ----- Materiali dello scafo -----
  const accentMat = new THREE.MeshStandardMaterial({ color: '#4de0ff', emissive: '#4de0ff', emissiveIntensity: 0.9, roughness: 0.4 })
  const floorTex = {} // one texture per deck, made once
  const floorMat = new THREE.MeshStandardMaterial({ map: (floorTex.bridge = FLOORS.bridge()), roughness: 0.55, metalness: 0.15 })
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: '#6f7ca8', roughness: 0.6, metalness: 0.35 })
  const wallMat = new THREE.MeshStandardMaterial({ color: '#3a4878', roughness: 0.7, metalness: 0.15 })
  const trimMat = new THREE.MeshStandardMaterial({ color: '#8da0cf', roughness: 0.5, metalness: 0.3 })
  const dadoMat = new THREE.MeshStandardMaterial({ color: '#27325a', roughness: 0.8 })
  const frameMat = new THREE.MeshStandardMaterial({ color: '#aab6d6', roughness: 0.4, metalness: 0.45 })
  const glassMat = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.1, transparent: true, opacity: 0.1, depthWrite: false })

  // ----- Platform: floor and hull edge, both octagonal -----
  const FLOOR_D = 0.3
  const floorGeo = new THREE.ExtrudeGeometry(hullShape(1), { depth: FLOOR_D, bevelEnabled: false })
  floorGeo.rotateX(-Math.PI / 2)
  const sideMat = new THREE.MeshStandardMaterial({ color: '#3a4670', roughness: 0.7, metalness: 0.2 })
  const floor = new THREE.Mesh(floorGeo, [floorMat, sideMat])
  floor.position.y = -FLOOR_D
  floor.receiveShadow = true
  floor.userData.isFloor = true
  root.add(floor)
  const HULL_D = 1.0
  const hullGeo = new THREE.ExtrudeGeometry(hullShape(1.035), { depth: HULL_D, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.16, bevelSegments: 2 })
  hullGeo.rotateX(-Math.PI / 2)
  const hull = new THREE.Mesh(hullGeo, hullMat)
  hull.position.y = -FLOOR_D - HULL_D - 0.14
  hull.castShadow = true; hull.receiveShadow = true
  root.add(hull)
  // path lights along the edge and beacon lights
  const rim = new THREE.Group()
  for (let i = 0; i < PLAN.length; i++) {
    const [x1, z1] = PLAN[i], [x2, z2] = PLAN[(i + 1) % PLAN.length]
    const len = Math.hypot(x2 - x1, z2 - z1) * 1.035
    const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.1), accentMat)
    s.position.set(((x1 + x2) / 2) * 1.04, -FLOOR_D - 0.02, ((z1 + z2) / 2) * 1.04)
    s.rotation.y = -Math.atan2(z2 - z1, x2 - x1)
    rim.add(s)
  }
  root.add(rim)
  const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow(0xff4a4a, 1.2))
  navRed.position.set(PLAN[7][0] * 1.04, -0.2, PLAN[7][1] * 1.04)
  const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow(0x4aff8a, 1.2))
  navGreen.position.set(PLAN[2][0] * 1.04, -0.2, PLAN[2][1] * 1.04)
  root.add(navRed, navGreen)

  // ----- Paneled walls with round portholes -----
  const H = ROOM.wallH
  function panelGeo(L, holes) {
    const s = new THREE.Shape()
    s.moveTo(-L / 2, 0); s.lineTo(L / 2, 0); s.lineTo(L / 2, H); s.lineTo(-L / 2, H); s.closePath()
    for (const h of holes) { const p = new THREE.Path(); p.absarc(h.x, h.y, h.r, 0, Math.PI * 2, true); s.holes.push(p) }
    const g = new THREE.ExtrudeGeometry(s, { depth: WALL_T, bevelEnabled: false, curveSegments: 28 })
    g.translate(0, 0, -WALL_T / 2)
    return g
  }
  function porthole(g, cx, cy, r) {
    const z = WALL_T / 2
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(r + 0.07, 0.1, 10, 36), frameMat)
    ringM.position.set(cx, cy, z + 0.02); ringM.castShadow = true; g.add(ringM)
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r, 36), glassMat)
    glass.position.set(cx, cy, 0.02); g.add(glass)
    const halo = new THREE.Mesh(new THREE.TorusGeometry(r + 0.32, 0.025, 6, 44), accentMat)
    halo.position.set(cx, cy, z + 0.03); g.add(halo)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), frameMat)
      b.position.set(cx + Math.cos(a) * (r + 0.07), cy + Math.sin(a) * (r + 0.07), z + 0.1); g.add(b)
    }
  }
  function hatch(g, cx, cy, r) {
    const z = WALL_T / 2
    const hatchMat = mat('#7a869e')
    const door = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.14, 40), hatchMat); door.rotation.x = Math.PI / 2; door.position.set(cx, cy, z + 0.07); door.castShadow = true; g.add(door)
    const fr = new THREE.Mesh(new THREE.TorusGeometry(r + 0.06, 0.1, 10, 40), frameMat); fr.position.set(cx, cy, z + 0.04); g.add(fr)
    const hal = new THREE.Mesh(new THREE.TorusGeometry(r + 0.32, 0.025, 6, 44), accentMat); hal.position.set(cx, cy, z + 0.03); g.add(hal)
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), glow(0x6af0ff, 0.5)); win.position.set(cx, cy + 0.38, z + 0.16); g.add(win)
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 28), frameMat); wheel.position.set(cx, cy - 0.28, z + 0.2); g.add(wheel)
    for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), frameMat); sp.position.set(cx, cy - 0.28, z + 0.2); sp.rotation.z = (i * Math.PI) / 3; g.add(sp) }
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), mat(i % 2 ? '#2a2e38' : '#f2c14e')); t.position.set(cx - r + 0.2 + i * 0.2 * (r / 0.7), cy - r + 0.22, z + 0.16); g.add(t) }
  }
  // A wall panel along the axis between two hull vertices
  function wallPanel(i, holes, extra) {
    const [x1, z1] = PLAN[i], [x2, z2] = PLAN[(i + 1) % PLAN.length]
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
    let nx = -(z2 - z1), nz = x2 - x1 // normale all'asse
    const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl
    if (nx * -mx + nz * -mz < 0) { nx = -nx; nz = -nz } // toward the inside
    const L = Math.hypot(x2 - x1, z2 - z1)
    const g = new THREE.Group()
    const pm = new THREE.Mesh(panelGeo(L, holes), wallMat); pm.castShadow = true; pm.receiveShadow = true; g.add(pm)
    for (const h of holes) { if (h.hatch) hatch(g, h.x, h.y, h.r); else porthole(g, h.x, h.y, h.r) }
    const add = (w, hh, d, x, y, z, m) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); k.position.set(x, y, z); k.castShadow = true; k.receiveShadow = true; g.add(k) }
    add(L, 0.22, 0.06, 0, 0.11, WALL_T / 2 + 0.03, trimMat)
    add(L, 0.95, 0.04, 0, 0.5, WALL_T / 2 + 0.02, dadoMat)
    add(L, 0.06, 0.08, 0, 1.0, WALL_T / 2 + 0.04, accentMat)
    add(L, 0.16, 0.6, 0, H - 0.08, WALL_T / 2 + 0.26, trimMat) // frame that sticks out toward the inside
    add(L, 0.04, 0.4, 0, H - 0.18, WALL_T / 2 + 0.3, accentMat)
    if (extra) extra(g, L)
    bakeShared(g)
    g.position.set(mx - nx * WALL_T / 2, 0, mz - nz * WALL_T / 2)
    g.rotation.y = Math.atan2(nx, nz)
    root.add(g)
    return g
  }
  // pilastri strutturali ai vertici
  function pillar(i) {
    const [x, z] = PLAN[i]
    const g = new THREE.Group()
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, H + 0.2, 0.5), trimMat); p.position.y = (H + 0.2) / 2; p.castShadow = true; p.receiveShadow = true; g.add(p)
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, H - 0.6, 0.1), accentMat); l.position.set(0, H / 2, 0); g.add(l)
    g.position.set(x * 0.985, 0, z * 0.985)
    root.add(g)
  }
  const back = wallPanel(0, [{ x: -8, y: 2.35, r: 0.95 }, { x: 0, y: 2.35, r: 0.95 }, { x: 8, y: 2.35, r: 0.95 }])
  wallPanel(1, [{ x: 0, y: 2.35, r: 0.85 }])
  wallPanel(6, [{ x: -3.3, y: 2.35, r: 0.9 }, { x: 3.3, y: 2.35, r: 0.9 }])
  wallPanel(7, [{ x: 0, y: 1.55, r: 0.95, hatch: true }])
  for (const i of [0, 1, 2, 6, 7]) pillar(i)
  void back

  // ----- Rooftop superstructures and wing with solar panels -----
  const roof = new THREE.Group()
  const gear = (parent, fn) => { fn(parent) }
  gear(roof, (g) => {
    const metal = mat('#8a93b0'), dark = mat('#2a3150')
    // parabola
    const mast = cyl(g, 0.1, 0.14, 1.6, '#58648a', -8.4, 0.8, 0, 10)
    void mast
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 10, 0, Math.PI * 2, Math.PI - 1.0, 1.0), new THREE.MeshStandardMaterial({ color: '#dfe6f8', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }))
    dish.position.set(-8.4, 2.1, 0.1); dish.rotation.set(0.75, 0.4, 0); dish.castShadow = true; g.add(dish)
    cyl(g, 0.04, 0.04, 0.9, '#58648a', -8.4, 2.5, 0.6, 6).rotation.x = 0.9
    // antennas with light
    for (const [x, h] of [[-4.2, 2.6], [-3.6, 1.8], [-3.0, 3.2]]) {
      cyl(g, 0.035, 0.05, h, '#aab6d6', x, h / 2, 0.1, 6)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow(h > 3 ? 0xff4a4a : 0x4de0ff, 1.2)); tip.position.set(x, h + 0.05, 0.1); g.add(tip)
    }
    // serbatoi
    for (const x of [1.6, 3.1]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 18), metal); t.rotation.z = Math.PI / 2; t.position.set(x + 1.2, 0.6, 0); t.castShadow = true; g.add(t) }
    box(g, 0.2, 0.9, 1.0, '#2a3150', 3.9, 0.45, 0, 0.04)
    // modulo sensori
    box(g, 1.8, 0.7, 1.2, '#cfd8ee', 8.2, 0.35, 0, 0.1)
    box(g, 1.2, 0.3, 0.9, '#2a3150', 8.2, 0.85, 0, 0.06)
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow(0xffc65a, 1.0)); lens.position.set(8.2, 1.1, 0.5); g.add(lens)
    void dark
  })
  roof.position.set(0, H + 0.1, -HZ - 0.05)
  bakeShared(roof)
  root.add(roof)
  // ala destra
  const wing = new THREE.Group()
  const solar = new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.35, metalness: 0.4 })
  solar.map.repeat.set(2, 1)
  const slab = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 4.4), [hullMat, hullMat, solar, hullMat, hullMat, hullMat])
  slab.position.set(4.2, 0, 0); slab.castShadow = true; slab.receiveShadow = true; wing.add(slab)
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.4), hullMat); pylon.position.set(0.6, 0, 0); pylon.castShadow = true; wing.add(pylon)
  for (const z of [-2.1, 2.1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.14, 0.14), frameMat); st.position.set(4.2, 0.1, z); wing.add(st) }
  const tipLight = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), glow(0x4aff8a, 1.3)); tipLight.position.set(7.6, 0.2, -2.2); wing.add(tipLight)
  wing.position.set(HX + 0.2, -0.45, -2.6); wing.rotation.y = -0.2
  root.add(wing)

  // ----- Static decorations per deck -----
  let decor = new THREE.Group()
  root.add(decor)
  function wallScreen(g, x, y, z, w, h, ry, color) {
    const s = new THREE.Group()
    box(s, w + 0.1, h + 0.1, 0.07, '#1a2040', 0, 0, 0, 0.03)
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow(color, 0.55)); p.position.z = 0.04; s.add(p)
    for (let i = 0; i < 5; i++) {
      const lw = w * (0.25 + 0.12 * ((i * 3) % 5))
      const l = new THREE.Mesh(new THREE.PlaneGeometry(lw, 0.05), mat('#f4fbff'))
      l.position.set(-w / 2 + 0.12 + lw / 2, h / 2 - 0.14 - i * h * 0.17, 0.045)
      s.add(l)
    }
    s.position.set(x, y, z); s.rotation.y = ry
    g.add(s)
  }
  function gauge(g, x, y, z, ry, color = 0xffc65a) {
    const s = new THREE.Group()
    cyl(s, 0.28, 0.28, 0.08, '#2a3150', 0, 0, 0, 24).rotation.x = Math.PI / 2
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.23, 24), glow(color, 0.6)); face.position.z = 0.045; s.add(face)
    box(s, 0.02, 0.2, 0.01, '#222a48', 0, 0.03, 0.05, 0.005).rotation.z = -0.7
    s.position.set(x, y, z); s.rotation.y = ry
    g.add(s)
  }
  function buildDecor(name) {
    root.remove(decor)
    disposeGroup(decor) // its geometries, materials and glowing screens (which the light loop updates every frame)
    decor = new THREE.Group()
    root.add(decor)
    const zb = -HZ + 0.06, xl = -HX + 0.06
    if (name === 'bridge') {
      wallScreen(decor, -4, 2.45, zb + 0.04, 1.9, 1.0, 0, 0x4de0ff)
      wallScreen(decor, 4, 2.45, zb + 0.04, 1.9, 1.0, 0, 0x6dffb0)
      wallScreen(decor, xl + 0.04, 2.4, 0, 1.8, 1.0, Math.PI / 2, 0xff7ad9)
      wallScreen(decor, -10.0, 2.6, zb + 0.04, 1.1, 0.8, 0, 0xffc65a)
      wallScreen(decor, 10.0, 2.6, zb + 0.04, 1.1, 0.8, 0, 0xb08cff)
      const em = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.32, 48), new THREE.MeshBasicMaterial({ color: '#4de0ff', transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
      em.rotation.x = -Math.PI / 2; em.position.set(0, 0.013, 0.2)
      decor.add(em)
    } else if (name === 'engine') {
      cyl(decor, 0.14, 0.14, 21, '#8a93a8', 0, 3.6, zb + 0.22, 14).rotation.z = Math.PI / 2
      cyl(decor, 0.1, 0.1, 21, '#e0872e', 0, 3.2, zb + 0.2, 12).rotation.z = Math.PI / 2
      for (const x of [-9, -3, 3, 9]) cyl(decor, 0.18, 0.18, 0.2, '#58648a', x, 3.6, zb + 0.22, 14).rotation.z = Math.PI / 2
      cyl(decor, 0.14, 0.14, 11, '#8a93a8', xl + 0.2, 3.6, 0, 14).rotation.x = Math.PI / 2
      for (const x of [-4, 4]) gauge(decor, x, 2.4, zb + 0.06, 0)
      gauge(decor, xl + 0.06, 2.5, 0, Math.PI / 2, 0x6dffb0)
      for (let i = 0; i < 4; i++) { box(decor, 0.8, 0.07, 0.05, '#1a2038', -10.2, 1.3 + i * 0.16, zb + 0.04, 0.02); box(decor, 0.8, 0.07, 0.05, '#1a2038', 10.2, 1.3 + i * 0.16, zb + 0.04, 0.02) }
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), mat(i % 2 ? '#2a2e38' : '#f2c14e'))
        s.rotation.x = -Math.PI / 2; s.position.set(-11.55 + i * 1.7, 0.013, ROOM.d / 2 - 0.4); s.receiveShadow = true
        decor.add(s)
      }
    } else {
      box(decor, 1.6, 1.1, 0.06, '#e3ede8', 4, 2.6, zb + 0.04, 0.02)
      box(decor, 1.7, 1.2, 0.05, '#4aa8a0', 4, 2.6, zb + 0.02, 0.03)
      const pl = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), mat('#e8946a')); pl.position.set(3.9, 2.62, zb + 0.075); decor.add(pl)
      const pr = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.5, 30), mat('#d9c7a0')); pr.position.set(3.9, 2.62, zb + 0.076); pr.rotation.x = 1.2; decor.add(pr)
      sph(decor, 0.06, '#ffffff', 4.4, 2.9, zb + 0.08)
      box(decor, 2.2, 0.08, 0.38, '#7da39b', -4, 2.0, zb + 0.18, 0.03)
      for (const [x, c] of [[-4.6, '#4fd07a'], [-4, '#7be092'], [-3.4, '#34c07a']]) { cyl(decor, 0.11, 0.09, 0.2, '#eef3ff', x, 2.14, zb + 0.18, 12); sph(decor, 0.14, c, x, 2.34, zb + 0.18) }
      for (let i = 0; i < 14; i++) {
        const bulb = sph(decor, 0.07, '#ffffff', -9.8 + i * 1.5, 3.9 - (i % 2) * 0.1, zb + 0.12)
        bulb.material = glow(i % 3 === 0 ? 0xff9ff3 : i % 3 === 1 ? 0x6dffb0 : 0xffd27a, 0.7)
      }
      wallScreen(decor, xl + 0.04, 2.4, 0, 1.6, 0.9, Math.PI / 2, 0x6dffb0)
    }
    bakeShared(decor)
  }

  // ----- Scene state -----
  let sceneName = 'bridge'
  function setScene(name) {
    sceneName = name
    const th = THEMES[name]
    floorMat.map = floorTex[name] ??= FLOORS[name]()
    floorMat.needsUpdate = true
    wallMat.color.set(th.wall); trimMat.color.set(th.trim); dadoMat.color.set(th.dado)
    sideMat.color.set(th.side); hullMat.color.set(th.hull)
    buildDecor(name)
  }
  setScene('bridge')

  // ----- Light modes -----
  let mode = 'auto'
  let alert = false
  let target = MODES.normal
  const cur = {
    hemiS: MODES.normal.hemiS.clone(), hemiG: MODES.normal.hemiG.clone(), sun: MODES.normal.sun.clone(), accent: MODES.normal.accent.clone(),
    sunI: 2.2, hemiI: 1.3, exp: 1.08, night: 0.35, sunPos: new THREE.Vector3(...MODES.normal.sunPos),
  }
  function resolveTarget() {
    const name = mode === 'auto' ? (alert ? 'alert' : 'normal') : mode
    target = MODES[name]
    return name
  }
  resolveTarget()
  function setTOD(m) { mode = m; return resolveTarget() }
  function cycleTOD() { const i = TOD_ORDER.indexOf(mode); mode = TOD_ORDER[(i + 1) % TOD_ORDER.length]; resolveTarget(); return mode }
  function setAlert(b) { if (alert !== b) { alert = b; resolveTarget() } }

  const sunTarget = new THREE.Vector3()
  function update(dt, t, camera) {
    if (camera) { space.position.copy(camera.position); sky.position.copy(camera.position); stars.position.copy(camera.position) }
    const k = 1 - Math.exp(-dt * 3)
    for (const key of ['hemiS', 'hemiG', 'sun', 'accent']) cur[key].lerp(target[key], k)
    cur.sunI += (target.sunI - cur.sunI) * k
    cur.hemiI += (target.hemiI - cur.hemiI) * k
    cur.exp += (target.exp - cur.exp) * k
    cur.night += (target.night - cur.night) * k
    cur.sunPos.lerp(sunTarget.set(...target.sunPos), k)
    sun.color.copy(cur.sun); sun.intensity = cur.sunI
    sun.position.copy(cur.sunPos).multiplyScalar(1.5); sun.target.position.set(0, 0, 0)
    hemi.color.copy(cur.hemiS); hemi.groundColor.copy(cur.hemiG); hemi.intensity = cur.hemiI
    renderer.toneMappingExposure = cur.exp
    const pulse = alert && mode === 'auto' || mode === 'alert' ? 0.75 + 0.25 * Math.sin(t * 6) : 1
    accentMat.color.copy(cur.accent); accentMat.emissive.copy(cur.accent)
    accentMat.emissiveIntensity = (0.55 + cur.night * 0.9) * pulse
    for (const { m, base } of glowMats) m.emissiveIntensity = base * (0.7 + cur.night * 0.9)
    // beacon lights that blink slowly
    const blink = Math.sin(t * 3) > 0.2 ? 1 : 0.15
    navRed.material.emissiveIntensity = 1.4 * blink
    navGreen.material.emissiveIntensity = 1.4 * (Math.sin(t * 3 + 1.5) > 0.2 ? 1 : 0.15)
    tipLight.material.emissiveIntensity = 1.4 * (Math.sin(t * 3 + 1.5) > 0.2 ? 1 : 0.15)

    sky.rotation.y += dt * 0.002
    stars.rotation.y += dt * 0.0015
    giant.rotation.y += dt * 0.01; blue.rotation.y -= dt * 0.02; halo.rotation.y = blue.rotation.y
    for (const s of asteroids) {
      s.a.position.x += s.v * dt
      if (s.a.position.x > 150) s.a.position.x = -150
      s.a.rotation.x += s.rx * dt; s.a.rotation.y += s.ry * dt
    }
  }

  return { root, floor, setScene, setTOD, cycleTOD, setAlert, update, get tod() { return mode }, get scene() { return sceneName } }
}

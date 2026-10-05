// Shared helpers: cached materials, rounded "toy" shapes, soft contact shadows.
import * as THREE from 'three'
export { THREE }

const mats = new Map()
export function mat(color, o = {}) {
  const key = [color, o.emissive ?? '', o.emissiveIntensity ?? '', o.opacity ?? '', o.rough ?? '', o.metal ?? ''].join('|')
  let m = mats.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.opacity !== undefined && o.opacity < 1,
      opacity: o.opacity ?? 1,
    })
    mats.set(key, m)
  }
  return m
}

// Glowing materials (lamps, screens): the brightness follows the day/evening cycle.
export const glowMats = []
export function glow(color, base = 1) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: base, roughness: 0.6 })
  glowMats.push({ m, base })
  return m
}

const geos = new Map()
function cached(key, make) {
  let g = geos.get(key)
  if (!g) { g = make(); geos.set(key, g) }
  return g
}

// Box with rounded edges ("toy" look)
export function rboxGeo(w, h, d, r = 0.05) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)
  return cached(`rb${w}|${h}|${d}|${r}`, () => {
    const hw = w / 2 - r, hh = h / 2 - r
    const s = new THREE.Shape()
    s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: w * h * d < 0.05 ? 1 : 2, curveSegments: 1 })
    g.translate(0, 0, -(d - 2 * r) / 2)
    return g
  })
}

function place(m, x, y, z, shadow = true) {
  m.position.set(x, y, z)
  m.castShadow = shadow
  m.receiveShadow = true
  return m
}

export function box(parent, w, h, d, color, x = 0, y = 0, z = 0, r = 0.05, material) {
  const m = place(new THREE.Mesh(rboxGeo(w, h, d, r), material ?? mat(color)), x, y, z)
  parent.add(m)
  return m
}
export function cyl(parent, rt, rb, h, color, x = 0, y = 0, z = 0, seg = 20, material) {
  const m = place(new THREE.Mesh(cached(`cy${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), material ?? mat(color)), x, y, z)
  parent.add(m)
  return m
}
export function sph(parent, r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, material) {
  // fewer polygons for small spheres (not noticeable, much lighter)
  const [ws, hs] = r > 0.3 ? [20, 14] : r > 0.1 ? [14, 10] : [9, 6]
  const m = place(new THREE.Mesh(cached(`sp${r}`, () => new THREE.SphereGeometry(r, ws, hs)), material ?? mat(color)), x, y, z)
  m.scale.set(sx, sy, sz)
  parent.add(m)
  return m
}
export function cone(parent, r, h, color, x = 0, y = 0, z = 0, seg = 16) {
  const m = place(new THREE.Mesh(cached(`co${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), mat(color)), x, y, z)
  parent.add(m)
  return m
}
export function torus(parent, r, t, color, x = 0, y = 0, z = 0) {
  const m = place(new THREE.Mesh(cached(`to${r}|${t}`, () => new THREE.TorusGeometry(r, t, 10, 24)), mat(color)), x, y, z)
  parent.add(m)
  return m
}
export function capsule(parent, r, len, color, x = 0, y = 0, z = 0) {
  const m = place(new THREE.Mesh(cached(`ca${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10)), mat(color)), x, y, z)
  parent.add(m)
  return m
}

// Soft contact shadow (fake ambient occlusion)
let blobTex = null
function blobTexture() {
  if (blobTex) return blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62)
  grd.addColorStop(0, 'rgba(60,35,20,0.55)')
  grd.addColorStop(0.6, 'rgba(60,35,20,0.22)')
  grd.addColorStop(1, 'rgba(60,35,20,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  blobTex = new THREE.CanvasTexture(c)
  blobTex.colorSpace = THREE.SRGBColorSpace
  return blobTex
}
const blobMat = () => cached('blobmat', () => new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }))
export function blob(w, d, y = 0.012) {
  const m = new THREE.Mesh(cached(`bl${w}|${d}`, () => new THREE.PlaneGeometry(w, d)), blobMat())
  m.rotation.x = -Math.PI / 2
  m.position.y = y
  m.renderOrder = 1
  return m
}

export const rand = (seed) => { // generatore deterministico semplice
  let s = seed >>> 0 || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// Frees the glowing materials of a removed object (cached ones are shared and stay).
export function disposeGroup(g) {
  g.traverse((o) => {
    const m = o.material
    if (!m) return
    const i = glowMats.findIndex((x) => x.m === m)
    if (i >= 0) { glowMats.splice(i, 1); m.dispose() }
  })
}

// ---------- Merging static meshes (fewer draw calls) ----------
// Merges all opaque, non-glowing meshes under `root` into a single mesh with per-vertex colors.
// Transparent meshes, glowing ones or those excluded by `skip` stay separate.
const vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
export function bake(root, skip = () => false) {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const list = []
  root.traverse((o) => {
    const m = o.material
    if (o.isMesh && !Array.isArray(m) && m && m.isMeshStandardMaterial && !m.transparent && m.emissive.getHex() === 0 && !m.map && !skip(o)) list.push(o)
  })
  if (list.length < 2) return
  let vc = 0, ic = 0
  for (const o of list) { const g = o.geometry; vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3)
  const idx = new Uint32Array(ic)
  const v = new THREE.Vector3(), n = new THREE.Vector3()
  let vo = 0, io = 0
  for (const o of list) {
    const g = o.geometry, p = g.attributes.position, nn = g.attributes.normal
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    const c = o.material.color
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m)
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z
      if (nn) n.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize(); else n.set(0, 1, 0)
      nor[(vo + i) * 3] = n.x; nor[(vo + i) * 3 + 1] = n.y; nor[(vo + i) * 3 + 2] = n.z
      col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo }
    else { for (let i = 0; i < p.count; i++) idx[io++] = vo + i }
    vo += p.count
    o.parent.remove(o)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  geo.computeBoundingSphere()
  const mesh = new THREE.Mesh(geo, vertexMat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  root.add(mesh)
}

// Merges the meshes that share the SAME material (the material stays, so colors remain editable).
export function bakeShared(root, skip = () => false) {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map()
  root.traverse((o) => {
    if (o.isMesh && o.material && !Array.isArray(o.material) && o.geometry.attributes.normal && !skip(o)) {
      if (!groups.has(o.material)) groups.set(o.material, [])
      groups.get(o.material).push(o)
    }
  })
  const v = new THREE.Vector3(), n = new THREE.Vector3()
  for (const [material, list] of groups) {
    if (list.length < 2) continue
    let vc = 0, ic = 0
    for (const o of list) { const g = o.geometry; vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), idx = new Uint32Array(ic)
    let vo = 0, io = 0
    for (const o of list) {
      const g = o.geometry, p = g.attributes.position, nn = g.attributes.normal
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
      const nm = new THREE.Matrix3().getNormalMatrix(m)
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m)
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z
        n.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize()
        nor[(vo + i) * 3] = n.x; nor[(vo + i) * 3 + 1] = n.y; nor[(vo + i) * 3 + 2] = n.z
      }
      if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo }
      else { for (let i = 0; i < p.count; i++) idx[io++] = vo + i }
      vo += p.count
      o.parent.remove(o)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))
    geo.computeBoundingSphere()
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = list[0].castShadow
    mesh.receiveShadow = list[0].receiveShadow
    root.add(mesh)
  }
}

// "Hologram" material: translucent and glowing, follows the ship light mode.
export function holo(color, base = 0.9, opacity = 0.5) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: base, roughness: 0.4, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
  glowMats.push({ m, base })
  return m
}

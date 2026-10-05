// Particelle a sprite con pool: stelline, Zzz, nuvolette, punto esclamativo.
import { THREE } from './lib.js'

function makeTex(draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  draw(c.getContext('2d'))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const TEX = {
  star: () => makeTex((g) => {
    g.fillStyle = '#ffe27a'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath()
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 27, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r) }
    g.closePath(); g.fill(); g.stroke()
  }),
  puff: () => makeTex((g) => {
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 28)
    grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64)
  }),
  zzz: () => makeTex((g) => {
    g.font = '800 44px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.strokeText('Z', 32, 34); g.fillStyle = '#6a8fd8'; g.fillText('Z', 32, 34)
  }),
  alert: () => makeTex((g) => {
    g.fillStyle = '#ff6a5a'; g.strokeStyle = '#fff'; g.lineWidth = 4
    g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.fill(); g.stroke()
    g.fillStyle = '#fff'; g.font = '900 36px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 32, 34)
  }),
  heart: () => makeTex((g) => {
    g.fillStyle = '#ff7a9a'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath()
    g.moveTo(32, 52); g.bezierCurveTo(4, 32, 14, 8, 32, 22); g.bezierCurveTo(50, 8, 60, 32, 32, 52); g.fill(); g.stroke()
  }),
}

export function createFx(scene) {
  const textures = {}
  const mats = {}
  const get = (kind) => {
    if (!mats[kind]) {
      textures[kind] = TEX[kind]()
      mats[kind] = new THREE.SpriteMaterial({ map: textures[kind], transparent: true, depthWrite: false })
    }
    return mats[kind]
  }
  const live = []
  const free = []

  function emit(kind, pos, o = {}) {
    let s = free.pop()
    if (!s) { s = new THREE.Sprite(); scene.add(s) }
    s.material = get(kind).clone()
    s.material.opacity = 1
    s.visible = true
    s.position.copy(pos)
    s.renderOrder = 10
    const size = o.size ?? 0.35
    s.scale.setScalar(size)
    live.push({ s, vel: o.vel ?? new THREE.Vector3(0, 0.6, 0), life: o.life ?? 1.2, age: 0, size, grow: o.grow ?? 0, spin: o.spin ?? 0, wob: o.wob ?? 0, ph: Math.random() * 6 })
  }

  return {
    emit,
    burst(kind, pos, n = 8, speed = 2.2, size = 0.3) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
        emit(kind, pos, { vel: new THREE.Vector3(Math.cos(a) * speed, 1.4 + Math.random() * 1.2, Math.sin(a) * speed), life: 0.9 + Math.random() * 0.4, size, spin: 3 })
      }
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i]
        p.age += dt
        const k = p.age / p.life
        if (k >= 1) { p.s.visible = false; p.s.material.dispose(); free.push(p.s); live.splice(i, 1); continue }
        p.s.position.addScaledVector(p.vel, dt)
        if (p.wob) p.s.position.x += Math.sin(p.age * 4 + p.ph) * p.wob * dt
        p.vel.y -= (p.spin ? 4.5 : 0) * dt
        p.s.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3
        const sc = p.size * (1 + p.grow * k)
        p.s.scale.setScalar(sc)
        if (p.spin) p.s.material.rotation += p.spin * dt
      }
    },
  }
}

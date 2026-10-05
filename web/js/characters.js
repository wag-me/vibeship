// Procedural 3D residents (fox, cat, dog, raccoon, rabbit, bear, bird) in space crew uniforms.
// The character faces +z. root.position is on the floor.
import { THREE, mat, sph, cone, capsule, cyl, box, torus, blob, bake, glow, holo } from './lib.js'

export const SPECIES = {
  fox:     { label: 'Fox',     fur: '#f08a3c', belly: '#fff1dc', dark: '#5a3a2a', ears: 'point', snout: 'long',  tail: 'bushy', tailTip: '#fff1dc' },
  cat:     { label: 'Cat',     fur: '#f2a65a', belly: '#fff1dc', dark: '#8a5a32', ears: 'point', snout: 'short', tail: 'thin' },
  dog:     { label: 'Dog',      fur: '#d3a77b', belly: '#fff4e6', dark: '#7a5236', ears: 'floppy', snout: 'round', tail: 'short' },
  raccoon: { label: 'Raccoon',  fur: '#a5a7b5', belly: '#eceef3', dark: '#454859', ears: 'round', snout: 'round', tail: 'ring',  mask: true },
  rabbit:  { label: 'Rabbit',  fur: '#f4ece6', belly: '#ffffff', dark: '#d9a5a5', ears: 'long',  snout: 'short', tail: 'pom' },
  bear:    { label: 'Bear',      fur: '#b07a52', belly: '#e6c7a0', dark: '#6a4630', ears: 'round', snout: 'round', tail: 'pom' },
  bird:    { label: 'Bird', fur: '#6db6e8', belly: '#f4fbff', dark: '#2f6a9a', ears: 'tuft',  snout: 'beak',  tail: 'feather' },
}
export const SPECIES_IDS = Object.keys(SPECIES)
// Crew uniforms: suit, pants, accent color and head accessory
export const OUTFITS = [
  { id: 'captain',   name: 'Captain',    suit: '#d94a4a', pants: '#2b2f4a', accent: '#f2c14e', head: 'cap',     pack: false },
  { id: 'engineer',  name: 'Engineer',   suit: '#f08a2e', pants: '#5a5f6a', accent: '#ffd24a', head: 'goggles', belt: true },
  { id: 'pilot',     name: 'Pilot',      suit: '#3f7ad9', pants: '#2a3d6a', accent: '#e8f1ff', head: 'helmet',  pack: true },
  { id: 'scientist', name: 'Scientist',  suit: '#f4f7fb', pants: '#7e8aa0', accent: '#6fd0c5', head: 'antenna', coat: true },
  { id: 'medic',     name: 'Medic',      suit: '#46c6b4', pants: '#2d6e66', accent: '#ffffff', head: 'mirror',  cross: true },
  { id: 'explorer',  name: 'Explorer', suit: '#6aa84f', pants: '#4a5a3a', accent: '#c9e265', head: 'visor',   pack: true, belt: true },
  { id: 'cadet',     name: 'Cadet',     suit: '#8e6bd6', pants: '#3a2f66', accent: '#ff9fb2', head: 'beanie',  jet: true },
]
export const SHIRTS = OUTFITS.map((o) => o.suit)

const S = 1.0 // scala generale

export function createCharacter(speciesId, shirtIndex = 0) {
  const sp = SPECIES[speciesId] ?? SPECIES.cat
  const outfit = OUTFITS[shirtIndex % OUTFITS.length]
  const shirt = outfit.suit
  const root = new THREE.Group()
  const rig = new THREE.Group() // scalato
  rig.scale.setScalar(S)
  root.add(rig)

  const shadow = blob(1.0, 1.0)
  root.add(shadow)

  // Pelvis: pivot for bob / sitting
  const body = new THREE.Group()
  body.position.y = 0.5
  rig.add(body)

  const torso = new THREE.Group()
  torso.position.y = 0.28
  body.add(torso)
  sph(torso, 0.34, shirt, 0, 0, 0, 1, 1.08, 0.88)
  // suit details
  torus(torso, 0.2, 0.05, outfit.accent, 0, 0.3, 0.03).rotation.x = Math.PI / 2 // neck ring
  box(torso, 0.16, 0.11, 0.03, outfit.accent, 0, 0.06, 0.3, 0.012) // chest panel
  box(torso, 0.05, 0.05, 0.035, '#2a3150', -0.03, 0.06, 0.31, 0.01)
  if (outfit.cross) { box(torso, 0.2, 0.06, 0.035, '#ff5a6a', 0, 0.06, 0.33, 0.012); box(torso, 0.06, 0.2, 0.035, '#ff5a6a', 0, 0.06, 0.33, 0.012) }
  if (outfit.belt) cyl(torso, 0.3, 0.3, 0.07, outfit.accent, 0, -0.21, 0, 18)
  if (outfit.coat) { sph(torso, 0.33, shirt, 0, -0.26, 0, 1.08, 0.62, 0.92); box(torso, 0.04, 0.5, 0.03, outfit.accent, 0, -0.18, 0.31, 0.01) }
  if (outfit.pack) { box(torso, 0.34, 0.4, 0.16, '#58648a', 0, 0.02, -0.34, 0.05); for (const sx of [-1, 1]) cyl(torso, 0.07, 0.07, 0.34, outfit.accent, sx * 0.1, 0.06, -0.46, 10) }
  if (outfit.jet) {
    box(torso, 0.36, 0.34, 0.16, '#3a3f60', 0, 0.02, -0.34, 0.05)
    for (const sx of [-1, 1]) { cyl(torso, 0.08, 0.1, 0.4, '#8a93a8', sx * 0.11, 0.04, -0.46, 12); cone(torso, 0.07, 0.14, outfit.accent, sx * 0.11, -0.2, -0.46, 10).rotation.x = Math.PI }
  }

  // Testa
  const head = new THREE.Group()
  head.position.y = 0.82
  body.add(head)
  sph(head, 0.38, sp.fur, 0, 0, 0, 1.1, 0.95, 0.96)
  // muso
  if (sp.snout === 'long') { sph(head, 0.17, sp.belly, 0, -0.08, 0.33, 0.9, 0.8, 1.2); sph(head, 0.045, '#2a2a30', 0, -0.04, 0.5) }
  else if (sp.snout === 'beak') { cone(head, 0.1, 0.22, '#f5a53a', 0, -0.05, 0.42).rotation.x = Math.PI / 2 }
  else { sph(head, 0.16, sp.belly, 0, -0.11, 0.3, 1, 0.75, 0.9); sph(head, 0.04, sp.snout === 'short' ? '#f08a98' : '#2a2a30', 0, -0.06, 0.4) }
  // guance
  for (const sx of [-1, 1]) {
    sph(head, 0.075, '#fba8b4', sx * 0.25, -0.1, 0.27, 1, 0.7, 0.4)
  }
  // occhi
  for (const sx of [-1, 1]) {
    sph(head, 0.062, '#2a1f1f', sx * 0.14, 0.05, 0.34, 0.9, 1.15, 0.6)
    sph(head, 0.02, '#ffffff', sx * 0.14 + 0.02, 0.09, 0.385)
  }
  if (sp.mask) for (const sx of [-1, 1]) sph(head, 0.11, sp.dark, sx * 0.15, 0.04, 0.3, 1.2, 0.8, 0.5)
  // orecchie
  const ears = []
  const ear = (fn) => { for (const sx of [-1, 1]) { const g = new THREE.Group(); g.position.set(sx * 0.2, 0.28, 0); fn(g, sx); head.add(g); ears.push(g) } }
  if (sp.ears === 'point') ear((g, sx) => { const c = cone(g, 0.13, 0.28, sp.fur, 0, 0.1, 0, 4); c.rotation.z = -sx * 0.25; cone(g, 0.07, 0.17, '#f7b6bb', 0, 0.08, 0.04, 4).rotation.z = -sx * 0.25 })
  if (sp.ears === 'round') ear((g, sx) => { sph(g, 0.12, sp.fur, sx * 0.04, 0.06, 0); sph(g, 0.065, sp.dark, sx * 0.04, 0.06, 0.06, 1, 1, 0.5) })
  if (sp.ears === 'floppy') ear((g, sx) => { const e = sph(g, 0.13, sp.dark, sx * 0.1, -0.12, 0, 0.7, 1.5, 0.6); e.rotation.z = sx * 0.25 })
  if (sp.ears === 'long') ear((g, sx) => { const e = capsule(g, 0.07, 0.38, sp.fur, 0, 0.3, 0); e.rotation.z = -sx * 0.12; const i = capsule(g, 0.035, 0.3, '#f7b6bb', 0, 0.3, 0.05); i.rotation.z = -sx * 0.12 })
  if (sp.ears === 'tuft') { const t = cone(head, 0.07, 0.2, sp.dark, 0, 0.4, 0.02, 6); t.rotation.x = -0.3 }

  // head accessory, depending on the uniform
  if (outfit.head === 'cap') {
    cyl(head, 0.3, 0.33, 0.13, shirt, 0, 0.32, 0, 18)
    box(head, 0.36, 0.03, 0.2, shirt, 0, 0.27, 0.3, 0.012)
    sph(head, 0.045, outfit.accent, 0, 0.34, 0.31)
  } else if (outfit.head === 'goggles') {
    torus(head, 0.37, 0.025, '#3a2a1f', 0, 0.2, 0).rotation.x = Math.PI / 2
    for (const sx of [-1, 1]) {
      cyl(head, 0.1, 0.1, 0.06, '#7a869e', sx * 0.15, 0.22, 0.33, 16).rotation.x = Math.PI / 2
      cyl(head, 0.075, 0.075, 0.07, '#ffd24a', sx * 0.15, 0.22, 0.34, 16).rotation.x = Math.PI / 2
    }
  } else if (outfit.head === 'helmet') {
    torus(head, 0.3, 0.045, '#d8dff0', 0, -0.3, 0).rotation.x = Math.PI / 2 // helmet collar
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.52, 20, 14), holo(0xbfe9ff, 0.2, 0.15))
    bubble.scale.set(1.0, 0.95, 1.0); bubble.position.y = -0.02
    head.add(bubble)
  } else if (outfit.head === 'antenna') {
    cyl(head, 0.012, 0.012, 0.24, '#58648a', 0.1, 0.44, 0, 6)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glow(0x6dffb0, 1.0)); tip.position.set(0.1, 0.58, 0); head.add(tip)
    box(head, 0.1, 0.07, 0.07, '#d8dff0', 0.38, 0.0, 0, 0.02)
  } else if (outfit.head === 'mirror') {
    torus(head, 0.37, 0.022, '#c9d2e8', 0, 0.2, 0).rotation.x = Math.PI / 2
    cyl(head, 0.1, 0.1, 0.03, '#e8f4ff', 0, 0.3, 0.34, 18).rotation.x = Math.PI / 2
    sph(head, 0.025, '#2a3150', 0, 0.3, 0.36)
  } else if (outfit.head === 'visor') {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.14, 0.1), holo(0x4de0ff, 0.9, 0.5)); band.position.set(0, 0.06, 0.34); head.add(band)
    box(head, 0.7, 0.04, 0.12, '#58648a', 0, 0.16, 0.3, 0.015)
    sph(head, 0.04, outfit.accent, 0.38, 0.08, 0.1)
  } else if (outfit.head === 'beanie') {
    sph(head, 0.37, outfit.accent, 0, 0.2, 0, 1.05, 0.62, 1)
    box(head, 0.4, 0.05, 0.1, shirt, 0, 0.12, 0.3, 0.02)
    sph(head, 0.075, '#ffffff', 0, 0.45, 0)
  }

  // Arms (pivot at the shoulder)
  const arms = []
  for (const sx of [-1, 1]) {
    const a = new THREE.Group()
    a.position.set(sx * 0.35, 0.4, 0)
    capsule(a, 0.085, 0.2, shirt, 0, -0.17, 0)
    sph(a, 0.1, '#e8edf8', 0, -0.38, 0.01) // suit glove
    torus(a, 0.085, 0.025, outfit.accent, 0, -0.3, 0).rotation.x = Math.PI / 2
    body.add(a)
    arms.push(a)
  }
  // Gambe (pivot all'anca)
  const legs = []
  for (const sx of [-1, 1]) {
    const l = new THREE.Group()
    l.position.set(sx * 0.17, 0.02, 0)
    capsule(l, 0.1, 0.22, outfit.pants, 0, -0.2, 0)
    sph(l, 0.12, '#2a3150', 0, -0.44, 0.07, 1, 0.7, 1.35) // stivali
    box(l, 0.2, 0.04, 0.3, outfit.accent, 0, -0.5, 0.08, 0.015)
    body.add(l)
    legs.push(l)
  }
  // Coda
  const tail = new THREE.Group()
  tail.position.set(0, 0.1, -0.3)
  body.add(tail)
  if (sp.tail === 'bushy') { sph(tail, 0.2, sp.fur, 0, 0.1, -0.16, 0.9, 0.9, 1.7); sph(tail, 0.13, sp.tailTip, 0, 0.12, -0.45, 1, 1, 1) }
  if (sp.tail === 'thin') { capsule(tail, 0.05, 0.4, sp.fur, 0, 0.18, -0.14).rotation.x = -0.5 }
  if (sp.tail === 'short') { sph(tail, 0.1, sp.fur, 0, 0.08, -0.08, 1, 1, 1.5) }
  if (sp.tail === 'ring') { for (let i = 0; i < 4; i++) sph(tail, 0.15 - i * 0.012, i % 2 ? sp.dark : sp.fur, 0, 0.1 + i * 0.03, -0.12 - i * 0.14, 1, 1, 0.9) }
  if (sp.tail === 'pom') { sph(tail, 0.12, sp.belly, 0, 0.06, -0.1) }
  if (sp.tail === 'feather') { cone(tail, 0.07, 0.34, sp.dark, 0, 0.1, -0.18, 6).rotation.x = -1.9 }

  // one mesh per body part (head, torso, arms, legs, tail): far fewer draw calls
  rig.updateMatrixWorld(true)
  for (const part of [torso, head, tail, ...arms, ...legs]) bake(part)

  const state = { walkPhase: 0, sit: 0, hop: 0, tilt: 0 }

  // a = { moving, sit(bool), mode: 'idle'|'typing'|'think'|'sleep'|'look'|'cheer'|'alert' }
  function update(dt, t, a) {
    state.sit += ((a.sit ? 1 : 0) - state.sit) * Math.min(1, dt * 7)
    const moving = !!a.moving
    if (moving) state.walkPhase += dt * 9
    const sw = moving ? Math.sin(state.walkPhase) : 0
    const sitAmt = state.sit

    // gambe
    legs[0].rotation.x = sw * 0.75 * (1 - sitAmt) + -1.35 * sitAmt
    legs[1].rotation.x = -sw * 0.75 * (1 - sitAmt) + -1.35 * sitAmt
    legs[0].rotation.z = legs[1].rotation.z = 0

    // corpo
    const bob = moving ? Math.abs(Math.sin(state.walkPhase)) * 0.07 : 0
    body.position.y = 0.5 + bob
    root.position.y = (0.56 - 0.5 * S) * sitAmt // sitting: resting on the seat
    const breathe = 1 + Math.sin(t * 2.2) * 0.018
    torso.scale.set(1, breathe, 1)
    body.rotation.x = a.mode === 'sleep' ? 0.12 * sitAmt : 0
    tail.rotation.y = Math.sin(t * (moving ? 7 : 2.4)) * (sp.tail === 'thin' ? 0.5 : 0.25)
    tail.rotation.x = 0

    // braccia: riposo
    let ax0 = sw * -0.7 * (1 - sitAmt), ax1 = sw * 0.7 * (1 - sitAmt)
    let az0 = 0.12, az1 = -0.12
    // testa
    let hx = 0, hy = 0, hz = 0
    switch (a.mode) {
      case 'typing':
        ax0 = -1.15 + Math.sin(t * 17) * 0.1; ax1 = -1.15 + Math.cos(t * 15) * 0.1
        az0 = 0.05; az1 = -0.05
        hx = 0.18; hy = Math.sin(t * 1.3) * 0.1
        break
      case 'think':
        ax0 = -0.1; ax1 = -2.1 + Math.sin(t * 2) * 0.05; az1 = -0.45 // mano al mento
        hx = -0.12; hz = 0.14 + Math.sin(t * 1.5) * 0.04; hy = Math.sin(t * 0.9) * 0.2
        break
      case 'sleep':
        hx = 0.5 + Math.sin(t * 1.4) * 0.04; hz = 0.08
        ax0 = -0.5; ax1 = -0.5
        break
      case 'look':
        hy = Math.sin(t * 0.8) * 0.7; hx = Math.sin(t * 1.6) * 0.06
        break
      case 'cheer': {
        const w = Math.sin(t * 14)
        ax0 = -2.9 + w * 0.2; ax1 = -2.9 - w * 0.2; az0 = 0.4; az1 = -0.4
        state.hop = Math.abs(Math.sin(t * 8)) * 0.22
        break
      }
      case 'alert':
        ax0 = -2.5; az0 = 0.2; hx = -0.1
        hy = Math.sin(t * 9) * 0.12
        break
      default:
        hy = Math.sin(t * 0.7) * 0.15; hx = Math.sin(t * 0.5) * 0.05
        ax0 += Math.sin(t * 1.6) * 0.04; ax1 -= Math.sin(t * 1.6) * 0.04
    }
    if (a.mode !== 'cheer') state.hop *= 0.8
    root.position.y += state.hop

    arms[0].rotation.set(ax0, 0, az0)
    arms[1].rotation.set(ax1, 0, az1)
    head.rotation.set(hx, hy, hz)
    for (let i = 0; i < ears.length; i++) ears[i].rotation.x = Math.sin(t * 2 + i) * 0.04
    shadow.scale.setScalar(1 - state.hop * 0.8)
  }

  root.userData.headTop = 1.75 * S
  return { root, update, species: sp, shirt, outfit, state }
}

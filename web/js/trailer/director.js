// LaunchTrailerMode: plays Vibeship's 30-second launch film inside the real window (open /?trailer).
// The agents, their walks, drones, materializations, chips, bubbles, the agent card and its chat, the permission card
// and the red alert are the window's own code, fed by a scripted session instead of Claude Code. The person's part
// (clicking an agent, typing in its card, pressing Send and Allow) goes through the window's own controls too.
// The director adds what a film needs on top: a clock, a camera operator, titles and a soundtrack. Everything is
// seeded and timed, so every run is the same.
//   /?trailer            click to play (with sound)
//   /?trailer&autoplay   starts by itself (sound needs a browser started with --autoplay-policy=no-user-gesture-required)
//   /?trailer&record     no clock of its own: tools/record-launch.js steps it frame by frame (window.__trailer)
//   &mute                no soundtrack
import { T, FPS, FRAMES, DURATION, MESSAGE, MESSAGE_RHYTHM, REPLY } from './story.js'
import { ease, track, cueList, seeded, span } from './timeline.js'
import { createRig, follower, handheld } from './camera.js'
import { createScriptedServer } from './scripted-server.js'
import { scheduleScore, renderScoreWav } from './score.js'
import { createOverlay, typingCues } from './overlay.js'
import { createCharacter } from '../characters.js'

const WALK_SPEED = 2.7 // m/s, as in main.js

// ---------- The crew: who they are, when they come aboard, how they reach their station ----------
const CREW = {
  fox:    { session: 'fox',    label: 'checkout-api', look: { species: 'fox', shirt: 0 },    enter: T.foxIn,    station: 'bridge-d1', route: [[-9.9, -5.35], [-7.3, -5.85], [-3.4, -5.2]] },
  rabbit: { session: 'rabbit', label: 'web-app',      look: { species: 'rabbit', shirt: 3 }, enter: T.rabbitIn, station: 'bridge-d2', route: [[-9.9, -5.35], [-7.3, -5.85], [1.4, -5.85], [1.45, -5.15]] },
  bear:   { session: 'bear',   label: 'infra',        look: { species: 'bear', shirt: 1 },   enter: T.bearIn,   station: 'bridge-d3', route: [[-9.9, -5.35], [-7.3, -5.85], [6.0, -5.85], [6.05, -5.15]] },
  dog:    { session: 'dog',    label: 'docs',         look: { species: 'dog', shirt: 5 },    enter: T.dogIn,    station: 'bridge-d0', route: [[-9.9, -5.35], [-8.1, -5.2]] },
}
const keyOf = (c) => CREW[c].session + ':main'

export function startTrailer(host) {
  const { THREE } = host
  const qs = new URLSearchParams(location.search)
  const RECORD = qs.has('record'), AUTOPLAY = qs.has('autoplay'), MUTE = qs.has('mute') || RECORD
  document.body.classList.add('trailer')
  loadCss()

  // ---- determinism: a virtual clock and a seeded Math.random for everything the window does ----
  let vnow = 1000
  performance.now = () => vnow
  Math.random = seeded(20261006)

  const server = createScriptedServer(host)
  const overlay = createOverlay(host.stage)
  const header = document.querySelector('header'), footer = document.querySelector('footer'), labels = document.getElementById('labels')
  const card = document.getElementById('card'), cardText = document.getElementById('card-text'), cardSend = document.querySelector('#card-form [type="submit"]')
  const conn = document.getElementById('conn')
  conn.className = 'pill ok'; conn.textContent = 'connected'

  // ---- where each crew member's station is (the real layout's seats) ----
  const seatOf = (id) => host.seatWorld(host.furn.get(id))
  const arrival = {}
  for (const [name, c] of Object.entries(CREW)) {
    const s = seatOf(c.station)
    let len = 0, p = host.DOOR
    for (const [x, z] of [...c.route, [s.x, s.z]]) { len += Math.hypot(x - p.x, z - p.z); p = { x, z } }
    arrival[name] = c.enter + len / WALK_SPEED
  }
  const walking = new Map() // agent key -> { route, i, station }

  // ---- the script: hook events at fixed times ----
  const ev = (e) => server.event(e)
  const tool = (c, status, detail) => ev({ type: 'tool', session: CREW[c].session, status, detail })
  // Every session starts under the opening terminal, on the engine deck (out of sight), so building the characters
  // never costs a frame on screen; at its cue each one moves to the bridge and walks in through the hatch.
  const start = (c) => { const k = CREW[c]; ev({ type: 'session_start', session: k.session, label: k.label, look: k.look, loc: 'engine' }) }
  const board = (c) => { const k = CREW[c]; ev({ type: 'move', session: k.session, loc: 'bridge' }); walking.set(keyOf(c), { route: k.route, i: 0, station: k.station }) }
  const SUB1 = 'fox:spawn:t1' // the reviewer: the server keys a subagent by its session and Task tool id
  // the Task tool starts a subagent: the drone leaves at once. The window's launch cheer reads "done!", which would
  // say the opposite of what is happening in a film, so here the agent keeps typing and only says "Mission! 🚀".
  const spawn = (c, e) => { ev({ type: 'spawn', session: CREW[c].session, ...e }); server.flush(); const a = host.agents.get(keyOf(c)); if (a) a.cheerUntil = 0 }
  // the person clicks an agent (as a click on it in the 3D view does): the selection ring and its card
  const pick = (c) => { server.flush(); host.select(c ? { kind: 'agent', key: keyOf(c) } : null) }
  const msg = (state) => ev({ type: 'msg_state', session: 'fox', id: 'm1', state })
  const script = cueList([
    { t: 0.05, run: () => { for (const c of Object.keys(CREW)) start(c) } },
    { t: T.foxIn, run: () => board('fox') },
    { t: T.foxRead, run: () => tool('fox', 'read', 'auth.ts') },
    { t: T.rabbitIn, run: () => { board('rabbit'); tool('rabbit', 'read', 'App.tsx') } },
    { t: T.bearIn, run: () => { board('bear'); tool('bear', 'read', 'main.tf') } },
    // talk to it: the card opens, the message goes out, the fox takes it and gets to work
    { t: T.clickFox, run: () => pick('fox') },
    { t: T.sendMsg, run: () => ev({ type: 'say', session: 'fox', id: 'm1', text: MESSAGE }) },
    { t: T.msgSent, run: () => msg('sent') },
    { t: T.foxWrite, run: () => { msg('working'); tool('fox', 'write', 'auth.ts') } },
    { t: T.cardOut + 0.3, run: () => pick(null) },
    { t: T.dogIn, run: () => { board('dog'); tool('dog', 'read', 'README.md') } },
    { t: T.rabbitRun, run: () => tool('rabbit', 'run', 'npm test') },
    { t: T.sub1, run: () => { tool('fox', 'delegate', 'reviewer'); spawn('fox', { toolUseId: 't1', name: 'reviewer', description: 'Review auth.ts for edge cases', look: { species: 'cat' } }) } },
    { t: 14.7, run: () => tool('dog', 'write', 'README.md') },
    { t: 15.2, run: () => tool('fox', 'write', 'auth.ts') },
    { t: T.sub2, run: () => { tool('rabbit', 'delegate', 'tester'); spawn('rabbit', { toolUseId: 't2', name: 'tester', description: 'Write e2e tests for checkout', look: { species: 'raccoon' } }) } },
    { t: 16.3, run: () => tool('rabbit', 'run', 'npm test') },
    { t: 16.8, run: () => tool('bear', 'web', 'terraform docs') },
    // the "oh" moment: Claude wants to push, the ship goes on alert, the person allows it from the window
    { t: T.ask, run: () => { tool('fox', 'run', 'git push origin main'); ev({ type: 'permission', session: 'fox', id: 'p1', tool: 'Bash', summary: 'git push origin main' }) } },
    { t: T.allow, run: () => ev({ type: 'decide', id: 'p1', decision: 'allow' }) },
    { t: T.allow + 0.2, run: () => { const a = host.agents.get(keyOf('fox')); if (a) { host.say(a, 'On it!', 1700, true); a.char.state.hop = 0.25 } } },
    { t: 21.0, run: () => tool('rabbit', 'write', 'Checkout.tsx') },
    { t: T.permGone, run: () => ev({ type: 'permission_end', id: 'p1' }) },
    { t: T.clickFox2, run: () => pick('fox') },
    { t: 22.3, run: () => tool('bear', 'run', 'terraform plan') },
    { t: 22.6, run: () => tool('fox', 'write', 'CHANGELOG.md') },
    { t: 23.2, run: () => tool('dog', 'write', 'docs/setup.md') },
    { t: T.subDone, run: () => ev({ type: 'sub_done', key: SUB1, answer: 'auth.ts looks solid. 2 edge cases fixed.' }) },
    // the reply lands in the open card; over its head the fox keeps it short
    { t: T.foxDone, run: () => {
      msg('done'); ev({ type: 'reply', session: 'fox', id: 'r1', text: REPLY }); ev({ type: 'turn_complete', session: 'fox' }); server.flush()
      const a = host.agents.get(keyOf('fox')); if (a) host.say(a, 'Shipped! 🚀', 2400, true)
    } },
    { t: 25.9, run: () => tool('rabbit', 'run', 'npm run e2e') },
    { t: T.brand + 0.3, run: () => pick(null) },
  ])

  // ---- sound effects that follow the picture ----
  const sfx = [...typingCues(), { t: T.foxIn, kind: 'puff' }, { t: T.foxIn + 0.04, kind: 'select' }]
  for (let s = T.foxIn + 0.2, i = 0; s < arrival.fox - 0.05; s += Math.PI / 9, i++) sfx.push({ t: s, kind: 'step', alt: i % 2, v: 0.045 })
  sfx.push({ t: arrival.fox + 0.12, kind: 'sit' })
  sfx.push({ t: T.foxWrite, kind: 'typing', dur: 1.9, v: 0.03 }, { t: 15.2, kind: 'typing', dur: 1.7, v: 0.012 }, { t: 22.6, kind: 'typing', dur: 2.6, v: 0.01 })
  sfx.push({ t: arrival.rabbit + 0.1, kind: 'sit' }, { t: T.rabbitRun, kind: 'typing', dur: 0.9, v: 0.018 })
  for (const t of [T.sub1, T.sub2]) sfx.push({ t, kind: 'mission' }, { t: t + 1.0, kind: 'materialize' })
  sfx.push({ t: T.click, kind: 'click' }, { t: T.allow, kind: 'allow' }, { t: T.subDone, kind: 'done' }, { t: T.foxDone, kind: 'done' })
  // the person's clicks on the fox, and the window's "got it" blip when the message reaches Claude
  for (const t of [T.clickFox, T.clickFox2]) sfx.push({ t, kind: 'click' }, { t: t + 0.03, kind: 'select' })
  sfx.push({ t: T.msgSent, kind: 'select' })

  // ---- furniture: the deck builds itself up from the middle out, as the camera arrives ----
  const furnOrder = [...host.furn.values()].sort((a, b) => Math.hypot(a.item.x, a.item.z) - Math.hypot(b.item.x, b.item.z))
  furnOrder.forEach((f, i) => sfx.push({ t: T.furniture + i * 0.075 + 0.08, kind: 'pop', i }))
  function hideFurniture() {
    furnOrder.forEach((f, i) => { f.delay = T.furniture + i * 0.075; f.appearT = 0; f.model.inner.scale.setScalar(0.001) })
  }

  // ---- dust in the air: tiny warm motes catch the light in close shots ----
  const dust = makeDust(THREE)
  host.scene.add(dust.points)

  // ---- camera: the shots ----
  const followFox = follower(3.2)
  const foxPos = () => host.agents.get(keyOf('fox'))?.char.root.position
  const P = (az, el, zoom, x, y, z) => ({ az, el, zoom, x, y, z })
  // the same shot with its subject moved left by a fraction of the frame width, to leave room for the agent card
  // (the frame is 2·D·tan(15°)·16/9 ≈ 39 m wide at zoom 1)
  const aside = (p, f) => { const d = f * p.zoom * 39; return { ...p, x: p.x + Math.cos(p.az) * d, z: p.z - Math.sin(p.az) * d } }
  const reveal = track([
    [T.reveal, P(-0.3, 0.1, 4.8, 0, -0.6, 0)],
    [4.6, P(0.36, 0.56, 1.1, 0, 0.6, 0.2), ease.outQuint],
    [7.2, P(0.6, 0.42, 0.42, -7.2, 1.0, -4.8), ease.inOut],
  ])
  const walkZoom = track([[6.6, 0.3], [9.4, 0.21]]), walkAz = track([[6.6, 0.62], [9.4, 0.3]]), walkEl = track([[6.6, 0.36], [9.4, 0.3]])
  // close shots look over the monitors from three-quarters, so the faces read; while its card is open the fox sits
  // in the left part of the frame
  const talkEnd = aside(P(0.34, 0.46, 0.15, -2.3, 1.15, -4.45), 0.17)
  const closeUp = track([
    [9.2, P(0.5, 0.5, 0.2, -2.3, 1.15, -4.45)],
    [10.4, aside(P(0.42, 0.48, 0.17, -2.3, 1.15, -4.45), 0.17), ease.inOutCubic],
    [T.cardOut + 0.2, talkEnd, ease.linear],
  ])
  const truck = track([[T.cardOut + 0.2, talkEnd], [13.9, P(-0.22, 0.5, 0.2, 2.4, 1.15, -4.45), ease.inOutCubic], [14.3, P(-0.25, 0.5, 0.21, 2.35, 1.15, -4.4), ease.linear]])
  const mission = track([[14.1, P(-0.1, 0.5, 0.42, 0.6, 1.0, -2.0)], [15.5, P(0.28, 0.52, 0.5, 0, 1.0, 0.9), ease.inOutCubic]])
  const busy = track([[15.6, P(0.28, 0.5, 0.5, 0.2, 0.9, -0.4)], [17.0, P(0.42, 0.56, 0.66, 0.8, 0.9, -1.2), ease.inOut]])
  const ask = track([
    [T.ask, P(0.42, 0.56, 0.66, 0.8, 0.9, -1.2)],
    [18.3, P(0.3, 0.5, 0.2, -2.3, 0.95, -4.45), ease.outCubic],
    [T.allow, P(0.24, 0.48, 0.16, -2.3, 0.98, -4.45), ease.linear],
  ])
  const release = track([[T.allow, P(0.24, 0.48, 0.16, -2.3, 0.98, -4.45)], [22.0, P(0.32, 0.5, 0.28, -2.2, 1.05, -4.3), ease.inOut]])
  // the whole window: the ship at work on the left, the fox's card (and its reply) on the right
  const heroWide = aside(P(0.62, 0.62, 1.06, 0.3, 0.6, 0.6), 0.15)
  const hero = track([
    [22.0, P(0.32, 0.5, 0.28, -2.2, 1.05, -4.3)],
    [24.6, aside(P(0.52, 0.64, 1.08, 0.3, 0.6, 0.6), 0.15), ease.inOutCubic],
    [T.brand, heroWide, ease.linear],
  ])
  const brand = track([[T.brand, heroWide], [28.5, P(0.7, 0.5, 1.7, 0, 11.5, 0), ease.outQuint], [DURATION, P(0.71, 0.5, 1.71, 0, 11.5, 0), ease.linear]])
  const rig = createRig([
    { at: 0, pose: reveal },
    { at: 6.6, blend: 1.3, pose: (t) => { const f = followFox.value; return P(walkAz(t), walkEl(t), walkZoom(t), f.x + 1.1, 1.0, f.z + 0.35) } },
    { at: 9.2, blend: 1.1, pose: closeUp },
    { at: T.cardOut + 0.2, blend: 0.3, pose: truck },
    { at: 14.2, blend: 0.8, pose: mission },
    { at: 15.6, blend: 1.0, pose: busy },
    { at: T.ask, blend: 0.35, pose: ask },
    { at: T.allow, blend: 0.8, pose: release },
    { at: 22.0, blend: 0.5, pose: hero },
    { at: T.brand, blend: 1.2, pose: brand },
  ])
  const shake = track([[0, 0], [6.5, 0], [7.5, 0.035], [16.0, 0.03], [17.0, 0.015], [19.9, 0.025], [22.5, 0.02], [24.0, 0], [DURATION, 0]])
  const chrome = track([[16.9, 0], [17.5, 1], [26.4, 1], [27.0, 0]])
  const tags = track([[26.6, 1], [27.2, 0]])

  // ---- warm-up: compile what will appear later (characters, sprites) so nothing stutters on its first frame ----
  function warmUp() {
    const tmp = ['fox', 'rabbit', 'bear', 'dog', 'cat', 'raccoon'].map((s, i) => { const c = createCharacter(s, [0, 3, 1, 5, 6, 6][i]); c.root.position.set(i - 3, -40, 0); host.scene.add(c.root); return c })
    for (const k of ['star', 'puff', 'alert', 'zzz']) host.fx.emit(k, new THREE.Vector3(0, -40, 0), { life: 0.01 })
    try { host.renderer.compile(host.scene, host.camera) } catch {}
    host.render()
    for (const c of tmp) host.scene.remove(c.root)
  }

  // ---- the clock ----
  let state = 'gate', t = 0, audio = null, audioT0 = 0
  const startT = Number(qs.get('t')) || 0 // &t=17 jumps in for rehearsing a beat (no sound)
  host.world.setBaseLight('dim') // the ship is asleep until the camera arrives
  hideFurniture()
  dust.update(0, 0)
  let lightsOn = false
  function begin() {
    state = 'play'
    if (startT > 0) { // fast-forward deterministically to the requested beat
      while (t < startT) { const d = Math.min(1 / FPS, startT - t); window.__ao.step(1, d) }
    }
  }
  function frame(dt) {
    if (state !== 'play') return 0
    let next = t + dt
    if (audio && !startT) next = Math.max(t, audio.currentTime - (audio.outputLatency || audio.baseLatency || 0) - audioT0)
    next = Math.min(next, DURATION)
    const d = Math.min(0.1, next - t)
    if (d <= 0 && t > 0) return 0
    t += d
    vnow += d * 1000
    direct(t, d)
    if (t >= DURATION) state = 'end'
    return d
  }

  function direct(t, dt) {
    if (!lightsOn && t >= T.lightsOn) { lightsOn = true; host.world.setBaseLight('cinema') }
    script.update(t)
    server.flush()
    // walking routes: from waypoint to waypoint, then the station
    for (const [key, w] of walking) {
      const ag = host.agents.get(key)
      if (!ag) continue
      const p = ag.char.root.position
      if (w.i < w.route.length) {
        const [x, z] = w.route[w.i]
        if (Math.hypot(p.x - x, p.z - z) < 0.05) w.i++
      }
      ag.pin = w.i < w.route.length ? { x: w.route[w.i][0], z: w.route[w.i][1] } : { station: w.station }
      if (w.i >= w.route.length) walking.delete(key)
    }
    // camera
    followFox.update(dt, foxPos())
    const pose = rig.pose(t)
    const hh = handheld(t, shake(t))
    host.cam.az = host.goal.az = pose.az + hh.az
    host.cam.el = host.goal.el = pose.el
    host.cam.zoom = host.goal.zoom = pose.zoom
    host.cam.target.set(pose.x + hh.x, pose.y + hh.y, pose.z)
    host.goal.target.copy(host.cam.target)
    host.applyCamera(); host.camera.updateMatrixWorld() // this frame's view, so the pointer lands where the picture is
    // the window's own interface comes in when the story turns from "beautiful" to "real"
    const c = chrome(t).toFixed(3)
    if (header.style.opacity !== c) { header.style.opacity = c; footer.style.opacity = c }
    labels.style.opacity = tags(t).toFixed(3)
    // the agent card: typed into, then it steps out of the way (and out of the brand shot)
    const co = ((t < T.ask ? 1 - span(t, T.cardOut, T.cardOut + 0.3) : 1) * (1 - span(t, 26.4, 27.0))).toFixed(3)
    if (card.style.opacity !== co) card.style.opacity = co
    if (t >= T.typeMsg && t < T.sendMsg) cardText.value = MESSAGE.slice(0, MESSAGE_RHYTHM.filter((d) => t >= T.typeMsg + d).length)
    else if (cardText.value) cardText.value = ''
    cardSend.classList.toggle('c-pressed', t >= T.sendMsg - 0.03 && t < T.sendMsg + 0.1)
    dust.update(t, span(t, T.reveal + 1.5, 7) * (1 - span(t, T.brand, T.brand + 1)))
    const asking = t >= T.ask && t < T.allow + 0.6 ? 1 - span(t, T.allow, T.allow + 0.6) : 0
    const btn = document.querySelector('#perm .ask:not(.done) [data-d="allow"]')
    overlay.update(t, { targets: { fox: screenOf(foxPos(), 0.75), allow: rectPoint(btn, 0.42, 0.55) }, alert: asking * span(t, T.ask, T.ask + 0.25) })
    if (btn) btn.classList.toggle('c-pressed', t >= T.click - 0.03 && t < T.allow + 0.05)
  }
  // where a point of the ship (or a button) is on the stage, in pixels
  const v3 = new THREE.Vector3()
  function screenOf(p, lift) {
    if (!p) return null
    v3.set(p.x, p.y + lift, p.z).project(host.camera)
    const s = host.stage.getBoundingClientRect()
    return { x: (v3.x + 1) / 2 * s.width, y: (1 - v3.y) / 2 * s.height }
  }
  function rectPoint(e, fx, fy) {
    if (!e) return null
    const s = host.stage.getBoundingClientRect(), b = e.getBoundingClientRect()
    return { x: b.left - s.left + b.width * fx, y: b.top - s.top + b.height * fy }
  }

  // ---- record mode: frame-exact stepping, CSS animations pinned to the virtual clock ----
  const animStart = new WeakMap()
  function syncCssAnimations() {
    for (const a of document.getAnimations()) {
      if (!animStart.has(a)) animStart.set(a, vnow)
      a.pause()
      a.currentTime = vnow - animStart.get(a)
    }
  }
  if (RECORD) {
    window.__trailer = {
      fps: FPS, frames: FRAMES, duration: DURATION, ready: false,
      start() { begin() },
      advance() { window.__ao.step(1, 1 / FPS); syncCssAnimations(); return t },
      async audio() { const wav = await renderScoreWav(sfx); return toBase64(wav) },
    }
    setTimeout(() => { warmUp(); window.__trailer.ready = true }, 0) // the recorder stubs requestAnimationFrame
    return { update: frame }
  }

  // ---- playback: a start card, then the film in sync with its soundtrack ----
  const gate = makeGate(async () => {
    gate.remove()
    document.body.classList.add('c-playing')
    if (!MUTE && !startT) {
      try {
        audio = new AudioContext({ latencyHint: 'playback' })
        await audio.resume()
        audioT0 = audio.currentTime + 0.3
        scheduleScore(audio, audio.destination, audioT0, sfx)
      } catch { audio = null }
    }
    begin()
  }, async () => {
    const wav = await renderScoreWav(sfx)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    a.download = 'vibeship-trailer.wav'
    a.click()
  })
  host.stage.append(gate.el)
  addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') location.search = '?trailer&autoplay' + (MUTE ? '&mute' : '')
    if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()
    if ((e.key === ' ' || e.key === 'Enter') && gate.el.isConnected) { e.preventDefault(); gate.play() }
  })
  requestAnimationFrame(() => {
    warmUp()
    gate.ready()
    if (AUTOPLAY) {
      // autoplay: only if the browser lets the soundtrack start without a click (or there is none)
      const probe = MUTE ? null : new AudioContext()
      setTimeout(() => {
        if (!probe || probe.state === 'running') { probe?.close(); gate.play() }
        else probe.close()
      }, Number(qs.get('delay') || 1) * 1000)
    }
  })
  return { update: frame }
}

// ---------- helpers ----------
function loadCss() {
  if (document.getElementById('trailer-css')) return
  const l = document.createElement('link')
  l.id = 'trailer-css'; l.rel = 'stylesheet'; l.href = '/js/trailer/trailer.css'
  document.head.append(l)
}
function makeGate(onPlay, onWav) {
  const el = document.createElement('div')
  el.className = 'c-gate'
  el.innerHTML = '<div class="c-card"><img src="/icons/icon.svg" alt=""><h2>VIBESHIP</h2><p>Launch trailer · 30 s · sound on</p><button class="btn primary" type="button" disabled>Warming up…</button><small>F fullscreen · R replay · <a href="#" class="c-wav">download the soundtrack (.wav)</a></small></div>'
  const btn = el.querySelector('button')
  let started = false
  const play = () => { if (started || btn.disabled) return; started = true; onPlay() }
  btn.onclick = play
  el.querySelector('.c-wav').onclick = (e) => { e.preventDefault(); onWav() }
  return {
    el, play,
    ready() { btn.disabled = false; btn.textContent = '▶ Play' ; btn.focus() },
    remove() { el.remove() },
  }
}
function makeDust(THREE) {
  const N = 240, r = seeded(31)
  const base = new Float32Array(N * 3), ph = new Float32Array(N * 3), pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    base[i * 3] = -12 + r() * 24; base[i * 3 + 1] = 0.3 + r() * 3.6; base[i * 3 + 2] = -7 + r() * 14
    ph[i * 3] = r() * 6.3; ph[i * 3 + 1] = r() * 6.3; ph[i * 3 + 2] = 0.15 + r() * 0.35
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const c = document.createElement('canvas'); c.width = c.height = 32
  const g = c.getContext('2d'), grd = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grd.addColorStop(0, 'rgba(255,240,215,1)'); grd.addColorStop(1, 'rgba(255,240,215,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32)
  const tex = new THREE.CanvasTexture(c)
  // fixed pixel size: a mote that drifts next to the lens stays a glint instead of a blurry orb
  const mat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe2b8' })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return {
    points,
    update(t, amount) {
      mat.opacity = 0.55 * amount
      points.visible = amount > 0.001
      if (!points.visible) return
      for (let i = 0; i < N; i++) {
        const s = ph[i * 3 + 2]
        pos[i * 3] = base[i * 3] + Math.sin(t * s + ph[i * 3]) * 0.6
        pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * s * 1.3 + ph[i * 3 + 1]) * 0.3
        pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * s * 0.8 + ph[i * 3]) * 0.6
      }
      geo.attributes.position.needsUpdate = true
    },
  }
}
function toBase64(buf) {
  const bytes = new Uint8Array(buf), parts = []
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)))
  return btoa(parts.join(''))
}

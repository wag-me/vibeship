// The trailer's soundtrack, synthesized like the rest of Vibeship's sounds (no audio files).
// scheduleScore() writes the whole 30 s onto any BaseAudioContext: a live AudioContext for playback, or an
// OfflineAudioContext to render a sample-exact WAV for the exported video. Same input, same sound, every time.
// Palette: cozy kalimba + soft pads + toy drums, a little sci-fi (drones, beams), and the app's own UI blips.
import { T, GRID0, DURATION } from './story.js'
import { seeded } from './timeline.js'

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)
const BEAT = 0.5, BAR = 2

// Chords of the film (MIDI voicings) and the bass roots, bar by bar from GRID0 (7 s)
const CH = {
  D: [50, 57, 61, 64, 66], Bm: [47, 54, 57, 61, 62], G: [43, 50, 54, 57, 59], A: [45, 52, 55, 59, 62],
  Dsus: [50, 57, 62, 64, 69], Gl: [43, 50, 54, 57, 61], // reveal colours: open D, Gmaj7#11
}
const ROOT = { D: 38, Bm: 35, G: 31, A: 33 }
// Main theme on kalimba: [eighth-note step, midi] per bar (8 steps of 0.25 s)
const THEME = {
  D: [[0, 78], [1, 81], [2, 83], [3, 81], [4, 78], [6, 76], [7, 74]],
  Bm: [[0, 74], [1, 78], [2, 83], [3, 81], [4, 78], [6, 74]],
  G: [[0, 71], [1, 74], [2, 79], [3, 78], [4, 74], [5, 76], [6, 78]],
  A: [[0, 76], [1, 73], [2, 76], [3, 81], [4, 79], [5, 78], [6, 76]],
  D2: [[0, 78], [1, 81], [2, 86], [3, 85], [4, 81], [5, 78], [6, 81]],
}

export function scheduleScore(ctx, out, t0, sfxCues = []) {
  const rnd = seeded(7)
  // every event lands exactly on a sample: a start a hair past a render-quantum boundary (0.45 + 0.39 = 0.8400000000000001)
  // can make Chrome's envelope jump to full scale for one block, an audible click
  const sr = ctx.sampleRate
  const at = (t) => Math.round((t0 + t) * sr) / sr
  // ---------- buses ----------
  // levels are set by hand; the limiter only catches peaks (a soft compressor's automatic make-up gain would
  // lift every transient that follows a quiet passage, like the keystrokes of the opening)
  const MASTER = 1.7
  const master = ctx.createGain(); master.gain.value = MASTER
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.12
  master.connect(limiter).connect(out)
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 2.6, rnd)
  const verbOut = ctx.createGain(); verbOut.gain.value = 0.32
  verb.connect(verbOut).connect(master)
  const bus = (vol, wet) => { const g = ctx.createGain(); g.gain.value = vol; g.connect(master); if (wet) { const s = ctx.createGain(); s.gain.value = wet; g.connect(s).connect(verb) } return g }
  // music runs through a filter, so the permission moment can duck it and open it up again
  const musicIn = ctx.createGain()
  const musicLp = ctx.createBiquadFilter(); musicLp.type = 'lowpass'; musicLp.frequency.value = 16000; musicLp.Q.value = 0.5
  const music = bus(0.95, 0.35)
  musicIn.connect(musicLp).connect(music)
  const fx = bus(0.9, 0.22)
  const ui = bus(0.75, 0.12)
  const noise = noiseBuffer(ctx, rnd)

  // ---------- voices ----------
  function osc(type, f, t, dur, vol, dest, { a = 0.005, slide = 0, detune = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type; o.frequency.setValueAtTime(f, at(t)); o.detune.value = detune
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), at(t + dur))
    g.gain.setValueAtTime(0.0001, at(t))
    g.gain.exponentialRampToValueAtTime(vol, at(t + a))
    g.gain.exponentialRampToValueAtTime(0.0001, at(t + a + dur))
    o.connect(g).connect(dest)
    o.start(at(t)); o.stop(at(t + a + dur + 0.05))
  }
  function hiss(t, dur, vol, dest, { type = 'bandpass', f = 2000, f2 = 0, q = 0.8, a = 0.004 } = {}) {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, at(t)); flt.Q.value = q
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, at(t + a + dur))
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at(t))
    g.gain.exponentialRampToValueAtTime(vol, at(t + a))
    g.gain.exponentialRampToValueAtTime(0.0001, at(t + a + dur))
    s.connect(flt).connect(g).connect(dest)
    const off = rnd() * 1.5
    s.start(at(t), off); s.stop(at(t + a + dur + 0.05))
  }
  const kalimba = (t, n, v = 0.1, dest = musicIn) => {
    const f = midi(n)
    osc('sine', f, t, 1.3, v, dest, { a: 0.003 })
    osc('triangle', f, t, 0.5, v * 0.35, dest, { a: 0.002 })
    osc('sine', f * 4.03, t, 0.07, v * 0.25, dest, { a: 0.001 })
  }
  const glock = (t, n, v = 0.06, dest = musicIn) => {
    const f = midi(n)
    osc('sine', f, t, 1.6, v, dest, { a: 0.002 })
    osc('sine', f * 2.76, t, 0.35, v * 0.4, dest, { a: 0.001 })
    osc('sine', f * 5.4, t, 0.12, v * 0.2, dest, { a: 0.001 })
  }
  function pad(t, t1, notes, v = 0.03, dest = musicIn, cutoff = 1100) {
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = cutoff; flt.Q.value = 0.6
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at(t))
    g.gain.exponentialRampToValueAtTime(v, at(t + Math.min(0.7, (t1 - t) * 0.4)))
    g.gain.setValueAtTime(v, at(t1))
    g.gain.exponentialRampToValueAtTime(0.0001, at(t1 + 1.1))
    flt.connect(g).connect(dest)
    for (const n of notes) for (const d of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = d
      o.connect(flt); o.start(at(t)); o.stop(at(t1 + 1.2))
    }
  }
  const bass = (t, n, dur, v = 0.16) => { osc('triangle', midi(n), t, dur, v, musicIn, { a: 0.006 }); osc('sine', midi(n), t, dur, v * 0.8, musicIn, { a: 0.006 }) }
  const kick = (t, v = 0.5) => osc('sine', 150, t, 0.3, v, musicIn, { a: 0.002, slide: -105 })
  const snap = (t, v = 0.05) => hiss(t, 0.11, v, musicIn, { f: 1700, q: 0.9 })
  const shaker = (t, v = 0.018) => hiss(t, 0.045, v, musicIn, { type: 'highpass', f: 7000, q: 0.5, a: 0.008 })
  const whoosh = (t, dur, v, f, f2, dest = fx) => hiss(t, dur, v, dest, { f, f2, q: 1.2, a: dur * 0.55 })
  const boom = (t, v = 0.5) => { osc('sine', 72, t, 1.8, v, fx, { a: 0.004, slide: -40 }); hiss(t, 0.5, v * 0.25, fx, { type: 'lowpass', f: 400, q: 0.5 }) }
  // the app's UI sounds (js/audio.js recipes), routed through the score
  const tone = (f, dur, type, vol, slide, delay, t) => osc(type, f, t + (delay || 0), dur, vol * 1.4, ui, { a: 0.01, slide })

  // ---------- 0–3: the hook ----------
  hiss(0, 2.9, 0.012, fx, { type: 'lowpass', f: 500, q: 0.3, a: 0.6 }) // room tone, almost nothing
  pad(T.headline - 0.1, T.reveal + 0.1, [38, 45], 0.035, fx, 500) // a low swell under the headline
  glock(T.headline, 81, 0.035, fx)
  hiss(2.25, 0.75, 0.05, fx, { type: 'highpass', f: 900, f2: 9000, q: 0.7, a: 0.72 }) // riser into the reveal
  osc('sine', midi(62), 2.3, 0.72, 0.025, fx, { a: 0.7, slide: midi(74) - midi(62) })

  // ---------- 3–7: the reveal ----------
  boom(T.reveal, 0.45)
  whoosh(T.reveal - 0.05, 1.1, 0.09, 4000, 300)
  pad(T.reveal, 5.0, CH.Dsus, 0.028)
  pad(5.0, GRID0, CH.Gl, 0.026)
  ;[74, 78, 81, 85, 88].forEach((n, i) => glock(T.reveal + 0.05 + i * 0.075, n, 0.05))
  kalimba(5.0, 81, 0.05); kalimba(5.5, 78, 0.04); kalimba(6.25, 76, 0.045)

  // ---------- 7–17: the theme, then the build ----------
  const prog = [['D', 7], ['Bm', 9], ['G', 11], ['A', 13], ['D', 15], ['D', 21], ['Bm', 23], ['G', 25, 1], ['A', 26, 1]]
  for (const [c, t, len = 2] of prog) pad(t, t + len, CH[c], t >= 21 ? 0.03 : 0.022)
  const bar = (t) => ({ step: (i) => t + i * BEAT / 2 })
  // melody
  ;[['D', 7], ['Bm', 9], ['G', 11], ['A', 13], ['D2', 15]].forEach(([c, t]) => {
    for (const [s, n] of THEME[c]) kalimba(bar(t).step(s), n, t < 9 ? 0.07 : 0.085)
  })
  // bass from 9 s, light drums from 11 s, full from 13 s
  for (const [c, t] of [['Bm', 9], ['G', 11], ['A', 13], ['D', 15]]) {
    const r = ROOT[c], b = bar(t)
    bass(b.step(0), r, 0.7); bass(b.step(3), r + 12, 0.18, 0.1); bass(b.step(4), r + 7, 0.45); bass(b.step(7), r, 0.18, 0.1)
  }
  for (let i = 0; i < 24; i++) { const t = 11 + i * 0.25; shaker(t, (i % 2 ? 0.014 : 0.022) * (t >= 13 ? 1.4 : 1)) }
  for (let i = 0; i < 8; i++) { const t = 13 + i * BEAT; kick(t, (i % 2 ? 0.3 : 0.44) * (t >= 15 ? 1.15 : 1)); if (i % 2) snap(t, t >= 15 ? 0.07 : 0.05) }
  ;[[15, 81], [15.5, 86], [16, 90], [16.25, 88], [16.5, 86], [16.75, 85]].forEach(([t, n]) => glock(t, n, 0.05))
  pad(15, 17, [62, 69, 74], 0.014, musicIn, 2400) // the air gets brighter as the ship fills up
  hiss(16.3, 0.68, 0.06, musicIn, { type: 'highpass', f: 1200, f2: 8000, q: 0.6, a: 0.66 }) // reverse swell into the cut

  // ---------- 17–20: the drop (a permission request) ----------
  musicIn.gain.setValueAtTime(1, at(T.ask - 0.02))
  musicIn.gain.linearRampToValueAtTime(0, at(T.ask + 0.04))
  // low tension bed: two detuned saws with a slowly breathing filter
  {
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 3
    flt.frequency.setValueAtTime(140, at(T.ask)); flt.frequency.linearRampToValueAtTime(420, at(T.allow))
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at(T.ask)); g.gain.exponentialRampToValueAtTime(0.03, at(T.ask + 0.3))
    g.gain.setValueAtTime(0.03, at(T.allow)); g.gain.exponentialRampToValueAtTime(0.0001, at(T.allow + 0.7))
    flt.connect(g).connect(fx)
    for (const [n, d] of [[26, -6], [26, 6], [33, 0]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = d; o.connect(flt); o.start(at(T.ask)); o.stop(at(T.allow + 0.8)) }
  }
  // alarm: two soft two-tone calls, and the bell of the permission card
  for (const t of [T.ask, T.ask + 0.55]) { osc('square', midi(76), t, 0.2, 0.025, fx, { a: 0.01 }); osc('square', midi(72), t + 0.22, 0.24, 0.025, fx, { a: 0.01 }) }
  tone(220, 0.18, 'sawtooth', 0.05, -80, 0, T.ask) // sfx.error, as the window plays it
  glock(T.ask + 0.08, 93, 0.03, fx)
  // heartbeat, a little faster each time
  for (const t of [17.7, 18.45, 19.1, 19.6]) { osc('sine', 58, t, 0.22, 0.17, fx, { a: 0.004, slide: -20 }); osc('sine', 52, t + 0.17, 0.25, 0.12, fx, { a: 0.004, slide: -18 }) }
  osc('sine', midi(86), 17.4, 2.5, 0.008, fx, { a: 2.2, slide: midi(87) - midi(86) }) // a thin rising whistle

  // ---------- 20–27: control, and the ship at full speed ----------
  musicIn.gain.setValueAtTime(0, at(T.allow))
  musicIn.gain.linearRampToValueAtTime(1, at(T.allow + 0.35))
  musicLp.frequency.setValueAtTime(500, at(T.allow))
  musicLp.frequency.exponentialRampToValueAtTime(16000, at(21.2))
  pad(T.allow, 21, CH.A, 0.03)
  ;[69, 73, 76, 81, 85].forEach((n, i) => glock(T.allow + 0.03 + i * 0.06, n, 0.05)) // the "yes" chime
  whoosh(T.allow, 0.9, 0.05, 500, 5000)
  ;[[20.5, 76], [20.625, 78], [20.75, 81], [20.875, 83]].forEach(([t, n]) => kalimba(t, n, 0.07))
  ;[[20.5, 0.18], [20.625, 0.22], [20.75, 0.26], [20.875, 0.32]].forEach(([t, v]) => osc('sine', 110 - (t - 20.5) * 60, t, 0.2, v, musicIn, { slide: -40 })) // little tom fill
  ;[['D', 21], ['Bm', 23], ['G', 25], ['A', 26]].forEach(([c, t]) => {
    const notes = c === 'D' ? THEME.D2 : THEME[c]
    for (const [s, n] of notes) { if (t >= 25 && s > 3) continue; kalimba(bar(t).step(s), n, 0.085); glock(bar(t).step(s), n + 12, 0.022) }
  })
  pad(21, 27, [62, 69, 74], 0.016, musicIn, 2600)
  for (const [c, t, len] of [['D', 21, 2], ['Bm', 23, 2], ['G', 25, 1], ['A', 26, 1]]) {
    const r = ROOT[c], b = bar(t)
    bass(b.step(0), r, 0.7); bass(b.step(3), r + 12, 0.18, 0.1)
    if (len === 2) { bass(b.step(4), r + 7, 0.45); bass(b.step(7), r, 0.18, 0.1) }
  }
  for (let i = 0; i < 12; i++) { const t = 21 + i * BEAT; kick(t, i % 2 ? 0.34 : 0.52); if (i % 2) snap(t, 0.065) }
  for (let i = 0; i < 24; i++) shaker(21 + i * 0.25, i % 2 ? 0.016 : 0.026)
  hiss(26.4, 0.58, 0.05, musicIn, { type: 'highpass', f: 1500, f2: 10000, q: 0.6, a: 0.56 })
  ;[[26.5, 0.3], [26.625, 0.34], [26.75, 0.38], [26.875, 0.45]].forEach(([t, v]) => osc('sine', 130 - (t - 26.5) * 90, t, 0.18, v, musicIn, { slide: -50 }))

  // ---------- 27–30: the brand ----------
  musicIn.gain.setValueAtTime(1, at(T.brand - 0.01))
  musicIn.gain.linearRampToValueAtTime(0, at(T.brand + 0.06)) // the groove stops; the final chord rings out alone
  boom(T.brand, 0.55)
  pad(T.brand, 29.4, [38, 45, 50, 57, 61, 64, 66, 73], 0.03, fx, 1600)
  kalimba(T.brand, 86, 0.09, fx); kalimba(T.brand, 74, 0.07, fx)
  hiss(T.brand, 2.6, 0.03, fx, { type: 'highpass', f: 5000, q: 0.4, a: 0.01 }) // cymbal bloom
  ;[[T.wordmark, 90], [T.wordmark + 0.07, 93], [T.wordmark + 0.14, 98]].forEach(([t, n]) => glock(t, n, 0.03, fx))
  glock(T.tagline, 86, 0.035, fx)
  master.gain.setValueAtTime(MASTER, at(DURATION - 0.8))
  master.gain.linearRampToValueAtTime(0.0001, at(DURATION))

  // ---------- sound effects that follow the picture (times computed by the director) ----------
  const steps = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83]
  for (const c of sfxCues) {
    const t = c.t
    switch (c.kind) {
      case 'key': { const v = c.v ?? 0.05; hiss(t, 0.025, v, ui, { type: 'highpass', f: 2500, q: 0.7, a: 0.002 }); osc('triangle', 1900 + rnd() * 300, t, 0.015, v * 0.24, ui); break }
      case 'enter': { const v = c.v ?? 0.07; hiss(t, 0.05, v, ui, { type: 'bandpass', f: 1200, q: 0.7, a: 0.002 }); osc('sine', 180, t, 0.08, v * 0.86, ui, { slide: -60 }); break }
      case 'pop': osc('sine', midi(steps[c.i % steps.length]) , t, 0.16, 0.05, ui, { a: 0.004, slide: -midi(steps[c.i % steps.length]) * 0.3 }); break
      case 'puff': whoosh(t, 0.45, 0.035, 1800, 600, ui); break
      case 'select': tone(660, 0.08, 'triangle', 0.07, 0, 0, t); tone(880, 0.1, 'triangle', 0.06, 0, 0.07, t); break
      case 'step': hiss(t, 0.05, c.v ?? 0.04, ui, { type: 'lowpass', f: c.alt ? 700 : 900, q: 0.7, a: 0.003 }); osc('sine', c.alt ? 150 : 170, t, 0.05, (c.v ?? 0.04) * 0.6, ui, { slide: -60 }); break
      case 'sit': tone(300, 0.1, 'sine', 0.06, -120, 0, t); break // sfx.place, a soft landing
      case 'typing': for (let s = t; s < t + c.dur; s += 0.055 + rnd() * 0.06) hiss(s, 0.018, (c.v ?? 0.02) * (0.6 + rnd() * 0.6), ui, { type: 'highpass', f: 3200, q: 0.6, a: 0.002 }); break
      case 'mission': tone(520, 0.08, 'triangle', 0.07, 200, 0, t); whoosh(t + 0.05, 0.9, 0.05, 400, 3500); osc('sine', 300, t + 0.05, 0.9, 0.02, fx, { a: 0.3, slide: 500 }); break
      case 'materialize': whoosh(t, 0.6, 0.05, 2500, 800); osc('sine', midi(74), t, 0.7, 0.03, fx, { slide: midi(86) - midi(74) }); [86, 90, 93].forEach((n, i) => glock(t + 0.05 + i * 0.06, n, 0.03, fx)); break
      case 'done': [74, 78, 81, 86].forEach((n, i) => tone(midi(n), 0.16, 'triangle', 0.07, 0, i * 0.09, t)); break // sfx.done, in key
      case 'click': tone(620, 0.07, 'triangle', 0.06, -120, 0, t); break // sfx.click
      case 'allow': tone(300, 0.1, 'sine', 0.1, -120, 0, t); tone(220, 0.12, 'sine', 0.07, -60, 0.07, t); break // sfx.place
    }
  }
}

// Renders the score offline and returns a 16-bit stereo WAV (ArrayBuffer)
export async function renderScoreWav(sfxCues, sampleRate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * DURATION), sampleRate)
  scheduleScore(ctx, ctx.destination, 0, sfxCues)
  return encodeWav(await ctx.startRendering())
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, data = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, buf.sampleRate, true)
  data.setUint32(28, buf.sampleRate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true)
  str(36, 'data'); data.setUint32(40, n * ch * 2, true)
  const chans = [...Array(ch)].map((_, i) => buf.getChannelData(i))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2 }
  return data.buffer
}
function noiseBuffer(ctx, rnd) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1
  return b
}
function impulse(ctx, secs, rnd) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, 3.2) }
  return b
}

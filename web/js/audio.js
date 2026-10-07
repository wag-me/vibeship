// Synthesized sounds (no audio files). They start only after a user gesture and can be muted.
let ctx = null
let muted = true
try { muted = localStorage.getItem('ao-muted') !== '0' } catch {}

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function tone(freq, dur = 0.12, type = 'sine', vol = 0.08, slide = 0, delay = 0) {
  if (muted) return
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

// Mechanical keyboard: each press is a sharp switch click plus a short low "thock" as the keycap bottoms out,
// and the release is a fainter click. Every parameter is jittered so repeated keys never sound identical.
let noiseBuf = null
let lastKey = 0
let keyBus = null
const KEY_VOL = 0.5 // overall loudness of the typing sounds
function keyOut(c) {
  if (!keyBus) { keyBus = c.createGain(); keyBus.gain.value = KEY_VOL; keyBus.connect(c.destination) }
  return keyBus
}
const jit = (v, amt) => v * (1 - amt + Math.random() * amt * 2)
function noiseHit(c, t0, { type, freq, q = 0.8, vol, dur }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.1), c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005) // a few ms of attack keeps it from sounding dry
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(keyOut(c))
  src.start(t0, Math.random() * 0.05)
  src.stop(t0 + dur + 0.01)
}
function body(c, t0, freq, vol, dur, drop = 0.6) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(freq, t0)
  o.frequency.exponentialRampToValueAtTime(freq * drop, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(keyOut(c))
  o.start(t0)
  o.stop(t0 + dur + 0.01)
}
// size: 1 = letter key, larger = space/enter (deeper, longer, with a little stabilizer rattle)
function mechDown(size = 1) {
  if (muted) return
  const c = ac()
  if (!c) return
  if (c.currentTime - lastKey < 0.02) return
  lastKey = c.currentTime
  const t0 = c.currentTime
  // "thock": mostly a muffled low knock, with only a hint of the switch click on top
  // "creamy": a smooth soft top, a resonant low knock and a quick falling pitch that gives the bubbly pop
  // no resonance in the 300-600 Hz range: that is what makes a key sound hollow and boxy
  noiseHit(c, t0, { type: 'bandpass', freq: jit(3000 / Math.sqrt(size), 0.15), q: 0.5, vol: jit(0.12, 0.2), dur: 0.016 })
  noiseHit(c, t0 + 0.003, { type: 'lowpass', freq: jit(800 / size, 0.12), q: 0.6, vol: jit(0.32, 0.15), dur: 0.05 * size })
  body(c, t0 + 0.002, jit(700 / Math.sqrt(size), 0.1), jit(0.1, 0.15), 0.025 * size, 0.55) // bubble pop
  body(c, t0 + 0.004, jit(120 / size, 0.08), jit(0.24, 0.15), 0.07 * size, 0.75) // heavy body
  if (size > 1) noiseHit(c, t0 + 0.022, { type: 'bandpass', freq: jit(2000, 0.15), q: 0.6, vol: 0.06, dur: 0.025 })
}
function mechUp(size = 1) {
  if (muted) return
  const c = ac()
  if (!c) return
  noiseHit(c, c.currentTime, { type: 'lowpass', freq: jit(2400 / Math.sqrt(size), 0.15), q: 0.6, vol: jit(0.07, 0.25), dur: 0.018 })
}

export const sfx = {
  key: () => mechDown(1),
  keyBig: () => mechDown(1.8),
  keyBack: () => mechDown(1.15),
  keyUp: (big) => mechUp(big ? 1.8 : 1),
  click: () => tone(620, 0.07, 'triangle', 0.06, -120),
  hover: () => tone(880, 0.04, 'sine', 0.02),
  pick: () => { tone(520, 0.08, 'triangle', 0.07, 200); },
  place: () => { tone(300, 0.1, 'sine', 0.1, -120); tone(220, 0.12, 'sine', 0.07, -60, 0.07) },
  select: () => { tone(660, 0.08, 'triangle', 0.07); tone(880, 0.1, 'triangle', 0.06, 0, 0.07) },
  done: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.07, 0, i * 0.09)) },
  error: () => { tone(220, 0.18, 'sawtooth', 0.05, -80) },
  remove: () => tone(380, 0.14, 'triangle', 0.07, -220),
}
export function isMuted() { return muted }
export function setMuted(m, persist = true) {
  muted = m
  if (persist) try { localStorage.setItem('ao-muted', m ? '1' : '0') } catch {}
  if (!m) { ac(); sfx.click() }
}

// Suoni sintetizzati (nessun file audio). Partono solo dopo un gesto dell'utente e si possono spegnere.
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

export const sfx = {
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
export function setMuted(m) {
  muted = m
  try { localStorage.setItem('ao-muted', m ? '1' : '0') } catch {}
  if (!m) { ac(); sfx.click() }
}

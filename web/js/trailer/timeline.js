// Small timeline toolkit for the launch trailer: easing, keyframe tracks, one-shot cues and a seeded random.
// Everything is a pure function of the trailer time, so a run can be replayed (or recorded) frame for frame.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, k) => a + (b - a) * k
// 0..1 progress of t inside [a, b]
export const span = (t, a, b) => clamp((t - a) / (b - a))

export const ease = {
  linear: (x) => x,
  inOut: (x) => x * x * (3 - 2 * x), // smoothstep
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
  out: (x) => 1 - (1 - x) * (1 - x),
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  in: (x) => x * x,
  inCubic: (x) => x * x * x,
  outBack: (x) => { const c = 1.4, y = x - 1; return 1 + (c + 1) * y * y * y + c * y * y },
}

// Keyframed value: track([[t, value, easeIntoThisKey?], ...]) -> (t) => value. Values can be numbers or flat objects of numbers.
export function track(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e] = keys[i]
      if (t > t1) continue
      const [t0, v0] = keys[i - 1]
      const k = (e ?? ease.inOut)(span(t, t0, t1))
      if (typeof v0 === 'number') return lerp(v0, v1, k)
      const out = {}
      for (const key in v0) out[key] = lerp(v0[key], v1[key] ?? v0[key], k)
      return out
    }
    return keys[keys.length - 1][1]
  }
}

// One-shot cues: each fires once, in time order, when the clock passes it (several in one frame keep their order)
export function cueList(list) {
  const cues = [...list].sort((a, b) => a.t - b.t)
  let next = 0
  return {
    update(t) { while (next < cues.length && cues[next].t <= t) cues[next++].run(t) },
    get done() { return next >= cues.length },
  }
}

// Seeded generator (mulberry32): the same sequence on every run
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

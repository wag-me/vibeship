// Camera choreography in the window's own orbit model (azimuth, elevation, zoom around a target point).
// A shot is a function of time; consecutive shots cross-blend, so each move hands over to the next like a real camera op.
import { clamp, ease, lerp } from './timeline.js'

const KEYS = ['az', 'el', 'zoom', 'x', 'y', 'z']
const mix = (a, b, k) => { const o = {}; for (const key of KEYS) o[key] = lerp(a[key], b[key], k); return o }

// shots: [{ at, blend?, pose(t) -> { az, el, zoom, x, y, z } }] sorted by `at`
export function createRig(shots) {
  return {
    pose(t) {
      let i = 0
      while (i + 1 < shots.length && shots[i + 1].at <= t) i++
      const s = shots[i]
      const p = s.pose(t)
      if (i === 0 || !s.blend || t >= s.at + s.blend) return p
      return mix(shots[i - 1].pose(t), p, ease.inOutCubic(clamp((t - s.at) / s.blend)))
    },
  }
}

// Follows a moving point with a critically damped spring: weight and lag, never a robotic lock-on
export function follower(stiffness = 4) {
  const v = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 }
  let primed = false
  return {
    value: v,
    update(dt, p) {
      if (!p) return v
      if (!primed) { primed = true; v.x = p.x; v.y = p.y; v.z = p.z; return v }
      const w = stiffness
      for (const k of ['x', 'y', 'z']) {
        const a = w * w * (p[k] - v[k]) - 2 * w * vel[k]
        vel[k] += a * dt
        v[k] += vel[k] * dt
      }
      return v
    },
  }
}

// A breath of handheld motion (deterministic: a sum of slow sines), scaled by `amount`
export function handheld(t, amount) {
  return {
    x: amount * (Math.sin(t * 0.83) * 0.6 + Math.sin(t * 1.91 + 1.3) * 0.4),
    y: amount * (Math.sin(t * 1.17 + 0.4) * 0.5 + Math.sin(t * 2.3 + 2.1) * 0.3),
    az: amount * 0.012 * Math.sin(t * 0.61 + 0.7),
  }
}

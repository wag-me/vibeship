// The film's 2D layer over the real window: the opening terminal, the iris into the ship, the two lines of copy,
// the captions that name each interaction, the brand card, the person's pointer, and a light grade (vignette, alert
// tint, grain). Every value is computed from the trailer time each frame (no CSS timers), so recorded frames are exact.
import { T, MESSAGE_RHYTHM } from './story.js'
import { ease, span, seeded } from './timeline.js'

const CMD1 = 'claude', CMD2 = '/vibeship'
// a human rhythm for the two commands (seconds after each line starts)
const RHYTHM1 = [0, 0.08, 0.14, 0.24, 0.31, 0.39]
const RHYTHM2 = [0, 0.07, 0.12, 0.17, 0.25, 0.3, 0.36, 0.43, 0.49]
const typed = (t, start, rhythm) => rhythm.filter((d) => t >= start + d).length
// Keystroke times, for the soundtrack
export function typingCues() {
  return [
    ...RHYTHM1.map((d) => ({ t: T.typeClaude + d, kind: 'key' })), { t: T.enterClaude, kind: 'enter' },
    ...RHYTHM2.map((d) => ({ t: T.typeSlash + d, kind: 'key' })), { t: T.enterSlash, kind: 'enter' },
    ...MESSAGE_RHYTHM.map((d) => ({ t: T.typeMsg + d, kind: 'key', v: 0.032 })), { t: T.sendMsg, kind: 'enter', v: 0.05 },
  ]
}

// The person's hand on the mouse: each move comes in from off screen, lands on a target the director tracks
// (an agent, a button), clicks, and drifts away
const MOVES = [
  { target: 'fox', in: T.cursorFox, click: T.clickFox, out: T.clickFox + 0.3, from: [0.86, 1.05] },
  { target: 'allow', in: T.cursorIn, click: T.click, out: T.allow + 0.6, from: [0.8, 1.04] },
  { target: 'fox', in: T.cursorFox2, click: T.clickFox2, out: T.clickFox2 + 0.35, from: [0.84, 1.05] },
]
// The captions: what the person just did, in a few words
const CAPTIONS = [
  { t0: T.capCrew, t1: 8.9, eyebrow: 'Sessions', text: 'Every Claude Code session joins the crew.' },
  { t0: T.capChat, t1: T.cardOut + 0.15, eyebrow: 'Chat', text: 'Talk to them.' },
  { t0: T.capPerm, t1: T.permGone - 0.2, eyebrow: 'Permissions', text: 'They ask. You decide.' },
  { t0: T.capReply, t1: T.brand - 0.55, eyebrow: 'Replies', text: 'Their answers, right here.' },
]

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }
const ARROW = '<svg viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.3 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z" fill="#fff" stroke="#14182e" stroke-width="1.6" stroke-linejoin="round"/></svg>'

export function createOverlay(stage) {
  // under the interface (over the 3D picture): vignette and the red alert tint
  const under = el('div', 'c-under')
  const vignette = el('div', 'c-vignette'), alertTint = el('div', 'c-alert')
  under.append(vignette, alertTint)
  stage.insertBefore(under, document.getElementById('labels'))

  // over everything
  const root = el('div', 'c-root')
  const term = el('div', 'c-term')
  const lines = el('div', 'c-lines')
  const l1 = el('div', 'l dim', '~/code/checkout-api')
  const l2 = el('div', 'l', '<span class="p">$</span> <span class="v"></span>')
  const l3 = el('div', 'l', '<span class="p">&gt;</span> <span class="v acc"></span>')
  const l4 = el('div', 'l dim out', '⎿&nbsp; Vibeship window opened: http://127.0.0.1:47890')
  const cursor = el('span', 'cur')
  lines.append(l1, l2, l3, l4)
  term.append(lines)
  const ring = el('div', 'c-ring')
  const title = el('div', 'c-title'), h1 = el('h1')
  title.append(h1)
  const brandBg = el('div', 'c-brand-bg')
  const brand = el('div', 'c-brand')
  const mark = el('img', 'c-mark'); mark.src = '/icons/icon.svg'; mark.alt = ''
  const word = el('div', 'c-word', 'VIBESHIP')
  const tagline = el('div', 'c-tagline', 'See your agents work. Talk to them.')
  const install = el('div', 'c-install', 'A free mod for Claude Code <span>·</span> github.com/wag-me/vibeship')
  brand.append(mark, word, tagline, install)
  const flash = el('div', 'c-flash')
  const grain = el('div', 'c-grain')
  grain.style.backgroundImage = `url(${grainTexture()})`
  const pointer = el('div', 'c-pointer', ARROW)
  const cap = el('div', 'c-cap', '<small></small><b></b>')
  const capEyebrow = cap.querySelector('small'), capText = cap.querySelector('b')
  root.append(brandBg, term, ring, title, cap, brand, flash, pointer, grain)
  stage.append(root)

  const v2 = l2.querySelector('.v'), v3 = l3.querySelector('.v')
  const set = (e, prop, val) => { if (e._s?.[prop] !== val) { (e._s ??= {})[prop] = val; e.style[prop] = val } }
  const aim = new Map() // move -> where it last saw its target (it stays there once it has clicked)

  return {
    root,
    // t: trailer time; ctx: { targets: { name: { x, y } in stage pixels, or null }, alert }
    update(t, ctx = {}) {
      // ---- terminal ----
      const n1 = typed(t, T.typeClaude, RHYTHM1), n2 = typed(t, T.typeSlash, RHYTHM2)
      v2.textContent = CMD1.slice(0, n1)
      v3.textContent = CMD2.slice(0, n2)
      set(l1, 'opacity', String(span(t, 0.05, 0.4)))
      set(l2, 'opacity', String(span(t, 0.2, 0.4)))
      set(l3, 'opacity', t >= T.enterClaude + 0.12 ? '1' : '0')
      set(l4, 'opacity', String(span(t, T.enterSlash + 0.06, T.enterSlash + 0.2) * 0.9))
      const line = t < T.enterClaude + 0.12 ? l2 : l3
      if (cursor.parentNode !== line) line.append(cursor)
      const typing = (t > T.typeClaude - 0.1 && t < T.enterClaude + 0.1) || (t > T.typeSlash - 0.1 && t < T.enterSlash + 0.1)
      set(cursor, 'opacity', t > T.enterSlash + 0.06 ? '0' : typing || (t % 1) < 0.55 ? '1' : '0')
      // the terminal steps back as the copy arrives
      const back = ease.outCubic(span(t, T.enterSlash + 0.15, T.headline + 0.5))
      set(lines, 'opacity', String(1 - back * 0.82))
      set(lines, 'transform', `translate(-50%, calc(-50% - ${(back * 3.2).toFixed(3)}cqh)) scale(${(1 - back * 0.04).toFixed(4)})`)
      set(lines, 'filter', `blur(${(back * 0.18).toFixed(3)}cqw)`)
      // ---- the iris: the command opens a round window onto the ship ----
      const ir = span(t, T.reveal, T.reveal + 0.95)
      const r = ease.inOutCubic(ir) * 125 // % of the stage half-diagonal
      if (ir <= 0) { set(term, 'maskImage', 'none'); set(term, 'webkitMaskImage', 'none'); set(term, 'display', '') }
      else if (ir >= 1) set(term, 'display', 'none')
      else {
        const m = `radial-gradient(circle at 50% 50%, transparent ${r.toFixed(2)}cqmax, #000 ${(r + 2.5).toFixed(2)}cqmax)`
        set(term, 'maskImage', m); set(term, 'webkitMaskImage', m); set(term, 'display', '')
      }
      set(ring, 'opacity', String(ir > 0 && ir < 1 ? (1 - ir) * 0.9 : 0))
      set(ring, 'background', `radial-gradient(circle at 50% 50%, transparent ${(r - 1.4).toFixed(2)}cqmax, rgba(120,230,255,.55) ${(r + 0.3).toFixed(2)}cqmax, rgba(255,214,150,.25) ${(r + 1.4).toFixed(2)}cqmax, transparent ${(r + 3.2).toFixed(2)}cqmax)`)
      set(flash, 'opacity', String(Math.max(0, 1 - Math.abs(t - (T.reveal + 0.18)) / 0.35) * 0.32))

      // ---- the copy ----
      let text = '', op = 0, track = 0.2, blur = 0, scale = 1
      // one line, held across the reveal so it can be read: the window opening is the answer to it
      if (t >= T.headline - 0.05 && t < T.headlineOut + 0.6) {
        text = 'Your agents are already working.'
        const a = ease.outCubic(span(t, T.headline, T.headline + 0.6)), b = span(t, T.headlineOut, T.headlineOut + 0.6)
        op = a * (1 - b); track = 0.36 - 0.14 * a + b * 0.06; blur = (1 - a) * 0.5 + b * 0.4; scale = 1 + b * 0.04
      }
      if (h1.textContent !== text) h1.textContent = text
      set(h1, 'opacity', op.toFixed(3))
      set(h1, 'letterSpacing', track.toFixed(3) + 'em')
      set(h1, 'filter', `blur(${blur.toFixed(3)}cqw)`)
      set(h1, 'transform', `scale(${scale.toFixed(4)})`)

      // ---- grade ----
      const brandK = span(t, T.brand - 0.2, T.brand + 1.0)
      set(vignette, 'opacity', String(0.75 + 0.25 * brandK))
      const alertOn = ctx.alert ?? 0
      set(alertTint, 'opacity', (alertOn * (0.55 + 0.45 * Math.sin(t * 6))).toFixed(3))
      set(grain, 'backgroundPosition', `${Math.floor(t * 24) * 37 % 256}px ${Math.floor(t * 24) * 91 % 256}px`)

      // ---- the brand ----
      set(brandBg, 'opacity', ease.inOut(span(t, T.brand, T.brand + 1.2)).toFixed(3))
      const m = ease.outBack(span(t, T.brand + 0.4, T.brand + 1.05))
      set(mark, 'opacity', String(span(t, T.brand + 0.4, T.brand + 0.7)))
      set(mark, 'transform', `translateY(${((1 - m) * 1.5).toFixed(3)}cqh) scale(${(0.82 + 0.18 * m).toFixed(4)})`)
      const w = ease.outQuint(span(t, T.wordmark, T.wordmark + 1.1))
      set(word, 'opacity', String(ease.out(span(t, T.wordmark, T.wordmark + 0.5))))
      set(word, 'letterSpacing', (0.5 - 0.36 * w).toFixed(3) + 'em')
      set(word, 'filter', `blur(${((1 - w) * 0.5).toFixed(3)}cqw)`)
      word.style.setProperty('--sh', (130 - ease.inOut(span(t, T.wordmark + 0.75, T.wordmark + 1.75)) * 160).toFixed(1) + '%')
      const g = ease.outCubic(span(t, T.tagline, T.tagline + 0.8))
      set(tagline, 'opacity', g.toFixed(3))
      set(tagline, 'transform', `translateY(${((1 - g) * 1.6).toFixed(3)}cqh)`)
      const i = ease.outCubic(span(t, T.install, T.install + 0.7))
      set(install, 'opacity', (i * 0.85).toFixed(3))
      set(install, 'transform', `translateY(${((1 - i) * 1.2).toFixed(3)}cqh)`)

      // ---- the captions ----
      const c = CAPTIONS.find((c) => t >= c.t0 && t < c.t1 + 0.4)
      if (c) {
        if (capText.textContent !== c.text) { capText.textContent = c.text; capEyebrow.textContent = c.eyebrow }
        const a = ease.outCubic(span(t, c.t0, c.t0 + 0.5)), b = ease.inOut(span(t, c.t1, c.t1 + 0.4))
        set(cap, 'opacity', (a * (1 - b)).toFixed(3))
        set(cap, 'transform', `translateX(${((1 - a) * -1.6 - b * 0.8).toFixed(3)}cqw)`)
        set(cap, 'filter', `blur(${((1 - a) * 0.3 + b * 0.25).toFixed(3)}cqw)`)
        set(capText, 'letterSpacing', (0.06 - 0.06 * a).toFixed(3) + 'em')
      } else set(cap, 'opacity', '0')

      // ---- the person's pointer ----
      const mv = MOVES.find((m) => t >= m.in && t < m.out + 0.5)
      const s = mv && stage.getBoundingClientRect()
      const seen = mv && t < mv.click && ctx.targets?.[mv.target]
      if (seen) aim.set(mv, seen)
      if (mv && aim.has(mv)) {
        const goal = aim.get(mv)
        const k = ease.inOutCubic(span(t, mv.in, mv.click - 0.12))
        const start = { x: s.width * mv.from[0], y: s.height * mv.from[1] }
        // a gentle arc, like a hand moving a mouse
        const x = start.x + (goal.x - start.x) * k + Math.sin(k * Math.PI) * s.width * 0.03
        const y = start.y + (goal.y - start.y) * k - Math.sin(k * Math.PI) * s.height * 0.06
        const press = t >= mv.click - 0.03 && t < mv.click + 0.09 ? 0.86 : 1
        const leave = span(t, mv.out, mv.out + 0.5)
        set(pointer, 'opacity', String(span(t, mv.in, mv.in + 0.25) * (1 - leave)))
        set(pointer, 'transform', `translate(${(x + leave * s.width * 0.05).toFixed(1)}px, ${(y + leave * s.height * 0.04).toFixed(1)}px) scale(${press})`)
      } else set(pointer, 'opacity', '0')
    },
  }
}

// A small tile of film grain, made once (seeded, so it is the same tile on every run)
function grainTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d'), img = g.createImageData(256, 256), r = seeded(99)
  for (let i = 0; i < img.data.length; i += 4) { const v = 96 + r() * 64; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
  g.putImageData(img, 0, 0)
  return c.toDataURL()
}

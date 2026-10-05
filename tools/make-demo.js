// Builds docs/demo.gif for the README: runs the window in headless Edge/Chrome, plays a scripted scene
// (an agent working, a subagent flying in and roaming, a chat message and its reply) on a virtual clock,
// grabs a screenshot per step and encodes the GIF with a small encoder (no dependencies, no ffmpeg).
// Run with `node tools/make-demo.js`. The scene is simulated with made-up events: it shows how the window looks.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const zlib = require('node:zlib')

const OUT = path.join(__dirname, '..', 'docs', 'demo.gif')
const W = 800, H = 450 // GIF size; the window is rendered at 1280x720
const FRAMES = Number(process.env.DEMO_FRAMES || 96)
const KEEP_FRAMES = process.env.DEMO_KEEP // folder to also save the PNG frames to (for checking by eye)
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

// ---------------- PNG decoding, resizing ----------------
function decodePng(buf) {
  let p = 8, w, h, ct, bd
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; if (data[12]) throw new Error('interlaced PNG') }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0
  if (!bpp || bd !== 8) throw new Error('unsupported PNG')
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, rgb = Buffer.alloc(w * h * 3)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      line[i] = v & 255
    }
    for (let x = 0; x < w; x++) { rgb[(y * w + x) * 3] = line[x * bpp]; rgb[(y * w + x) * 3 + 1] = line[x * bpp + 1]; rgb[(y * w + x) * 3 + 2] = line[x * bpp + 2] }
    prev = line
  }
  return { w, h, rgb }
}
function resize(img, tw, th) { // box filter
  const out = Buffer.alloc(tw * th * 3), sx = img.w / tw, sy = img.h / th
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0, g = 0, b = 0, n = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.w + xx) * 3; r += img.rgb[i]; g += img.rgb[i + 1]; b += img.rgb[i + 2]; n++ }
      const o = (y * tw + x) * 3
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n
    }
  }
  return out
}

// ---------------- palette (median cut) and GIF encoding ----------------
function medianCut(pixels, n) {
  const chan = (c, k) => (c >> (16 - 8 * k)) & 255
  let boxes = [pixels]
  while (boxes.length < n) {
    let bi = -1, best = -1, bk = 0
    boxes.forEach((b, i) => {
      if (b.length < 2) return
      for (let k = 0; k < 3; k++) {
        let lo = 255, hi = 0
        for (const c of b) { const v = chan(c, k); if (v < lo) lo = v; if (v > hi) hi = v }
        const score = (hi - lo) * Math.sqrt(b.length)
        if (score > best) { best = score; bi = i; bk = k }
      }
    })
    if (bi < 0) break
    const b = boxes[bi].sort((p, q) => chan(p, bk) - chan(q, bk)), mid = b.length >> 1
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid))
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0
    for (const c of b) { r += chan(c, 0); g += chan(c, 1); bl += chan(c, 2) }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)]
  })
}
function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1
  let codeSize = minCode + 1, next = eoi + 1, dict = new Map(), cur = 0, curBits = 0
  const out = []
  const emit = (code) => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8 } }
  emit(clear)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k, hit = dict.get(key)
    if (hit !== undefined) { prefix = hit; continue }
    emit(prefix)
    if (next < 4096) { const c = next++; dict.set(key, c); if (c === 1 << codeSize && codeSize < 12) codeSize++ }
    else { emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1 }
    prefix = k
  }
  emit(prefix); emit(eoi)
  if (curBits > 0) out.push(cur & 255)
  return Buffer.from(out)
}
function subBlocks(data) {
  const parts = []
  for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); parts.push(Buffer.from([n]), data.subarray(i, i + n)) }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}
function encodeGif(frames, w, h, delayCs) { // frames: RGB buffers of w*h
  const sample = []
  const stride = Math.max(1, Math.floor((frames.length * w * h) / 250000))
  frames.forEach((f, fi) => { for (let p = (fi * 7) % stride; p < w * h; p += stride) sample.push((f[p * 3] << 16) | (f[p * 3 + 1] << 8) | f[p * 3 + 2]) })
  const pal = medianCut(sample, 255)
  const TRANSP = 255
  const table = Buffer.alloc(256 * 3)
  pal.forEach((c, i) => { table[i * 3] = c[0]; table[i * 3 + 1] = c[1]; table[i * 3 + 2] = c[2] })
  const cache = new Int16Array(32768).fill(-1)
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    if (cache[key] >= 0) return cache[key]
    const cr = (r & 248) | 4, cg = (g & 248) | 4, cb = (b & 248) | 4
    let bi = 0, bd = 1e9
    for (let i = 0; i < pal.length; i++) { const d = (pal[i][0] - cr) ** 2 + (pal[i][1] - cg) ** 2 + (pal[i][2] - cb) ** 2; if (d < bd) { bd = d; bi = i } }
    return (cache[key] = bi)
  }
  const head = Buffer.alloc(13)
  head.write('GIF89a', 0, 'ascii'); head.writeUInt16LE(w, 6); head.writeUInt16LE(h, 8); head[10] = 0xf7; head[11] = 0; head[12] = 0
  const parts = [head, table, Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0', 'ascii'), Buffer.from([3, 1, 0, 0, 0])]
  let prev = null
  for (const f of frames) {
    const idx = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) idx[p] = nearest(f[p * 3], f[p * 3 + 1], f[p * 3 + 2])
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    const sub = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (prev && prev[p] === idx[p]) { sub[p] = TRANSP; continue }
      sub[p] = idx[p]
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0 } // identical frame: a single transparent pixel
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, crop = new Uint8Array(cw * ch)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = x1 < 0 ? TRANSP : sub[(y0 + y) * w + x0 + x]
    const gce = Buffer.from([0x21, 0xf9, 4, prev ? 0x05 : 0x04, delayCs & 255, delayCs >> 8, TRANSP, 0])
    const desc = Buffer.alloc(10)
    desc[0] = 0x2c; desc.writeUInt16LE(x0, 1); desc.writeUInt16LE(y0, 3); desc.writeUInt16LE(cw, 5); desc.writeUInt16LE(ch, 7); desc[9] = 0
    parts.push(gce, desc, Buffer.from([8]), subBlocks(lzw(crop, 8)))
    prev = idx
  }
  parts.push(Buffer.from([0x3b]))
  return Buffer.concat(parts)
}

// ---------------- scripted scene ----------------
let server, browser, tmp, ws, nextId = 1
const pending = new Map()
const cdp = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })) }
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }

async function main() {
  const exe = BROWSERS.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('No Edge/Chrome found')
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeship-demo-'))
  const port = await freePort(), base = 'http://127.0.0.1:' + port
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_DIR: path.join(tmp, 'data'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), VIBESHIP_NO_UPDATE_CHECK: '1' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/ping')).ok) break } catch {} await sleep(100) }
  const token = fs.readFileSync(path.join(tmp, 'data', 'token'), 'utf8').trim()
  const post = async (p, body, auth) => { await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'x-token': token } : {}) }, body: JSON.stringify(body) }); await sleep(90) }
  const event = (e) => post('/api/event', { session: 's1', ...e })

  const dbg = await freePort()
  browser = spawn(exe, ['--headless=new', '--remote-debugging-port=' + dbg, '--user-data-dir=' + path.join(tmp, 'profile'), '--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch('http://127.0.0.1:' + dbg + '/json')).json()).find((t) => t.type === 'page') } catch {} if (!target) await sleep(150) }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) } }
  await cdp('Page.enable'); await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  // a virtual clock and no animation loop: every frame of the scene advances by exactly one step, however slow the screenshots are
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'let __vt = 1000; performance.now = () => __vt; window.__adv = (ms) => { __vt += ms }; window.requestAnimationFrame = () => 0' })
  await cdp('Page.navigate', { url: base + '/?t=' + token })
  for (let i = 0; i < 100; i++) { if (await ev('!!window.__ao').catch(() => false)) break; await sleep(200) }

  const STEP = 7 // simulation frames of 1/60 s per GIF frame (~8.6 fps)
  const advance = (n = 1) => ev(`for (let i = 0; i < ${n}; i++) { window.__adv(${(STEP * 1000) / 60}); window.__ao.step(${STEP}, 1 / 60) }`)
  await event({ type: 'session_start', label: 'vibeship', look: { species: 'fox', shirt: 0 }, loc: 'bridge' })
  for (let i = 0; i < 50 && !(await ev('window.__ao.agents.size')); i++) await sleep(100)
  await event({ type: 'tool', status: 'write', detail: 'server.js' })
  await advance(60) // walks in through the hatch and sits at its console

  const frames = []
  let snapId = null
  const lastChatId = async () => { const r = await fetch(base + '/stream'); const rd = r.body.getReader(); const { value } = await rd.read(); rd.cancel(); const d = JSON.parse(Buffer.from(value).toString().replace(/^data: /, '').trim()); return (d.chat.s1 || []).filter((m) => m.role === 'user').at(-1)?.id }
  for (let f = 0; f < FRAMES; f++) {
    if (f % 3 === 0) await event({ type: 'tool', status: f < 40 ? 'write' : f < 64 ? 'run' : 'write', detail: f < 40 ? 'server.js' : f < 64 ? 'node --test' : 'README.md' })
    if (f === 10) await event({ type: 'spawn', toolUseId: 't1', name: 'reviewer', description: 'Review server.js for bugs' })
    if (f >= 24 && f % 3 === 0 && f < 70) await event({ type: 'tool', agentId: 'a1', status: 'read', detail: 'server.js' })
    if (f === 44) await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    if (f === 52) {
      await post('/api/command', { session: 's1', kind: 'say', text: 'Add tests for the server' }, true)
      snapId = await lastChatId()
      await event({ type: 'say_delivered', id: snapId })
    }
    if (f === 56) await event({ type: 'turn_start' })
    if (f === 70) await event({ type: 'sub_done', agentId: 'a1', answer: 'server.js looks solid. I found 2 edge cases worth a test.' })
    if (f === 84) await event({ type: 'turn_complete', answer: 'Done! I added 13 server tests and they all pass.', reason: 'answer' })
    await advance(1)
    const shot = await cdp('Page.captureScreenshot', { format: 'png' })
    const png = Buffer.from(shot.data, 'base64')
    if (KEEP_FRAMES) { fs.mkdirSync(KEEP_FRAMES, { recursive: true }); fs.writeFileSync(path.join(KEEP_FRAMES, String(f).padStart(3, '0') + '.png'), png) }
    frames.push(resize(decodePng(png), W, H))
    if (f % 12 === 0) console.log(`frame ${f + 1}/${FRAMES}`)
  }
  console.log('encoding...')
  const gif = encodeGif(frames, W, H, 12)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, gif)
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${(gif.length / 1024 / 1024).toFixed(2)} MB, ${frames.length} frames`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => {
  try { ws?.close() } catch {}
  browser?.kill(); server?.kill()
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} process.exit(process.exitCode || 0) }, 500)
})

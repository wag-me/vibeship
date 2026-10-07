// Records the 30-second launch trailer (/?trailer) frame by frame in headless Edge/Chrome, with no dependencies:
// the film is stepped on a virtual clock (every frame is exactly 1/30 s, however slow the capture is), each frame is
// a 1920x1080 screenshot, and the soundtrack is rendered offline from the same timeline (sample-exact WAV).
// With ffmpeg on the PATH (or FFMPEG=path) it writes the finished MP4; otherwise it keeps the PNG frames and the WAV
// and prints the ffmpeg line to run.
//   node tools/record-launch.js                         -> docs/trailer/vibeship-trailer.mp4
//   node tools/record-launch.js --out my.mp4
//   node tools/record-launch.js --frames                -> also keep the frames (docs/trailer/frames)
//   node tools/record-launch.js --png                   -> lossless PNG frames instead of JPEG q95 (about 3x slower)
//   node tools/record-launch.js --audio-only            -> just the soundtrack (.wav)
//   node tools/record-launch.js --stills 3.5,9,18,24,29 -> only those moments, as PNGs (quick look while editing; --dir to choose where)
//   node tools/record-launch.js --swiftshader           -> software rendering (if the GPU path fails in headless mode)
//   node tools/record-launch.js --gif                   -> docs/demo.gif for the README: the permission-to-reply beat, steady camera
//   node tools/record-launch.js --web                   -> docs/demo.mp4 for the website: the whole film, light, no sound
//        --from 17 --to 27 --fps 8 --width 560           the cut, its frame rate and width (these are --gif's defaults;
//                                                        --web's are the whole film at 30 fps, 1280 wide). Both need ffmpeg
//        --frames --dir <folder>                         also keep the JPEG frames, to try other encodings with ffmpeg
//   Both stay out of git on main: commit them to the `media` branch, then rerun the Website workflow
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf('--' + name); return i < 0 ? null : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true }
const OUT_DIR = path.join(ROOT, 'docs', 'trailer')
const GIF = !!opt('gif'), WEB = !GIF && !!opt('web')
const num = (name, def) => (typeof opt(name) === 'string' ? Number(opt(name)) : def)
const OUT = path.resolve(opt('out') && opt('out') !== true ? opt('out') : path.join(ROOT, 'docs', GIF ? 'demo.gif' : WEB ? 'demo.mp4' : 'trailer/vibeship-trailer.mp4'))
const STILLS = typeof opt('stills') === 'string' ? opt('stills').split(',').map(Number) : null
const KEEP_FRAMES = !!opt('frames')
const PNG = !!opt('png'), EXT = PNG ? 'png' : 'jpg'
// CSS size and device scale: 1920x1080 pixels, interface at a readable size (a GIF or web cut is not bigger: 1280x720)
const W = 1280, H = 720, SCALE = GIF || WEB ? 1 : 1.5
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
function findFfmpeg() {
  const c = process.env.FFMPEG || 'ffmpeg'
  try { return spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0 ? c : null } catch { return null }
}

let server, browser, tmp, ws, nextId = 1
const pending = new Map()
const cdp = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })) }
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }

async function main() {
  const exe = BROWSERS.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('No Edge/Chrome found')
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeship-trailer-'))
  const port = await freePort(), base = 'http://127.0.0.1:' + port
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env: { ...process.env, VIBESHIP_PORT: String(port), VIBESHIP_DIR: path.join(tmp, 'data'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), VIBESHIP_NO_UPDATE_CHECK: '1' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/ping')).ok) break } catch {} await sleep(100) }

  const dbg = await freePort()
  const gl = opt('swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default']
  browser = spawn(exe, ['--headless=new', '--remote-debugging-port=' + dbg, '--user-data-dir=' + path.join(tmp, 'profile'), `--window-size=${W},${H}`, ...gl, '--hide-scrollbars', '--no-first-run', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch('http://127.0.0.1:' + dbg + '/json')).json()).find((t) => t.type === 'page') } catch {} if (!target) await sleep(150) }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) } }
  await cdp('Page.enable'); await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false })
  // no animation loop of its own: the recorder advances the film one frame at a time
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0' })
  await cdp('Page.navigate', { url: base + '/?trailer&record' + (GIF ? '&steady' : '') })
  for (let i = 0; i < 150; i++) { if (await ev('!!(window.__trailer && window.__trailer.ready)').catch(() => false)) break; await sleep(200) }
  if (!(await ev('!!(window.__trailer && window.__trailer.ready)'))) throw new Error('The trailer did not start (open /?trailer in a browser to see why)')
  const renderer = await ev('(() => { const g = window.__ao.renderer.getContext(); const x = g.getExtension("WEBGL_debug_renderer_info"); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : "?" })()')
  console.log('renderer: ' + renderer)
  const { fps, frames } = await ev('({ fps: __trailer.fps, frames: __trailer.frames })')
  // JPEG at q95 is visually lossless and several times faster for Chrome to encode at 1080p than PNG
  const shot = async (png = PNG) => Buffer.from((await cdp('Page.captureScreenshot', png ? { format: 'png' } : { format: 'jpeg', quality: 95 })).data, 'base64')

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  await ev('__trailer.start()')
  if (STILLS) {
    const dir = typeof opt('dir') === 'string' ? path.resolve(opt('dir')) : path.join(OUT_DIR, 'stills')
    fs.mkdirSync(dir, { recursive: true })
    const want = new Set(STILLS.map((s) => Math.max(1, Math.round(s * fps))))
    const last = Math.max(...want)
    for (let f = 1; f <= last; f++) {
      await ev('__trailer.advance()')
      if (want.has(f)) { const file = path.join(dir, `t${(f / fps).toFixed(2)}.png`); fs.writeFileSync(file, await shot(true)); console.log('still ' + path.relative(process.cwd(), file)) }
    }
    return
  }

  if (GIF || WEB) return recordCut(fps, frames, shot)

  const wavFile = OUT.replace(/\.[^.]+$/, '') + '.wav'
  console.log('rendering the soundtrack...')
  fs.writeFileSync(wavFile, Buffer.from(await ev('__trailer.audio()'), 'base64'))
  if (opt('audio-only')) { console.log('wrote ' + path.relative(process.cwd(), wavFile)); return }
  const ffmpeg = findFfmpeg()
  const framesDir = path.join(path.dirname(OUT), 'frames')
  if (KEEP_FRAMES || !ffmpeg) fs.mkdirSync(framesDir, { recursive: true })
  let enc = null, encDone = null
  if (ffmpeg) {
    enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', PNG ? 'png' : 'mjpeg', '-i', '-', '-i', wavFile,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(fps),
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', OUT], { stdio: ['pipe', 'inherit', 'inherit'] })
    encDone = new Promise((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited with ' + c)))))
  }
  const t0 = Date.now()
  for (let f = 1; f <= frames; f++) {
    await ev('__trailer.advance()')
    const img = await shot()
    if (KEEP_FRAMES || !ffmpeg) fs.writeFileSync(path.join(framesDir, 'frame-' + String(f).padStart(4, '0') + '.' + EXT), img)
    if (enc && !enc.stdin.write(img)) await new Promise((r) => enc.stdin.once('drain', r))
    if (f % 30 === 0) { const s = (Date.now() - t0) / 1000; console.log(`frame ${f}/${frames}, ${(f / s).toFixed(1)} fps, ~${Math.round((frames - f) * s / f)} s left`) }
  }
  if (enc) {
    enc.stdin.end()
    await encDone
    console.log('wrote ' + path.relative(process.cwd(), OUT) + ' (' + (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB)')
  } else {
    const out = path.relative(process.cwd(), OUT), fr = path.relative(process.cwd(), path.join(framesDir, 'frame-%04d.' + EXT)), wav = path.relative(process.cwd(), wavFile)
    console.log(`\nffmpeg was not found, so the frames and the soundtrack are kept:\n  ${path.relative(process.cwd(), framesDir)}  (${frames} ${EXT.toUpperCase()}, 1920x1080, ${fps} fps)\n  ${wav}\nTo make the MP4 (install ffmpeg first, e.g. winget install ffmpeg / brew install ffmpeg):\n  ffmpeg -framerate ${fps} -i "${fr}" -i "${wav}" -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart -shortest "${out}"`)
  }
}

// A cut of the film for the README (GIF) or the website (MP4): every film frame is stepped (the story stays
// frame-exact), only every n-th is shot. The GIF gets one palette for the whole cut (stats_mode=diff favours what
// moves), no dithering and only the changed rectangle of each frame: a camera that never stops already costs ~0.5 MB/s.
async function recordCut(fps, frames, shot) {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) throw new Error((GIF ? '--gif' : '--web') + ' needs ffmpeg on the PATH (or FFMPEG=path)')
  const from = num('from', GIF ? 17 : 0), to = num('to', GIF ? 27 : 30), gfps = num('fps', GIF ? 8 : fps), width = num('width', GIF ? 560 : 1280)
  const every = Math.max(1, Math.round(fps / gfps)), first = Math.max(1, Math.round(from * fps)), last = Math.min(frames, Math.round(to * fps))
  const codec = GIF
    ? ['-vf', `scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0']
    : ['-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']
  const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps / every), '-c:v', 'mjpeg', '-i', '-', ...codec, OUT], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited with ' + c)))))
  const dir = KEEP_FRAMES ? (typeof opt('dir') === 'string' ? path.resolve(opt('dir')) : path.join(OUT_DIR, 'cut-frames')) : null // to try other encodings without filming again
  if (dir) fs.mkdirSync(dir, { recursive: true })
  for (let f = 1, n = 0; f <= last; f++) {
    await ev('__trailer.advance()')
    if (f < first || (f - first) % every) continue
    const img = await shot(false)
    if (dir) fs.writeFileSync(path.join(dir, 'f' + String(++n).padStart(4, '0') + '.jpg'), img)
    if (!enc.stdin.write(img)) await new Promise((r) => enc.stdin.once('drain', r))
    if (f % (fps * 2) === 0) console.log(`${(f / fps).toFixed(0)} s / ${to} s`)
  }
  enc.stdin.end()
  await done
  console.log('wrote ' + path.relative(process.cwd(), OUT) + ' (' + (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB)')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => {
  try { ws?.close() } catch {}
  browser?.kill(); server?.kill()
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} process.exit(process.exitCode || 0) }, 500)
})

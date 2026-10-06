// Plays the launch trailer live, for screen capture (OBS, Screen Studio...): starts this repo's server on a free port
// with a throwaway data folder (your real Vibeship layout and token are not touched) and opens Edge/Chrome as a bare
// app window at 1920x1080 pixels, allowed to start the soundtrack by itself. The film starts after a short black hold.
//   node tools/launch-trailer.js               autoplay after 2 s
//   node tools/launch-trailer.js --delay 5     longer black hold before it starts (time to hit record)
//   node tools/launch-trailer.js --manual      wait on the Play card instead
//   node tools/launch-trailer.js --fullscreen  kiosk mode (Alt+F4 to leave), for a full-screen capture
//   node tools/launch-trailer.js --mute        no soundtrack
// In the window: R replays from the start, F toggles full screen.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const has = (f) => args.includes('--' + f)
const val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeship-trailer-'))
  const port = await freePort(), base = 'http://127.0.0.1:' + port
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env: { ...process.env, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_DIR: path.join(tmp, 'data'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), VIBESHIP_NO_UPDATE_CHECK: '1' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/ping')).ok) break } catch {} await sleep(100) }
  const q = ['trailer', ...(has('manual') ? [] : ['autoplay', 'delay=' + Number(val('delay', 2))]), ...(has('mute') ? ['mute'] : [])]
  const url = base + '/?' + q.join('&')
  const cleanup = () => { server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} }
  process.on('SIGINT', () => { cleanup(); process.exit(0) })

  const exe = BROWSERS.find((p) => fs.existsSync(p))
  if (!exe) { console.log('Open this address in Chrome or Edge (Ctrl+C here to stop):\n  ' + url); return }
  const scale = Number(val('scale', 1.5)) // 1280x720 page at 1.5 = 1920x1080 pixels, the interface at a readable size
  const browser = spawn(exe, [
    '--app=' + url, '--user-data-dir=' + path.join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=' + scale, `--window-size=${Math.round(1920 / scale)},${Math.round(1080 / scale)}`,
    ...(has('fullscreen') ? ['--kiosk'] : []),
  ], { stdio: 'ignore' })
  console.log('Vibeship launch trailer: ' + url + '\nIn the window: R replays, F full screen. Close the window (or Ctrl+C here) to stop.')
  browser.on('exit', () => { cleanup(); process.exit(0) })
}
main().catch((e) => { console.error(e); process.exitCode = 1 })

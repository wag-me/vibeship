// Live UI check: starts the server, opens the window in headless Edge/Chrome and drives it through the DevTools protocol.
// Run with `node tests/ui-smoke.js` (needs Edge or Chrome installed; no npm packages). Saves a screenshot next to this file.
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let server, browser, tmp, ws, web, webPort, nextId = 1
const pending = new Map()
const errors = []
const results = []

async function cdp(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => pending.set(id, { res, rej }))
}
const ev = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result.value
}
const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
const key = async (code, k, type) => cdp('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyR: 82, Delete: 46, Tab: 9 }[code] || 0 })
async function drag(from, to) {
  await mouse('mouseMoved', from[0], from[1], { button: 'none', buttons: 0 })
  await mouse('mousePressed', from[0], from[1])
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
  await mouse('mouseReleased', to[0], to[1])
  await sleep(150)
}
async function click(x, y) { await mouse('mouseMoved', x, y, { button: 'none', buttons: 0 }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(120) }
// screen position of a furniture item, from the live scene
const screenOf = (id) => ev(`(() => { const a = window.__ao; const f = a.furn.get(${JSON.stringify(id)}); const v = new a.THREE.Vector3(f.group.position.x, 0.6, f.group.position.z).project(a.camera); const r = document.getElementById('gl').getBoundingClientRect(); return [(v.x * 0.5 + 0.5) * r.width + r.left, (-v.y * 0.5 + 0.5) * r.height + r.top] })()`)

async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ✔ ' + name) } catch (e) { results.push(['FAIL', name, e]); console.log('  ✘ ' + name + '\n      ' + (e.message || e).split('\n')[0]) }
}

async function main() {
  const exe = BROWSERS.find((p) => fs.existsSync(p))
  if (!exe) { console.log('No Edge/Chrome found: skipping'); return process.exit(0) }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeship-ui-'))
  const port = await freePort()
  const base = 'http://127.0.0.1:' + port
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, VIBESHIP_PORT: String(port), VIBESHIP_DIR: path.join(tmp, 'data'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), VIBESHIP_UPDATE_URL: 'data:application/json,{"version":"99.0.0"}' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/ping')).ok) break } catch {} await sleep(100) }
  const token = fs.readFileSync(path.join(tmp, 'data', 'token'), 'utf8').trim()
  const post = (p, body, auth = false) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'x-token': token } : {}) }, body: JSON.stringify(body) })
  const work = path.join(tmp, 'work'); fs.mkdirSync(path.join(work, 'src'), { recursive: true }); fs.writeFileSync(path.join(work, 'src', 'app.js'), 'let hello = 1\n')
  await post('/api/event', { type: 'session_start', session: 's1', label: 'demo', loc: 'bridge', cwd: work })
  await post('/api/event', { type: 'commands', session: 's1', list: [{ name: 'model', description: 'Switch model' }, { name: 'compact', description: 'Compact' }, { name: 'cost', description: 'Show cost' }] })

  const dbgPort = await freePort()
  browser = spawn(exe, ['--headless=new', '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + path.join(tmp, 'profile'), '--window-size=1600,950', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch('http://127.0.0.1:' + dbgPort + '/json')).json()).find((t) => t.type === 'page') } catch {} if (!target) await sleep(150) }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) }
    else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '))
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon|apple-touch/.test(d.params.entry.url || '')) errors.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
  }
  await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('Page.enable')
  await cdp('Page.navigate', { url: base + '/?t=' + token })
  for (let i = 0; i < 100; i++) { if (await ev('!!window.__ao && window.__ao.agents.size >= 1').catch(() => false)) break; await sleep(200) }

  console.log('Window checks:')
  await step('the window loads, connects and shows the agent', async () => {
    assert.equal(await ev('window.__ao.agents.size'), 1)
    assert.equal(await ev("document.getElementById('conn').textContent"), 'connected')
    assert.equal(await ev("document.getElementById('count').textContent"), '1 resident')
  })
  await step('the header shows the full logo', async () => {
    assert.match(await ev("document.querySelector('.brand img').getAttribute('src')"), /logo\.svg$/)
  })
  await step('edit mode starts off: add / rotate / delete / reset are disabled', async () => {
    for (const id of ['add-btn', 'rot', 'del', 'reset']) assert.equal(await ev(`document.getElementById('${id}').disabled`), true, id)
    assert.equal(await ev("document.getElementById('edit-btn').getAttribute('aria-pressed')"), 'false')
  })

  const items = await ev('window.__ao.items().map((i) => ({ id: i.id, type: i.type, x: i.x, z: i.z }))')
  const sofa = items.find((i) => i.type === 'sofa')
  await step('outside edit mode, dragging furniture moves the view and not the furniture', async () => {
    const p = await screenOf(sofa.id)
    const camBefore = await ev('window.__ao.goal.target.x + "," + window.__ao.goal.target.z')
    await drag(p, [p[0] + 160, p[1] + 90])
    const now = await ev(`(() => { const i = window.__ao.items().find((i) => i.id === ${JSON.stringify(sofa.id)}); return [i.x, i.z] })()`)
    assert.deepEqual(now, [sofa.x, sofa.z])
    assert.notEqual(await ev('window.__ao.goal.target.x + "," + window.__ao.goal.target.z'), camBefore)
  })
  await step('outside edit mode, clicking furniture selects it; Delete only warns', async () => {
    await ev('window.__ao.goal.target.set(0, 0.8, 0.4)'); await ev('window.__ao.step(60)')
    const p = await screenOf(sofa.id)
    await click(p[0], p[1])
    assert.deepEqual(await ev('window.__ao.selected'), { kind: 'furn', id: sofa.id })
    await key('Delete', 'Delete', 'keyDown'); await key('Delete', 'Delete', 'keyUp')
    assert.equal(await ev('window.__ao.items().length'), items.length)
    assert.match(await ev("document.getElementById('toast').textContent"), /Edit mode/)
  })
  await step('WASD moves the view relative to the camera and stops on release', async () => {
    await ev('window.__ao.goal.target.set(0, 0.8, 0.4); window.__ao.step(30)')
    const read = () => ev('[window.__ao.goal.target.x, window.__ao.goal.target.z]')
    const a = await read()
    await key('KeyD', 'd', 'keyDown'); await ev('window.__ao.step(24, 1 / 60)'); await key('KeyD', 'd', 'keyUp')
    const b = await read()
    assert.notDeepEqual(a, b)
    await ev('window.__ao.step(24, 1 / 60)')
    assert.deepEqual(await read(), b)
    await key('KeyW', 'w', 'keyDown'); await ev('window.__ao.step(18, 1 / 60)'); await key('KeyW', 'w', 'keyUp')
    assert.notDeepEqual(await read(), b)
  })
  await step('turning on edit mode enables the tools', async () => {
    await click(...(await ev("(() => { const r = document.getElementById('edit-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")))
    assert.equal(await ev('document.getElementById("add-btn").disabled'), false)
    assert.equal(await ev("document.getElementById('edit-btn').getAttribute('aria-pressed')"), 'true')
  })
  await step('in edit mode, dragging furniture moves it (and rotate works)', async () => {
    await ev('window.__ao.goal.target.set(0, 0.8, 0.4); window.__ao.step(60)')
    const lamp = items.find((i) => i.type === 'lamp') || items.find((i) => i.type === 'plant')
    const p = await screenOf(lamp.id)
    await drag(p, [p[0] + 70, p[1] - 50])
    await ev('window.__ao.step(30)')
    const now = await ev(`(() => { const i = window.__ao.items().find((i) => i.id === ${JSON.stringify(lamp.id)}); return [i.x, i.z] })()`)
    assert.notDeepEqual(now, [lamp.x, lamp.z])
    await ev(`window.__ao.select({ kind: 'furn', id: ${JSON.stringify(lamp.id)} })`) // a thin lamp is easy to miss with the mouse
    const rot0 = await ev(`window.__ao.items().find((i) => i.id === ${JSON.stringify(lamp.id)}).rot`)
    await key('KeyR', 'r', 'keyDown'); await key('KeyR', 'r', 'keyUp')
    assert.notEqual(await ev(`window.__ao.items().find((i) => i.id === ${JSON.stringify(lamp.id)}).rot`), rot0)
  })
  await step('catalog adds furniture only in edit mode', async () => {
    const before = await ev('window.__ao.items().length')
    await ev("document.getElementById('add-btn').click()")
    await ev("document.querySelector('#grid .card').click()")
    for (let i = 0; i < 10 && (await ev('window.__ao.items().length')) !== before + 1; i++) await sleep(100) // the layout may be re-synced from the server meanwhile
    assert.equal(await ev('window.__ao.items().length'), before + 1)
    await ev("document.getElementById('cat-close').click()")
  })
  await step('turning edit mode off closes the catalog and locks the tools again', async () => {
    await ev("document.getElementById('add-btn').click()")
    await ev("document.getElementById('edit-btn').click()")
    assert.equal(await ev("document.getElementById('catalog').hidden"), true)
    assert.equal(await ev('document.getElementById("add-btn").disabled'), true)
  })
  await step('selecting a work station offers "Add an agent at this station"', async () => {
    const station = items.find((i) => i.type === 'console')
    await click(...(await screenOf(station.id)))
    assert.equal(await ev("document.getElementById('seatbar').hidden"), false)
    await ev("document.getElementById('seat-add').click()")
    assert.equal(await ev("document.getElementById('spawn').hidden"), false)
    await ev("document.getElementById('sp-close').click()")
  })
  await step('statistics panel opens, fills in, and closes when another header button is pressed', async () => {
    await ev("(() => { const el = document.getElementById('stats'); const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden'); window.__hl = []; Object.defineProperty(el, 'hidden', { configurable: true, get() { return d.get.call(this) }, set(v) { window.__hl.push(v + ' @ ' + new Error().stack.split(String.fromCharCode(10)).slice(2, 5).map((x) => x.trim().split('/').pop()).join(' < ')); d.set.call(this, v) } }) })()")
    await ev("document.getElementById('stats-btn').click()")
    await sleep(500)
    assert.equal(await ev("document.getElementById('stats').hidden"), false)
    assert.ok((await ev("document.getElementById('st-body').children.length")) >= 4)
    await ev("document.getElementById('tod').click()")
    const closed = await ev("document.getElementById('stats').hidden")
    if (!closed) console.log('      trace:', JSON.stringify(await ev('window.__hl')))
    assert.equal(closed, true)
  })
  await step('a subagent roams the room while its task runs, and stops when it completes', async () => {
    await post('/api/event', { type: 'spawn', session: 's1', toolUseId: 't9', name: 'helper', description: 'look around' })
    const getKey = () => ev("[...window.__ao.agents.keys()].find((k) => k.includes('spawn:t9')) || ''")
    let k = ''
    for (let i = 0; i < 40 && !k; i++) { await sleep(150); k = await getKey() }
    assert.ok(k, 'the subagent appeared')
    let task = null
    for (let i = 0; i < 40 && !task; i++) { await ev('window.__ao.step(20, 1 / 60)'); await sleep(250); task = await ev(`(() => { const t = window.__ao.agents.get(${JSON.stringify(k)}).task; return t ? t.type : null })()`) }
    assert.ok(['sit', 'look', 'walk'].includes(task), 'picked a free-time activity, got ' + task)
    const pos = () => ev(`(() => { const p = window.__ao.agents.get(${JSON.stringify(k)}).char.root.position; return [p.x, p.z] })()`)
    const p0 = await pos()
    for (let i = 0; i < 6; i++) { await ev('window.__ao.step(30, 1 / 60)'); await sleep(100) }
    const p1 = await pos()
    assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.3 || task === 'sit', 'it walks toward its target')
    await post('/api/event', { type: 'sub_done', session: 's1', agentId: 'unbound', answer: 'done' }) // an unknown id is bound to the first waiting subagent
    for (let i = 0; i < 10; i++) { await ev('window.__ao.step(20, 1 / 60)'); await sleep(150) }
    assert.equal(await ev(`window.__ao.agents.get(${JSON.stringify(k)})?.task ?? null`), null)
  })
  await step('agent card: activity feed lists finished actions and Files opens the changed file', async () => {
    await post('/api/event', { type: 'activity', session: 's1', tool: 'Edit', kind: 'write', ok: true, summary: 'x', file: path.join(work, 'src', 'app.js'), add: 2, del: 1 })
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    await sleep(800)
    assert.match(await ev("document.getElementById('acts').textContent"), /src\/app\.js.*\+2/)
    await ev("document.getElementById('card-files').click()")
    await sleep(500)
    assert.equal(await ev("document.getElementById('files').hidden"), false)
    assert.match(await ev("document.getElementById('fl-list').textContent"), /src/)
    await ev("document.querySelector('#acts button.act').click()")
    await sleep(500)
    assert.equal(await ev("document.getElementById('fv-text').textContent"), 'let hello = 1\n')
    await ev("document.getElementById('fl-close').click()")
  })
  await step('agent card: a web server the agent started is listed with its page title and an Open button', async () => {
    // `web` plays the Claude Code session and starts a web server (which quits when `web` is killed). Not this script
    // itself: the headless browser is its child too, and its debugging port would count as one of the agent's servers.
    const site = "require('http').createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Shop demo</title>') }).listen(0, '127.0.0.1', function () { console.log(this.address().port) }); process.stdin.on('end', () => process.exit()).resume()"
    web = spawn(process.execPath, ['-e', 'require("child_process").spawn(process.execPath, ["-e", ' + JSON.stringify(site) + '], { stdio: ["pipe", "inherit", "ignore"] }); setInterval(() => {}, 1e6)'], { stdio: ['ignore', 'pipe', 'ignore'] })
    webPort = Number(await new Promise((r) => web.stdout.once('data', (d) => r(String(d).trim()))))
    await post('/api/event', { type: 'proc', session: 's1', pid: web.pid })
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    for (let i = 0; i < 80 && (await ev("document.getElementById('ports-box').hidden")); i++) await sleep(250)
    assert.equal(await ev("document.getElementById('ports-box').hidden"), false)
    assert.match(await ev("document.getElementById('ports').textContent"), new RegExp(':' + webPort + 'Shop demo.*Open'))
  })
  await step('agent card: typing "/" shows command suggestions, filtering and Tab complete', async () => {
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    await sleep(800)
    assert.equal(await ev("document.getElementById('card').hidden"), false)
    await ev("(() => { const i = document.getElementById('card-text'); i.focus(); i.value = '/'; i.dispatchEvent(new Event('input')) })()")
    assert.equal(await ev("document.getElementById('cmdlist').hidden"), false)
    assert.equal(await ev("document.querySelectorAll('#cmdlist button').length"), 3)
    await ev("(() => { const i = document.getElementById('card-text'); i.value = '/co'; i.dispatchEvent(new Event('input')) })()")
    assert.deepEqual(await ev("[...document.querySelectorAll('#cmdlist b')].map((b) => b.textContent)"), ['/compact', '/cost'])
    await key('Tab', 'Tab', 'keyDown'); await key('Tab', 'Tab', 'keyUp')
    assert.equal(await ev("document.getElementById('card-text').value"), '/compact ')
  })
  await step('typing /model shows the in-window model chooser instead of sending it', async () => {
    await ev("(() => { const i = document.getElementById('card-text'); i.value = '/model'; i.dispatchEvent(new Event('input')); document.getElementById('card-form').requestSubmit() })()")
    await sleep(300)
    assert.equal(await ev("document.getElementById('cmdlist').hidden"), false)
    assert.match(await ev("document.getElementById('cmdlist').textContent"), /Sonnet 5\.5/)
    const queued = await (await fetch(base + '/api/poll?session=s1', { headers: { 'x-token': token } })).json()
    assert.ok(!queued.commands.some((c) => c.kind === 'say'), 'nothing was sent yet')
  })
  await step('a slash command from the chat reaches the mod queue as a "say" command', async () => {
    await ev("(() => { const i = document.getElementById('card-text'); i.value = '/cost'; document.getElementById('card-form').requestSubmit() })()")
    await sleep(400)
    const queued = await (await fetch(base + '/api/poll?session=s1', { headers: { 'x-token': token } })).json()
    assert.equal(queued.commands.find((c) => c.kind === 'say')?.text, '/cost')
  })
  await step("Claude's replies are shown as Markdown, and cannot inject HTML or script links", async () => {
    const md = '# Title\n\n**Bold** and ' + '`code` and *italic*.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1 < 2\n```\n\n<img src=x onerror="window.__pwned=1"> [ok](https://example.com) [bad](javascript:alert(1))'
    await post('/api/event', { session: 's1', type: 'turn_complete', answer: md, reason: 'answer' })
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    await sleep(500)
    const q = (sel) => ev("document.querySelectorAll('.msg.assistant .md " + sel + "').length")
    assert.equal(await ev("[...document.querySelectorAll('.msg.assistant .md strong')].pop().textContent"), 'Bold')
    assert.equal(await ev("[...document.querySelectorAll('.msg.assistant .md code')].map((c) => c.textContent).includes('code')"), true)
    assert.ok((await q('li')) >= 5, 'list items')
    assert.ok((await q('li > ul')) >= 1, 'nested list')
    assert.ok((await q('ol')) >= 1 && (await q('blockquote')) >= 1 && (await q('table')) >= 1 && (await q('pre code')) >= 1)
    assert.equal(await ev("document.querySelector('.msg.assistant .md pre code').textContent"), 'const x = 1 < 2')
    assert.equal(await q('img'), 0, 'no injected <img>')
    assert.equal(await ev('window.__pwned'), undefined, 'no script ran')
    assert.deepEqual(await ev("[...document.querySelectorAll('.msg.assistant .md a')].map((x) => x.getAttribute('href'))"), ['https://example.com'])
    assert.equal(await ev("[...document.querySelectorAll('.msg.assistant .md')].pop().textContent.includes('**')"), false, 'no raw ** left')
  })
  await step('the chat toolbar: model chip, + menu, / button, attachments and web chip', async () => {
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    await post('/api/event', { session: 's1', type: 'info', model: 'claude-sonnet-5-5' })
    await sleep(400)
    assert.equal(await ev("document.getElementById('cb-model-name').textContent"), 'Sonnet 5.5')
    await ev("document.getElementById('cb-plus').click()")
    assert.equal(await ev("document.getElementById('cmenu').hidden"), false)
    assert.deepEqual(await ev("[...document.querySelectorAll('#cmenu button')].map((b) => b.textContent.trim())"), ['⬆️ Upload from computer', '📄 Add context', '🌐 Browse the web'])
    await ev("document.getElementById('cm-web').click()")
    assert.equal(await ev("document.getElementById('cmenu').hidden"), true)
    assert.match(await ev("document.getElementById('atts').textContent"), /Browse the web/)
    await ev("document.getElementById('cb-slash').click()")
    assert.equal(await ev("document.getElementById('card-text').value"), '/')
    assert.equal(await ev("document.getElementById('cmdlist').hidden"), false)
    await ev("(() => { const i = document.getElementById('card-text'); i.value = ''; i.dispatchEvent(new Event('input')) })()")
    // an uploaded file becomes a chip and is added to the message that is sent
    await ev("(async () => { const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' })); const i = document.getElementById('cb-file'); i.files = dt.files; i.dispatchEvent(new Event('change')) })()")
    for (let i = 0; i < 20 && !(await ev("document.getElementById('atts').textContent.includes('notes.txt')")); i++) await sleep(150)
    assert.match(await ev("document.getElementById('atts').textContent"), /notes\.txt/)
    await ev("(() => { const i = document.getElementById('card-text'); i.value = 'what is in it?'; document.getElementById('card-form').requestSubmit() })()")
    await sleep(400)
    const queued = (await (await fetch(base + '/api/poll?session=s1', { headers: { 'x-token': token } })).json()).commands.filter((c) => c.kind === 'say')
    const sent = queued.at(-1).text
    assert.match(sent, /^Browse the web if it helps\. what is in it\?/)
    assert.match(sent, /Attached files[^]*notes\.txt/)
    assert.equal(await ev("document.getElementById('atts').hidden"), true, 'chips are cleared after sending')
    // a screenshot pasted into the message box is uploaded with its own name and shows a preview
    await ev("(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })); document.getElementById('card-text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })()")
    for (let i = 0; i < 20 && !(await ev("document.getElementById('atts').textContent.includes('screenshot-')")); i++) await sleep(150)
    assert.match(await ev("document.getElementById('atts').textContent"), /screenshot-[\d-]+\.png/)
    assert.equal(await ev("!!document.querySelector('#atts .chip2 img')"), true)
    await ev("document.querySelector('#atts .chip2 button').click()")
    // resizing the card with its grip: the conversation shrinks, the card itself never needs a scrollbar
    for (let n = 0; n < 12; n++) await post('/api/event', { session: 's1', type: 'activity', tool: 'Bash', kind: 'run', ok: true, summary: 'echo ' + n })
    await sleep(500)
    const [gx, gy] = await ev("(() => { const r = document.getElementById('card-grip').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    await drag([gx, gy], [gx - 60, gy + 260])
    await sleep(200)
    assert.equal(await ev("document.getElementById('card').classList.contains('sized')"), true)
    const fit = await ev("(() => { const c = document.getElementById('card'); return { ok: c.scrollHeight <= c.clientHeight + 1, scroll: c.scrollHeight, client: c.clientHeight, chat: document.getElementById('chat').clientHeight, style: c.style.height, kids: [...c.children].map((k) => (k.id || k.className) + ':' + k.offsetHeight).join(' ') } })()")
    assert.ok(fit.ok, 'the card does not overflow: ' + JSON.stringify(fit))
    if (process.env.SMOKE_CARD_SHOT) fs.writeFileSync(process.env.SMOKE_CARD_SHOT, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await ev("document.getElementById('card-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
    assert.equal(await ev("document.getElementById('card').classList.contains('sized')"), false)
    // the model chip opens the chooser, and picking one sends a model command
    await ev("document.getElementById('cb-model').click()")
    assert.match(await ev("document.getElementById('cmdlist').textContent"), /Opus 5\.5/)
    await ev("document.querySelector('#cmdlist button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))")
    await sleep(300)
    const q2 = (await (await fetch(base + '/api/poll?session=s1', { headers: { 'x-token': token } })).json()).commands
    assert.deepEqual(q2.filter((c) => c.kind === 'model').map((c) => c.value), ['opus'])
  })
  await step('an agent can be renamed from its card (pencil or double-click, Enter to save, Esc to cancel)', async () => {
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    await sleep(300)
    const old = await ev("document.getElementById('card-name').textContent")
    await ev("document.getElementById('card-rename').click()")
    assert.equal(await ev("document.getElementById('card-name').firstElementChild?.tagName"), 'INPUT')
    await ev("(() => { const i = document.querySelector('#card-name input'); i.value = 'Nova'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()")
    assert.equal(await ev("document.getElementById('card-name').textContent"), old, 'Esc keeps the old name')
    await ev("document.getElementById('card-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
    await ev("(() => { const i = document.querySelector('#card-name input'); i.value = 'Nova'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()")
    for (let i = 0; i < 20 && (await ev("document.getElementById('card-name').textContent")) !== 'Nova'; i++) await sleep(150)
    assert.equal(await ev("document.getElementById('card-name').textContent"), 'Nova')
    assert.equal(await ev("[...window.__ao.agents.values()].find((a) => a.data.session === 's1' && a.data.kind === 'main').data.name"), 'Nova')
    assert.equal(await ev("document.getElementById('card-rename').style.display"), '')
  })
  await step('moving an agent location from its card works (no drag needed)', async () => {
    await ev("[...document.querySelectorAll('#card-move button')].find((b) => /Engine/.test(b.textContent)).click()")
    await sleep(500)
    assert.equal((await (await fetch(base + '/stream')).body.getReader().read().then((r) => JSON.parse(Buffer.from(r.value).toString().replace(/^data: /, '').trim()))).agents.find((a) => a.session === 's1').loc, 'engine')
  })
  await step('changing deck again and again does not leak GPU memory', async () => {
    const measure = async () => { await ev('window.__ao.step(2, 1 / 60); window.__ao.renderer.render(window.__ao.scene, window.__ao.camera)'); return ev('[window.__ao.renderer.info.memory.geometries, window.__ao.renderer.info.memory.textures]') }
    const visit = async () => { for (const sc of ['engine', 'habitat', 'bridge']) { await ev("window.__ao.switchScene('" + sc + "', false)"); await sleep(350) } }
    await visit(); await visit() // warm-up: what is used the first time gets uploaded to the GPU once
    const before = await measure()
    await visit(); await visit(); await visit()
    const after = await measure()
    assert.ok(after[0] <= before[0] + 5, 'geometries grew from ' + before[0] + ' to ' + after[0])
    assert.ok(after[1] <= before[1], 'textures grew from ' + before[1] + ' to ' + after[1])
  })
  await step('the Agent panel lists recent sessions to resume, with search; the ones aboard can be shown', async () => {
    const dir = path.join(tmp, 'claude', 'projects', 'C--work-demo')
    fs.mkdirSync(dir, { recursive: true })
    const L = (o) => JSON.stringify(o)
    fs.writeFileSync(path.join(dir, '33333333-4444-4555-8666-777777777777.jsonl'), [L({ type: 'user', cwd: 'C:\\work\\demo', message: { content: 'Refactor the parser' } }), L({ type: 'ai-title', aiTitle: 'Parser refactor' })].join('\n'))
    fs.writeFileSync(path.join(dir, 's1.jsonl'), L({ type: 'user', cwd: 'C:\\work\\ship', message: { content: 'Build the ship' } }))
    await ev("document.getElementById('agent-btn').click()")
    await ev("document.querySelector('#sp-tabs [data-tab=resume]').click()")
    for (let i = 0; i < 20 && (await ev("document.querySelectorAll('#rs-list .rs-row').length")) < 2; i++) await sleep(150)
    const rows = await ev("[...document.querySelectorAll('#rs-list .rs-row')].map((r) => [r.querySelector('.rs-title').textContent, r.querySelector('button').textContent])")
    assert.deepEqual(rows.find((r) => r[0] === 'Parser refactor')?.[1], '↩ Resume')
    assert.deepEqual(rows.find((r) => r[0] === 'Build the ship')?.[1], '👁 Show', 'the session already aboard is shown, not resumed')
    await ev("(() => { const q = document.getElementById('rs-q'); q.value = 'parser'; q.dispatchEvent(new Event('input')) })()")
    assert.deepEqual(await ev("[...document.querySelectorAll('#rs-list .rs-title')].map((t) => t.textContent)"), ['Parser refactor'])
    await ev("document.querySelector('#sp-tabs [data-tab=new]').click()")
    assert.equal(await ev("document.getElementById('sp-new').hidden"), false)
    await ev("document.getElementById('sp-close').click()")
  })
  await step('a new version shows a notice in the footer, which can be hidden', async () => {
    for (let i = 0; i < 20 && (await ev("document.getElementById('upd').hidden")); i++) await sleep(150)
    assert.equal(await ev("document.getElementById('upd').hidden"), false)
    assert.match(await ev("document.getElementById('upd-text').textContent"), /99\.0\.0/)
    await ev("document.getElementById('upd-x').click()")
    assert.equal(await ev("document.getElementById('upd').hidden"), true)
  })
  await step('a server still running after its session ends shows up in the footer, with the agent it came from', async () => {
    const name = await ev('window.__ao.agents.get("s1:main").data.name') // renamed by an earlier check
    await post('/api/event', { type: 'session_end', session: 's1' })
    for (let i = 0; i < 80 && (await ev("document.getElementById('orph').hidden")); i++) await sleep(250)
    assert.equal(await ev("document.getElementById('orph').textContent"), '🔌 1 server left running')
    await ev("document.getElementById('orph').click()")
    assert.equal(await ev("document.getElementById('orph-pop').hidden"), false)
    assert.match(await ev("document.getElementById('orph-list').textContent"), new RegExp(':' + webPort + 'Shop demo.*from ' + name))
    web.kill() // once it stops listening, the notice goes away
    for (let i = 0; i < 80 && !(await ev("document.getElementById('orph').hidden")); i++) await sleep(250)
    assert.equal(await ev("document.getElementById('orph').hidden"), true)
    assert.equal(await ev("document.getElementById('orph-pop').hidden"), true)
  })
  await step("Claude's multiple-choice questions show clickable options, and the answers reach the mod", async () => {
    const questions = [
      { question: 'Which style?', header: 'Style', multiSelect: false, options: [{ label: 'Bold', description: 'Loud colors' }, { label: 'Calm', description: 'Soft colors' }] },
      { question: 'Which pages?', header: 'Pages', multiSelect: true, options: [{ label: 'Home', description: '' }, { label: 'Docs', description: '' }, { label: 'Blog', description: '' }] },
    ]
    await post('/api/event', { type: 'session_start', session: 's1', label: 'quiz' }) // the earlier steps ended it
    for (let i = 0; i < 40 && !(await ev("window.__ao.agents.has('s1:main')")); i++) await sleep(150)
    await post('/api/event', { type: 'permission', session: 's1', id: 'uq1', tool: 'AskUserQuestion', summary: 'Which style?', questions })
    for (let i = 0; i < 40 && !(await ev("!!document.querySelector('.ask.question')")); i++) await sleep(150)
    assert.equal(await ev("document.querySelectorAll('.ask.question .opt').length"), 5)
    // the agent's chat is locked while it waits for the answer: a message would only queue behind the question
    await ev('window.__ao.select({ kind: "agent", key: "s1:main" })')
    assert.equal(await ev("document.getElementById('card-text').disabled"), true)
    assert.match(await ev("document.getElementById('card-text').placeholder"), /Answer the request/)
    const wait = fetch(base + '/api/permission/wait?id=uq1&ms=8000', { headers: { 'x-token': token } }).then((r) => r.json())
    const pick = (q, n) => ev(`document.querySelectorAll('.ask.question .q')[${q}].querySelectorAll('.opt')[${n}].click()`)
    const sendBtn = "[...document.querySelectorAll('.ask.question .row button')].find((b) => /Send/.test(b.textContent))"
    await pick(0, 1)
    assert.equal(await ev(sendBtn + '.disabled'), true) // the second question is still unanswered
    await pick(1, 0); await pick(1, 2)
    if (process.env.SMOKE_QUESTION_SHOT) fs.writeFileSync(process.env.SMOKE_QUESTION_SHOT, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await ev(sendBtn + '.click()')
    assert.deepEqual(await wait, { decision: { answers: { 'Which style?': 'Calm', 'Which pages?': 'Home, Blog' } } })
    await post('/api/event', { type: 'permission_end', session: 's1', id: 'uq1' })
    for (let i = 0; i < 20 && (await ev("document.getElementById('card-text').disabled")); i++) await sleep(150)
    assert.equal(await ev("document.getElementById('card-text').disabled"), false) // answered: the chat is open again
  })
  await step('no JavaScript errors were logged', async () => { assert.deepEqual(errors, []) })

  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(__dirname, 'ui-smoke.png'), Buffer.from(shot.data, 'base64'))
}

main().catch((e) => { console.error(e); results.push(['FAIL', 'harness', e]) }).finally(() => {
  try { ws?.close() } catch {}
  // on Windows the process started here hands over to a new Edge process and exits: killing it leaves the browser, its GPU
  // and renderer processes running (busy with software rendering). Stop every process using this run's profile instead.
  if (browser && process.platform === 'win32') spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" + path.join(tmp, 'profile').replace(/'/g, "''") + "') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore', timeout: 30000 })
  browser?.kill(); server?.kill(); web?.kill()
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} }, 500)
  const bad = results.filter((r) => r[0] === 'FAIL')
  console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`)
  process.exit(bad.length ? 1 : 0)
})

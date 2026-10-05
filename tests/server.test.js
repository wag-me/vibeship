// Server tests: run with `node --test tests/`
// They start the real server on a free port with a temporary data folder and a fake Claude Code config folder.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')

let child, base, token, tmp

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
const api = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.auth === false ? {} : { 'x-token': token }), ...(o.headers || {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
const event = (ev) => api('/api/event', { method: 'POST', auth: false, body: ev })
// first message of the SSE stream = the current snapshot
async function snapshot() {
  const ctl = new AbortController()
  const r = await fetch(base + '/stream', { signal: ctl.signal })
  const reader = r.body.getReader()
  let buf = ''
  for (;;) {
    const { value } = await reader.read()
    buf += Buffer.from(value).toString()
    const i = buf.indexOf('\n\n')
    if (i >= 0) { ctl.abort(); return JSON.parse(buf.slice(buf.indexOf('data: ') + 6, i)) }
  }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeship-test-'))
  const claudeDir = path.join(tmp, 'claude')
  const proj = path.join(claudeDir, 'projects', 'C--work-demo')
  fs.mkdirSync(proj, { recursive: true })
  const ts = new Date().toISOString()
  const line = (id, usage, tools = []) => JSON.stringify({ type: 'assistant', timestamp: ts, cwd: 'C:\\work\\demo', message: { id, model: 'claude-test', usage, content: tools.map((name) => ({ type: 'tool_use', name })) } })
  fs.writeFileSync(path.join(proj, 's1.jsonl'), [
    line('a', { input_tokens: 10, output_tokens: 5 }),
    line('a', { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 100 }, ['Bash']), // same message streamed twice: only the last counts
    line('b', { input_tokens: 1, output_tokens: 2 }, ['Edit', 'Bash']),
    'not json at all',
  ].join('\n'))
  const port = await freePort()
  base = 'http://127.0.0.1:' + port
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_DIR: path.join(tmp, 'data'), CLAUDE_CONFIG_DIR: claudeDir },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/ping')).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }
  token = fs.readFileSync(path.join(tmp, 'data', 'token'), 'utf8').trim()
})
after(() => { child?.kill(); fs.rmSync(tmp, { recursive: true, force: true }) })

test('protected endpoints refuse requests without the token', async () => {
  for (const [m, p] of [['GET', '/api/stats'], ['GET', '/api/dirs'], ['GET', '/api/commands'], ['GET', '/api/poll?session=x'], ['POST', '/api/command'], ['POST', '/api/spawn'], ['POST', '/api/mkdir'], ['POST', '/api/move'], ['POST', '/api/permission'], ['POST', '/api/layout']]) {
    const r = await api(p, { method: m, auth: false, body: m === 'POST' ? {} : undefined })
    assert.equal(r.status, 401, m + ' ' + p)
  }
  assert.equal((await api('/api/stats', { headers: { 'x-token': 'wrong' }, auth: false })).status, 401)
})

test('static files are served and path traversal is refused', async () => {
  assert.equal((await fetch(base + '/')).status, 200)
  assert.equal((await fetch(base + '/js/main.js')).status, 200)
  assert.equal((await fetch(base + '/../server/server.js')).status === 200, false)
  assert.equal((await fetch(base + '/%2e%2e/server/server.js')).status === 200, false)
})

test('a session shows up as an agent, tool events change its status, session_end removes it', async () => {
  await event({ type: 'session_start', session: 's1', label: 'demo', look: { species: 'fox', shirt: 2 }, loc: 'engine' })
  await event({ type: 'tool', session: 's1', status: 'write', detail: 'a.js' })
  let snap = await snapshot()
  const a = snap.agents.find((x) => x.session === 's1')
  assert.equal(a.name, 'demo')
  assert.equal(a.status, 'write')
  assert.equal(a.loc, 'engine')
  assert.deepEqual(a.look, { species: 'fox', shirt: 2 })
  await event({ type: 'session_start', session: 's2', label: 'demo' })
  snap = await snapshot()
  assert.equal(snap.agents.find((x) => x.session === 's2').name, 'demo #2')
  await event({ type: 'session_end', session: 's1' })
  await event({ type: 'session_end', session: 's2' })
  assert.equal((await snapshot()).agents.length, 0)
})

test('subagents: spawn, bind to the first tool call, finish', async () => {
  await event({ type: 'session_start', session: 'p' })
  await event({ type: 'spawn', session: 'p', toolUseId: 't1', name: 'helper', description: 'do things' })
  let snap = await snapshot()
  assert.equal(snap.agents.filter((x) => x.kind === 'sub').length, 1)
  await event({ type: 'tool', session: 'p', agentId: 'ag1', status: 'read', detail: 'x' })
  snap = await snapshot()
  const sub = snap.agents.find((x) => x.kind === 'sub')
  assert.equal(sub.id, 'ag1')
  assert.equal(sub.bound, true)
  await event({ type: 'sub_done', session: 'p', agentId: 'ag1', answer: 'result' })
  assert.equal((await snapshot()).agents.find((x) => x.id === 'ag1').result, 'result')
  await event({ type: 'session_end', session: 'p' })
})

test('chat: window messages are queued, delivered, and answered', async () => {
  await event({ type: 'session_start', session: 'c' })
  assert.equal((await api('/api/command', { method: 'POST', body: { session: 'c', kind: 'say', text: 'hello' } })).status, 204)
  assert.equal((await api('/api/command', { method: 'POST', body: { session: 'c', kind: 'say', text: '   ' } })).status, 400)
  assert.equal((await api('/api/command', { method: 'POST', body: { session: 'c', kind: 'explode' } })).status, 400)
  let snap = await snapshot()
  const m = snap.chat.c.find((x) => x.role === 'user')
  assert.equal(m.state, 'queued')
  const polled = await (await api('/api/poll?session=c')).json()
  assert.equal(polled.commands[0].text, 'hello')
  assert.deepEqual((await (await api('/api/poll?session=c')).json()).commands, []) // the queue is emptied
  await event({ type: 'say_delivered', session: 'c', id: m.id })
  await event({ type: 'turn_start', session: 'c' })
  assert.equal((await snapshot()).chat.c[0].state, 'working')
  await event({ type: 'turn_complete', session: 'c', answer: 'hi there', reason: 'answer' })
  snap = await snapshot()
  assert.equal(snap.chat.c[0].state, 'done')
  assert.equal(snap.chat.c[1].text, 'hi there')
  await event({ type: 'session_end', session: 'c' })
})

test('slash commands: list is stored per session, results land in the chat', async () => {
  await event({ type: 'session_start', session: 'k' })
  await event({ type: 'commands', session: 'k', list: [{ name: 'model', description: 'Switch model' }, { nope: 1 }, { name: 'compact' }] })
  const list = (await (await api('/api/commands?session=k')).json()).commands
  assert.deepEqual(list.map((c) => c.name), ['model', 'compact'])
  assert.deepEqual((await (await api('/api/commands?session=other')).json()).commands, [])
  assert.equal((await api('/api/command', { method: 'POST', body: { session: 'k', kind: 'commands' } })).status, 204)
  await api('/api/command', { method: 'POST', body: { session: 'k', kind: 'say', text: '/model sonnet' } })
  const id = (await snapshot()).chat.k.find((x) => x.role === 'user').id
  await event({ type: 'command_result', session: 'k', id, ok: true, text: 'Set model to sonnet' })
  let chat = (await snapshot()).chat.k
  assert.equal(chat.find((x) => x.id === id).state, 'done')
  assert.equal(chat.at(-1).text, 'Set model to sonnet')
  await api('/api/command', { method: 'POST', body: { session: 'k', kind: 'say', text: '/nope' } })
  const id2 = (await snapshot()).chat.k.filter((x) => x.role === 'user').at(-1).id
  await event({ type: 'command_result', session: 'k', id: id2, ok: false, text: 'Unknown command: /nope' })
  chat = (await snapshot()).chat.k
  assert.equal(chat.find((x) => x.id === id2).state, 'error')
  await event({ type: 'session_end', session: 'k' })
  assert.deepEqual((await (await api('/api/commands?session=k')).json()).commands, []) // forgotten with the session
})

test('permissions: a decision wakes the waiting mod; unknown ids are refused', async () => {
  await event({ type: 'session_start', session: 'x' })
  await event({ type: 'permission', session: 'x', id: 'p1', tool: 'Bash', summary: 'rm -rf /tmp/x' })
  assert.equal((await snapshot()).perms[0].id, 'p1')
  const waiting = api('/api/permission/wait?id=p1&ms=5000').then((r) => r.json())
  await new Promise((r) => setTimeout(r, 150))
  assert.equal((await api('/api/permission', { method: 'POST', body: { id: 'p1', decision: 'maybe' } })).status, 400)
  assert.equal((await api('/api/permission', { method: 'POST', body: { id: 'p1', decision: 'deny' } })).status, 204)
  assert.deepEqual(await waiting, { decision: 'deny' })
  assert.equal((await api('/api/permission', { method: 'POST', body: { id: 'nope', decision: 'allow' } })).status, 400)
  // "allow for this session" is a valid answer and reaches the mod as such
  await event({ type: 'permission', session: 'x', id: 'p2', tool: 'SubagentHandback', summary: '{}' })
  const waiting2 = api('/api/permission/wait?id=p2&ms=5000').then((r) => r.json())
  await new Promise((r) => setTimeout(r, 150))
  assert.equal((await api('/api/permission', { method: 'POST', body: { id: 'p2', decision: 'allow_session' } })).status, 204)
  assert.deepEqual(await waiting2, { decision: 'allow_session' })
  await event({ type: 'session_end', session: 'x' })
})

test('move: only valid locations are accepted', async () => {
  await event({ type: 'session_start', session: 'm', loc: 'bridge' })
  assert.equal((await api('/api/move', { method: 'POST', body: { session: 'm', loc: 'habitat' } })).status, 204)
  assert.equal((await snapshot()).agents.find((a) => a.session === 'm').loc, 'habitat')
  assert.equal((await api('/api/move', { method: 'POST', body: { session: 'm', loc: 'moon' } })).status, 400)
  assert.equal((await api('/api/move', { method: 'POST', body: { session: 'ghost', loc: 'bridge' } })).status, 400)
  await event({ type: 'session_end', session: 'm' })
})

test('new project folders: valid names are created, bad ones refused', async () => {
  const parent = path.join(tmp, 'projects-here')
  fs.mkdirSync(parent)
  const mk = (name, git = false) => api('/api/mkdir', { method: 'POST', body: { parent, name, git } })
  assert.equal((await mk('my-app')).status, 200)
  assert.ok(fs.statSync(path.join(parent, 'my-app')).isDirectory())
  for (const bad of ['', '..', '../escape', 'a/b', 'a\\b', 'CON', 'nul.txt', '.hidden', 'trail.', 'x'.repeat(65), 'bad*name']) {
    assert.equal((await mk(bad)).status, 400, JSON.stringify(bad))
  }
  assert.equal((await mk('my-app')).status, 400) // already exists
  assert.equal((await api('/api/mkdir', { method: 'POST', body: { parent: 'relative', name: 'x' } })).status, 400)
})

test('directory listing: lists subfolders and hides dot folders', async () => {
  const dir = path.join(tmp, 'listing')
  fs.mkdirSync(path.join(dir, 'visible'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.hidden'))
  const d = await (await api('/api/dirs?path=' + encodeURIComponent(dir))).json()
  assert.deepEqual(d.dirs.map((x) => x.name), ['visible'])
})

test('spawn refuses dangerous or missing paths', async () => {
  for (const cwd of ['relative/path', 'C:\\x"y', '/tmp/a%b', path.join(tmp, 'does-not-exist')]) {
    assert.equal((await api('/api/spawn', { method: 'POST', body: { cwd } })).status, 400, cwd)
  }
})

test('statistics: counts each message once, tools, sessions, projects, models', async () => {
  const s = await (await api('/api/stats?days=7')).json()
  assert.equal(s.days, 7)
  assert.equal(s.total.messages, 2) // the streamed duplicate counts once
  assert.equal(s.total.input, 11)
  assert.equal(s.total.output, 52)
  assert.equal(s.total.cacheRead, 100)
  assert.equal(s.total.tools, 3)
  assert.equal(s.total.sessions, 1)
  assert.equal(s.series.length, 7)
  assert.equal(s.series.at(-1).output, 52) // today
  assert.deepEqual(s.projects.map((p) => p.name), ['demo'])
  assert.deepEqual(s.models.map((m) => m.name), ['claude-test'])
  assert.deepEqual(s.tools, [{ name: 'Bash', count: 2 }, { name: 'Edit', count: 1 }])
  assert.equal((await (await api('/api/stats?days=999')).json()).days, 14) // unknown ranges fall back
})

test('layout: saved and returned in the snapshot', async () => {
  const layout = { scene: 'engine', scenes: { 'engine@3': [{ id: 'a', type: 'sofa', x: 1, z: 2, rot: 0 }] } }
  assert.equal((await api('/api/layout', { method: 'POST', body: layout })).status, 204)
  assert.deepEqual((await snapshot()).layout, layout)
  assert.equal((await api('/api/layout', { method: 'POST', body: { nonsense: true } })).status, 204) // ignored, not stored
  assert.deepEqual((await snapshot()).layout, layout)
})

test('activity feed and Files panel: browse only inside the working folder', async () => {
  const work = path.join(tmp, 'work')
  fs.mkdirSync(path.join(work, 'src'), { recursive: true })
  fs.writeFileSync(path.join(work, 'src', 'a.js'), 'console.log(1)\n')
  fs.writeFileSync(path.join(work, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(work, 'bin.dat'), Buffer.from([1, 0, 2]))
  fs.writeFileSync(path.join(tmp, 'outside.txt'), 'nope')
  await event({ type: 'session_start', session: 'f1', label: 'files', cwd: work })
  await event({ type: 'tool', session: 'f1', status: 'write', detail: 'a.js' })
  await event({ type: 'activity', session: 'f1', tool: 'Edit', kind: 'write', ok: true, summary: 'x', file: path.join(work, 'src', 'a.js'), add: 3, del: 1 })
  await event({ type: 'activity', session: 'f1', tool: 'Bash', kind: 'run', ok: false, summary: 'npm test', error: 'exit 1' })
  const snap = await snapshot()
  assert.equal(snap.acts.f1.length, 2)
  assert.equal(snap.acts.f1[0].rel, 'src/a.js') // absolute path becomes relative to the folder
  assert.equal(snap.acts.f1[0].add, 3)
  assert.equal(snap.acts.f1[1].ok, false)
  assert.equal(snap.roots.f1, 'work')
  assert.ok(!JSON.stringify(snap).includes(JSON.stringify(work).slice(1, -1)), 'the absolute folder never reaches the window')

  const ls = await (await api('/api/files?session=f1&path=')).json()
  assert.deepEqual(ls.entries.map((e) => e.name), ['src', '.env', 'bin.dat']) // folders first
  const file = await (await api('/api/file?session=f1&path=src/a.js')).json()
  assert.equal(file.text, 'console.log(1)\n')
  assert.ok((await (await api('/api/file?session=f1&path=.env')).json()).blocked)
  assert.ok((await (await api('/api/file?session=f1&path=bin.dat')).json()).blocked)
  for (const p of ['../outside.txt', path.join(tmp, 'outside.txt'), 'src/../../outside.txt']) {
    const r = await api('/api/file?session=f1&path=' + encodeURIComponent(p))
    assert.equal(r.status, 400, p)
  }
  assert.equal((await api('/api/files?session=f1&path=', { auth: false })).status, 401)
  assert.equal((await api('/api/files?session=nope&path=')).status, 400)
  await event({ type: 'session_end', session: 'f1' })
  assert.equal((await api('/api/files?session=f1&path=')).status, 400)
})

test('model switch commands are validated and queued; info is shown in the snapshot', async () => {
  await event({ type: 'session_start', session: 'mi' })
  assert.equal((await api('/api/command', { method: 'POST', body: { session: 'mi', kind: 'model', value: 'opus' } })).status, 204)
  assert.equal((await api('/api/command', { method: 'POST', body: { session: 'mi', kind: 'model', value: 'sonnet[1m]' } })).status, 204)
  for (const bad of ['', 'Opus 5', 'a/b', 'x'.repeat(31), '$(rm)', undefined]) {
    assert.equal((await api('/api/command', { method: 'POST', body: { session: 'mi', kind: 'model', value: bad } })).status, 400, JSON.stringify(bad))
  }
  const q = (await (await api('/api/poll?session=mi')).json()).commands
  assert.deepEqual(q.map((c) => [c.kind, c.value]), [['model', 'opus'], ['model', 'sonnet[1m]']])
  await event({ type: 'info', session: 'mi', model: 'claude-opus-5-5' })
  assert.deepEqual((await snapshot()).info.mi, { model: 'claude-opus-5-5' })
  await event({ type: 'info_error', session: 'mi', text: 'Could not switch the model: nope' })
  assert.match((await snapshot()).chat.mi.at(-1).text, /nope/)
  await event({ type: 'session_end', session: 'mi' })
  assert.equal((await snapshot()).info.mi, undefined)
})

test('uploads: saved in the data folder, safe names, size limit, token required', async () => {
  const up = (name, bytes, auth = true) => api('/api/upload', { method: 'POST', auth, body: { session: 'x', name, data: Buffer.from(bytes).toString('base64') } })
  assert.equal((await up('a.txt', 'hi', false)).status, 401)
  const r = await up('../../evil name?.txt', 'hello')
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(fs.readFileSync(d.path, 'utf8'), 'hello')
  assert.equal(path.dirname(d.path), path.join(tmp, 'data', 'uploads')) // never outside the uploads folder
  assert.ok(!/[?\\/]/.test(path.basename(d.path)))
  assert.equal((await up('empty.txt', '')).status, 400)
  assert.equal((await up('big.bin', Buffer.alloc(8 * 1024 * 1024 + 1))).status, 400)
})

test('rename: applied at once, unique among agents, cleaned, and queued for the mod', async () => {
  await event({ type: 'session_start', session: 'r1', label: 'alpha' })
  await event({ type: 'session_start', session: 'r2', label: 'beta' })
  const rename = (session, value) => api('/api/command', { method: 'POST', body: { session, kind: 'rename', value } })
  assert.equal((await rename('r1', '  Ada   Lovelace  ')).status, 204)
  assert.equal((await snapshot()).agents.find((a) => a.session === 'r1').name, 'Ada Lovelace')
  assert.equal((await rename('r2', 'Ada Lovelace')).status, 204)
  assert.equal((await snapshot()).agents.find((a) => a.session === 'r2').name, 'Ada Lovelace #2') // two agents never share a name
  assert.equal((await rename('r1', '<b>x</b>/\\')).status, 204)
  assert.equal((await snapshot()).agents.find((a) => a.session === 'r1').name, 'bxb') // symbols are stripped, the letters stay
  for (const bad of ['', '   ', '<>/', undefined, 5]) assert.equal((await rename('r1', bad)).status, 400, JSON.stringify(bad))
  assert.equal((await rename('ghost', 'x')).status, 400)
  const q = (await (await api('/api/poll?session=r1')).json()).commands.filter((c) => c.kind === 'rename')
  assert.deepEqual(q.map((c) => c.value), ['Ada Lovelace', 'bxb'])
  await event({ type: 'session_end', session: 'r1' })
  await event({ type: 'session_end', session: 'r2' })
})

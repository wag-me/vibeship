// Vibeship local server: receives events from the mod and publishes them to the web window (SSE).
// No dependencies. Listens on 127.0.0.1 only.
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')

const PORT = Number(process.env.AGENT_OFFICE_PORT || 47890)
const WEB = path.join(__dirname, '..', 'web')
const DATA_DIR = process.env.AGENT_OFFICE_DIR || path.join(os.homedir(), '.claude-agent-office')
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json')
const IDLE_AFTER_MS = 8000

// agents: key "<session>:<id>" -> agent
const agents = new Map()
let layout = { scene: 'office', scenes: {} }
try {
  layout = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'))
} catch {}

const clients = new Set()

// Random token: needed by whoever sends commands (window) and whoever picks them up (mod).
// It lives in a file in your user folder, so an arbitrary website cannot read it.
// It is created ONCE and reused: a restarted server or a second instance that exits right away
// does not change the token, so windows that are already open stay valid.
const TOKEN_FILE = path.join(DATA_DIR, 'token')
let TOKEN = null
try {
  const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  if (/^[0-9a-f]{48}$/.test(t)) TOKEN = t
} catch {}
if (!TOKEN) {
  TOKEN = crypto.randomBytes(24).toString('hex')
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 })
  } catch {}
}
const queues = new Map() // session -> [command]
const chat = new Map() // session -> [messages]  { id, role:'user'|'assistant', text, state, via, ts }
const cmds = new Map() // session -> [{ name, description }] slash commands of that session
const perms = new Map() // id -> pending permission request
const permWaiters = new Map() // id -> [{ res, timer }]
const rid = () => crypto.randomBytes(6).toString('hex')
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
function addChat(session, msg) {
  const list = chat.get(session) || []
  const m = { id: rid(), ts: Date.now(), ...msg }
  list.push(m)
  chat.set(session, list.slice(-40))
  return m
}
const lastUser = (session, states) => [...(chat.get(session) || [])].reverse().find((m) => m.role === 'user' && states.includes(m.state))
const authed = (req) => req.headers['x-token'] === TOKEN

function snapshot() {
  const c = {}
  for (const [k, v] of chat) c[k] = v.slice(-25)
  const list = [...agents.values()].map((a) => (a.kind === 'main' ? a : { ...a, loc: agents.get(a.session + ':main')?.loc }))
  return JSON.stringify({ agents: list, layout, chat: c, perms: [...perms.values()] })
}
function broadcast() {
  const data = 'data: ' + snapshot() + '\n\n'
  for (const res of clients) res.write(data)
}
function saveLayout() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout))
  } catch {}
}

// Two agents with the same name (e.g. same folder) become "name", "name #2", "name #3"...
function uniqueName(base, key) {
  const taken = new Set([...agents.values()].filter((x) => x.kind === 'main' && x.key !== key).map((x) => x.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(base + ' #' + n)) return base + ' #' + n
}
const SPECIES = ['fox', 'cat', 'dog', 'raccoon', 'rabbit', 'bear', 'bird']
// Ship locations: each agent is in one, subagents follow the location of their main agent
const LOCS = ['bridge', 'engine', 'habitat']
const cleanLoc = (l) => (LOCS.includes(l) ? l : undefined)
function leastBusyLoc(exceptKey) {
  const count = Object.fromEntries(LOCS.map((l) => [l, 0]))
  for (const a of agents.values()) if (a.kind === 'main' && a.key !== exceptKey && a.loc) count[a.loc]++
  return LOCS.reduce((best, l) => (count[l] < count[best] ? l : best), LOCS[0])
}
function cleanLook(l) {
  if (!l || typeof l !== 'object') return undefined
  const species = SPECIES.includes(l.species) ? l.species : undefined
  const shirt = Number.isInteger(l.shirt) && l.shirt >= 0 && l.shirt < 7 ? l.shirt : undefined
  return species || shirt !== undefined ? { species, shirt } : undefined
}
function mainOf(session, label, look, loc) {
  const key = session + ':main'
  if (agents.has(key) && cleanLook(look)) agents.get(key).look = cleanLook(look)
  if (agents.has(key) && cleanLoc(loc)) agents.get(key).loc = cleanLoc(loc)
  if (!agents.has(key)) {
    agents.set(key, { key, session, id: 'main', name: uniqueName(label || 'Claude', key), kind: 'main', status: 'idle', detail: '', bound: true, t: Date.now(), look: cleanLook(look), loc: cleanLoc(loc) ?? leastBusyLoc(key) })
  } else if (label) {
    const a = agents.get(key)
    // an already valid name (e.g. "x #2") does not change if the base is the same
    if (a.name !== label && !a.name.startsWith(label + ' #')) a.name = uniqueName(label, key)
  }
  return agents.get(key)
}

// The first tool.call of a subagent that is not yet bound binds it to the agentId.
function resolve(session, agentId) {
  if (!agentId) return mainOf(session)
  const key = session + ':' + agentId
  if (agents.has(key)) return agents.get(key)
  for (const [k, a] of agents) {
    if (a.session === session && a.kind === 'sub' && !a.bound) {
      agents.delete(k)
      a.key = key
      a.id = agentId
      a.bound = true
      agents.set(key, a)
      return a
    }
  }
  const a = { key, session, id: agentId, name: 'subagent', kind: 'sub', status: 'idle', detail: '', bound: true, t: Date.now() }
  agents.set(key, a)
  return a
}

function handleEvent(ev) {
  const session = String(ev.session || 'default')
  const now = Date.now()
  switch (ev.type) {
    case 'session_start':
      mainOf(session, ev.label, ev.look, ev.loc)
      break
    case 'session_end':
      for (const [k, a] of agents) if (a.session === session) agents.delete(k)
      chat.delete(session)
      cmds.delete(session)
      for (const [id, p] of perms) if (p.session === session) endPerm(id)
      break
    case 'prompt_in': // message typed in the terminal
      if (typeof ev.text === 'string' && ev.text.trim()) addChat(session, { role: 'user', text: ev.text.slice(0, 4000), state: 'working', via: 'terminal' })
      break
    case 'commands':
      if (Array.isArray(ev.list)) cmds.set(session, ev.list.filter((c) => c && typeof c.name === 'string').slice(0, 500).map((c) => ({ name: c.name.slice(0, 80), description: String(c.description || '').slice(0, 120) })))
      break
    case 'command_result': { // a slash command typed in the window chat has run
      const m = (chat.get(session) || []).find((x) => x.id === ev.id)
      if (m) m.state = ev.ok ? 'done' : 'error'
      const text = typeof ev.text === 'string' ? ev.text.trim().slice(0, 4000) : ''
      if (text || !ev.ok) addChat(session, { role: 'assistant', text: text || 'The command failed.', state: ev.ok ? 'command' : 'error' })
      else addChat(session, { role: 'assistant', text: 'Done, no text output. If the command opened a selector, answer it in the terminal.', state: 'command' })
      break
    }
    case 'say_delivered': {
      const m = (chat.get(session) || []).find((x) => x.id === ev.id)
      if (m && m.state === 'queued') m.state = 'sent'
      break
    }
    case 'say_failed': {
      const m = (chat.get(session) || []).find((x) => x.id === ev.id)
      if (m) m.state = 'error'
      break
    }
    case 'turn_start': {
      const m = lastUser(session, ['queued', 'sent'])
      if (m) m.state = 'working'
      break
    }
    case 'permission':
      if (ev.id) perms.set(String(ev.id), { id: String(ev.id), session, tool: String(ev.tool || ''), summary: String(ev.summary || '').slice(0, 400), reason: ev.reason ? String(ev.reason).slice(0, 200) : '', ts: now, decision: null })
      break
    case 'permission_end':
      endPerm(String(ev.id))
      break
    case 'tool': {
      const a = resolve(session, ev.agentId)
      a.status = ev.status || 'run'
      a.detail = ev.detail || ''
      a.t = now
      break
    }
    case 'spawn': {
      const key = session + ':spawn:' + ev.toolUseId
      agents.set(key, { key, session, id: key, name: ev.name || 'subagent', kind: 'sub', status: 'read', detail: ev.description || '', task: ev.description ? String(ev.description).slice(0, 160) : '', bound: false, t: now })
      break
    }
    case 'sub_done': { // a subagent has finished its work: it stays a few seconds with the result
      const a = resolve(session, ev.agentId)
      a.status = 'idle'
      a.detail = ''
      a.done = true
      a.doneAt = now
      a.result = typeof ev.answer === 'string' ? ev.answer.slice(0, 600) : ''
      break
    }
    case 'turn_complete': {
      // subagents still active at the end of the turn stay a few seconds (their end may arrive later) and then disappear
      for (const a of agents.values()) if (a.session === session && a.kind === 'sub' && !a.done) { a.done = true; a.doneAt = now; a.status = 'idle'; a.detail = '' }
      const m = mainOf(session)
      m.status = 'idle'
      m.detail = ''
      const reason = ev.reason || 'answer'
      const end = reason === 'answer' ? 'done' : reason === 'aborted' ? 'aborted' : 'error'
      const running = (chat.get(session) || []).filter((m) => m.role === 'user' && m.state === 'working')
      if (running.length) running.forEach((m) => { m.state = end })
      else { const u = lastUser(session, ['sent', 'queued']); if (u) u.state = end }
      const text = typeof ev.answer === 'string' && ev.answer.trim() ? ev.answer.slice(0, 4000) : reason === 'aborted' ? 'Work interrupted.' : reason === 'answer' ? '' : 'Something went wrong.'
      if (text) addChat(session, { role: 'assistant', text, state: reason })
      break
    }
  }
  broadcast()
}


// ---------- Launching new agents (new terminal with the mod) ----------
const WIN = process.platform === 'win32'
const RECENT_FILE = path.join(DATA_DIR, 'recent.json')
let recent = []
try { recent = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')) } catch {}
function addRecent(p) {
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, 8)
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(RECENT_FILE, JSON.stringify(recent)) } catch {}
}
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', 'Windows', 'ProgramData'])
function listDirs(p) {
  const home = os.homedir()
  if (p === '~') p = home
  if (!p) {
    if (WIN) {
      const drives = []
      for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const d = l + ':\\'; try { if (fs.existsSync(d)) drives.push({ name: d, path: d }) } catch {} }
      return { path: '', parent: null, dirs: drives, home, recent }
    }
    p = home
  }
  const full = path.resolve(p)
  const ents = fs.readdirSync(full, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .slice(0, 400)
  const up = path.dirname(full)
  return { path: full, parent: up !== full ? up : WIN ? '' : null, dirs: ents.map((n) => ({ name: n, path: path.join(full, n) })), home, recent }
}
// Creates a new project folder inside `parent` (with optional git init).
// The name must be a plain folder name: no paths, no reserved Windows names.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
function createProject(parent, name, git) {
  if (typeof parent !== 'string' || !path.isAbsolute(parent)) throw new Error('First choose the folder to create it in')
  let st
  try { st = fs.statSync(parent) } catch { throw new Error('The destination folder does not exist') }
  if (!st.isDirectory()) throw new Error('The destination is not a folder')
  const nm = String(name || '').trim()
  if (!nm || nm.length > 64 || !/^[\p{L}\p{N} _.\-]+$/u.test(nm) || nm.startsWith('.') || nm.endsWith('.') || RESERVED.test(nm)) {
    throw new Error('Invalid name: use letters, numbers, spaces, hyphens and underscores')
  }
  const dir = path.join(parent, nm)
  if (path.dirname(dir) !== path.resolve(parent)) throw new Error('Invalid name')
  try { fs.mkdirSync(dir) } catch (e) {
    if (e.code === 'EEXIST') throw new Error('A folder with this name already exists')
    throw new Error('Cannot create the folder: ' + (e.code || 'error'))
  }
  let gitOk = false
  if (git) { try { gitOk = spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore', timeout: 10000 }).status === 0 } catch {} }
  addRecent(dir)
  return { path: dir, git: gitOk }
}
const q = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'"
let lastLaunch = 0
function launchAgent(cwd, name, species, shirt, loc) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || /["%\r\n]/.test(cwd)) throw new Error('Invalid path')
  if (!fs.statSync(cwd).isDirectory()) throw new Error('Not a folder')
  const plugin = path.join(__dirname, '..')
  if (/["%\r\n]/.test(plugin)) throw new Error('Mod path not supported')
  if (Date.now() - lastLaunch < 1500) throw new Error('Too fast: try again in a moment')
  lastLaunch = Date.now()
  const nm = String(name || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 40)
  const envs = []
  if (nm) envs.push(['AGENT_OFFICE_NAME', nm])
  const look = cleanLook({ species, shirt })
  if (look) envs.push(['AGENT_OFFICE_LOOK', (look.species || '') + ':' + (look.shirt ?? '')])
  if (cleanLoc(loc)) envs.push(['AGENT_OFFICE_LOC', cleanLoc(loc)])
  if (process.env.AGENT_OFFICE_PORT) envs.push(['AGENT_OFFICE_PORT', String(process.env.AGENT_OFFICE_PORT).replace(/\D/g, '')])
  if (process.env.AGENT_OFFICE_DIR) envs.push(['AGENT_OFFICE_DIR', process.env.AGENT_OFFICE_DIR])
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (WIN) {
    if (envs.some(([, v]) => /["%\r\n]/.test(v))) throw new Error('Unsupported variable')
    const f = path.join(DATA_DIR, 'launch-' + Date.now() + '.cmd')
    const lines = ['@echo off', 'title Vibeship', 'cd /d "' + cwd + '"', ...envs.map(([k, v]) => 'set "' + k + '=' + v + '"'), 'call claude --plugin-dir "' + plugin + '"', 'exit', '']
    fs.writeFileSync(f, lines.join('\r\n'))
    spawn('cmd.exe', ['/d', '/c', 'start', '"Vibeship"', '"' + f + '"'], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
    setTimeout(() => fs.unlink(f, () => {}), 90000)
  } else if (process.platform === 'darwin') {
    const f = path.join(DATA_DIR, 'launch-' + Date.now() + '.command')
    const lines = ['#!/bin/bash', 'cd ' + q(cwd), ...envs.map(([k, v]) => 'export ' + k + '=' + q(v)), 'claude --plugin-dir ' + q(plugin), '']
    fs.writeFileSync(f, lines.join('\n'), { mode: 0o755 })
    spawn('open', ['-a', 'Terminal', f], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => fs.unlink(f, () => {}), 90000)
  } else {
    throw new Error('Automatic launch is not supported on this system: open a terminal and run claude with --plugin-dir')
  }
  addRecent(cwd)
}

// ---------- Statistics (from Claude Code transcripts in ~/.claude/projects) ----------
// Every "assistant" line has message.usage with the tokens. The same message can appear several times
// (streaming): only the last occurrence per message.id is counted. Each file's result is cached (mtime+size).
const PROJECTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const fileStats = new Map() // path -> { sig, data }
const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
function parseTranscript(file) {
  const msgs = new Map()
  let first = 0
  let cwd = ''
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const m = o.message
    if (o.type !== 'assistant' || !m || !m.usage) continue
    const ts = Date.parse(o.timestamp)
    if (!ts) continue
    if (!first || ts < first) first = ts
    if (o.cwd) cwd = o.cwd
    const tools = Array.isArray(m.content) ? m.content.filter((c) => c && c.type === 'tool_use').map((c) => String(c.name)) : []
    msgs.set(m.id || o.uuid, { ts, model: String(m.model || ''), u: m.usage, tools })
  }
  return { first, cwd, msgs: [...msgs.values()] }
}
function collectFiles() {
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { return out }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d.name)
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const n of names) if (n.endsWith('.jsonl')) out.push({ file: path.join(dir, n), project: d.name })
  }
  return out
}
function computeStats(days) {
  const now = Date.now()
  const todayKey = dayKey(now)
  const since = now - days * 86400000
  const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0, sessions: 0, tools: 0 })
  const total = zero()
  const today = zero()
  const range = zero()
  const byDay = new Map()
  const byModel = new Map()
  const byProject = new Map()
  const byTool = new Map()
  const add = (t, u, tools) => { t.input += u.input_tokens || 0; t.output += u.output_tokens || 0; t.cacheRead += u.cache_read_input_tokens || 0; t.cacheWrite += u.cache_creation_input_tokens || 0; t.messages++; t.tools += tools }
  const seen = new Set()
  for (const { file, project } of collectFiles()) {
    seen.add(file)
    let st
    try { st = fs.statSync(file) } catch { continue }
    const sig = st.mtimeMs + ':' + st.size
    let c = fileStats.get(file)
    if (!c || c.sig !== sig) {
      try { c = { sig, data: parseTranscript(file) } } catch { continue }
      fileStats.set(file, c)
    }
    const { first, cwd, msgs } = c.data
    if (!msgs.length) continue
    const name = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : project
    const sessionDay = dayKey(first)
    total.sessions++
    if (sessionDay === todayKey) today.sessions++
    if (first >= since) { range.sessions++; const d0 = byDay.get(sessionDay) || zero(); byDay.set(sessionDay, d0); d0.sessions++ }
    const proj = byProject.get(name) || { name, ...zero() }
    byProject.set(name, proj)
    proj.sessions++
    for (const m of msgs) {
      add(total, m.u, m.tools.length)
      const k = dayKey(m.ts)
      if (k === todayKey) add(today, m.u, m.tools.length)
      if (m.ts >= since) {
        add(range, m.u, m.tools.length)
        const day = byDay.get(k) || zero()
        byDay.set(k, day)
        add(day, m.u, m.tools.length)
        const mod = byModel.get(m.model || 'unknown') || { name: m.model || 'unknown', ...zero() }
        byModel.set(mod.name, mod)
        add(mod, m.u, m.tools.length)
        add(proj, m.u, m.tools.length)
        for (const t of m.tools) byTool.set(t, (byTool.get(t) || 0) + 1)
      }
    }
  }
  for (const f of fileStats.keys()) if (!seen.has(f)) fileStats.delete(f)
  const series = []
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(now - i * 86400000)
    series.push({ day: k, ...(byDay.get(k) || zero()) })
  }
  const top = (map, n) => [...map.values()].sort((a, b) => b.input + b.output - (a.input + a.output)).slice(0, n)
  return {
    days, total, today, range, series,
    models: top(byModel, 6),
    projects: top(byProject, 8).filter((p) => p.messages > 0),
    tools: [...byTool].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    live: { agents: [...agents.values()].filter((a) => a.kind === 'main').length, subagents: [...agents.values()].filter((a) => a.kind === 'sub').length },
  }
}

function endPerm(id) {
  perms.delete(id)
  for (const w of permWaiters.get(id) || []) { clearTimeout(w.timer); json(w.res, { decision: null, gone: true }) }
  permWaiters.delete(id)
}
function decidePerm(id, decision) {
  const p = perms.get(id)
  if (!p || p.decision) return false
  p.decision = decision
  for (const w of permWaiters.get(id) || []) { clearTimeout(w.timer); json(w.res, { decision }) }
  permWaiters.delete(id)
  setTimeout(() => { perms.delete(id); broadcast() }, 1800) // the window sees the outcome and then closes it
  return true
}

setInterval(() => {
  const now = Date.now()
  let changed = false
  for (const [id, p] of perms) if (now - p.ts > 120000) { endPerm(id); changed = true }
  for (const [k, a] of agents) if (a.done && now - a.doneAt > 9000) { agents.delete(k); changed = true }
  for (const a of agents.values()) {
    if (a.status !== 'idle' && now - a.t > IDLE_AFTER_MS) {
      a.status = 'idle'
      a.detail = ''
      changed = true
    }
  }
  if (changed) broadcast()
}, 2000)

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }

function readBody(req, cb) {
  let body = ''
  req.on('data', (c) => {
    body += c
    if (body.length > 1e6) req.destroy()
  })
  req.on('end', () => {
    try {
      cb(JSON.parse(body || '{}'))
    } catch {
      cb(null)
    }
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (req.method === 'GET' && url.pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('agent-office')
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return json(res, { clients: clients.size })
  }
  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write('data: ' + snapshot() + '\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/event') {
    return readBody(req, (ev) => {
      if (ev) handleEvent(ev)
      res.writeHead(ev ? 204 : 400)
      res.end()
    })
  }
  if (req.method === 'POST' && url.pathname === '/api/command') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (c) => {
      const ok = c && typeof c.session === 'string' && ['say', 'stop', 'close', 'commands'].includes(c.kind) && (c.kind !== 'say' || (typeof c.text === 'string' && c.text.trim()))
      if (ok) {
        const q = queues.get(c.session) || []
        let id
        if (c.kind === 'say') id = addChat(c.session, { role: 'user', text: c.text.trim().slice(0, 4000), state: 'queued', via: 'window' }).id
        q.push({ kind: c.kind, id, text: c.kind === 'say' ? c.text.trim().slice(0, 4000) : undefined })
        queues.set(c.session, q.slice(-20))
        if (c.kind === 'close') {
          // if the session does not respond within a few seconds, remove it from the window anyway
          const sid = c.session
          setTimeout(() => { if ([...agents.values()].some((a) => a.session === sid)) handleEvent({ type: 'session_end', session: sid }) }, 7000)
        }
        broadcast()
      }
      res.writeHead(ok ? 204 : 400)
      res.end()
    })
  }
  if (req.method === 'GET' && url.pathname === '/api/commands') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return json(res, { commands: cmds.get(url.searchParams.get('session') || '') || [] })
  }
  if (req.method === 'GET' && url.pathname === '/api/poll') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    const sid = url.searchParams.get('session') || ''
    const q = queues.get(sid) || []
    queues.delete(sid)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ commands: q }))
  }
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    const days = [7, 14, 30].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 14
    try { return json(res, computeStats(days)) } catch { return json(res, { error: 'Statistics not available' }, 500) }
  }
  if (req.method === 'GET' && url.pathname === '/api/dirs') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    try { return json(res, listDirs(url.searchParams.get('path') || '')) } catch (e) { return json(res, { error: 'Folder not readable' }, 400) }
  }
  if (req.method === 'POST' && url.pathname === '/api/mkdir') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (b) => {
      if (!b) return json(res, { error: 'Invalid request' }, 400)
      try { json(res, createProject(b.parent, b.name, !!b.git)) } catch (e) { json(res, { error: e.message || 'Error' }, 400) }
    })
  }
  if (req.method === 'POST' && url.pathname === '/api/spawn') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (b) => {
      if (!b) return json(res, { error: 'Invalid request' }, 400)
      try { launchAgent(b.cwd, b.name, b.species, b.shirt, b.loc); json(res, { ok: true }) } catch (e) { json(res, { error: e.message || 'Error' }, 400) }
    })
  }
  if (req.method === 'POST' && url.pathname === '/api/move') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (b) => {
      const a = b && typeof b.session === 'string' ? agents.get(b.session + ':main') : null
      const loc = b ? cleanLoc(b.loc) : undefined
      if (a && loc) { a.loc = loc; broadcast() }
      res.writeHead(a && loc ? 204 : 400)
      res.end()
    })
  }
  if (req.method === 'POST' && url.pathname === '/api/permission') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (b) => {
      const ok = b && typeof b.id === 'string' && ['allow', 'allow_session', 'deny'].includes(b.decision) && decidePerm(b.id, b.decision)
      if (ok) broadcast()
      res.writeHead(ok ? 204 : 400)
      res.end()
    })
  }
  if (req.method === 'GET' && url.pathname === '/api/permission/wait') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    const id = url.searchParams.get('id') || ''
    const ms = Math.min(9000, Math.max(500, Number(url.searchParams.get('ms')) || 8000))
    const p = perms.get(id)
    if (!p) return json(res, { decision: null, gone: true })
    if (p.decision) return json(res, { decision: p.decision })
    const w = { res, timer: setTimeout(() => { permWaiters.set(id, (permWaiters.get(id) || []).filter((x) => x !== w)); json(res, { decision: null }) }, ms) }
    const list = permWaiters.get(id) || []
    list.push(w)
    permWaiters.set(id, list)
    req.on('close', () => { clearTimeout(w.timer); permWaiters.set(id, (permWaiters.get(id) || []).filter((x) => x !== w)) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/layout') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (l) => {
      if (l && typeof l === 'object' && l.scenes) {
        layout = { scene: String(l.scene || 'office'), scenes: l.scenes }
        saveLayout()
        broadcast()
      }
      res.writeHead(l ? 204 : 400)
      res.end()
    })
  }

  // Static files
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const file = path.normalize(path.join(WEB, rel))
  if (!file.startsWith(WEB)) {
    res.writeHead(403)
    return res.end()
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
})

server.on('error', () => process.exit(0)) // port already in use: another server is running
server.listen(PORT, '127.0.0.1')

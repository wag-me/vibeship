// Vibeship local server: receives events from the mod and publishes them to the web window (SSE).
// No dependencies. Listens on 127.0.0.1 only.
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, spawnSync, execFile } = require('child_process')

const PORT = Number(process.env.AGENT_OFFICE_PORT || 47890)
const WEB = path.join(__dirname, '..', 'web')
const DATA_DIR = process.env.AGENT_OFFICE_DIR || path.join(os.homedir(), '.claude-vibeship')
// The data folder used to be ~/.claude-agent-office: copy it over once, so the token, the layout and the recent folders are kept.
if (!process.env.AGENT_OFFICE_DIR) {
  const old = path.join(os.homedir(), '.claude-agent-office')
  try { if (!fs.existsSync(DATA_DIR) && fs.statSync(old).isDirectory()) fs.cpSync(old, DATA_DIR, { recursive: true }) } catch {}
}
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json')

// ---------- New version check ----------
// Reads the version published on GitHub (the plugin manifest on main) at startup and every 6 hours, and compares it with
// this copy. No data is sent: it is a plain download of a public file. VIBESHIP_NO_UPDATE_CHECK=1 turns it off.
const PLUGIN_VERSION = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version) } catch { return '0.0.0' } })()
const UPDATE_URL = process.env.VIBESHIP_UPDATE_URL || 'https://raw.githubusercontent.com/wag-me/vibeship/main/.claude-plugin/plugin.json'
let update = null // { current, latest } when a newer version is out
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}
async function checkUpdate() {
  if (process.env.VIBESHIP_NO_UPDATE_CHECK) return
  try {
    const r = await fetch(UPDATE_URL, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return
    const v = String((await r.json()).version || '')
    const next = /^\d+\.\d+\.\d+$/.test(v) && isNewer(v, PLUGIN_VERSION) ? { current: PLUGIN_VERSION, latest: v } : null
    if (JSON.stringify(next) !== JSON.stringify(update)) { update = next; broadcast() }
  } catch {
    // offline or GitHub unreachable: try again later
  }
}
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
const infos = new Map() // session -> { model } what the session is running with
const cmds = new Map() // session -> [{ name, description }] slash commands of that session
const roots = new Map() // session -> working folder (what the Files panel may browse); never sent to the window
const acts = new Map() // session -> [finished actions] { id, ts, agent, tool, kind, ok, summary, file?, add?, del?, error? }
const perms = new Map() // id -> pending permission request
const permWaiters = new Map() // id -> [{ res, timer }]
const parked = new Map() // id -> permission question waiting in the terminal { id, session, tool, summary, ts }
const procs = new Map() // session -> pid of the process hosting it
const runs = new Map() // session -> recent commands [{ start, end }] (end 0 while running): who was running what, and when
let ports = {} // session -> servers its agent started [{ port, pid, addr, proc, http, title, url }]
let orphans = [] // servers still listening after the session that started them has ended (same shape, plus from)
const leftBy = new Map() // "pid:port" -> name of the agent whose session ended while that server was running
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
  const a = {}
  for (const [k, v] of acts) a[k] = v.slice(-30)
  const files = Object.fromEntries([...roots].map(([k, v]) => [k, path.basename(v) || v]))
  const pub = ({ pid, addr, ...p }) => p // process ids and addresses stay in the server
  const sp = Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, v.map(pub)]))
  return JSON.stringify({ agents: list, layout, chat: c, perms: [...perms.values()], parked: [...parked.values()], acts: a, roots: files, info: Object.fromEntries(infos), update, ports: sp, orphans: orphans.map(pub) })
}
// Events often come in bursts (several tool calls, a turn ending): they are sent to the windows as one snapshot.
let broadcastTimer = null
function broadcast() {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    const data = 'data: ' + snapshot() + '\n\n'
    for (const res of clients) res.write(data)
  }, 30)
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
// A name chosen by the person: letters, numbers, spaces and a few symbols, up to 40 characters
const cleanName = (v) => String(v ?? '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40)
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
      if (typeof ev.cwd === 'string' && path.isAbsolute(ev.cwd)) roots.set(session, path.resolve(ev.cwd))
      if (!historyTried.has(session)) { historyTried.add(session); loadHistory(session) }
      break
    case 'proc': // the process hosting the session: whatever it starts that listens on a port is this agent's server
      if (Number.isInteger(ev.pid) && ev.pid > 1 && ev.pid !== process.pid) { procs.set(session, ev.pid); kickScan() }
      break
    case 'activity':
      addActivity(session, ev, now)
      if (ev.kind === 'run') {
        const w = [...(runs.get(session) || [])].reverse().find((x) => !x.end)
        if (w) w.end = now
        kickScan() // a command may have just started (or stopped) a server
      }
      break
    case 'session_end': {
      // its servers that are still listening become orphans, remembered with the agent that started them
      const from = agents.get(session + ':main')?.name || 'a closed session'
      for (const p of ports[session] || []) { leftBy.set(p.pid + ':' + p.port, from); orphans.push({ ...p, from }) }
      delete ports[session]
      procs.delete(session)
      runs.delete(session)
      kickScan()
      for (const [k, a] of agents) if (a.session === session) agents.delete(k)
      chat.delete(session)
      cmds.delete(session)
      infos.delete(session)
      acts.delete(session)
      roots.delete(session)
      for (const [id, p] of perms) if (p.session === session) endPerm(id)
      unpark(session)
      break
    }
    case 'prompt_in': { // message typed in the terminal
      if (typeof ev.text !== 'string' || !ev.text.trim()) break
      addChat(session, { role: 'user', text: ev.text.slice(0, 4000), state: 'working', via: 'terminal' })
      if (ev.text.trim().startsWith('/')) break // a slash command may not start a turn: no turn_complete would end "thinking"
      // a turn is starting: thinking already, without waiting for turn_start (which may come later, or not at all)
      const main = mainOf(session)
      main.busy = true
      if (main.status === 'idle') { main.status = 'think'; main.detail = '' }
      main.t = now
      break
    }
    case 'info': // what the session runs with (the model), shown under the chat
      if (typeof ev.model === 'string') infos.set(session, { ...(infos.get(session) || {}), model: ev.model.slice(0, 80) })
      break
    case 'info_error':
      addChat(session, { role: 'assistant', text: String(ev.text || 'The change was refused.').slice(0, 300), state: 'error' })
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
      unpark(session) // a new turn: whatever was asked in the terminal has been answered
      const main = mainOf(session)
      main.busy = true // until turn_complete the agent is working, even while it only thinks between tools
      if (main.status === 'idle') { main.status = 'think'; main.detail = '' }
      main.t = now
      const m = lastUser(session, ['queued', 'sent'])
      if (m) m.state = 'working'
      break
    }
    case 'permission':
      if (ev.id) {
        const p = { id: String(ev.id), session, tool: String(ev.tool || ''), summary: String(ev.summary || '').slice(0, 400), reason: ev.reason ? String(ev.reason).slice(0, 200) : '', ts: now, decision: null }
        const qs = cleanQuestions(ev.questions)
        if (qs) p.questions = qs // a multiple-choice question from Claude (AskUserQuestion), not a permission
        perms.set(p.id, p)
      }
      break
    case 'permission_end':
      endPerm(String(ev.id))
      break
    case 'parked': // the question moved to the terminal and is waiting there
      if (ev.id) parked.set(String(ev.id), { id: String(ev.id), session, tool: String(ev.tool || ''), summary: String(ev.summary || '').slice(0, 400), ts: now })
      break
    case 'unparked':
      parked.delete(String(ev.id))
      break
    case 'tool': {
      if (ev.status === 'run') { const l = runs.get(session) || []; l.push({ start: now, end: 0 }); runs.set(session, l.slice(-30)) }
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
      unpark(session) // the turn ended (a refusal or Esc in the terminal ends it too)
      const m = mainOf(session)
      m.status = 'idle'
      m.detail = ''
      m.busy = false
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

// One finished action in a session's activity feed (from the mod, or rebuilt from the transcript)
function addActivity(session, ev, ts) {
  const a = resolve(session, ev.agentId)
  const n = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1e6, Math.floor(x))) : undefined)
  const list = acts.get(session) || []
  // the window only needs the path inside the working folder (that is also what the Files panel opens)
  let rel
  const root = roots.get(session)
  if (root && typeof ev.file === 'string') {
    const r = path.relative(root, path.resolve(root, ev.file))
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) rel = r.split(path.sep).join('/')
  }
  list.push({ id: rid(), ts, agent: a.name, tool: String(ev.tool || '').slice(0, 40), kind: ['read', 'write', 'run', 'web', 'delegate'].includes(ev.kind) ? ev.kind : 'run', ok: ev.ok !== false, summary: String(ev.summary || '').slice(0, 160), rel, add: n(ev.add), del: n(ev.del), error: ev.error ? String(ev.error).slice(0, 160) : undefined })
  acts.set(session, list.slice(-60))
}

// ---------- Conversation history from the transcripts ----------
// The chat and the activity feed live in this server's memory: a server started later (the window closed and opened
// again, maybe from another folder) would show them empty. So the first time a session shows up, both are rebuilt from
// the end of its Claude Code transcript, which also holds what happened while no window was open.
const historyTried = new Set()
const HISTORY_TAIL = 2 * 1024 * 1024
function transcriptOf(id) {
  if (!SESSION_ID.test(id)) return null
  let dirs = []
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { return null }
  for (const d of dirs) { const f = path.join(PROJECTS_DIR, d.name, id + '.jsonl'); if (fs.existsSync(f)) return f }
  return null
}
// the same kinds and summaries the mod sends for live tool calls
function kindOf(tool) {
  if (['Read', 'Grep', 'Glob'].includes(tool)) return 'read'
  if (['Edit', 'Write', 'NotebookEdit'].includes(tool)) return 'write'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web'
  if (tool === 'Task' || tool === 'Agent') return 'delegate'
  return 'run'
}
const lines = (t) => (typeof t === 'string' && t.length ? t.split('\n').length : 0)
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ') : '')
function loadHistory(session) {
  const file = transcriptOf(session)
  if (!file) return
  let text
  try {
    const st = fs.statSync(file)
    const fd = fs.openSync(file, 'r')
    try { text = readSlice(fd, Math.max(0, st.size - HISTORY_TAIL), Math.min(st.size, HISTORY_TAIL)) } finally { fs.closeSync(fd) }
  } catch { return }
  const msgs = [], done = [], calls = new Map(), seen = new Set(), ran = []
  let reply = '', replyTs = 0
  const endTurn = () => { if (reply.trim()) msgs.push({ role: 'assistant', text: reply.trim().slice(0, 4000), state: 'answer', ts: replyTs }); reply = '' }
  for (const line of text.split('\n')) {
    if (!line.includes('"message"')) continue
    let o
    try { o = JSON.parse(line) } catch { continue } // the first line of the slice is usually cut
    if (o.isSidechain || !o.message) continue // a subagent's own work
    const ts = Date.parse(o.timestamp) || Date.now()
    const content = o.message.content
    if (o.type === 'user') {
      for (const c of Array.isArray(content) ? content : []) {
        const call = c && c.type === 'tool_result' && calls.get(c.tool_use_id)
        if (!call) continue
        calls.delete(c.tool_use_id)
        const i = call.input
        const raw = i.command ?? i.file_path ?? i.path ?? i.url ?? i.query ?? i.pattern ?? i.description ?? ''
        const ev = { tool: call.tool, kind: kindOf(call.tool), ok: !c.is_error, summary: String(raw).replace(/\s+/g, ' ').trim().slice(0, 160) }
        if (typeof (i.file_path ?? i.notebook_path) === 'string') ev.file = i.file_path ?? i.notebook_path
        if (call.tool === 'Edit') { ev.add = lines(i.new_string); ev.del = lines(i.old_string) } else if (call.tool === 'Write') ev.add = lines(i.content)
        if (c.is_error) ev.error = resultText(c.content).replace(/\s+/g, ' ').slice(0, 160)
        done.push([ev, ts])
        if (ev.kind === 'run' && ev.ok) ran.push({ start: call.ts, end: ts })
      }
      const t = o.isMeta ? '' : firstText(content)
      if (t && !/^\[Request interrupted/.test(t)) { endTurn(); msgs.push({ role: 'user', text: t.slice(0, 4000), state: 'done', via: 'terminal', ts }) }
    } else if (o.type === 'assistant' && Array.isArray(content)) {
      content.forEach((c) => {
        // a message may be written more than once while it streams: each of its parts counts once
        if (!c) return
        const sig = (o.message.id || o.uuid) + ':' + (c.id || c.type + ':' + String(c.text || '').slice(0, 200))
        if (seen.has(sig)) return
        seen.add(sig)
        if (c.type === 'text' && c.text) { reply += (reply ? '\n\n' : '') + c.text; replyTs = ts }
        else if (c.type === 'tool_use') { reply = ''; calls.set(c.id, { tool: String(c.name), input: c.input || {}, ts }) } // only the text after the last tool is the answer
      })
    }
  }
  endTurn()
  if (!(chat.get(session) || []).length && msgs.length) chat.set(session, msgs.slice(-24).map((m) => ({ id: rid(), ...m })))
  if (!(acts.get(session) || []).length) for (const [ev, ts] of done.slice(-30)) addActivity(session, ev, ts)
  // when its commands ran: a server one of them started before this server was running can still be told apart
  if (!(runs.get(session) || []).length && ran.length) { runs.set(session, ran.slice(-30)); kickScan() }
}

// ---------- Servers the agents started (listening ports) ----------
// Every few seconds, only while a window is open, the listening TCP ports and the process tree are read with one system
// command. A port belongs to an agent when the process listening on it descends from the process hosting that session.
// Each new port is asked for "/" once: if it answers HTTP, its page title is kept and the window offers to open it.
const SCAN_MS = 6000
// On Windows one PowerShell stays open while windows are: starting one costs ~2.5 s of CPU, a scan inside it ~0.03 s.
// It scans once per line it reads and quits when its input closes (no window for a while, or this server has ended).
const PS_LOOP = "$ErrorActionPreference='SilentlyContinue'; while ($null -ne [Console]::In.ReadLine()) { $o = @(Get-NetTCPConnection -State Listen | ForEach-Object { 'L ' + $_.LocalPort + ' ' + $_.OwningProcess + ' ' + $_.LocalAddress }) + @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate | ForEach-Object { 'P ' + $_.ProcessId + ' ' + $_.ParentProcessId + ' ' + $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }) + ' ' + $_.Name }); [Console]::Out.Write(($o -join [char]10) + [char]10 + 'END' + [char]10); [Console]::Out.Flush() }"
let scanner = null // { proc, buf, done }
function stopScanner() { if (scanner) { scanner.proc.stdin.end(); scanner.proc.kill(); scanner = null } }
function readListeners() {
  if (!WIN) {
    return new Promise((resolve) => execFile('sh', ['-c', 'lsof -nP -iTCP -sTCP:LISTEN -F pn 2>/dev/null; echo ---; ps -A -o pid= -o ppid= -o etime= -o comm='], { timeout: 15000, maxBuffer: 16e6 }, (err, out) => resolve(out ? parseListeners(String(out), false) : null)))
  }
  return new Promise((resolve) => {
    if (!scanner) {
      const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_LOOP], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
      const s = { proc, buf: '', done: null }
      proc.stdout.on('data', (d) => {
        s.buf += d
        const i = s.buf.indexOf('\nEND\n')
        if (i >= 0 && s.done) { const out = s.buf.slice(0, i); s.buf = s.buf.slice(i + 5); s.done(parseListeners(out, true)) }
      })
      proc.on('error', () => { if (scanner === s) scanner = null; s.done?.(null) })
      proc.on('exit', () => { if (scanner === s) scanner = null; s.done?.(null) })
      proc.stdin.on('error', () => {})
      scanner = s
    }
    const s = scanner
    const timer = setTimeout(() => { if (scanner === s) stopScanner(); finish(null) }, 15000) // stuck: start a fresh one next time
    const finish = (r) => { clearTimeout(timer); s.done = null; resolve(r) }
    s.done = finish
    s.proc.stdin.write('\n')
  })
}
// -> { listen: [{ port, pid, addr }], parent: pid -> ppid, name: pid -> process name, born: pid -> start time (ms) }
function parseListeners(out, win) {
  const listen = [], parent = new Map(), name = new Map(), born = new Map()
  if (win) {
    for (const line of out.split(/\r?\n/)) {
      const l = /^L (\d+) (\d+) (.*)$/.exec(line.trim())
      if (l) { listen.push({ port: +l[1], pid: +l[2], addr: l[3] }); continue }
      const p = /^P (\d+) (\d+) (\d*) (.*)$/.exec(line.trim())
      if (p) { parent.set(+p[1], +p[2]); born.set(+p[1], +p[3] || 0); name.set(+p[1], p[4]) }
    }
  } else {
    const [lsof, ps = ''] = out.split(/^---$/m)
    let pid = 0
    for (const line of lsof.split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1)
      else if (line[0] === 'n') { const i = line.lastIndexOf(':'); const port = +line.slice(i + 1); if (pid && port) listen.push({ port, pid, addr: line.slice(1, i).replace(/^\[|\]$/g, '') }) }
    }
    const now = Date.now()
    for (const line of ps.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(.*)$/.exec(line) // etime is [[dd-]hh:]mm:ss
      if (m) { parent.set(+m[1], +m[2]); born.set(+m[1], now - ((+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + +m[5] * 60 + +m[6]) * 1000); name.set(+m[1], path.basename(m[7].trim())) }
    }
  }
  return { listen, parent, name, born }
}
// The address a browser on this machine reaches the server at
function urlOf(port, addr) {
  const any = !addr || addr === '0.0.0.0' || addr === '::' || addr === '*'
  const host = any || addr === '127.0.0.1' || addr === '::1' ? 'localhost' : addr.includes(':') ? '[' + addr + ']' : addr
  return 'http://' + host + ':' + port + '/'
}
const probes = new Map() // "pid:port" -> { http, title, at }
const ownedBy = new Map() // "pid:port" -> session the server was found under
async function probe(port, addr) {
  const host = addr === '::1' ? '[::1]' : !addr || addr === '0.0.0.0' || addr === '::' || addr === '*' || addr === '127.0.0.1' ? '127.0.0.1' : addr.includes(':') ? '[' + addr + ']' : addr
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 2500)
  try {
    const r = await fetch('http://' + host + ':' + port + '/', { signal: ctl.signal, headers: { Accept: 'text/html' } })
    let title = ''
    if (/html/i.test(r.headers.get('content-type') || '')) {
      // only the head of the page is needed: stop reading after 64 KB (a dev server may also stream forever)
      const reader = r.body.getReader()
      let buf = ''
      while (buf.length < 65536 && !/<\/title>/i.test(buf)) { const { value, done } = await reader.read(); if (done) break; buf += Buffer.from(value).toString('utf8') }
      reader.cancel().catch(() => {})
      const m = /<title[^>]*>([^<]*)/i.exec(buf)
      if (m) title = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 80)
    } else r.body?.cancel().catch(() => {})
    return { http: true, title }
  } catch {
    return { http: false, title: '' } // not HTTP (a database, a socket server...) or not answering yet
  } finally { clearTimeout(timer) }
}

let scanning = false, kickTimer = null
// A command just ran or a session came or went: look again shortly, without waiting for the next round
function kickScan() {
  clearTimeout(kickTimer)
  kickTimer = setTimeout(() => void scanPorts(), 1500)
}
async function scanPorts() {
  if (scanning || !clients.size || (!procs.size && !leftBy.size && !orphans.length)) return
  scanning = true
  try {
    const r = await readListeners()
    if (!r) return
    const hosts = new Map([...procs].map(([s, pid]) => [pid, s]))
    const born = (pid) => r.born.get(pid) || 0
    // the parent of pid if it is still running, else 0 (on Windows its id may even belong to a newer process by now)
    const liveParent = (pid) => { const p = r.parent.get(pid); return p && r.parent.has(p) && !(born(p) > born(pid)) ? p : 0 }
    const ownerOf = (pid) => { for (let p = liveParent(pid), i = 0; p && i < 40; p = liveParent(p), i++) if (hosts.has(p)) return hosts.get(p) }
    // When the chain is cut (the shell that started a server in the background has exited), what is left of it was
    // started by whichever agent was running a command at that moment, if only one was.
    const guessOwner = (pid) => {
      let top = pid
      for (let i = 0; i < 40; i++) { const p = liveParent(top); if (!p || p === 1) break; top = p }
      const cut = WIN ? r.parent.get(top) > 4 && !liveParent(top) : r.parent.get(top) === 1 // 0 and 4 are Windows' own roots
      const t = born(top)
      if (!cut || !t) return
      const hit = [...procs.keys()].filter((s) => (runs.get(s) || []).some((w) => t >= w.start - 2000 && t <= (w.end || Math.min(Date.now(), w.start + 300000)) + 2000))
      return hit.length === 1 ? hit[0] : undefined
    }
    const seen = new Map() // "pid:port" -> listener (the same port is often listened on both IPv4 and IPv6)
    for (const l of r.listen) {
      if (l.pid === process.pid || l.port === PORT || hosts.has(l.pid)) continue // Vibeship itself and Claude Code's own ports
      const k = l.pid + ':' + l.port
      if (!seen.has(k) || seen.get(k).addr !== '127.0.0.1') seen.set(k, l)
    }
    const nextPorts = {}, nextOrphans = []
    const now = Date.now()
    for (const [k, l] of seen) {
      // once found, a server stays its agent's even if the chain breaks later (e.g. the shell that started it exits)
      let session = ownerOf(l.pid) || (!ownedBy.has(k) && !leftBy.has(k) ? guessOwner(l.pid) : undefined)
      if (session) ownedBy.set(k, session)
      else if (procs.has(ownedBy.get(k))) session = ownedBy.get(k)
      const from = session ? null : leftBy.get(k)
      if (!session && !from) continue
      let pr = probes.get(k)
      if (!pr || (!pr.http && now - pr.at > 20000)) { pr = { ...(await probe(l.port, l.addr)), at: now }; probes.set(k, pr) } // a server may still be starting: ask again later
      const item = { port: l.port, pid: l.pid, addr: l.addr, proc: String(r.name.get(l.pid) || '').slice(0, 40), http: pr.http, title: pr.title, url: urlOf(l.port, l.addr) }
      if (session) (nextPorts[session] ||= []).push(item)
      else nextOrphans.push({ ...item, from })
    }
    for (const k of leftBy.keys()) if (!seen.has(k)) leftBy.delete(k)
    for (const k of probes.keys()) if (!seen.has(k)) probes.delete(k)
    for (const k of ownedBy.keys()) if (!seen.has(k)) ownedBy.delete(k)
    for (const v of Object.values(nextPorts)) v.sort((a, b) => a.port - b.port)
    nextOrphans.sort((a, b) => a.port - b.port)
    const changed = JSON.stringify([nextPorts, nextOrphans]) !== JSON.stringify([ports, orphans])
    ports = nextPorts
    orphans = nextOrphans
    if (changed) broadcast()
  } finally { scanning = false }
}
let lastClientAt = 0
setInterval(() => {
  if (clients.size) lastClientAt = Date.now()
  else if (scanner && Date.now() - lastClientAt > 60000) stopScanner() // no window for a minute: free the PowerShell
  void scanPorts()
}, SCAN_MS)

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
// ---------- Files panel: browse and read the working folder of a session ----------
// Everything is resolved against the session's folder (symlinks included): nothing outside it can be listed or read.
const HIDE_DIRS = new Set(['node_modules', '.git'])
const SECRET = /^(\.env(\..*)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials|.*\.(pem|key|p12|pfx|kdbx))$/i
const MAX_FILE = 256 * 1024
function inRoot(session, p) {
  const root = roots.get(session)
  if (!root) throw new Error('This agent has no working folder yet: type /vibeship in its session')
  const realRoot = fs.realpathSync(root)
  const real = fs.realpathSync(path.resolve(realRoot, String(p || '.')))
  const rel = path.relative(realRoot, real)
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Outside the working folder') // a name like "..notes" inside is fine
  return { real, rel: rel.split(path.sep).join('/') }
}
function listFiles(session, p) {
  const { real, rel } = inRoot(session, p)
  const ents = fs.readdirSync(real, { withFileTypes: true }).filter((e) => !(e.isDirectory() && HIDE_DIRS.has(e.name)))
  const out = []
  for (const e of ents.slice(0, 2000)) {
    let st = null
    try { st = fs.statSync(path.join(real, e.name)) } catch { continue }
    out.push({ name: e.name, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs })
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'en') : a.dir ? -1 : 1))
  return { rel, name: path.basename(real), entries: out.slice(0, 500), more: out.length > 500 }
}
function readFile(session, p) {
  const { real, rel } = inRoot(session, p)
  const st = fs.statSync(real)
  if (!st.isFile()) throw new Error('Not a file')
  const name = path.basename(real)
  if (SECRET.test(name)) return { rel, name, size: st.size, blocked: 'Hidden on purpose: this kind of file often holds secrets.' }
  const fd = fs.openSync(real, 'r')
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_FILE))
    fs.readSync(fd, buf, 0, buf.length, 0)
    if (buf.includes(0)) return { rel, name, size: st.size, blocked: 'Binary file: preview not available.' }
    return { rel, name, size: st.size, truncated: st.size > MAX_FILE, text: buf.toString('utf8') }
  } finally { fs.closeSync(fd) }
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
function launchAgent(cwd, name, species, shirt, loc, resume) {
  if (resume !== undefined && !SESSION_ID.test(String(resume))) throw new Error('Invalid session')
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
    const lines = ['@echo off', 'title Vibeship', 'cd /d "' + cwd + '"', ...envs.map(([k, v]) => 'set "' + k + '=' + v + '"'), 'call claude --plugin-dir "' + plugin + '"' + (resume ? ' --resume ' + resume : ''), 'exit', '']
    fs.writeFileSync(f, lines.join('\r\n'))
    spawn('cmd.exe', ['/d', '/c', 'start', '"Vibeship"', '"' + f + '"'], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
    setTimeout(() => fs.unlink(f, () => {}), 90000)
  } else if (process.platform === 'darwin') {
    const f = path.join(DATA_DIR, 'launch-' + Date.now() + '.command')
    const lines = ['#!/bin/bash', 'cd ' + q(cwd), ...envs.map(([k, v]) => 'export ' + k + '=' + q(v)), 'claude --plugin-dir ' + q(plugin) + (resume ? ' --resume ' + q(resume) : ''), '']
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
// ---------- Recent sessions, to resume them from the window ----------
// Read from the same transcripts as the statistics. Only the start and the end of each file are read (titles, folder,
// first message), so even very long sessions cost little; the result is cached per file until it changes.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sessionInfoCache = new Map() // file -> { sig, info }
const firstText = (content) => {
  const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((c) => c && c.type === 'text').map((c) => c.text) : []
  return parts.map((t) => String(t).trim()).find((t) => t && !t.startsWith('<')) || '' // system reminders and command echoes start with a tag
}
function readSlice(fd, pos, len) { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.subarray(0, n).toString('utf8') }
function sessionInfo(file) {
  const st = fs.statSync(file)
  const sig = st.mtimeMs + ':' + st.size
  const c = sessionInfoCache.get(file)
  if (c && c.sig === sig) return c.info
  const HEAD = 512 * 1024, TAIL = 256 * 1024
  const fd = fs.openSync(file, 'r')
  let head, tail = ''
  try { head = readSlice(fd, 0, Math.min(st.size, HEAD)); if (st.size > HEAD) tail = readSlice(fd, Math.max(HEAD, st.size - TAIL), TAIL) } finally { fs.closeSync(fd) }
  let cwd = '', first = '', ai = '', custom = ''
  for (const part of [head, tail]) {
    for (const line of part.split('\n')) {
      if (!line.includes('"type"')) continue
      let o
      try { o = JSON.parse(line) } catch { continue } // the cut line at either end of a slice is skipped
      if (o.type === 'custom-title' && o.customTitle) custom = String(o.customTitle) // the last one wins
      else if (o.type === 'ai-title' && o.aiTitle) ai = String(o.aiTitle)
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
      if (!first && o.type === 'user' && !o.isMeta && !o.isSidechain && o.message) first = firstText(o.message.content)
    }
  }
  const info = { id: path.basename(file, '.jsonl'), cwd, title: (custom || ai || first).replace(/\s+/g, ' ').trim().slice(0, 140), lastAt: st.mtimeMs, size: st.size }
  sessionInfoCache.set(file, { sig, info })
  return info
}
function recentSessions(limit = 30) {
  const files = []
  for (const { file } of collectFiles()) { try { files.push({ file, m: fs.statSync(file).mtimeMs }) } catch {} }
  files.sort((a, b) => b.m - a.m)
  const out = []
  for (const { file } of files.slice(0, limit * 2)) {
    let info
    try { info = sessionInfo(file) } catch { continue }
    if (!info.cwd || !info.title) continue // nothing to show or to resume (e.g. a session that only ran a command)
    out.push({ ...info, project: path.basename(info.cwd) || info.cwd, live: agents.has(info.id + ':main') })
    if (out.length >= limit) break
  }
  return out
}

let statsCache = null
const liveCounts = () => ({ agents: [...agents.values()].filter((a) => a.kind === 'main').length, subagents: [...agents.values()].filter((a) => a.kind === 'sub').length })
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

function unpark(session) {
  for (const [id, p] of parked) if (p.session === session) parked.delete(id)
}
function cleanQuestions(list) {
  if (!Array.isArray(list) || !list.length) return null
  const str = (v, n) => String(v ?? '').slice(0, n)
  const qs = list.slice(0, 4).map((q) => ({
    question: str(q?.question, 500),
    header: str(q?.header, 40),
    multiSelect: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 8).map((o) => ({ label: str(o?.label, 120), description: str(o?.description, 400) })),
  })).filter((q) => q.question)
  return qs.length ? qs : null
}
// The window's answer to a question: question text -> answer, for every question asked
function cleanAnswers(p, answers) {
  if (!p.questions || !answers || typeof answers !== 'object') return null
  const out = {}
  for (const q of p.questions) {
    const a = answers[q.question]
    if (typeof a !== 'string' || !a.trim()) return null
    out[q.question] = a.trim().slice(0, 2000)
  }
  return out
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
  for (const [id, p] of perms) if (now - p.ts > (p.questions ? 180000 : 120000)) { endPerm(id); changed = true }
  for (const [k, a] of agents) if (a.done && now - a.doneAt > 9000) { agents.delete(k); changed = true }
  for (const a of agents.values()) {
    // the last tool finished a while ago: back to idle, or to "thinking" if its turn is still going
    const rest = a.busy && now - a.t < 15 * 60000 ? 'think' : 'idle' // a turn whose end never arrived does not think forever
    if (a.status !== rest && a.status !== 'idle' && now - a.t > IDLE_AFTER_MS) {
      a.status = rest
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

// uploaded files older than a week are removed
try { const d = path.join(DATA_DIR, 'uploads'); for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.unlinkSync(p) } } catch {}

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
    kickScan() // the ports may be stale: nothing is scanned while no window is open
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
      const ok = c && typeof c.session === 'string' && ['say', 'stop', 'close', 'commands', 'model', 'rename'].includes(c.kind) && (c.kind !== 'say' || (typeof c.text === 'string' && c.text.trim())) && (c.kind !== 'model' || (typeof c.value === 'string' && /^[a-z0-9.\[\]-]{1,30}$/.test(c.value))) && (c.kind !== 'rename' || (typeof c.value === 'string' && cleanName(c.value) && agents.has(c.session + ':main')))
      if (ok) {
        const q = queues.get(c.session) || []
        let id
        if (c.kind === 'say') id = addChat(c.session, { role: 'user', text: c.text.trim().slice(0, 4000), state: 'queued', via: 'window' }).id
        if (c.kind === 'rename') { c.value = cleanName(c.value); const a = agents.get(c.session + ':main'); a.name = uniqueName(c.value, a.key) }
        q.push({ kind: c.kind, id, text: c.kind === 'say' ? c.text.trim().slice(0, 4000) : undefined, value: c.kind === 'model' || c.kind === 'rename' ? c.value : undefined })
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
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    // a file picked in the window is saved in the data folder, so the agent can read it by path (up to 8 MB each)
    let body = '', tooBig = false
    req.on('data', (c) => { body += c; if (body.length > 12e6) { tooBig = true; req.destroy() } })
    req.on('end', () => {
      if (tooBig) return
      try {
        const b = JSON.parse(body)
        const buf = Buffer.from(String(b.data || ''), 'base64')
        if (!buf.length || buf.length > 8 * 1024 * 1024) throw new Error('A file must be between 1 byte and 8 MB')
        const safe = path.basename(String(b.name || 'file')).replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(-80) || 'file'
        const dir = path.join(DATA_DIR, 'uploads')
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, rid() + '-' + safe)
        fs.writeFileSync(file, buf)
        json(res, { path: file, name: safe, size: buf.length })
      } catch (e) { json(res, { error: e.message || 'Upload failed' }, 400) }
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    try { return json(res, { sessions: recentSessions() }) } catch { return json(res, { error: 'Sessions not available' }, 500) }
  }
  if (req.method === 'POST' && url.pathname === '/api/resume') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    return readBody(req, (b) => {
      try {
        const id = b && String(b.id || '')
        if (!SESSION_ID.test(id)) throw new Error('Invalid session')
        const sess = recentSessions(200).find((x) => x.id === id)
        if (!sess) throw new Error('Session not found')
        if (sess.live) throw new Error('This session is already open')
        launchAgent(sess.cwd, '', undefined, undefined, undefined, id)
        json(res, { ok: true })
      } catch (e) { json(res, { error: e.code === 'ENOENT' ? 'Its folder no longer exists' : e.message || 'Error' }, 400) }
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
    return res.end(JSON.stringify({ commands: q, known: agents.has(sid + ':main'), update: update || undefined }))
  }
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    const days = [7, 14, 30].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 14
    // the window refreshes every 15 s: reading every transcript again within a few seconds is wasted work
    try {
      if (!statsCache || statsCache.days !== days || Date.now() - statsCache.at > 5000) statsCache = { days, at: Date.now(), data: computeStats(days) }
      return json(res, { ...statsCache.data, live: liveCounts() })
    } catch { return json(res, { error: 'Statistics not available' }, 500) }
  }
  if (req.method === 'GET' && url.pathname === '/api/dirs') {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    try { return json(res, listDirs(url.searchParams.get('path') || '')) } catch (e) { return json(res, { error: 'Folder not readable' }, 400) }
  }
  if (req.method === 'GET' && (url.pathname === '/api/files' || url.pathname === '/api/file')) {
    if (!authed(req)) { res.writeHead(401); return res.end() }
    try {
      const s = url.searchParams.get('session') || '', p = url.searchParams.get('path') || ''
      return json(res, url.pathname === '/api/files' ? listFiles(s, p) : readFile(s, p))
    } catch (e) { return json(res, { error: e.code === 'ENOENT' ? 'Not found' : e.message || 'Not readable' }, 400) }
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
      const p = b && typeof b.id === 'string' ? perms.get(b.id) : null
      let decision = null
      if (p?.questions) {
        // a question: the answers, or "terminal" to hand it back to the terminal at once
        if (b.decision === 'terminal') { endPerm(b.id); broadcast(); res.writeHead(204); return res.end() }
        const answers = cleanAnswers(p, b.answers)
        if (answers) decision = { answers }
      } else if (p && ['allow', 'allow_session', 'deny'].includes(b.decision)) decision = b.decision
      const ok = !!decision && decidePerm(b.id, decision)
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
server.listen(PORT, '127.0.0.1', () => {
  void checkUpdate()
  setInterval(checkUpdate, 6 * 3600 * 1000).unref()
})

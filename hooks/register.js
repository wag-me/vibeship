function statusOf(tool) {
  if (['Read', 'Grep', 'Glob'].includes(tool)) return 'read'
  if (['Edit', 'Write', 'NotebookEdit'].includes(tool)) return 'write'
  if (tool === 'Bash' || tool === 'PowerShell') return 'run'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web'
  if (tool === 'Task' || tool === 'Agent') return 'delegate'
  return 'run'
}

// ---------- Web window (local server + browser) ----------
// Port and data folder can be changed with AGENT_OFFICE_PORT and AGENT_OFFICE_DIR (handy to test without disturbing other windows)
let BASE = 'http://127.0.0.1:47890'
let dataDir = null
let loc = null // location chosen with AGENT_OFFICE_LOC (bridge, engine, habitat)
let look = null // look chosen with AGENT_OFFICE_LOOK ("species:shirt")
let agentName = null // name chosen with AGENT_OFFICE_NAME; otherwise the folder name is used
let sessionId = 'default'
let serverStarting = false
let turnId = null // current turn, needed to stop it from the window
let tokenCache = null
let cancelPoll = null
let polling = false

// The token is in a file in the user's folder, written by the server at startup.
async function readToken($) {
  if (tokenCache) return tokenCache
  let dir = dataDir
  if (!dir) {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return null
    dir = home + '/.claude-agent-office'
  }
  try {
    tokenCache = String(await $.fs.read(dir + '/token')).trim()
  } catch {
    tokenCache = null
  }
  return tokenCache
}

// Picks up the commands sent from the window (chat, stop) and runs them in this session.
async function pollCommands($) {
  if (polling) return
  polling = true
  try {
    const token = await readToken($)
    if (!token) return
    const r = await $.http.fetch(BASE + '/api/poll?session=' + encodeURIComponent(sessionId), { headers: { 'x-token': token } })
    if (r.status === 401) { tokenCache = null; return }
    if (!r.ok) return
    const { commands } = JSON.parse(r.text)
    for (const c of commands ?? []) {
      if (c.kind === 'say' && c.text && /^\/[\w:.-]+(\s|$)/.test(String(c.text).trim())) {
        const m = /^\/([\w:.-]+)\s*([\s\S]*)$/.exec(String(c.text).trim())
        void runSlash($, c.id, m[1], m[2])
      } else if (c.kind === 'commands') {
        void sendCommandList($)
      } else if (c.kind === 'say' && c.text) {
        const p = $.prompt.submit({ text: String(c.text), asUser: true })
        send($, { type: 'say_delivered', id: c.id }) // the window shows "delivered"
        void p.catch(() => send($, { type: 'say_failed', id: c.id }))
      } else if (c.kind === 'close') {
        void closeSelf($)
      } else if (c.kind === 'stop' && turnId) {
        void $.turn.abort({ turnId }).catch(() => {})
      }
    }
  } catch {
    // server off or invalid response: retry on the next round
  } finally {
    polling = false
  }
}

// Runs a slash command typed in the window chat (/model, /compact, skills...) as if it was typed in the terminal.
async function runSlash($, id, name, args) {
  send($, { type: 'say_delivered', id })
  // a plugin cannot run its own commands through $.command.run: answer these directly
  if (name === 'vibeship') return send($, { type: 'command_result', id, ok: true, text: 'The Vibeship window is already open.' })
  try {
    const list = await $.command.list()
    if (!list.some((x) => x.name === name)) return send($, { type: 'command_result', id, ok: false, text: 'Unknown command: /' + name })
    const r = await $.command.run({ command: name, args })
    send($, { type: 'command_result', id, ok: true, text: r && r.text ? String(r.text) : '' })
  } catch (e) {
    send($, { type: 'command_result', id, ok: false, text: String((e && e.message) || e).slice(0, 300) })
  }
}
// Publishes the slash commands of this session (for the autocomplete of the window chat).
async function sendCommandList($) {
  try {
    const list = await $.command.list()
    send($, { type: 'commands', list: list.slice(0, 500).map((c) => ({ name: c.name, description: String(c.description || '').slice(0, 120) })) })
  } catch {
    // not available: the chat still works, only without suggestions
  }
}

// Closes this Claude Code session. First tells the server, then stops the process hosting it.
// Walks up the process chain until it finds claude/node/bun and stops only that one; if not found, it just removes the agent from the window.
async function closeSelf($) {
  await sendNow($, { type: 'session_end' })
  const win = (await $.env.get('OS')) === 'Windows_NT'
  try {
    const find = win
      ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', '$i=$PID; for($k=0;$k -lt 6;$k++){ $i=(Get-CimInstance Win32_Process -Filter "ProcessId=$i").ParentProcessId; if(-not $i){break}; $n=(Get-Process -Id $i -ErrorAction SilentlyContinue).ProcessName; if($n -match "^(claude|node|bun|deno)$"){ "$i $n"; break } }']
      : ['sh', '-c', 'p=$$; for k in 1 2 3 4 5 6; do p=$(ps -o ppid= -p $p | tr -d " "); [ -z "$p" ] && break; n=$(ps -o comm= -p $p); case "$n" in *claude*|*node*|*bun*|*deno*) echo "$p $n"; break;; esac; done']
    const r = await $.process.run(find, { timeoutMs: 15000 })
    const m = /^(\d+)\s+(.+)$/m.exec(String(r.stdout).trim())
    if (!m || !/node|claude|bun|deno/i.test(m[2])) return
    await $.process.run(win ? ['taskkill', '/PID', m[1], '/F'] : ['kill', '-9', m[1]], { timeoutMs: 10000 })
  } catch {
    // not available in this environment: the agent stays removed from the window but the session continues
  }
}

// Sends an event to the local server without waiting for the response (does not slow Claude down).
function send($, body) {
  $.http
    .fetch(BASE + '/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, ...body }),
    })
    .catch(() => {})
}

// Like send but waits for the server to record the event (needed before a long wait).
async function sendNow($, body) {
  try {
    await $.http.fetch(BASE + '/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, ...body }) })
  } catch {
    // server off
  }
}

function summaryOf(e) {
  const i = e.input ?? {}
  const raw = i.command ?? i.file_path ?? i.path ?? i.url ?? i.query ?? i.pattern ?? ''
  const t = String(raw || JSON.stringify(i)).replace(/\s+/g, ' ').trim()
  return t.length > 300 ? t.slice(0, 300) + '…' : t
}

async function windowOpen($) {
  try {
    const r = await $.http.fetch(BASE + '/api/status')
    return r.ok && JSON.parse(r.text).clients > 0
  } catch {
    return false
  }
}

// Tools the person allowed for the rest of this session from the window (the mod's memory: it resets on reload)
const sessionAllowed = new Set()

// Shows the permission request in the window and waits for the answer (up to ~32 s).
// With no answer, or with the window closed, it decides as before: the question appears in the terminal.
async function askWindow($, e, base) {
  if (!(await windowOpen($))) return base
  const token = await readToken($)
  if (!token) return base
  const id = String(e.tool_use_id)
  await sendNow($, { type: 'permission', id, tool: String(e.tool), summary: summaryOf(e), reason: base.reason })
  let decision = null
  for (let i = 0; i < 4 && !decision; i++) {
    try {
      const r = await $.http.fetch(BASE + '/api/permission/wait?id=' + encodeURIComponent(id) + '&ms=8000', { headers: { 'x-token': token } })
      if (r.status === 401) { tokenCache = null; break }
      const j = JSON.parse(r.text)
      decision = j.decision
      if (j.gone) break
    } catch {
      break
    }
  }
  if (!decision) {
    send($, { type: 'permission_end', id })
    return base
  }
  if (decision === 'allow_session') sessionAllowed.add(String(e.tool))
  return decision === 'allow' || decision === 'allow_session'
    ? { decision: 'allow', reason: decision === 'allow_session' ? 'Allowed for this session from the Vibeship window' : 'Allowed from the Vibeship window' }
    : { decision: 'deny', reason: 'Denied from the Vibeship window' }
}

function detailOf(e) {
  const raw = e.file_path ?? e.path ?? e.pattern ?? e.command ?? e.query ?? e.url ?? ''
  const s = String(raw).split(/[\\/]/).pop() ?? ''
  return s.length > 0 ? s : String(e.tool ?? '')
}

async function isServerUp($) {
  try {
    const r = await $.http.fetch(BASE + '/api/ping')
    return r.ok && r.text.includes('agent-office')
  } catch {
    return false
  }
}

// Starts the server as a child process: it lives as long as the session and closes with it.
async function ensureServer($) {
  if (serverStarting || (await isServerUp($))) return
  serverStarting = true
  const script = $.plugin.root + '/server/server.js'
  void (async () => {
    try {
      const child = $.process.spawn({ argv: ['node', script] })
      for await (const piece of child) {
        if (piece.text) $.ui.log(String(piece.text), { to: 'debug' })
      }
    } catch {
      // node not available: the window does not start, the text panel remains
    } finally {
      serverStarting = false
    }
  })()
  for (let i = 0; i < 20; i++) {
    if (await isServerUp($)) return
    await $.clock.sleep(150)
  }
}

async function openWindow($) {
  await ensureServer($)
  const token = await readToken($)
  const url = BASE + '/' + (token ? '?t=' + token : '')
  const os = await $.env.get('OS')
  const platform = os === 'Windows_NT' ? 'win' : (await $.env.get('HOME'))?.startsWith('/Users') ? 'mac' : 'linux'
  const tries =
    platform === 'win'
      ? [['cmd', '/c', 'start', '', 'msedge', '--app=' + url], ['cmd', '/c', 'start', '', 'chrome', '--app=' + url], ['cmd', '/c', 'start', '', url]]
      : platform === 'mac'
        ? [['open', '-na', 'Google Chrome', '--args', '--app=' + url], ['open', url]]
        : [['google-chrome', '--app=' + url], ['xdg-open', url]]
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 5000 })
      if (r.exitCode === 0) return true
    } catch {
      // try the next one
    }
  }
  return false
}

// ---------- Commands ----------
// /vibeship opens the 3D window.
async function runWindowCommand($) {
  const ok = await openWindow($)
  const cwd = await $.session.cwd()
  send($, { type: 'session_start', label: agentName ?? String(cwd).split(/[\\/]/).pop(), look, loc })
  void sendCommandList($)
  return { text: ok ? 'Vibeship window opened: ' + BASE : 'Server started on ' + BASE + ' but I could not open the browser: open it manually.' }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vibeship',
      description: 'Open the Vibeship window (locations, stations, agents at work)',
    })
    const port = await $.env.get('AGENT_OFFICE_PORT')
    if (port && /^\d+$/.test(port)) BASE = 'http://127.0.0.1:' + port
    dataDir = (await $.env.get('AGENT_OFFICE_DIR')) ?? null
    agentName = ((await $.env.get('AGENT_OFFICE_NAME')) ?? '').trim().slice(0, 40) || null
    const lm = /^([a-z]*):(\d?)$/.exec(((await $.env.get('AGENT_OFFICE_LOOK')) ?? '').trim())
    look = lm ? { species: lm[1] || undefined, shirt: lm[2] !== '' ? Number(lm[2]) : undefined } : null
    loc = ((await $.env.get('AGENT_OFFICE_LOC')) ?? '').trim() || null
    sessionId = await $.session.id()
    if (cancelPoll) cancelPoll.cancel()
    cancelPoll = $.clock.every(1000, () => void pollCommands($))
    const cwd = await $.session.cwd()
    // If the server is already up (window open), report the session; otherwise it starts with /vibeship
    if (await isServerUp($)) { send($, { type: 'session_start', label: agentName ?? String(cwd).split(/[\\/]/).pop(), look, loc }); void sendCommandList($) }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (cancelPoll) cancelPoll.cancel()
    cancelPoll = null
    send($, { type: 'session_end' })
    return next(e)
  })

  on('command.run', { command: 'vibeship' }, async ($) => runWindowCommand($))

  on('turn.start', async ($, e, next) => {
    turnId = e.turnId
    send($, { type: 'turn_start' })
    return next(e)
  })

  // Messages typed in the terminal: they also appear in the window chat
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'composer' && typeof e.text === 'string') send($, { type: 'prompt_in', text: e.text })
    return next(e)
  })

  // Permissions: if the window is open, the request appears there
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision !== 'ask' || !e.tool_use_id) return r
    if (sessionAllowed.has(String(e.tool))) return { decision: 'allow', reason: 'Allowed for this session from the Vibeship window' }
    return askWindow($, e, r)
  })

  on('tool.call', async ($, e, next) => {
    send($, { type: 'tool', agentId: e.agentId, status: statusOf(e.tool), detail: detailOf(e) })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const name = e.name ?? e.subagentType ?? 'subagent'
    send($, { type: 'spawn', toolUseId: e.tool_use_id, name: String(name), description: e.description })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) { send($, { type: 'sub_done', agentId: e.agentId, answer: e.answer, reason: e.reason }); return next(e) } // the subagent is done, but not the main turn
    turnId = null
    send($, { type: 'turn_complete', answer: e.answer, reason: e.reason })
    return next(e)
  })
}

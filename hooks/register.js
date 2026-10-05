import { SCENES, SCENE_IDS, W, H } from './scenes.js'

const PANE = 'agent-office'

// Stato -> aspetto (colore e fumetto sopra la postazione)
const STATUS = {
  idle: { color: 'gray', bubble: ' z ', label: 'a riposo' },
  read: { color: 'cyan', bubble: ' ? ', label: 'legge' },
  write: { color: 'green', bubble: '...', label: 'scrive' },
  run: { color: 'yellow', bubble: ' $ ', label: 'esegue comandi' },
  web: { color: 'magenta', bubble: '@@@', label: 'cerca sul web' },
  delegate: { color: 'blue', bubble: ' > ', label: 'delega' },
}

function statusOf(tool) {
  if (['Read', 'Grep', 'Glob'].includes(tool)) return 'read'
  if (['Edit', 'Write', 'NotebookEdit'].includes(tool)) return 'write'
  if (tool === 'Bash' || tool === 'PowerShell') return 'run'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web'
  if (tool === 'Task' || tool === 'Agent') return 'delegate'
  return 'run'
}

// Stato del mod (si azzera al reload; scena e postazioni sono salvate in $.store)
let sceneId = 'bridge'
let deskCount = 3
const agents = new Map([['main', { name: 'Claude', status: 'idle', detail: '' }]])

// Un tool.call con agentId proviene da un subagente. Il primo tool.call di un subagente
// appena lanciato (non ancora associato) ne prende il posto.
function resolveAgent(agentId) {
  if (!agentId) return 'main'
  if (agents.has(agentId)) return agentId
  for (const [key, a] of agents) {
    if (key !== 'main' && !a.bound) {
      agents.delete(key)
      a.bound = true
      agents.set(agentId, a)
      return agentId
    }
  }
  agents.set(agentId, { name: 'subagente', status: 'idle', detail: '', bound: true })
  return agentId
}

function setStatus($, id, status, detail) {
  const a = agents.get(id) ?? agents.get('main')
  a.status = status
  a.detail = detail ?? ''
  $.ui.invalidate('ui.render')
}

function buildGrid() {
  const scene = SCENES[sceneId]
  const overlay = Array.from({ length: H }, () => Array(W).fill(null))
  for (const d of scene.deco) overlay[d.y][d.x] = { g: d.g, color: d.color }

  const desks = scene.slots.slice(0, deskCount)
  const list = [...agents.values()]
  desks.forEach(([x, y], i) => {
    const a = list[i]
    if (a) {
      const s = STATUS[a.status]
      overlay[y][x] = { g: '[@]', color: s.color }
      if (y > 0) overlay[y - 1][x] = { g: s.bubble, color: s.color }
    } else {
      overlay[y][x] = { g: scene.deskGlyph, color: scene.deskColor }
    }
  })
  // Chi non ha una postazione aspetta nella lobby (riga in basso)
  list.slice(desks.length).forEach((a, i) => {
    const x = i + 1
    if (x < W) overlay[H - 1][x] = { g: ' @ ', color: STATUS[a.status].color }
  })
  return { scene, overlay, list }
}

// ---------- Finestra web (server locale + browser) ----------
// Porta e cartella dati si possono cambiare con AGENT_OFFICE_PORT e AGENT_OFFICE_DIR (utile per provare senza disturbare altre finestre)
let BASE = 'http://127.0.0.1:47890'
let dataDir = null
let loc = null // luogo scelto con AGENT_OFFICE_LOC (bridge, engine, habitat)
let look = null // aspetto scelto con AGENT_OFFICE_LOOK ("specie:maglietta")
let agentName = null // nome scelto con AGENT_OFFICE_NAME; altrimenti si usa il nome della cartella
let sessionId = 'default'
let serverStarting = false
let turnId = null // turno in corso, serve per fermarlo dalla finestra
let tokenCache = null
let cancelPoll = null
let polling = false

// Il token sta in un file nella cartella dell'utente, scritto dal server all'avvio.
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

// Ritira i comandi inviati dalla finestra (chat, stop) e li esegue in questa sessione.
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
      if (c.kind === 'say' && c.text) {
        const p = $.prompt.submit({ text: String(c.text), asUser: true })
        send($, { type: 'say_delivered', id: c.id }) // la finestra mostra "consegnato"
        void p.catch(() => send($, { type: 'say_failed', id: c.id }))
      } else if (c.kind === 'close') {
        void closeSelf($)
      } else if (c.kind === 'stop' && turnId) {
        void $.turn.abort({ turnId }).catch(() => {})
      }
    }
  } catch {
    // server spento o risposta non valida: riprova al prossimo giro
  } finally {
    polling = false
  }
}

// Chiude questa sessione di Claude Code. Prima avvisa il server, poi ferma il processo che ci ospita.
// Risale la catena dei processi fino a trovare claude/node/bun e ferma solo quello; se non lo trova, toglie l'agente dalla finestra e basta.
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
    // non disponibile in questo ambiente: l'agente resta tolto dalla finestra ma la sessione continua
  }
}

// Invia un evento al server locale senza aspettare la risposta (non rallenta Claude).
function send($, body) {
  $.http
    .fetch(BASE + '/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, ...body }),
    })
    .catch(() => {})
}

// Come send ma aspetta che il server abbia registrato l'evento (serve prima di un'attesa lunga).
async function sendNow($, body) {
  try {
    await $.http.fetch(BASE + '/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sessionId, ...body }) })
  } catch {
    // server spento
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

// Mostra la richiesta di permesso nella finestra e aspetta la risposta (fino a ~32 s).
// Senza risposta, o con la finestra chiusa, decide come prima: la domanda arriva nel terminale.
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
  return decision === 'allow'
    ? { decision: 'allow', reason: 'Consentito dalla finestra Vibeship' }
    : { decision: 'deny', reason: 'Negato dalla finestra Vibeship' }
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

// Avvia il server come processo figlio: vive quanto la sessione e si chiude con lei.
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
      // node non disponibile: la finestra non parte, il pannello testuale resta
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
      // prova il prossimo
    }
  }
  return false
}

// ---------- Comandi ----------
// /vibeship apre la finestra 3D; /vibeship-text la vista testuale nel terminale.
// /office e /office-pane sono i vecchi nomi: restano come alias nascosti (funzionano se li scrivi per intero).
async function runWindowCommand($) {
  const ok = await openWindow($)
  const cwd = await $.session.cwd()
  send($, { type: 'session_start', label: agentName ?? String(cwd).split(/[\\/]/).pop(), look, loc })
  return { text: ok ? 'Finestra Vibeship aperta: ' + BASE : 'Server avviato su ' + BASE + ' ma non sono riuscito ad aprire il browser: aprilo a mano.' }
}
async function runTextCommand($) {
  await $.ui.open({ id: PANE, title: 'Vibeship', focus: true, closeOnEscape: true })
  return {}
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vibeship',
      description: 'Apri la finestra Vibeship (luoghi, postazioni, agenti al lavoro)',
    })
    await $.command.register({
      name: 'vibeship-text',
      description: 'Vista testuale di Vibeship dentro Claude Code',
    })
    await $.command.register({ name: 'office', description: 'Vecchio nome di /vibeship' })
    await $.command.register({ name: 'office-pane', description: 'Vecchio nome di /vibeship-text' })
    const saved = await $.store.get('agent-office')
    if (saved && SCENES[saved.sceneId]) {
      sceneId = saved.sceneId
      deskCount = Math.min(Math.max(saved.deskCount ?? 3, 1), SCENES[sceneId].slots.length)
    }
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
    // Se il server c'è già (finestra aperta), comunica la sessione; altrimenti parte con /vibeship
    if (await isServerUp($)) send($, { type: 'session_start', label: agentName ?? String(cwd).split(/[\\/]/).pop(), look, loc })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (cancelPoll) cancelPoll.cancel()
    cancelPoll = null
    send($, { type: 'session_end' })
    return next(e)
  })

  on('command.run', { command: 'vibeship' }, async ($) => runWindowCommand($))
  on('command.run', { command: 'vibeship-text' }, async ($) => runTextCommand($))
  on('command.run', { command: 'office' }, async ($) => runWindowCommand($))
  on('command.run', { command: 'office-pane' }, async ($) => runTextCommand($))

  // i vecchi nomi non compaiono più nell'elenco dei comandi
  on('command.describe', { command: 'office' }, async ($, e, next) => ({ ...(await next(e)), isHidden: true }))
  on('command.describe', { command: 'office-pane' }, async ($, e, next) => ({ ...(await next(e)), isHidden: true }))

  on('turn.start', async ($, e, next) => {
    turnId = e.turnId
    send($, { type: 'turn_start' })
    return next(e)
  })

  // Messaggi scritti nel terminale: compaiono anche nella chat della finestra
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'plugin' && typeof e.text === 'string') send($, { type: 'prompt_in', text: e.text })
    return next(e)
  })

  // Permessi: se la finestra è aperta, la richiesta compare lì
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision !== 'ask' || !e.tool_use_id) return r
    return askWindow($, e, r)
  })

  on('tool.call', async ($, e, next) => {
    setStatus($, resolveAgent(e.agentId), statusOf(e.tool), e.tool)
    send($, { type: 'tool', agentId: e.agentId, status: statusOf(e.tool), detail: detailOf(e) })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const name = e.name ?? e.subagentType ?? 'subagente'
    agents.set(e.tool_use_id, { name: String(name), status: 'read', detail: e.description ?? 'in arrivo', bound: false })
    $.ui.invalidate('ui.render')
    send($, { type: 'spawn', toolUseId: e.tool_use_id, name: String(name), description: e.description })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) { send($, { type: 'sub_done', agentId: e.agentId, answer: e.answer, reason: e.reason }); return next(e) } // il subagente ha finito, ma non il turno principale
    for (const id of [...agents.keys()]) if (id !== 'main') agents.delete(id)
    setStatus($, 'main', 'idle', '')
    turnId = null
    send($, { type: 'turn_complete', answer: e.answer, reason: e.reason })
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const { scene, overlay, list } = buildGrid()
    const maxSlots = scene.slots.length

    const rows = overlay.map((row, y) =>
      Box({
        key: 'row-' + y,
        flexDirection: 'row',
        children: row.map((cell, x) =>
          cell
            ? Text({ key: 'c-' + x + '-' + y, color: cell.color, bold: true, children: [cell.g] })
            : Text({ key: 'c-' + x + '-' + y, dimColor: true, children: [scene.floor] }),
        ),
      }),
    )

    const sceneButtons = SCENE_IDS.map((id, i) =>
      Button({
        key: 'scene-' + id,
        label: (id === sceneId ? '● ' : '○ ') + SCENES[id].label,
        hotkey: String(i + 1),
        plain: true,
        dimColor: id !== sceneId,
        onPress: async () => {
          sceneId = id
          deskCount = Math.min(deskCount, SCENES[id].slots.length)
          redraw()
          await $.store.set('agent-office', { sceneId, deskCount })
        },
      }),
    )

    const legend = list.map((a, i) =>
      Text({
        key: 'agent-' + i,
        color: STATUS[a.status].color,
        children: ['@ ' + a.name + ' · ' + STATUS[a.status].label + (a.detail ? ' (' + a.detail + ')' : '')],
      }),
    )

    return Box({
      flexDirection: 'column',
      children: [
        Box({ flexDirection: 'row', columnGap: 3, children: sceneButtons }),
        Box({ key: 'grid', flexDirection: 'column', children: rows }),
        Box({
          flexDirection: 'row',
          columnGap: 3,
          children: [
            Button({
              key: 'add',
              label: '[a] + ' + scene.stationName,
              hotkey: 'a',
              onPress: async () => {
                if (deskCount < maxSlots) deskCount += 1
                redraw()
                await $.store.set('agent-office', { sceneId, deskCount })
              },
            }),
            Button({
              key: 'remove',
              label: '[r] - rimuovi',
              hotkey: 'r',
              onPress: async () => {
                if (deskCount > 1) deskCount -= 1
                redraw()
                await $.store.set('agent-office', { sceneId, deskCount })
              },
            }),
            Text({ dimColor: true, children: ['postazioni ' + deskCount + '/' + maxSlots] }),
          ],
        }),
        Box({ flexDirection: 'column', children: legend }),
      ],
    })
  })
}

// In-browser stand-in for server/server.js while the trailer plays. It takes the same events the mod sends
// (session_start, tool, spawn, sub_done, permission, turn_complete) and the chat (say, msg_state, reply), and turns
// them into the same snapshots, which go to the window's own handlers (onAgents, onPerms, onChat): what is on screen
// is the real client at work.
export function createScriptedServer(host) {
  const agents = new Map()
  const perms = new Map()
  const chat = {} // session -> messages, as the server keeps them
  const msgOf = (session, id) => chat[session]?.find((m) => m.id === id)
  let dirty = false
  const mainOf = (session) => agents.get(session + ':main')

  function event(ev) {
    const session = ev.session
    const now = Date.now()
    switch (ev.type) {
      case 'session_start':
        agents.set(session + ':main', { key: session + ':main', session, id: 'main', name: ev.label, kind: 'main', status: 'idle', detail: '', bound: true, t: now, look: ev.look, loc: ev.loc || 'bridge' })
        break
      case 'move': { // what POST /api/move does: the agent changes deck (and walks in through the hatch)
        const a = agents.get(session + ':main')
        if (a) a.loc = ev.loc
        break
      }
      case 'tool': {
        const a = agents.get(ev.key ?? session + ':main')
        if (a) { a.status = ev.status; a.detail = ev.detail || ''; a.t = now }
        break
      }
      case 'spawn': { // the Task tool starts a subagent (the drone leaves its main agent)
        const key = session + ':spawn:' + ev.toolUseId
        agents.set(key, { key, session, id: key, name: ev.name, kind: 'sub', status: 'read', detail: ev.description, task: ev.description, bound: false, t: now, look: ev.look })
        break
      }
      case 'sub_done': {
        const a = agents.get(ev.key)
        if (a) Object.assign(a, { status: 'idle', detail: '', done: true, doneAt: now, result: ev.answer || '' })
        break
      }
      case 'permission':
        perms.set(ev.id, { id: ev.id, session, tool: ev.tool, summary: ev.summary, reason: ev.reason || '', ts: now, decision: null })
        break
      case 'decide': { // what POST /api/permission does when the person answers in the window
        const p = perms.get(ev.id)
        if (p) p.decision = ev.decision
        break
      }
      case 'permission_end':
        perms.delete(ev.id)
        break
      case 'turn_complete': {
        const m = mainOf(session)
        if (m) { m.status = 'idle'; m.detail = '' }
        break
      }
      case 'say': // what POST /api/command (kind: say) does when the person writes in the card
        ;(chat[session] ??= []).push({ id: ev.id, role: 'user', text: ev.text, via: 'window', state: 'queued', ts: now })
        break
      case 'msg_state': { // the mod reports the message's progress: sent, working, done
        const m = msgOf(session, ev.id)
        if (m) m.state = ev.state
        break
      }
      case 'reply':
        ;(chat[session] ??= []).push({ id: ev.id, role: 'assistant', text: ev.text, ts: now })
        break
    }
    dirty = true
  }

  // One snapshot per frame at most, like the server's 30 ms broadcast window
  function flush() {
    if (!dirty) return
    dirty = false
    const list = [...agents.values()].map((a) => (a.kind === 'main' ? { ...a } : { ...a, loc: mainOf(a.session)?.loc }))
    host.onAgents(list)
    host.onPerms([...perms.values()].map((p) => ({ ...p })))
    host.onChat(Object.fromEntries(Object.entries(chat).map(([s, list]) => [s, list.map((m) => ({ ...m }))])))
  }

  return { event, flush }
}

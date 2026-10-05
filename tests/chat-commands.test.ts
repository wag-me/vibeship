import { expect, mock, test } from 'claude-code/testing'

// Stands in for the local server: serves one queued command to /api/poll and records what the mod posts to /api/event.
function fakeServer(on: any, queued: any[]) {
  const posted: any = []
  posted.waits = 0 // how many times the window was asked for a permission
  posted.decision = 'allow' // what the person answers there
  let served = false
  const reply = (text: string, status = 200) => ({ value: { ok: status < 300, status, text, headers: {} } })
  on('http.fetch', (_: any, e: any) => {
    if (e.url.includes('/api/ping')) return reply('agent-office')
    if (e.url.includes('/api/status')) return reply(JSON.stringify({ clients: 1 }))
    if (e.url.includes('/api/permission/wait')) { posted.waits++; return reply(JSON.stringify({ decision: posted.decision })) }
    if (e.url.includes('/api/poll')) {
      const commands = served ? [] : queued
      served = true
      return reply(JSON.stringify({ commands }))
    }
    if (e.url.includes('/api/event')) {
      posted.push(JSON.parse(String(e.init?.body ?? '{}')))
      return reply('', 204)
    }
    return reply('', 404)
  })
  return posted
}

async function boot($: any, on: any, queued: any[]) {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { AGENT_OFFICE_PORT: '47991', AGENT_OFFICE_DIR: 'C:/tmp/vibeship-test' })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd })) // the engine beneath the plugin
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sess1' }))
  on('session.cwd', () => ({ value: 'C:/work/proj' }))
  on('fs.read', () => ({ value: 'a'.repeat(48) }))
  const posted = fakeServer(on, queued)
  await $.session.start({ cwd: 'C:/work/proj', surface: 'terminal', isInteractive: true })
  await clock.advance(1100) // one poll of the command queue
  return posted
}

test('a /command typed in the window chat runs and its output goes back to the window', async ($, on) => {
  on('command.list', () => ({ value: [{ name: 'model', description: 'Switch model', source: 'builtin' }] }))
  on('command.run', (_: any, e: any) => ({ text: 'Set model to ' + e.args }))
  const posted = await boot($, on, [{ kind: 'say', id: 'm1', text: '/model sonnet' }])
  const result = posted.find((p) => p.type === 'command_result')
  expect(result).toMatchObject({ id: 'm1', ok: true, text: 'Set model to sonnet' })
  expect(posted.some((p) => p.type === 'say_delivered' && p.id === 'm1')).toBe(true)
})

test('an unknown /command is reported as an error, not sent to the model', async ($, on) => {
  on('command.list', () => ({ value: [{ name: 'model', description: 'Switch model', source: 'builtin' }] }))
  const posted = await boot($, on, [{ kind: 'say', id: 'm2', text: '/nope' }])
  expect(posted.find((p) => p.type === 'command_result')).toMatchObject({ id: 'm2', ok: false, text: 'Unknown command: /nope' })
})

test("the mod's own /vibeship is answered directly (a plugin cannot run its own commands)", async ($, on) => {
  on('command.list', () => ({ value: [{ name: 'vibeship', description: 'x', source: 'plugin' }] }))
  const posted = await boot($, on, [{ kind: 'say', id: 'm3', text: '/vibeship' }])
  expect(posted.find((p) => p.type === 'command_result')).toMatchObject({ id: 'm3', ok: true, text: 'The Vibeship window is already open.' })
})

test('the command list is published for the chat autocomplete', async ($, on) => {
  on('command.list', () => ({ value: [{ name: 'compact', description: 'Compact the conversation', source: 'builtin' }] }))
  const posted = await boot($, on, [{ kind: 'commands' }])
  const list = posted.filter((p) => p.type === 'commands').pop()
  expect(list.list).toEqual([{ name: 'compact', description: 'Compact the conversation' }])
})

test('"allow for this session" is remembered: the same tool is not asked about again', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask', reason: 'needs review' }))
  const posted = await boot($, on, [])
  posted.decision = 'allow_session'
  const check = (id: string, tool: string) => $.tool.check({ tool, input: {}, tool_use_id: id })
  expect((await check('t1', 'SubagentHandback')).decision).toBe('allow')
  expect(posted.waits).toBe(1)
  expect((await check('t2', 'SubagentHandback')).decision).toBe('allow')
  expect(posted.waits).toBe(1) // answered from memory
  expect((await check('t3', 'WebFetch')).decision).toBe('allow') // another tool is still asked
  expect(posted.waits).toBe(2)
})

test('a plain "allow" is for that one call only', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask', reason: 'needs review' }))
  const posted = await boot($, on, [])
  posted.decision = 'allow'
  await $.tool.check({ tool: 'PowerShell', input: {}, tool_use_id: 'a' })
  await $.tool.check({ tool: 'PowerShell', input: {}, tool_use_id: 'b' })
  expect(posted.waits).toBe(2)
})

test('a deny from the window is passed on', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask', reason: 'needs review' }))
  const posted = await boot($, on, [])
  posted.decision = 'deny'
  expect((await $.tool.check({ tool: 'Bash', input: {}, tool_use_id: 'd' })).decision).toBe('deny')
})

test('a finished tool call reaches the window with the file, the lines changed and whether it worked', async ($, on) => {
  on('tool.call', () => ({ result: {}, text: 'ok' })) // the engine beneath the plugin
  const posted = await boot($, on, [])
  expect(posted.find((p) => p.type === 'session_start')).toMatchObject({ cwd: 'C:/work/proj' })
  await $.tool.call({ tool: 'Edit', input: { file_path: 'C:/work/proj/a.js', old_string: 'x', new_string: 'x\ny\nz' } })
  expect(posted.find((p) => p.type === 'activity')).toMatchObject({ tool: 'Edit', kind: 'write', ok: true, file: 'C:/work/proj/a.js', add: 3, del: 1 })
})

test('a failed tool call is reported as failed', async ($, on) => {
  on('tool.call', () => ({ isError: true, result: 'boom', text: 'exit code 1' }))
  const posted = await boot($, on, [])
  await $.tool.call({ tool: 'Bash', input: { command: 'npm test' } })
  expect(posted.find((p) => p.type === 'activity')).toMatchObject({ tool: 'Bash', kind: 'run', ok: false, error: 'exit code 1' })
})

test('calls that only the auto-mode classifier can allow are left to the engine, not shown in the window', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask', reason: 'SubagentHandback requires auto-mode classifier review' }))
  const posted = await boot($, on, [])
  posted.decision = 'allow' // even if the person would click Allow, the mod must not answer for the classifier
  const r = await $.tool.check({ tool: 'SubagentHandback', input: {}, tool_use_id: 'h1' })
  expect(r.decision).toBe('ask') // passed on untouched
  expect(posted.waits).toBe(0) // the window was never asked
  expect(posted.some((p: any) => p.type === 'permission')).toBe(false)
})

test('the window can switch the model; the mod reports what the session runs with', async ($, on) => {
  let model = 'claude-sonnet-5-5'
  const sets: any[] = []
  on('session.model', () => ({ value: model }))
  on('config.set', (_: any, e: any) => { sets.push(e); model = 'claude-opus-5-5'; return { value: e.value } })
  const posted = await boot($, on, [{ kind: 'model', value: 'opus' }])
  expect(sets.map((x) => [x.key, x.value])).toEqual([['model', 'opus']])
  const infos = posted.filter((p: any) => p.type === 'info')
  expect(infos.length).toBeGreaterThan(0) // the model is reported to the window
  expect(infos.at(-1).model).toBe('claude-opus-5-5') // and the last report is the model after the switch
})

test('a refused model switch is reported to the window', async ($, on) => {
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.set', () => ({ deny: 'managed by policy' }))
  const posted = await boot($, on, [{ kind: 'model', value: 'opus' }])
  expect(posted.find((p: any) => p.type === 'info_error').text).toContain('managed by policy')
})

test('a rename from the window sticks: the mod announces the new name', async ($, on) => {
  const posted = await boot($, on, [{ kind: 'rename', value: 'Ada  <Lovelace>' }])
  const starts = posted.filter((p: any) => p.type === 'session_start')
  expect(starts.at(-1).label).toBe('Ada Lovelace') // symbols are stripped and spaces collapsed
})

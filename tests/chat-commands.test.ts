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

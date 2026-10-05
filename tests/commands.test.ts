import { expect, test } from 'claude-code/testing'

test('/vibeship stays visible in the command list', async ($, on) => {
  // stands in for Claude Code: replies with the received description
  on('command.describe', (_: any, e: any) => ({ description: e.description, isHidden: e.isHidden }))
  expect((await $.command.describe({ command: 'vibeship', description: 'x', isHidden: false })).isHidden).toBe(false)
})

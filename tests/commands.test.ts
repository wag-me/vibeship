import { expect, test } from 'claude-code/testing'

// Stub di ui.open: registra l'id del pannello aperto
function stubOpen(on: any) {
  const opened: string[] = []
  on('ui.open', (_: any, e: any) => {
    opened.push(e.id)
    return { value: undefined }
  })
  return opened
}

test('/vibeship-text apre il pannello testuale', async ($, on) => {
  const opened = stubOpen(on)
  await $.command.run({ command: 'vibeship-text', args: '' })
  expect(opened).toEqual(['agent-office'])
})

test('il vecchio nome /office-pane funziona ancora', async ($, on) => {
  const opened = stubOpen(on)
  await $.command.run({ command: 'office-pane', args: '' })
  expect(opened).toEqual(['agent-office'])
})

test('/vibeship resta visibile e i vecchi nomi sono nascosti', async ($, on) => {
  // al posto di Claude Code: risponde con la descrizione ricevuta, poi la mod può nasconderla
  on('command.describe', (_: any, e: any) => ({ description: e.description, isHidden: e.isHidden }))
  const describe = (command: string) => $.command.describe({ command, description: 'x', isHidden: false })
  expect((await describe('vibeship')).isHidden).toBe(false)
  expect((await describe('vibeship-text')).isHidden).toBe(false)
  expect((await describe('office')).isHidden).toBe(true)
  expect((await describe('office-pane')).isHidden).toBe(true)
})

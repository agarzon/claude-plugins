import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ask, MIN, usage, world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const ON = { autoHandoff: true }

function permissions(on: On) {
  on('classic.PermissionRequest', () => ({}))
}

async function turn($: Engine, turnId: string) {
  await $.turn.start({ text: 'hi', turnId })
  await ask($, { turnId })
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId, usage, reason: 'answer' })
}

const ask4 = (tool: string) => ({ tool_name: tool, tool_input: {} }) as never

test('off by default: an idle hour runs nothing', async ($, on) => {
  const { clock, calls } = world(on, {})
  await $.session.start(start)
  await turn($, 't1')
  await clock.advance(59 * MIN)
  expect(calls).toEqual([])
})

test('warns a minute ahead, runs the handoff once at 55 min, declines its permission prompts, and waits for your next turn', { options: ON }, async ($, on) => {
  const { clock, calls, toasts } = world(on, {})
  permissions(on)
  await $.session.start(start)
  await turn($, 't1')

  await clock.advance(53 * MIN)
  expect(toasts.filter(t => t.includes('Auto-handoff'))).toEqual([])
  await clock.advance(1 * MIN)
  expect(toasts.at(-1)).toContain('Auto-handoff in 1 min')
  expect(calls).toEqual([])
  await clock.advance(1 * MIN)
  expect(calls).toEqual(['/agarzon:handoff'])

  await $.turn.start({ text: '', turnId: 'h1' })
  const denied = await $.classic.PermissionRequest(ask4('Bash'))
  expect(denied.decision).toMatchObject({ behavior: 'deny' })
  await ask($, { turnId: 'h1' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'h1', usage, reason: 'answer' })
  expect((await $.classic.PermissionRequest(ask4('Bash'))).decision).toBeUndefined()

  await clock.advance(60 * MIN)
  expect(calls).toEqual(['/agarzon:handoff'])

  await turn($, 't2')
  await clock.advance(55 * MIN)
  expect(calls).toEqual(['/agarzon:handoff', '/agarzon:handoff'])
})

test('a handoff you start yourself does not re-arm it; a turn while it counts down cancels it', { options: ON }, async ($, on) => {
  const { clock, calls } = world(on, {})
  permissions(on)
  await $.session.start(start)
  await turn($, 't1')
  await clock.advance(54 * MIN)
  await turn($, 't2')
  await clock.advance(54 * MIN)
  expect(calls).toEqual([])

  await $.command.run({ command: 'agarzon:handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await turn($, 'h1')
  expect((await $.classic.PermissionRequest(ask4('Bash'))).decision).toBeUndefined()
  await clock.advance(60 * MIN)
  expect(calls).toEqual(['/agarzon:handoff'])
})

test('keep-warm pings first, so auto-handoff never fires while it is on', { options: ON }, async ($, on) => {
  const { clock, calls } = world(on, {})
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } }))
  await $.session.start(start)
  await turn($, 't1')
  await $.command.run({ command: 'warm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await clock.advance(3 * 60 * MIN)
  expect(calls.filter(c => c.includes('handoff'))).toEqual([])
})

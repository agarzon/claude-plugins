import { expect, test } from 'claude-code/testing'

import { BAND, usage, world } from './world'

const TOOL = 'mcp__agarzon__handoff_ready'
const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const done = { answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' } as const

test('renames only after the turn ends, and never clears or prompts', async ($, on) => {
  const { clock, calls } = world(on, {})
  await $.session.start(start)

  const answer = await $.tool.call({ tool: TOOL, name: 'done-for-today' })
  expect('deny' in answer && answer.deny).toBeFalsy()
  expect(calls).toEqual([])

  await $.turn.complete(done)
  await clock.settle()
  expect(calls).toEqual(['/rename done-for-today'])
})

test('refuses a bad name and does nothing', async ($, on) => {
  const { clock, calls } = world(on, {})
  await $.session.start(start)
  for (const name of ['Bad Name; /clear', '', undefined]) {
    const answer = await $.tool.call({ tool: TOOL, name })
    expect('deny' in answer && answer.deny).toBeTruthy()
  }
  await $.turn.complete(done)
  await clock.settle()
  expect(calls).toEqual([])
})

test('context turns yellow at half the limit and red at 200k, with one toast per crossing', async ($, on) => {
  const { toasts, chimes } = world(on, {})
  await $.session.start(start)
  const measure = (k: number) => $.session.measure({ context: { tokens: k * 1000, window: 1_000_000, percent: k / 10 }, rateLimits: [], changed: ['context'] })
  const ctx = async () => (await (await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })).find({ type: 'Text', text: /^\d+k$/ }))?.props.color

  await measure(99)
  expect(await ctx()).toBe('success')
  await measure(100)
  expect(await ctx()).toBe('warning')
  expect(toasts).toEqual([])

  await measure(201)
  await measure(230)
  expect(await ctx()).toBe('error')
  const bar = async () => (await (await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })).find({ type: 'Text', text: /^[▓░]+$/ }))?.text
  expect(await bar()).toBe('▓░░░░░░░')
  expect(toasts).toEqual(['Context at 201k: time to /agarzon:handoff'])
  expect(chimes).toEqual(['audio sounds/error-002.wav'])

  await measure(130)
  expect(await bar()).toBe('▓░░░░░░░')
  await measure(800)
  expect(await bar()).toBe('▓▓▓▓▓▓░░')
  await measure(130)
  await measure(205)
  expect(toasts).toHaveLength(3)
})

test('over the limit the band offers a handoff button that submits it; a lower limit applies from the settings', { options: { contextLimitK: 120 } }, async ($, on) => {
  const { calls, styles } = world(on, {})
  styles.current = null
  await $.session.start(start)
  await $.session.measure({ context: { tokens: 110_000, window: 1_000_000, percent: 11 }, rateLimits: [], changed: ['context'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  }

  await $.session.measure({ context: { tokens: 125_000, window: 1_000_000, percent: 12.5 }, rateLimits: [], changed: ['context'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    await ui.press({ key: 'handoff' })
  }
  expect(calls).toEqual(['/agarzon:handoff', '/agarzon:handoff'])
})

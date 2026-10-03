import { expect, test } from 'claude-code/testing'

import { BAND, usage, world } from './world'

const TOOL = 'mcp__agarzon__handoff_ready'
const FILE = '/w/HANDOFF.md'
const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const done = { answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' } as const

test('refresh: renames, clears, then resumes from the file, only after the turn ends', async ($, on) => {
  const { clock, calls } = world(on, {}, new Map([[FILE, '# Handoff']]))
  await $.session.start(start)

  const answer = await $.tool.call({ tool: TOOL, path: FILE, name: 'mods-cache-watch', mode: 'refresh' })
  expect('deny' in answer && answer.deny).toBeFalsy()
  expect(calls).toEqual([])

  await $.turn.complete(done)
  await clock.settle()
  expect(calls).toEqual(['/rename mods-cache-watch', '/clear', '/rename mods-cache-watch-2', expect.stringContaining(`prompt: Read ${FILE} and continue`)])
})

test('wrap: only renames', async ($, on) => {
  const { clock, calls } = world(on, {})
  await $.session.start(start)
  await $.tool.call({ tool: TOOL, path: FILE, name: 'done-for-today', mode: 'wrap' })
  await $.turn.complete(done)
  await clock.settle()
  expect(calls).toEqual(['/rename done-for-today'])
})

test('refuses a missing file, a bad name or a path that is not HANDOFF.md, and does nothing', async ($, on) => {
  const { clock, calls } = world(on, {})
  await $.session.start(start)
  for (const input of [
    { path: FILE, name: 'ok-name', mode: 'refresh' },
    { path: FILE, name: 'Bad Name; /clear', mode: 'wrap' },
    { path: '/etc/passwd', name: 'ok-name', mode: 'wrap' },
  ]) {
    const answer = await $.tool.call({ tool: TOOL, ...input })
    expect('deny' in answer && answer.deny).toBeTruthy()
  }
  await $.turn.complete(done)
  await clock.settle()
  expect(calls).toEqual([])
})

test('nudges once when context crosses 60%, and again only after it drops back', async ($, on) => {
  const { toasts } = world(on, {})
  await $.session.start(start)
  const measure = (percent: number) => $.session.measure({ context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: [], changed: ['context'] })

  await measure(45)
  expect(toasts).toEqual([])
  await measure(61)
  await measure(66)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Context at 61%')

  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /ctx 66% → \/handoff/ })).toBeDefined()

  await measure(10)
  await measure(62)
  expect(toasts).toHaveLength(2)
})

test('a waiting HANDOFF.md shows Load on terminal and desktop; Load resumes from it and takes the banner down', async ($, on) => {
  const { calls } = world(on, {}, new Map([[FILE, '# Handoff']]))
  await $.session.start(start)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    expect(await ui.find({ key: 'load-handoff' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await ui.press({ key: 'load-handoff' })
  expect(calls).toEqual([expect.stringContaining(`prompt: Read ${FILE} and continue`)])
  expect(await ui.find({ key: 'load-handoff' })).toBeUndefined()
})

test('no banner without a HANDOFF.md', async ($, on) => {
  world(on, {})
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'load-handoff' })).toBeUndefined()
})

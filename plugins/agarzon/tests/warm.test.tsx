import { expect, test } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { ask, BAND, MIN, world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const warm = (args: string) => ({ command: 'warm', args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 120 } })
const HIT = { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 20 } } as const
const MISS = { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 150_000 } } as const

function forks(on: On, answers: ModelForkResult[] = []) {
  const sent: number[] = []
  on('model.fork', () => {
    sent.push(sent.length)
    return { value: answers.shift() ?? HIT }
  })
  return sent
}

test('off until asked: an idle hour pings nothing', async ($, on) => {
  const { clock } = world(on, {})
  const sent = forks(on)
  await $.session.start(start)
  await ask($)
  await clock.advance(59 * MIN)
  expect(sent).toEqual([])
})

test('/warm pings after 45 min idle, each warm ping restarts the hour, and it stops itself after 10 in a row', async ($, on) => {
  const { clock, toasts } = world(on, {})
  const sent = forks(on)
  await $.session.start(start)
  await ask($)
  expect((await $.command.run(warm(''))).text).toContain('after 45 min idle')

  await clock.advance(44 * MIN)
  expect(sent).toHaveLength(0)
  await clock.advance(1 * MIN)
  expect(sent).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /cache 60m/ })).toBeDefined()

  await clock.advance(44 * MIN)
  expect(sent).toHaveLength(1)
  await clock.advance(1 * MIN)
  expect(sent).toHaveLength(2)

  await clock.advance(8 * 45 * MIN)
  expect(sent).toHaveLength(10)
  await clock.advance(45 * MIN)
  expect(sent).toHaveLength(10)
  expect(toasts.at(-1)).toContain('after 10 pings in a row')
})

test('your own turn starts the count over', async ($, on) => {
  const { clock } = world(on, {})
  const sent = forks(on)
  await $.session.start(start)
  await ask($)
  await $.command.run(warm(''))
  await clock.advance(9 * 45 * MIN)
  expect(sent).toHaveLength(9)
  await ask($)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't9', usage: HIT.usage as never, reason: 'answer' })
  await clock.advance(3 * 45 * MIN)
  expect(sent).toHaveLength(12)
})

test('a ping that found the cache cold, or nothing to fork, turns keep-warm off', async ($, on) => {
  const { clock, toasts } = world(on, {})
  const sent = forks(on, [MISS, { isAnswered: false, reason: 'nothing-to-fork' } as never])
  await $.session.start(start)
  await ask($)
  await $.command.run(warm(''))
  await clock.advance(45 * MIN)
  expect(sent).toHaveLength(1)
  expect(toasts.at(-1)).toContain('found the cache cold (re-cached 150k tokens)')
  await clock.advance(45 * MIN)
  expect(sent).toHaveLength(1)

  await ask($)
  await $.command.run(warm(''))
  await clock.advance(45 * MIN)
  expect(toasts.at(-1)).toContain('needs one answer from Claude')
})

test('/warm 90m stops at its time; /warm off stops at once; nonsense gets the usage', async ($, on) => {
  const { clock, toasts } = world(on, {})
  const sent = forks(on)
  await $.session.start(start)
  await ask($)
  expect((await $.command.run(warm('soon'))).text).toMatch(/^Usage/)
  await $.command.run(warm('90m'))
  await clock.advance(91 * MIN)
  expect(sent).toHaveLength(1)
  expect(toasts.at(-1)).toContain('as asked')

  await $.command.run(warm(''))
  await $.command.run(warm('off'))
  await clock.advance(45 * MIN)
  expect(sent).toHaveLength(1)
})

test('the band button toggles it; the minutes come from the settings', { options: { keepWarmAfterMin: 30 } }, async ($, on) => {
  const { clock } = world(on, {})
  const sent = forks(on)
  await $.session.start(start)
  await ask($)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await ui.press({ key: 'warm' })
  await clock.advance(30 * MIN)
  expect(sent).toHaveLength(1)
  await ui.press({ key: 'warm' })
  await clock.advance(30 * MIN)
  expect(sent).toHaveLength(1)
})

test('switched off, there is no button and /warm does nothing', { options: { keepWarm: false } }, async ($, on) => {
  const { clock } = world(on, {})
  const sent = forks(on)
  await $.session.start(start)
  await ask($)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'warm' })).toBeUndefined()
  expect((await $.command.run(warm(''))).text).toContain('switched off')
  await clock.advance(45 * MIN)
  expect(sent).toEqual([])
})

test('a ping asks for the effort the effort button set, none when the main requests carry none', async ($, on) => {
  const { clock } = world(on, {})
  const efforts: unknown[] = []
  on('model.fork', (_$, e) => {
    efforts.push(e.effort)
    return { value: HIT }
  })
  await $.session.start(start)
  await ask($)
  await $.command.run(warm(''))
  await clock.advance(45 * MIN)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await ui.press({ key: 'effort' })
  await clock.advance(1500)
  await ask($)
  await clock.advance(46 * MIN)
  await ask($, { effort: undefined })
  await clock.advance(46 * MIN)
  expect(efforts).toEqual([undefined, 'low', undefined])
})

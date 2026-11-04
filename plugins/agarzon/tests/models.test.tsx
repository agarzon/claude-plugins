import { expect, test } from 'claude-code/testing'

import { ask, BAND, STEP, world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const send = ask

test('the model button cycles the engine list without its meta names, for this session only; subagents keep theirs', async ($, on) => {
  const { calls, clock, requests } = world(on, {})
  await $.session.start(start)
  const label = async () => (await (await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })).find({ key: 'model' }))?.props.label
  const press = async () => {
    await (await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })).press({ key: 'model' })
    await clock.advance(1500)
  }
  expect(await label()).toBe('model')

  await send($)
  expect(await label()).toBe('opus-5.5')

  await press()
  expect(await label()).toBe('sonnet?')
  await send($)
  expect(await label()).toBe('sonnet-5.5')

  await press()
  expect(await label()).toBe('opus?')
  await send($)
  await send($, { agentId: 'a1', model: 'claude-haiku-5-5' })
  expect(await label()).toBe('opus-5.5')

  await press()
  await send($)
  expect(await label()).toBe('opus-5.5 1m')

  await press()
  expect(await label()).toBe('default?')
  await send($)
  expect(await label()).toBe('opus-5.5')

  expect(requests.map(r => r.model)).toEqual(['claude-opus-5-5', 'sonnet', 'opus', 'claude-haiku-5-5', 'opus[1m]', 'claude-opus-5-5'])
  expect(calls.filter(c => c.startsWith('config.set') || c.startsWith('/model') || c.startsWith('/effort'))).toEqual([])
})

test('the effort button cycles the five levels, then hands back to the engine', async ($, on) => {
  const { clock, requests } = world(on, {})
  await $.session.start(start)
  await send($)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'effort' }))?.props.label).toBe('medium')

  for (const level of ['low', 'medium', 'high', 'xhigh', 'max', 'medium']) {
    await ui.press({ key: 'effort' })
    await clock.advance(1500)
    await send($)
    expect(requests.at(-1)?.effort).toBe(level)
  }
})

test('clicks hold a pending pick on the button; a send before it settles keeps the old model and effort', async ($, on) => {
  const { clock, requests } = world(on, {})
  await $.session.start(start)
  await send($)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await ui.press({ key: 'model' })
  await ui.press({ key: 'model' })
  await ui.press({ key: 'effort' })
  expect((await ui.find({ key: 'model' }))?.props.label).toBe('opus…')
  expect((await ui.find({ key: 'effort' }))?.props.label).toBe('low…')

  await send($)
  expect(requests.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'medium', agentId: undefined })

  await clock.advance(1500)
  await send($)
  expect(requests.at(-1)).toEqual({ model: 'opus', effort: 'low', agentId: undefined })
})

test('a request sent with no effort gets none from the effort button', async ($, on) => {
  const { clock, requests } = world(on, {})
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await ui.press({ key: 'effort' })
  await clock.advance(1500)
  await send($, { effort: undefined })
  expect(requests.at(-1)?.effort).toBeUndefined()
})

test('one re-cache toast, 1.5 s after the last model click', async ($, on) => {
  const { clock, toasts } = world(on, {})
  await $.session.start(start)
  await $.session.measure({ context: { tokens: 162_000, window: 1_000_000, percent: 16 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })

  await ui.press({ key: 'model' })
  await clock.advance(1000)
  await ui.press({ key: 'model' })
  await clock.advance(1000)
  expect(toasts).toEqual([])
  await clock.advance(500)
  expect(toasts).toEqual(['Next send uses opus and re-caches 162k of context'])
})

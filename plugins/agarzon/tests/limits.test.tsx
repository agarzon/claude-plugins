import { expect, test } from 'claude-code/testing'

import { BAND, MIN, world } from './world'

const HOUR = 60 * MIN
const at = (ms: number) => new Date(ms).toISOString()
const hhmm = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
const context = { tokens: 1, window: 1_000_000, percent: 0 }

test('without 30 min of history the window average projects the reset; the band colours it', async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: at(2.5 * HOUR) }, { kind: 'spend_limit', percentUsed: 5 }], changed: ['rateLimits'] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    const percent = await ui.find({ type: 'Text', text: /^\d+%$/ })
    expect(percent?.text).toBe('30%')
    expect(percent?.props.color).toBe('success')
    expect((await ui.find({ type: 'Text', text: /^[@⚠]/ }))?.text).toBe(`@${hhmm(2.5 * HOUR)}`)
    expect(await ui.find({ type: 'Text', text: /^5%$/ })).toBeUndefined()
  }
})

test('the last 30 min pace wins; past the red line the band shows when it hits 100%', async ($, on) => {
  const { clock } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const measure = (percentUsed: number) => $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: at(4 * HOUR) }], changed: ['rateLimits'] })

  await measure(20)
  await clock.advance(30 * MIN)
  await measure(35)

  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^\d+%$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^[@⚠]/ }))?.text).toBe(`⚠ ${hhmm(30 * MIN + 130 * MIN)}`)
})

test('the orange and red lines come from the settings', { options: { limitOrangePercent: 50, limitRedPercent: 95 } }, async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context, rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: at(84 * HOUR) }], changed: ['rateLimits'] })

  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^\d+%$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^[@⚠]/ }))?.text).toMatch(/^@\w{3}$/)
})

test('a window that reset drops its old pace', async ($, on) => {
  const { clock } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: at(1 * HOUR) }], changed: ['rateLimits'] })
  await clock.advance(1 * HOUR)
  await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: at(4 * HOUR) }], changed: ['rateLimits'] })

  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^\d+%$/ }))?.props.color).toBe('success')
})

test('in the first hour of the window the colour follows the % used, not a projection', async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: at(4.4 * HOUR) }], changed: ['rateLimits'] })
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^\d+%$/ }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: /^[@⚠]/ }))?.text).toMatch(/^@/)
})

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BAND, world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const

function stage(on: On) {
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
}

async function prompt($: Engine, clock: { advance(ms: number): Promise<unknown> }, n: number, kind: 'composer' | 'task-notification' = 'composer', requestId = `m${n}`, text = `prompt ${n}\nsecond line`) {
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', component: 'UserMessage', requestId, props: { text, origin: { kind }, isExpanded: false } } as never)
  await ui.unmount()
  await clock.advance(1)
}

const band = ($: Engine, bodyColumns = 120) => $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns } })

test('the rail numbers your prompts, shows the last 9, and a click moves the cursor (the scroll itself is checked live: the kit answers none)', async ($, on) => {
  const { clock } = world(on, {})
  stage(on)
  await $.session.start(start)
  for (let n = 1; n <= 12; n++) await prompt($, clock, n)
  await prompt($, clock, 13, 'task-notification')
  await prompt($, clock, 12)
  await prompt($, clock, 14, 'composer', 'placeholder')
  await prompt($, clock, 15, 'composer', 'm15', '/model')

  let ui = await band($)
  expect(await ui.find({ key: 'rail-2' })).toBeUndefined()
  expect((await ui.find({ key: 'rail-3' }))?.props.label).toBe('4')
  expect((await ui.find({ key: 'rail-11' }))?.props.label).toBe('[12]')
  expect(await ui.find({ key: 'rail-12' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '12/12' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'prompt 5' })).toBeDefined()

  await ui.press({ key: 'rail-4' })
  ui = await band($)
  expect((await ui.find({ key: 'rail-4' }))?.props.label).toBe('[5]')
  await ui.press({ key: 'rail-prev' })
  ui = await band($)
  expect(await ui.find({ type: 'Text', text: '4/12' })).toBeDefined()
})

test('narrow bands show only the counter; a new prompt returns the cursor to the end; /clear empties it', async ($, on) => {
  const { clock } = world(on, {})
  stage(on)
  await $.session.start(start)
  for (let n = 1; n <= 3; n++) await prompt($, clock, n)

  let ui = await band($, 60)
  expect(await ui.find({ key: 'rail-0' })).toBeUndefined()
  await ui.press({ key: 'rail-prev' })
  await prompt($, clock, 4)
  ui = await band($, 60)
  expect(await ui.find({ type: 'Text', text: '4/4' })).toBeDefined()

  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  ui = await band($)
  expect(await ui.find({ key: 'rail-prev' })).toBeUndefined()
})

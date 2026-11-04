import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'

import { findHits } from '../hooks/find'
import { world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const pane = ($: Engine, bodyColumns = 60) =>
  $.ui.mount({ plugin: 'agarzon', surface: 'terminal', component: 'Pane', requestId: 'find', props: { title: 'Find', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)
const search = async ($: Engine, text: string) => {
  const ui = await pane($)
  await $.ui.input({ plugin: 'agarzon', key: 'find-query', text })
  await ui.unmount()
}
const labels = async ($: Engine, bodyColumns?: number) => {
  const ui = await pane($, bodyColumns)
  const found: string[] = []
  for (let i = 0; ; i++) {
    const hit = await ui.find({ key: `find-hit-${i}` })
    if (hit === undefined) break
    found.push(String(hit.props.label))
  }
  await ui.unmount()
  return found
}

function transcript(on: On, messages: SessionMessage[]) {
  on('session.messages', () => ({ value: messages }))
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
}

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Deploy the staging server', toolUses: [] },
  { role: 'assistant', text: 'I will check the Staging config.', toolUses: [{ tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'ls staging/' }, text: 'compose.yml\nREADME.md' }] },
  { role: 'user', text: '', toolUses: [], toolResults: [] },
  { role: 'user', text: 'and production?', toolUses: [] },
  { role: 'assistant', text: 'Not touched.', toolUses: [{ tool_use_id: 'toolu_2', tool: 'Read', input: { file_path: '/w/notes.md' }, text: 'nothing relevant' }] },
]

test('a search lists matching messages and tool calls, newest first, any case', async ($, on) => {
  world(on, {})
  transcript(on, MESSAGES)
  await $.session.start(start)
  await search($, 'STAGING')
  expect(await labels($)).toEqual(['Bash …ommand":"ls staging/"} compose.yml README.md', 'Claude …l check the Staging config.', 'you Deploy the staging server'])
})

test('filters narrow to you, Claude or tools and keep the query', async ($, on) => {
  world(on, {})
  transcript(on, MESSAGES)
  await $.session.start(start)
  await search($, 'staging')
  for (const [filter, tag] of [['you', 'you '], ['claude', 'Claude '], ['tools', 'Bash ']] as const) {
    const ui = await pane($)
    await ui.press({ key: `find-filter-${filter}` })
    await ui.unmount()
    const found = await labels($)
    expect(found.length).toBe(1)
    expect(found[0]?.startsWith(tag)).toBe(true)
  }
  const ui = await pane($)
  expect((await ui.find({ key: 'find-filter-tools' }))?.props.label).toBe('[tools]')
  expect((await ui.find({ key: 'find-filter-all' }))?.props.label).toBe('all')
})

test('an empty query shows a hint, a miss says so', async ($, on) => {
  world(on, {})
  transcript(on, MESSAGES)
  await $.session.start(start)
  let ui = await pane($)
  expect(await ui.find({ key: 'find-hit-0' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Type, then Enter/ })).toBeDefined()
  await ui.unmount()
  await search($, 'zzz')
  ui = await pane($)
  expect(await ui.find({ type: 'Text', text: 'No matches.' })).toBeDefined()
})

test('a long match stays visible and the label fits the pane on one line', async ($, on) => {
  world(on, {})
  transcript(on, [{ role: 'user', text: `${'x'.repeat(500)}\nneedle ${'y'.repeat(500)}`, toolUses: [] }])
  await $.session.start(start)
  await search($, 'needle')
  const [label] = await labels($, 40)
  expect(label).toContain('needle')
  expect(label).toContain('…')
  expect(label).not.toContain('\n')
  expect([...(label ?? '')].length).toBeLessThanOrEqual(38)
})

test('more matches than fit: newest 50, and the count says so', async ($, on) => {
  world(on, {})
  transcript(on, Array.from({ length: 60 }, (_, i) => ({ role: 'user' as const, text: `hit ${i}`, toolUses: [] })))
  await $.session.start(start)
  await search($, 'hit')
  const found = await labels($)
  expect(found.length).toBe(50)
  expect(found[0]).toBe('you hit 59')
  expect(await (await pane($)).find({ type: 'Text', text: 'Newest 50 of 60 matches.' })).toBeDefined()
})

test('a hit with no drawn row toasts instead of jumping', async ($, on) => {
  const { toasts } = world(on, {})
  transcript(on, MESSAGES)
  await $.session.start(start)
  await search($, 'production')
  const ui = await pane($)
  await ui.press({ key: 'find-hit-0' })
  expect(toasts.at(-1)).toBe('That message is not in the transcript view.')
})

test('identical texts map to their own rows in order, and tool hits use the call id (the scroll itself is checked live: the kit answers none)', () => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'yes', toolUses: [] },
    { role: 'assistant', text: 'ok', toolUses: [{ tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'yes' } }] },
    { role: 'user', text: 'yes', toolUses: [] },
  ]
  const rows = new Map([['r1', 'yes'], ['r2', 'ok'], ['r3', 'yes']])
  expect(findHits(messages, rows, { text: 'yes', kind: 'all' }, 40).map(hit => hit.rowId)).toEqual(['r3', 'toolu_1', 'r1'])
})

for (const reason of ['clear', 'resume'] as const) test(`/find opens the tab focused and searches; ${reason} forgets the search`, async ($, on) => {
  const { panes } = world(on, {})
  transcript(on, MESSAGES)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start(start)
  const panel = { args: 'production', origin: { kind: 'composer' } as const, presentation: { isFullscreen: true, columns: 160 } }
  await $.command.run({ ...panel, command: 'find' })
  expect(panes.has('find')).toBe(true)
  expect((await labels($))[0]).toBe('you and production?')
  await $.session.end({ reason, sessionId: 's1' } as never)
  expect(await labels($)).toEqual([])
})

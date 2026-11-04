import { expect, test } from 'claude-code/testing'

import { BAND, world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const ALL_OFF = { showPromptRail: false, showModelButtons: false, showUsageLimits: false, showContext: false, showCache: false, showLoadedSkills: false, showSoundButton: false, showGitRow: false, showSidebarButton: false }

test('every band feature on by default', async ($, on) => {
  world(on, {})
  await $.session.start(start)
  await $.session.measure({ context: { tokens: 162_000, window: 1_000_000, percent: 16 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(3_600_000).toISOString() }], changed: ['context', 'rateLimits'] })
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'model' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ctx' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^⧗ cache/ })).toBeDefined()
})

test('switched off, a feature leaves the band; all off, only the style button stays', { options: ALL_OFF }, async ($, on) => {
  world(on, {})
  await $.session.start(start)
  await $.session.measure({ context: { tokens: 162_000, window: 1_000_000, percent: 16 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(3_600_000).toISOString() }], changed: ['context', 'rateLimits'] })
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'model' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'ctx' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '5h' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^⧗ cache/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '│' })).toBeUndefined()
  expect((await ui.find({ key: 'style' }))?.props.label).toBe('Concise')
})

test('another mod\'s band stays drawn beneath; a subagent\'s transcript in view gets only that band', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  world(on, {})
  await $.session.start(start)
  const main = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await main.find({ type: 'Text', text: 'other band' })).toBeDefined()
  expect(await main.find({ key: 'model' })).toBeDefined()

  const agent = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND, props: { ...BAND.props, view: { agentId: 'a1' } } })
  expect(await agent.find({ type: 'Text', text: 'other band' })).toBeDefined()
  expect(await agent.find({ key: 'model' })).toBeUndefined()
})

test('with only the git row and ♪ switched on and no output style, the band still draws them', { options: { ...ALL_OFF, showGitRow: true, showSoundButton: true } }, async ($, on) => {
  const { styles } = world(on, {})
  styles.current = null
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sounds-all' })).toBeDefined()
})

test('with only ☰ switched on, the band still draws it', { options: { ...ALL_OFF, showSidebarButton: true } }, async ($, on) => {
  const { styles } = world(on, {})
  styles.current = null
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sidebar' })).toBeDefined()
})

import { expect, test } from 'claude-code/testing'

import { BAND, MIN, usage, world } from './world'

for (const [platform, env, player] of [
  ['WSL', { WSL_DISTRO_NAME: 'Ubuntu' }, 'powershell.exe'],
  ['macOS', {}, 'afplay'],
] as const) {
  test(`${platform}: warns once at 10m with ${player}, then goes cold`, async ($, on) => {
    const { clock, toasts, chimes } = world(on, env)

    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' })

    await clock.advance(49 * MIN)
    expect(toasts).toEqual([])

    await clock.advance(1 * MIN)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('expires in 10m')
    expect(chimes).toEqual([player])

    await clock.advance(5 * MIN)
    expect(toasts).toHaveLength(1)

    await clock.advance(6 * MIN)
    expect(toasts).toHaveLength(2)
    expect(toasts[1]).toContain('~312k tokens')
  })
}

test('the band counts down on terminal and desktop', async ($, on) => {
  const { clock } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /cache 60m/ })).toBeDefined()
    await ui.unmount()
  }

  await clock.advance(61 * MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /cache cold/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a subagent turn does not restart the hour', async ($, on) => {
  const { clock, toasts } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' })
  await clock.advance(45 * MIN)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'sub', usage, reason: 'answer' })
  await clock.advance(5 * MIN)
  expect(toasts).toHaveLength(1)
})

test('the style button cycles the output style', async ($, on) => {
  const { styles } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    expect(await ui.find({ key: 'style' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await ui.press({ key: 'style' })
  expect(styles.current).toBe('Explanatory')
  await ui.press({ key: 'style' })
  expect(styles.current).toBe('default')
})

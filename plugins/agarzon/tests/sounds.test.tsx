import { expect, test } from 'claude-code/testing'

import { BAND, usage, world } from './world'

const sounds = (args: string) => ({ command: 'sounds', args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 120 } })
const turn = (durationMs: number, agentId?: string) => ({ answer: 'a', durationMs, isAborted: false, turnId: 't', usage, reason: 'answer' as const, agentId })

test('a long main turn and a subagent each ring their own sound, a short turn stays quiet', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  await $.turn.complete(turn(5_000))
  expect(chimes).toEqual([])

  await $.turn.complete(turn(31_000))
  await $.turn.complete(turn(1_000, 'a1'))
  expect(chimes).toEqual(['audio sounds/glass-003.wav', 'audio sounds/drop-001.wav'])
})

test('a loop no agent list names, such as compaction or a workflow agent, stays quiet', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(1_000, 'compact-fork'))
  expect(chimes).toEqual([])
})

test('nothing plays under claude -p', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  await $.turn.complete(turn(60_000))
  expect(chimes).toEqual([])
})

test('a permission prompt rings needs-you; Linux plays it with paplay', async ($, on) => {
  const { chimes } = world(on, {}, new Map(), 'Linux')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await $.classic.Notification({ message: 'idle', notification_type: 'idle_prompt' })
  expect(chimes).toHaveLength(1)
  expect(chimes[0]).toMatch(/^paplay .*\/sounds\/question-001\.wav$/)
})

test('/sounds mutes one event, then all, and the mute survives a new session', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(sounds('turnDone off'))).text).toMatch(/turnDone\s+off/)
  await $.turn.complete(turn(60_000))
  await $.turn.complete(turn(1_000, 'a1'))
  expect(chimes).toEqual(['audio sounds/drop-001.wav'])

  expect((await $.command.run(sounds('off'))).text).toContain('Sounds muted.')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(1_000, 'a1'))
  expect(chimes).toHaveLength(1)

  expect((await $.command.run(sounds('bogus'))).text).toContain('Usage:')
})

test('an event set to an absolute path plays that file; an empty one is silent', { options: { soundTurnDone: '/Users/me/ding.wav', soundSubagentDone: '' } }, async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(60_000))
  await $.turn.complete(turn(1_000, 'a1'))
  expect(chimes).toEqual(['afplay /Users/me/ding.wav'])
})

test('Esc on a long turn or a subagent stays quiet', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ ...turn(60_000), isAborted: true, reason: 'aborted' })
  await $.turn.complete({ ...turn(60_000, 'a1'), isAborted: true, reason: 'aborted' })
  expect(chimes).toEqual([])
})

test('crossing the context nudge rings context-limit', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { tokens: 610_000, window: 1_000_000, percent: 61 }, rateLimits: [], changed: ['context'] })
  expect(chimes).toEqual(['audio sounds/error-002.wav'])
})

test('Linux falls back to aplay when paplay fails', async ($, on) => {
  const { chimes, failing, clock } = world(on, {}, new Map(), 'Linux')
  failing.add('paplay')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(60_000))
  await clock.advance(1)
  expect(chimes.map(chime => chime.split(' ')[0])).toEqual(['paplay', 'aplay'])
})

test("WSL converts the path and escapes a quote in it", { options: { soundTurnDone: "/home/o'neil/ding.wav" } }, async ($, on) => {
  const { chimes, clock } = world(on, { WSL_DISTRO_NAME: 'Ubuntu' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(60_000))
  await clock.advance(1)
  expect(chimes).toEqual(["powershell.exe (New-Object Media.SoundPlayer 'C:/home/o''neil/ding.wav').PlaySync()"])
})

test('♪ mutes and unmutes all, the same switch /sounds shows', async ($, on) => {
  const { chimes } = world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'sounds-all' }))?.props.dimColor).toBe(false)

  await ui.press({ key: 'sounds-all' })
  ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'sounds-all' }))?.props.dimColor).toBe(true)
  expect((await $.command.run(sounds(''))).text).toContain('Sounds muted.')
  await $.turn.complete(turn(1_000, 'a1'))
  expect(chimes).toEqual([])

  await ui.press({ key: 'sounds-all' })
  await $.turn.complete(turn(1_000, 'a1'))
  expect(chimes).toHaveLength(1)
})

test('/sounds off shows every event off', async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run(sounds('off'))
  expect(text).toMatch(/turnDone\s+off/)
  expect(text).not.toMatch(/\bon\s/)
})

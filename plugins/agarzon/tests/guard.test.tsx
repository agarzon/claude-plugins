import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { ask, MIN, usage, world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const typed = { text: 'next step', wait: false, origin: { kind: 'composer' } } as const

function drafts(on: On) {
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

async function goCold($: Engine, clock: { advance(ms: number): Promise<unknown> }) {
  await $.session.start(start)
  await ask($)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' })
  await clock.advance(61 * MIN)
}

test('cold cache, big context: the first typed prompt is held back with the cost and put back in the box; Enter again sends it', async ($, on) => {
  const { clock, calls } = world(on, {})
  const filled = drafts(on)
  await goCold($, clock)

  const first = await $.prompt.submit(typed)
  expect('drop' in first && first.drop).toContain('~312k tokens')
  expect(filled).toEqual(['next step'])
  expect(calls.filter(c => c.startsWith('prompt:'))).toEqual([])

  const second = await $.prompt.submit(typed)
  expect('drop' in second && second.drop).toBeFalsy()
  expect(calls.filter(c => c.startsWith('prompt:'))).toEqual(['prompt: next step'])
})

test('the guard re-arms after the cache is warm again and goes cold again', async ($, on) => {
  const { clock } = world(on, {})
  drafts(on)
  await goCold($, clock)
  await $.prompt.submit(typed)
  await $.prompt.submit(typed)
  await ask($)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't2', usage, reason: 'answer' })
  await clock.advance(61 * MIN)
  const again = await $.prompt.submit(typed)
  expect('drop' in again && again.drop).toBeTruthy()
})

test('never holds back an unattended prompt, a warm cache, or a prompt with attachments', async ($, on) => {
  const { clock } = world(on, {})
  drafts(on)
  await $.session.start(start)
  await ask($)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' })
  const warm = await $.prompt.submit(typed)
  expect('drop' in warm && warm.drop).toBeFalsy()

  await clock.advance(61 * MIN)
  for (const origin of [{ kind: 'task-notification' }, { kind: 'scheduled-trigger' }] as const) {
    const r = await $.prompt.submit({ ...typed, origin } as never)
    expect('drop' in r && r.drop).toBeFalsy()
  }
  const withImage = await $.prompt.submit({ ...typed, attachments: [{}] } as never)
  expect('drop' in withImage && withImage.drop).toBeFalsy()
})

for (const [name, options] of [['switched off', { guardColdSend: false }], ['context under the floor', { guardColdSendMinK: 400 }]] as const) {
  test(`does nothing when ${name}`, { options }, async ($, on) => {
    const { clock } = world(on, {})
    drafts(on)
    await goCold($, clock)
    const r = await $.prompt.submit(typed)
    expect('drop' in r && r.drop).toBeFalsy()
  })
}

import { expect, test } from 'claude-code/testing'

import { parseLedger } from '../hooks/skills'
import { BAND, usage, world } from './world'

const TRANSCRIPT = '/elsewhere/sid.jsonl'
const line = (entry: object) => JSON.stringify(entry)
const skill = (name: string, body: string) => line({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: `Base directory for this skill: /x/${name}\n\n${body}` }] } })
const done = { answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' } as const

test('lists skill bodies from the transcript SessionStart names, flags a body loaded twice, drops what compaction removed', async ($, on) => {
  const transcript = [
    skill('old-skill', 'x'.repeat(4000)),
    line({ type: 'system', subtype: 'compact_boundary' }),
    skill('plugin-authoring', 'y'.repeat(9600)),
    line({ type: 'user', message: { content: 'quoting Base directory for this skill: /x/fake in a normal prompt' } }),
    skill('plugin-authoring', 'y'.repeat(9600)),
  ].join('\n')
  world(on, {}, new Map([[TRANSCRIPT, transcript]]))

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
  await $.turn.complete(done)

  expect(parseLedger(transcript).map(i => `${i.folder} ${(i.tokens / 1000).toFixed(1)}k ×${i.count}`)).toEqual(['/x/plugin-authoring 4.8k ×2'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    const chip = await ui.find({ type: 'Text', text: /^skills / })
    expect(chip?.text).toBe('skills 1 · 4.8k')
    expect(chip?.props.color).toBe('error')
    await ui.unmount()
  }
})

test('/clear empties the list', async ($, on) => {
  world(on, {}, new Map([[TRANSCRIPT, skill('a-skill', 'z')]]))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
  await $.session.end({ reason: 'clear', sessionId: 'sid', resume: { sessionId: 'sid' } as never })
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^skills / })).toBeUndefined()
})

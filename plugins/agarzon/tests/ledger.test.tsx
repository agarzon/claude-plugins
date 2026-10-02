import { expect, test } from 'claude-code/testing'

import { BAND, usage, world } from './world'

const TRANSCRIPT = '/home/me/.claude/projects/-w/sid.jsonl'
const line = (entry: object) => JSON.stringify(entry)
const skill = (name: string, body: string) => line({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: `Base directory for this skill: /x/${name}\n\n${body}` }] } })
const hook = (type: string, content: unknown) => line({ type: 'attachment', attachment: { type, content } })
const done = { answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' } as const

test('lists skill bodies and hook injections, flags a body loaded twice, drops what compaction removed', async ($, on) => {
  const transcript = [
    skill('old-skill', 'x'.repeat(4000)),
    line({ type: 'system', subtype: 'compact_boundary' }),
    hook('hook_success', 'PONYTAIL MODE ACTIVE\n' + 'p'.repeat(5000)),
    hook('hook_success', ''),
    hook('hook_additional_context', ['<EXTREMELY_IMPORTANT>\nYou have superpowers.\n' + 's'.repeat(13000)]),
    hook('hook_system_message', '<persisted-output>\nOutput too large (9.9KB). Full output saved to: /home/ponytail/x\n\nPreview (first 2KB):\n\u001b[1m[proj] recent context, today\u001b[0m'),
    skill('plugin-authoring', 'y'.repeat(9600)),
    line({ type: 'user', message: { content: 'quoting Base directory for this skill: /x/fake in a normal prompt' } }),
    skill('plugin-authoring', 'y'.repeat(9600)),
  ].join('\n')
  world(on, { HOME: '/home/me' }, new Map([[TRANSCRIPT, transcript]]))

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.complete(done)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agarzon', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^ponytail·hook 1\.3k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^superpowers·hook 3\.3k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\[proj\] recent context, today·hook 2\.5k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^plugin-authoring 4\.8k ×2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /old-skill|fake/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/clear empties the list', async ($, on) => {
  world(on, { HOME: '/home/me' }, new Map([[TRANSCRIPT, skill('a-skill', 'z')]]))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 'sid', resume: { sessionId: 'sid' } as never })
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /a-skill/ })).toBeUndefined()
})

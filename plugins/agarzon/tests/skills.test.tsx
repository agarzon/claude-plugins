import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { world } from './world'

const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const BIG = 'x'.repeat(40_000)

function skills(on: On, $: Engine) {
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, async (_$, e) => {
    await $.skill.prompt({ skill: e.skill, text: e.skill.endsWith('big') ? BIG : 'small', frontmatter: {}, source: 'plugin' } as never)
    return { result: 'loaded' } as never
  })
}

test('a big skill loaded by the main conversation toasts once; small ones and subagent loads do not', async ($, on) => {
  const { toasts } = world(on, {})
  skills(on, $)
  await $.session.start(start)

  await $.tool.call({ tool: 'Skill', skill: 'small' })
  await $.tool.call({ tool: 'Skill', skill: 'big', agentId: 'a1' })
  expect(toasts).toEqual([])

  await $.tool.call({ tool: 'Skill', skill: 'agarzon:big' })
  expect(toasts).toEqual(['big loaded: ~10.0k tokens of context.'])
})

test('a second main-conversation load of a skill still in context becomes a pointer; compaction resets it', async ($, on) => {
  const { toasts } = world(on, {})
  const seen: string[] = []
  on('skill.prompt', (_$, e) => {
    seen.push(e.text.slice(0, 20))
    return { text: e.text }
  })
  on('tool.call', { tool: 'Skill' }, async () => {
    const r = await $.skill.prompt({ skill: 'agarzon:debug', text: 'full body', frontmatter: {}, source: 'plugin' } as never)
    seen.push(r.text.slice(0, 20))
    return { result: 'loaded' } as never
  })
  on('session.compact', (_$, e) => ({ messages: e.messages }) as never)
  await $.session.start(start)
  await $.tool.call({ tool: 'Skill', skill: 'agarzon:debug' })
  await $.tool.call({ tool: 'Skill', skill: 'debug' })
  expect(seen).toEqual(['full body', 'full body', 'The debug skill is a'])
  expect(toasts.at(-1)).toContain('Skipped a second copy of debug')

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
  await $.tool.call({ tool: 'Skill', skill: 'debug' })
  expect(seen.at(-1)).toBe('full body')
})

test('two plugins\' skills with one name are two skills', async ($, on) => {
  const { toasts } = world(on, {})
  const seen: string[] = []
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, async (_$, e) => {
    const [plugin = '', name = ''] = e.skill.split(':')
    const r = await $.skill.prompt({ skill: e.skill, text: 'full body', frontmatter: {}, source: 'plugin', pluginName: plugin, path: `/p/${plugin}/skills/${name}/SKILL.md` } as never)
    seen.push(r.text.slice(0, 20))
    return { result: 'loaded' } as never
  })
  await $.session.start(start)
  await $.tool.call({ tool: 'Skill', skill: 'claude-mem:handoff' })
  await $.tool.call({ tool: 'Skill', skill: 'agarzon:handoff' })
  await $.tool.call({ tool: 'Skill', skill: 'agarzon:handoff' })
  expect(seen).toEqual(['full body', 'full body', 'The handoff skill is'])
  expect(toasts).toEqual(['Skipped a second copy of handoff (~0.0k tokens): it is still in context.'])
})

test('a skill the transcript already holds, as after --resume, becomes a pointer by its folder', async ($, on) => {
  const transcript = JSON.stringify({ type: 'user', isMeta: true, message: { content: 'Base directory for this skill: /p/agarzon/skills/debug\n\nbody' } })
  world(on, {}, new Map([['/t/sid.jsonl', transcript]]))
  const seen: string[] = []
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, async (_$, e) => {
    const r = await $.skill.prompt({ skill: e.skill, text: 'full body', frontmatter: {}, source: 'plugin', pluginName: e.skill.split(':')[0], path: `/p/${e.skill.split(':')[0]}/skills/debug/SKILL.md` } as never)
    seen.push(r.text.slice(0, 20))
    return { result: 'loaded' } as never
  })
  await $.session.start(start)
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/t/sid.jsonl' })
  await $.tool.call({ tool: 'Skill', skill: 'agarzon:debug' })
  await $.tool.call({ tool: 'Skill', skill: 'other:debug' })
  expect(seen).toEqual(['The debug skill is a', 'full body'])
})

test('switched off, no toast', { options: { skillGuard: false } }, async ($, on) => {
  const { toasts } = world(on, {})
  skills(on, $)
  await $.session.start(start)
  await $.tool.call({ tool: 'Skill', skill: 'big' })
  expect(toasts).toEqual([])
})

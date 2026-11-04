import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseFiles } from '../hooks/git'
import { ask, BAND, world } from './world'

const start = { cwd: '/home/me/w', surface: 'terminal', isInteractive: true } as const
const STATUS = '# branch.oid abcdef1234\n# branch.head main\n1 .M N... 100644 100644 100644 a b hooks/x.ts'
const panel = { command: 'panel', args: '', origin: { kind: 'composer' } as const, presentation: { isFullscreen: true, columns: 160 } }
const pane = ($: Engine, requestId: string, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'agarzon', surface, component: 'Pane', requestId, props: { title: requestId, isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never)

test('git -z output parses modified, untracked and renamed files with their counts', () => {
  const status = ' M hooks/x.ts\0?? notes/new file.md\0R  hooks/b.ts\0hooks/a.ts\0'
  const numstat = '12\t3\thooks/x.ts\0' + '1\t0\t\0hooks/a.ts\0hooks/b.ts\0'
  expect(parseFiles(status, numstat)).toEqual([
    { path: 'hooks/b.ts', status: 'R', added: 1, removed: 0 },
    { path: 'hooks/x.ts', status: 'M', added: 12, removed: 3 },
    { path: 'notes/new file.md', status: '?', added: null, removed: null },
  ])
})

test('/panel and ☰ open the five tabs and close them; left open, they reopen next session', async ($, on) => {
  const { panes, store } = world(on, {})
  await $.session.start(start)
  expect((await $.command.run(panel)).text).toContain('opened')
  expect([...panes.values()]).toEqual(['Git', 'Context', 'Agents', 'Cache', 'Sounds'])
  expect(store.get('sidebar-open')).toBe(true)

  panes.clear()
  await $.session.start(start)
  expect(panes.size).toBe(5)

  const band = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  await band.press({ key: 'sidebar' })
  expect(panes.size).toBe(0)
  expect(store.get('sidebar-open')).toBe(false)
})

test('Git tab: files with counts, ● for files Claude touched, why? fills the prompt, this-session view keeps committed files', async ($, on) => {
  const { repo, calls } = world(on, {})
  Object.assign(repo, { status: STATUS, dirs: '/home/me/w/.git\n/home/me/w/.git\n/home/me/w', porcelain: ' M hooks/x.ts\0?? y.ts\0', numstat: '12\t3\thooks/x.ts\0' })
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
  on('prompt.fill', (_$, e) => {
    calls.push(`fill: ${e.text}`)
    return { isFilled: true }
  })
  await $.session.start(start)
  await $.tool.call({ tool: 'Edit', file_path: '/home/me/w/hooks/x.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/home/me/w/done.ts', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, 'git', surface)
    expect(await ui.find({ type: 'Text', text: 'hooks/x.ts' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '+12' }))).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'new' })).toBeDefined()
    expect(await ui.find({ key: 'why-hooks/x.ts' })).toBeDefined()
    expect(await ui.find({ key: 'why-y.ts' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await pane($, 'git')
  await ui.press({ key: 'why-hooks/x.ts' })
  expect(calls).toContain('fill: Briefly explain what you changed in hooks/x.ts and why.')
  await ui.press({ key: 'scope' })
  await ui.unmount()
  const session = await pane($, 'git')
  expect(await session.find({ type: 'Text', text: 'y.ts' })).toBeUndefined()
  expect(await session.find({ type: 'Text', text: 'committed' })).toBeDefined()
})

test('Agents tab: a running subagent and a background shell tick and stop; a notification ends the shell', async ($, on) => {
  const { agents, calls, clock } = world(on, {})
  agents.splice(0, agents.length, { id: 'a7', name: 'reviewer', description: 'Review the diff', type: 'general-purpose', status: 'running' })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b9' } as never }))
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true, description: 'dev server' })
  await clock.advance(65_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, 'agents', surface)
    expect(await ui.find({ type: 'Text', text: 'Review the diff' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'dev server' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1m0[0-9]s$/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await pane($, 'agents')
  await ui.press({ key: 'stop-a7' })
  expect(calls).toContain('TaskStop reviewer')
  await ui.unmount()

  await $.session.receive({ origin: { kind: 'task-notification' }, text: '<task-notification><task-id>b9</task-id><status>completed</status></task-notification>' } as never)
  const after = await pane($, 'agents')
  expect(await after.find({ key: 'stop-b9' })).toBeUndefined()
})

test('Cache tab: request log, keep-warm and auto-handoff switches', async ($, on) => {
  const { calls } = world(on, {})
  await $.session.start(start)
  await ask($)
  const ui = await pane($, 'cache')
  expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d {2}0\.0k · 0\.0k · 0\.0k$/ })).toBeDefined()
  expect((await ui.find({ key: 'auto-handoff' }))?.props.label).toBe('off')
  await ui.press({ key: 'auto-handoff' })
  expect(calls).toContain('config.set agarzon.autoHandoff')
  await ui.press({ key: 'warm' })
  await ui.unmount()
  expect((await (await pane($, 'cache')).find({ key: 'warm' }))?.props.label).toBe('on')
})

test('Context tab: the breakdown after an answer, with the denied skills it hides', async ($, on) => {
  const { settings, usageNow } = world(on, {})
  settings.deny = ['Skill(claude-mem:do)']
  usageNow.context = { tokens: 50_000, window: 1_000_000, breakdown: { categories: [{ name: 'System prompt', tokens: 8000, kind: 'used' }, { name: 'MCP server instructions', tokens: 0, kind: 'used' }, { name: 'Free space', tokens: 900_000, kind: 'free' }], totalTokens: 50_000, rawMaxTokens: 1_000_000, memoryFiles: [{ path: '/w/CLAUDE.md', type: 'Project', tokens: 3100 }], mcpTools: [{ name: 'a', serverName: 'digitalocean', tokens: 4000, isLoaded: true }, { name: 'b', serverName: 'digitalocean', tokens: 2000, isLoaded: true }], agents: [], skills: { totalSkills: 70, includedSkills: 70, tokens: 4200, skillFrontmatter: [] } } }
  await $.session.start(start)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  const ui = await pane($, 'context')
  expect(await ui.find({ type: 'Text', text: 'System prompt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Free space' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'MCP server instructions' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'digitalocean' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '6.0k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 denied skills hidden from the list' })).toBeDefined()
})

test('Sounds tab: each event switches on its own, the same switch /sounds shows', async ($, on) => {
  world(on, {})
  await $.session.start(start)
  const ui = await pane($, 'sounds')
  await ui.press({ key: 'sound-turnDone' })
  const text = (await $.command.run({ ...panel, command: 'sounds' })).text
  expect(text).toMatch(/turnDone\s+off/)
  expect(text).toMatch(/needsYou\s+on/)
})

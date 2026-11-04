import { mock } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const MIN = 60_000
export const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
export const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const
const styleRow = { key: 'outputStyle', label: 'Output style', kind: 'choice', options: ['default', 'Concise', 'Explanatory'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as const
const modelRow = { key: 'model', label: 'Model', kind: 'choice', value: 'Default (recommended)', options: ['default', 'sonnet', 'best', 'opus', 'opusplan', 'opus[1m]'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as const
export const SERVED: Record<string, string> = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', 'opus[1m]': 'claude-opus-5-5' }
export const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 } as const

export async function ask($: Engine, input: Partial<TurnStepInput> = {}) {
  const stream = $.turn.step({ ...STEP, ...input })
  for await (const _ of stream) void _
  return stream.result
}

const RAN = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

export function world(on: On, env: Record<string, string>, files = new Map<string, string>(), uname = 'Darwin') {
  const calls: string[] = []
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, env)
  const toasts: string[] = []
  const chimes: string[] = []
  const failing = new Set<string>()
  const styles = { current: 'Concise' as string | null }
  const requests: Pick<TurnStepInput, 'model' | 'effort' | 'agentId'>[] = []
  on('turn.step', async function* (_$, e) {
    requests.push({ model: e.model, effort: e.effort, agentId: e.agentId })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: SERVED[e.model] ?? e.model } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const repo = { status: null as string | null, shortstat: '', dirs: '', porcelain: '', numstat: '', remote: null as string | null, review: null as string | null, runs: [] as string[] }
  on('session.cwd', () => ({ value: '/home/me/w' }))
  on('session.version', () => ({ value: { version: '2.1.318' } as never }))
  on('session.repo', () => ({ value: repo.status === null ? null : ({ root: '/home/me/w', remote: repo.remote, internal: false } as never) }))
  const previews = new Map<string, string>()
  const previewRuns: { argv: string; cwd?: string }[] = []
  on('process.run', (_$, e) => {
    const program = e.argv[0] ?? ''
    const argv = e.argv.join(' ')
    if (previews.has(argv)) {
      previewRuns.push({ argv, cwd: e.init?.cwd })
      return { value: { ...RAN, stdout: previews.get(argv) ?? '' } }
    }
    if (program === 'git' || program === 'gh' || program === 'glab') {
      repo.runs.push(e.argv.join(' '))
      const isZ = e.argv.includes('-z')
      const out = program !== 'git' ? repo.review : e.argv[1] === 'status' ? (isZ && repo.status !== null ? repo.porcelain : repo.status) : e.argv[1] === 'diff' ? (isZ ? repo.numstat : repo.shortstat) : repo.dirs
      return { value: out === null ? { ...RAN, exitCode: 128 } : { ...RAN, stdout: out } }
    }
    if (program === 'uname') return { value: { ...RAN, stdout: `${uname}\n` } }
    if (program === 'wslpath') return { value: { ...RAN, stdout: `C:${e.argv.at(-1)}\n` } }
    chimes.push(`${program} ${e.argv.at(-1)}`)
    return { value: { ...RAN, exitCode: failing.has(program) ? 1 : 0 } }
  })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) ?? null }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('audio.play', (_$, e) => {
    chimes.push(`audio ${e.clip.asset ?? ''}`)
    return { value: undefined }
  })
  const usageNow = { context: { tokens: 312_000, window: 1_000_000 } as Record<string, unknown> }
  on('session.usage', () => ({ value: { startedAt: 0, context: usageNow.context, rateLimits: [] } as never }))
  on('config.list', () => ({ value: styles.current === null ? [modelRow] : [modelRow, { ...styleRow, value: styles.current }] }))
  on('config.set', (_$, e) => {
    calls.push(`config.set ${e.key}`)
    styles.current = String(e.value)
    return { value: e.value }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('classic.Notification', () => ({}))
  on('classic.SessionStart', () => ({}))
  const settings = { deny: [] as string[] }
  on('settings.read', () => ({ value: { permissions: { deny: settings.deny } } }))
  const panes = new Map<string, string>()
  on('ui.panes', () => ({ value: [...panes].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true }) as never) }))
  on('ui.open', (_$, e) => {
    panes.set(e.id, e.title ?? e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as RenderElement
  })
  const agents: AgentInfo[] = [{ id: 'a1', description: 'd', type: 'general-purpose', status: 'completed' }]
  on('agent.list', () => ({ value: agents }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
    calls.push(`TaskStop ${e.task_id}`)
    return { result: {} as never }
  })
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__agarzon__${e.name}` } }))
  on('session.root', () => ({ value: '/w' }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.stat', (_$, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('command.run', (_$, e) => {
    calls.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  on('prompt.submit', (_$, e) => {
    calls.push(`prompt: ${e.text}`)
    return { text: e.text }
  })
  on('session.id', () => ({ value: 'sid' }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
  return { clock, toasts, chimes, failing, styles, calls, files, requests, repo, settings, panes, store, agents, usageNow, previews, previewRuns }
}

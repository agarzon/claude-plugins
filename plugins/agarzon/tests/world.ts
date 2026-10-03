import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const MIN = 60_000
export const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
export const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const
const styleRow = { key: 'outputStyle', label: 'Output style', kind: 'choice', options: ['default', 'Concise', 'Explanatory'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as const
const RAN = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

export function world(on: On, env: Record<string, string>, files = new Map<string, string>()) {
  const calls: string[] = []
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, env)
  const toasts: string[] = []
  const chimes: string[] = []
  const styles = { current: 'Concise' as string | null }
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    chimes.push(e.argv[0] ?? '')
    return { value: RAN }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 312_000, window: 1_000_000 }, rateLimits: [] } }))
  on('config.list', () => ({ value: styles.current === null ? [] : [{ ...styleRow, value: styles.current }] }))
  on('config.set', (_$, e) => {
    styles.current = String(e.value)
    return { value: e.value }
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
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true, 'superpowers@official': true } } }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
  return { clock, toasts, chimes, styles, calls, files }
}

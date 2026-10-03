import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheAlert, HandoffMode, LedgerItem, PendingHandoff } from '../types'

const TTL_MS = 60 * 60 * 1000
const WARN_MS = 10 * 60 * 1000
const TICK_MS = 15 * 1000
const NUDGE_PERCENT = 60
const HANDOFF_TOOL = 'mcp__agarzon__handoff_ready'

const lastAt = atom({ plugin: 'agarzon', key: 'cacheLastAt' } as const, null)
const leftMin = atom({ plugin: 'agarzon', key: 'cacheLeftMin' } as const, null)
const alert = atom({ plugin: 'agarzon', key: 'cacheAlert' } as const, 'none' as CacheAlert)
const isBusy = atom({ plugin: 'agarzon', key: 'isBusy' } as const, false)
const style = atom({ plugin: 'agarzon', key: 'style' } as const, null)
const contextNudge = atom({ plugin: 'agarzon', key: 'contextNudge' } as const, null)
const handoffFile = atom({ plugin: 'agarzon', key: 'handoffFile' } as const, null)
const pendingHandoff = atom({ plugin: 'agarzon', key: 'pendingHandoff' } as const, null)
const transcriptDir = atom({ plugin: 'agarzon', key: 'transcriptDir' } as const, null)
const ledger = atom({ plugin: 'agarzon', key: 'ledger' } as const, [] as LedgerItem[])

const WSL_CHIME = ['powershell.exe', '-NoProfile', '-Command', "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Windows Exclamation.wav').PlaySync()"]
const MAC_CHIME = ['afplay', '/System/Library/Sounds/Glass.aiff']

async function chime($: EngineInterface) {
  const argv = (await $.env.get('WSL_DISTRO_NAME')) ? WSL_CHIME : MAC_CHIME
  await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => {})
}

async function readStyle($: EngineInterface) {
  return (await $.config.list()).find(row => row.key === 'outputStyle')
}

async function cycleStyle($: EngineInterface) {
  const row = await readStyle($)
  if (!row || row.kind !== 'choice') return
  const options = row.options ?? []
  const value = options[(options.indexOf(String(row.value)) + 1) % options.length]
  if (value === undefined) return
  const result = await $.config.set({ key: 'outputStyle', value })
  if ('deny' in result && result.deny) $.ui.toast(`Output style not changed: ${result.deny}`)
  else await update($, style, () => value)
}

async function tick($: EngineInterface) {
  const at = await read($, lastAt)
  if (at === null) return

  const left = TTL_MS - ((await $.clock.now()) - at)
  const min = Math.max(0, Math.ceil(left / 60_000))
  if ((await read($, leftMin)) !== min) await update($, leftMin, () => min)

  const state = await read($, alert)
  if (left <= 0 && state !== 'cold') {
    await update($, alert, () => 'cold' as const)
    const tokens = (await $.session.usage()).context.tokens ?? 0
    $.ui.toast(`Prompt cache expired: the next message re-caches ~${Math.round(tokens / 1000)}k tokens at 2x input price`, { timeoutMs: 60_000 })
  } else if (left > 0 && left <= WARN_MS && state === 'none' && !(await read($, isBusy))) {
    await update($, alert, () => 'soon' as const)
    $.ui.toast(`Prompt cache expires in ${min}m: send a message to keep it warm`, { timeoutMs: 60_000 })
    void chime($)
  }
}

function resumePrompt(path: string) {
  return `Read ${path} and continue with its To do list. HANDOFF.md holds only pending work: remove each item from the file as soon as it is done, and delete the file when nothing is left.`
}

async function checkHandoff($: EngineInterface, input: Record<string, unknown>): Promise<PendingHandoff | string> {
  const { path, name, mode } = input
  if (typeof path !== 'string' || !path.startsWith('/') || !path.endsWith('/HANDOFF.md')) return 'path must be the absolute path of a HANDOFF.md file'
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) return 'name must be kebab-case, up to 60 characters'
  if (mode !== 'refresh' && mode !== 'wrap') return "mode must be 'refresh' or 'wrap'"
  if (mode === 'refresh') {
    const stat = await $.fs.stat(path).catch(() => null)
    if (!stat || stat.kind !== 'file' || stat.size === 0) return `${path} is missing or empty: write it before handing off`
  }
  return { mode: mode as HandoffMode, name, path }
}

function nextName(name: string) {
  const match = /^(.*)-(\d+)$/.exec(name)
  return match ? `${match[1]}-${Number(match[2]) + 1}` : `${name}-2`
}

const SKILL_MARK = 'Base directory for this skill: '

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : String((part as { text?: unknown }).text ?? ''))).join('\n')
  return ''
}

function hookLabel(text: string, plugins: string[]) {
  const lower = text.replace(/\S*\/\S*/g, ' ').toLowerCase()
  const hits = plugins.map(name => [name, lower.indexOf(name.toLowerCase())] as const).filter(([, at]) => at >= 0)
  if (hits.length) return hits.sort((a, b) => a[1] - b[1])[0]![0]
  const line = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.replace(/<[^>]+>/g, '').trim())
    .find(l => l && !l.startsWith('Output too large') && !l.startsWith('Preview')) ?? 'hook'
  return line.length > 28 ? line.slice(0, 27) + '…' : line
}

function hookChars(text: string) {
  const persisted = /Output too large \(([\d.]+)KB\)/.exec(text)
  return persisted ? Number(persisted[1]) * 1024 : text.length
}

export function parseLedger(transcript: string, plugins: string[]): LedgerItem[] {
  let items = new Map<string, LedgerItem>()
  const add = (name: string, kind: LedgerItem['kind'], chars: number) => {
    const item = items.get(`${kind}:${name}`) ?? { name, kind, tokens: 0, count: 0 }
    items.set(`${kind}:${name}`, { ...item, tokens: item.tokens + Math.round(chars / 4), count: item.count + 1 })
  }
  for (const line of transcript.split('\n')) {
    if (!line.includes(SKILL_MARK) && !line.includes('"hook_') && !line.includes('compact_boundary')) continue
    let entry: { type?: string; subtype?: string; isMeta?: boolean; message?: { content?: unknown }; attachment?: { type?: string; content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      items = new Map()
    } else if (entry.type === 'user' && entry.isMeta) {
      const text = textOf(entry.message?.content)
      if (text.startsWith(SKILL_MARK)) add(text.slice(SKILL_MARK.length).split('\n')[0]!.split('/').pop() ?? '?', 'skill', text.length)
    } else if (/^hook_(success|additional_context|system_message)$/.test(entry.attachment?.type ?? '')) {
      const text = textOf(entry.attachment?.content)
      if (text.trim()) add(hookLabel(text, plugins), 'hook', hookChars(text))
    }
  }
  return [...items.values()]
}

async function refreshLedger($: EngineInterface) {
  const dir = await read($, transcriptDir)
  if (dir === null) return
  const text = await $.fs.read(`${dir}/${await $.session.id()}.jsonl`).catch(() => null)
  if (typeof text !== 'string') return
  const plugins = Object.keys((await $.settings.read()).enabledPlugins ?? {}).map(key => key.split('@')[0]!)
  const items = parseLedger(text, plugins)
  await update($, ledger, () => items)
}

async function runHandoff($: EngineInterface, handoff: PendingHandoff) {
  await $.command.run({ command: 'rename', args: handoff.name })
  if (handoff.mode !== 'refresh') return
  await $.command.run({ command: 'clear' })
  await $.command.run({ command: 'rename', args: nextName(handoff.name) })
  await $.prompt.submit({ text: resumePrompt(handoff.path), asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'handoff_ready',
      description: 'Call after writing HANDOFF.md. Renames this session; in refresh mode it then clears the session and starts the next one on the file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the HANDOFF.md just written' },
          name: { type: 'string', description: 'kebab-case name for the session that is ending' },
          mode: { type: 'string', enum: ['refresh', 'wrap'] },
        },
        required: ['path', 'name', 'mode'],
      },
    })
    $.clock.every(TICK_MS, () => void tick($))
    const row = await readStyle($)
    await update($, style, () => (row ? String(row.value) : null))
    const file = `${await $.session.root()}/HANDOFF.md`
    if (e.isInteractive && (await $.fs.exists(file))) await update($, handoffFile, () => file)
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    const projectDir = `${configDir}/projects/${(await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')}`
    await update($, transcriptDir, () => projectDir)
    await refreshLedger($)
    return next(e)
  })

  on('tool.call', { tool: HANDOFF_TOOL }, async ($, e) => {
    const checked = await checkHandoff($, e as Record<string, unknown>)
    if (typeof checked === 'string') return { deny: checked }
    await update($, pendingHandoff, () => checked)
    return { result: checked.mode === 'refresh' ? 'Handoff accepted: when this turn ends the session is renamed, cleared, and resumed from the file. End your turn now.' : 'Wrap accepted: the session is renamed when this turn ends.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, handoffFile, () => null)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, isBusy, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isBusy, () => false)
      if (e.usage) {
        const now = await $.clock.now()
        await update($, lastAt, () => now)
        await update($, alert, () => 'none' as const)
        await tick($)
      }
      await refreshLedger($)
      const handoff = await read($, pendingHandoff)
      if (handoff) {
        await update($, pendingHandoff, () => null)
        $.clock.after(0, () => void runHandoff($, handoff))
      }
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    if (percent !== undefined && e.changed.includes('context')) {
      const nudged = await read($, contextNudge)
      if (percent < NUDGE_PERCENT) {
        if (nudged !== null) await update($, contextNudge, () => null)
      } else {
        if (nudged === null) $.ui.toast(`Context at ${percent}%: time to /handoff and continue in a fresh session`, { timeoutMs: 30_000 })
        if (nudged !== percent) await update($, contextNudge, () => percent)
      }
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, lastAt, () => null)
      await update($, leftMin, () => null)
      await update($, alert, () => 'none' as const)
      await update($, contextNudge, () => null)
      await update($, ledger, () => [])
    }
    return next(e)
  })

  on('config.set', { key: 'outputStyle' }, async ($, e, next) => {
    const result = await next(e)
    if ('value' in result) await update($, style, () => String(result.value))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [min, busy, current, nudge, file, loaded] = await Promise.all([read($, leftMin), read($, isBusy), read($, style), read($, contextNudge), read($, handoffFile), read($, ledger)])
    if (e.props.hasSurvey || (min === null && current === null && file === null && nudge === null && loaded.length === 0)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const cacheColor = min === null ? 'gray' : min === 0 ? 'red' : min > 20 ? 'green' : min > 10 ? 'yellow' : 'red'
    const cacheText = busy || min === null ? '⧗ cache —' : min === 0 ? '⧗ cache cold' : `⧗ cache ${min}m`

    return (
      <Box flexDirection="column">
        {file === null ? null : (
          <Box flexDirection="row" gap={1}>
            <Text color="cyan">HANDOFF.md is waiting from your last session</Text>
            <Button key="load-handoff" label="Load" variant="primary" onPress={async () => { await update($, handoffFile, () => null); await $.prompt.submit({ text: resumePrompt(file), asUser: true }) }} />
            <Button key="dismiss-handoff" label="Dismiss" onPress={() => update($, handoffFile, () => null)} />
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Text color={cacheColor} bold={min === 0 && !busy}>{cacheText}</Text>
          {current === null ? null : <Text dimColor>│</Text>}
          {current === null ? null : <Button key="style" label={current} onPress={() => cycleStyle($)} />}
          {nudge === null ? null : <Text dimColor>│</Text>}
          {nudge === null ? null : <Text color="yellow">ctx {nudge}% → /handoff</Text>}
        </Box>
        {loaded.length === 0 ? null : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor>loaded:</Text>
            {loaded.map(item => (
              <Text key={`${item.kind}:${item.name}`} color={item.count > 1 ? 'red' : item.kind === 'hook' ? 'magenta' : 'cyan'}>
                {item.name}{item.kind === 'hook' ? '·hook' : ''} {(item.tokens / 1000).toFixed(1)}k{item.count > 1 ? ` ×${item.count}` : ''}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

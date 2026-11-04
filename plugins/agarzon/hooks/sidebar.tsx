import type { EngineInterface, On } from 'claude-code'

import { readRequests, readCache } from './cache'
import { readBreakdown } from './context'
import { findTab, setFindText } from './find'
import { readFiles, readGit, toggleScope } from './git'
import { hiddenCount } from './listing'
import { readTasks, stopTask } from './agents'
import { isOn } from './options'
import { loadedItems } from './skills'
import { readSounds, toggleSound } from './sounds'
import { readPings, readWarm, toggleWarm } from './warm'

export const PANEL_COMMAND = 'panel'
export const FIND_COMMAND = 'find'

const TABS = [
  { id: 'git', title: 'Git' },
  { id: 'context', title: 'Context' },
  { id: 'agents', title: 'Agents' },
  { id: 'cache', title: 'Cache' },
  { id: 'sounds', title: 'Sounds' },
  { id: 'find', title: 'Find' },
] as const
const TAB_IDS = new Set<string>(TABS.map(tab => tab.id))
const OPEN_KEY = 'sidebar-open'

const k = (tokens: number) => (tokens >= 10_000 ? `${Math.round(tokens / 1000)}k` : `${(tokens / 1000).toFixed(1)}k`)
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}
const STATUS_MARK: Record<string, string> = { completed: '✓', failed: '✗', killed: '✗', idle: '·' }

async function ourPanes($: EngineInterface) {
  return (await $.ui.panes()).filter(pane => TAB_IDS.has(pane.id))
}

async function openAll($: EngineInterface) {
  for (const tab of TABS) await $.ui.open({ id: tab.id, title: tab.title })
}

export async function toggleSidebar($: EngineInterface) {
  const open = await ourPanes($)
  if (open.length > 0) {
    await $.store.set(OPEN_KEY, false)
    for (const pane of open) await $.ui.close({ id: pane.id })
    return 'Sidebar closed.'
  }
  await $.store.set(OPEN_KEY, true)
  await openAll($)
  await $.ui.open({ id: 'git', title: 'Git', focus: true })
  return 'Sidebar opened: Git, Context, Agents, Cache, Sounds, Find.'
}

export async function openFind($: EngineInterface, text: string) {
  if (text.trim()) await setFindText($, text.trim())
  await $.store.set(OPEN_KEY, true)
  await openAll($)
  await $.ui.open({ id: 'find', title: 'Find', focus: true })
  return text.trim() ? `Find: ${text.trim()}` : 'Find opened.'
}

export async function startSidebar($: EngineInterface) {
  await $.command.register({ name: PANEL_COMMAND, description: 'Open or close the agarzon sidebar (Git, Context, Agents, Cache, Sounds, Find)' })
  await $.command.register({ name: FIND_COMMAND, description: 'Search this session and jump to a message', argumentHint: '[text]' })
  if (isOn('sidebar') && (await $.store.get(OPEN_KEY)) === true) await openAll($)
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

function Section({ ui, title }: { ui: Ui; title: string }) {
  return <ui.Text bold>{title}</ui.Text>
}

async function gitTab($: EngineInterface, ui: Ui) {
  const [{ info, pr }, files] = await Promise.all([readGit($), readFiles($)])
  if (info === null) return <ui.Text dimColor>Not a git repository.</ui.Text>
  return (
    <ui.Box flexDirection="column">
      <ui.Text wrap="truncate-end">
        <ui.Text color="success">⎇ {info.branch}{info.isDirty ? '*' : ''}</ui.Text>
        {info.ahead > 0 ? <ui.Text color="warning"> ↑{info.ahead}</ui.Text> : null}
        {info.behind > 0 ? <ui.Text color="warning"> ↓{info.behind}</ui.Text> : null}
        {pr === null ? null : <ui.Text> │ {pr.label}{pr.ci ? ` ${pr.ci}` : ''}</ui.Text>}
      </ui.Text>
      <ui.Box flexDirection="row" gap={1}>
        <ui.Button key="scope" plain label={files.scope === 'all' ? 'all changes' : 'this session'} onPress={() => toggleScope($)} />
        <ui.Text dimColor>● = touched this session</ui.Text>
      </ui.Box>
      {files.rows.length === 0 ? <ui.Text dimColor>{files.scope === 'all' ? 'No uncommitted changes.' : 'Nothing touched this session.'}</ui.Text> : null}
      {files.rows.map(file => (
        <ui.Box key={`file-${file.path}`} flexDirection="row" gap={1}>
          <ui.Text color={file.isMine ? 'success' : 'inactive'}>{file.isMine ? '●' : ' '}</ui.Text>
          <ui.Text dimColor>{(file.status || '·').padEnd(2)}</ui.Text>
          <ui.Box flexGrow={1} flexShrink={1}>
            <ui.Text wrap="truncate-start">{file.path}</ui.Text>
          </ui.Box>
          {file.status === '?' ? <ui.Text color="success">new</ui.Text> : null}
          {file.added === null ? null : <ui.Text color="success">+{file.added}</ui.Text>}
          {file.removed === null ? null : <ui.Text color="error">−{file.removed}</ui.Text>}
          {file.status === '' ? <ui.Text dimColor>committed</ui.Text> : null}
          {file.isMine ? <ui.Button key={`why-${file.path}`} plain label="why?" onPress={() => void $.prompt.fill({ text: `Briefly explain what you changed in ${file.path} and why.` })} /> : null}
        </ui.Box>
      ))}
    </ui.Box>
  )
}

async function contextTab($: EngineInterface, ui: Ui) {
  const [view, loaded] = await Promise.all([readBreakdown($), loadedItems($)])
  if (view === null) return <ui.Text dimColor>Measured after the first answer.</ui.Text>
  const row = (key: string, name: string, tokens: number, note = '') => (
    <ui.Box key={key} flexDirection="row" gap={1}>
      <ui.Box flexGrow={1} flexShrink={1}>
        <ui.Text wrap="truncate-start">{name}</ui.Text>
      </ui.Box>
      {note ? <ui.Text dimColor>{note}</ui.Text> : null}
      <ui.Text>{k(tokens)}</ui.Text>
    </ui.Box>
  )
  const hidden = hiddenCount()
  return (
    <ui.Box flexDirection="column">
      <ui.Text>ctx {k(view.total)} of {k(view.max)}</ui.Text>
      {view.categories.map(c => row(`cat-${c.name}`, c.name, c.tokens))}
      {hidden > 0 && isOn('hideDeniedSkills') ? <ui.Text dimColor>{hidden} denied skills hidden from the list</ui.Text> : null}
      {loaded.length === 0 ? null : <Section ui={ui} title="Loaded skills" />}
      {loaded.map(item => row(`loaded-${item.folder}`, item.folder.split(/[\\/]/).pop() ?? item.folder, item.tokens, item.count > 1 ? `×${item.count}` : ''))}
      {view.memory.length === 0 ? null : <Section ui={ui} title="Memory files" />}
      {view.memory.map(f => row(`memory-${f.name}`, f.name, f.tokens))}
      {view.mcp.length === 0 ? null : <Section ui={ui} title="MCP servers" />}
      {view.mcp.map(m => row(`mcp-${m.name}`, m.name, m.tokens))}
    </ui.Box>
  )
}

async function agentsTab($: EngineInterface, ui: Ui) {
  const { rows, now, isRunning } = await readTasks($)
  if (rows.length === 0) return <ui.Text dimColor>No subagents or background shells yet.</ui.Text>
  return (
    <ui.Box flexDirection="column">
      {[...rows].reverse().map(row => (
        <ui.Box key={`task-${row.id}`} flexDirection="row" gap={1}>
          <ui.Text color={isRunning(row) ? 'warning' : row.status === 'completed' ? 'success' : row.status === 'idle' ? 'inactive' : 'error'}>{isRunning(row) ? '⧗' : (STATUS_MARK[row.status] ?? '·')}</ui.Text>
          <ui.Box flexGrow={1} flexShrink={1}>
            <ui.Text wrap="truncate-end">{row.label}</ui.Text>
          </ui.Box>
          <ui.Text dimColor>{row.detail}</ui.Text>
          {isRunning(row) ? <ui.Text>{elapsed(now - row.startedAt)}</ui.Text> : <ui.Text dimColor>{row.status}</ui.Text>}
          {isRunning(row) ? <ui.Button key={`stop-${row.id}`} plain label="stop" onPress={() => void stopTask($, row)} /> : null}
        </ui.Box>
      ))}
    </ui.Box>
  )
}

async function cacheTab($: EngineInterface, ui: Ui) {
  const [{ min, busy }, isWarm, log, pings] = await Promise.all([readCache($), readWarm($), readRequests($), readPings($)])
  const state = busy || min === null ? 'no request yet' : min === 0 ? 'cold' : `${min}m left`
  const isAuto = isOn('autoHandoff')
  return (
    <ui.Box flexDirection="column">
      <ui.Text>
        cache <ui.Text color={min === null ? 'inactive' : min === 0 ? 'error' : min > 20 ? 'success' : min > 10 ? 'warning' : 'error'}>{state}</ui.Text>
      </ui.Text>
      {isOn('keepWarm') ? (
        <ui.Box flexDirection="row" gap={1}>
          <ui.Text>keep-warm</ui.Text>
          <ui.Button key="warm" plain label={isWarm ? 'on' : 'off'} onPress={() => toggleWarm($)} />
        </ui.Box>
      ) : null}
      <ui.Box flexDirection="row" gap={1}>
        <ui.Text>auto-handoff</ui.Text>
        <ui.Button key="auto-handoff" plain label={isAuto ? 'on' : 'off'} onPress={() => void $.config.set({ key: 'agarzon.autoHandoff', value: !isAuto })} />
      </ui.Box>
      {log.length === 0 ? null : <Section ui={ui} title="Requests  read · wrote · uncached" />}
      {[...log].reverse().map(r => (
        <ui.Text key={`req-${r.at}`} color={r.written > r.read && r.written > 20_000 ? 'warning' : undefined}>
          {hhmm(r.at)}  {k(r.read)} · {k(r.written)} · {k(r.uncached)}
        </ui.Text>
      ))}
      {pings.length === 0 ? null : <Section ui={ui} title="Keep-warm pings" />}
      {[...pings].reverse().map(p => (
        <ui.Text key={`ping-${p.at}`} color={p.isHit ? undefined : 'error'}>
          {hhmm(p.at)}  {p.isHit ? 'warm' : 'cold'} · read {k(p.cached)} · wrote {k(p.written)}
        </ui.Text>
      ))}
    </ui.Box>
  )
}

async function soundsTab($: EngineInterface, ui: Ui) {
  const { isMuted, events } = await readSounds($)
  return (
    <ui.Box flexDirection="column">
      <ui.Box flexDirection="row" gap={1}>
        <ui.Text>all sounds</ui.Text>
        <ui.Button key="sound-all" plain label={isMuted ? 'muted' : 'on'} onPress={() => toggleSound($, 'all')} />
      </ui.Box>
      {events.map(({ event, file, isOn: on }) => (
        <ui.Box key={`sound-${event}`} flexDirection="row" gap={1}>
          <ui.Box width={14} flexShrink={0}>
            <ui.Text>{event}</ui.Text>
          </ui.Box>
          <ui.Button key={`sound-${event}`} plain label={on ? 'on' : 'off'} dimColor={!on || isMuted} onPress={() => toggleSound($, event)} />
          <ui.Box flexShrink={1}>
            <ui.Text dimColor wrap="truncate-start">{file || '(no file)'}</ui.Text>
          </ui.Box>
        </ui.Box>
      ))}
    </ui.Box>
  )
}

export function installSidebar(on: On) {
  on('ui.render', { component: 'Pane', requestId: 'git' }, async ($, e) => gitTab($, $.ui.resolve(e)))
  on('ui.render', { component: 'Pane', requestId: 'context' }, async ($, e) => contextTab($, $.ui.resolve(e)))
  on('ui.render', { component: 'Pane', requestId: 'agents' }, async ($, e) => agentsTab($, $.ui.resolve(e)))
  on('ui.render', { component: 'Pane', requestId: 'cache' }, async ($, e) => cacheTab($, $.ui.resolve(e)))
  on('ui.render', { component: 'Pane', requestId: 'sounds' }, async ($, e) => soundsTab($, $.ui.resolve(e)))
  on('ui.render', { component: 'Pane', requestId: 'find' }, async ($, e) => findTab($, $.ui.resolve(e), e.props.bodyColumns))

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'person' && TAB_IDS.has(e.id) && (await ourPanes($)).every(pane => pane.id === e.id)) await $.store.set(OPEN_KEY, false)
    return result
  })
}

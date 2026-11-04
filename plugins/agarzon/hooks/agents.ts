import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Timer } from 'claude-code'

import type { TaskRow } from '../types'

const tasks = atom({ plugin: 'agarzon', key: 'tasks' } as const, [] as TaskRow[])
const now = atom({ plugin: 'agarzon', key: 'tasksNow' } as const, 0)

const TICK_MS = 2_000
const GRACE_MS = 10_000
const RUNNING = new Set(['pending', 'running', 'waiting'])
const NOTICE = /<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>/g

let ticking: Timer | undefined
let keepUntil = 0

const fromAgent = (agent: AgentInfo, seenAt: number): TaskRow => ({
  id: agent.id,
  stopId: agent.name ?? agent.teammateId ?? agent.id,
  kind: 'agent',
  label: agent.description || agent.type,
  detail: agent.type,
  status: agent.status,
  startedAt: seenAt,
})

async function tick($: EngineInterface) {
  const [agents, at, before] = await Promise.all([$.agent.list(), $.clock.now(), read($, tasks)])
  const rows = [
    ...before.filter(row => row.kind === 'shell'),
    ...agents.map(agent => fromAgent(agent, before.find(row => row.id === agent.id)?.startedAt ?? at)),
  ]
  if (JSON.stringify(rows) !== JSON.stringify(before)) await update($, tasks, () => rows)
  if (rows.some(row => RUNNING.has(row.status))) await update($, now, () => at)
  else if (at >= keepUntil) {
    ticking?.cancel()
    ticking = undefined
  }
}

export async function watchAgents($: EngineInterface) {
  keepUntil = (await $.clock.now()) + GRACE_MS
  ticking ??= $.clock.every(TICK_MS, () => void tick($))
}

export async function noteShell($: EngineInterface, id: string, command: string) {
  const at = await $.clock.now()
  const row: TaskRow = { id, stopId: id, kind: 'shell', label: command, detail: 'shell', status: 'running', startedAt: at }
  await update($, tasks, rows => [...rows.filter(r => r.id !== id), row])
  await update($, now, () => at)
  await watchAgents($)
}

export async function noteTaskStatus($: EngineInterface, text: string) {
  const ended = new Map([...text.matchAll(NOTICE)].map(m => [m[1]!.trim(), m[2]!.trim()]))
  if (ended.size === 0) return
  await update($, tasks, rows => rows.map(row => (row.kind === 'shell' && ended.has(row.id) ? { ...row, status: ended.get(row.id)! } : row)))
}

export async function noteStopped($: EngineInterface, id: string) {
  await update($, tasks, rows => rows.map(row => (row.kind === 'shell' && row.id === id ? { ...row, status: 'killed' } : row)))
}

export async function stopTask($: EngineInterface, row: TaskRow) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: row.stopId })
  if (r.deny !== undefined || r.isError) $.ui.toast(`Could not stop ${row.label}: ${r.deny ?? r.text ?? 'TaskStop failed'}`)
  else if (row.kind === 'shell') await noteStopped($, row.id)
}

export async function clearAgents($: EngineInterface) {
  await update($, tasks, () => [])
}

export async function readTasks($: EngineInterface) {
  const [rows, at] = await Promise.all([read($, tasks), read($, now)])
  return { rows, now: at, isRunning: (row: TaskRow) => RUNNING.has(row.status) }
}

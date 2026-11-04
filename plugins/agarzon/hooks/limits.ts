import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit } from 'claude-code'

import type { LimitSample, LimitView } from '../types'
import { limitPercents } from './options'

const HOUR = 3_600_000
const WINDOWS: Record<string, { label: string; ms: number; trustMs: number }> = {
  five_hour: { label: '5h', ms: 5 * HOUR, trustMs: HOUR },
  seven_day: { label: '7d', ms: 7 * 24 * HOUR, trustMs: 24 * HOUR },
}
const PACE_MS = 30 * 60_000

const samples = atom({ plugin: 'agarzon', key: 'limitSamples' } as const, [] as LimitSample[])
const views = atom({ plugin: 'agarzon', key: 'limits' } as const, [] as LimitView[])

function view(limit: SessionRateLimit, window: { label: string; ms: number; trustMs: number }, paceFrom: LimitSample | undefined, now: number): LimitView {
  const percent = limit.percentUsed
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  if (Number.isNaN(resetsAt)) return { label: window.label, percent, resetsAt: null, fullAt: null, tone: 'success' }

  const left = Math.max(0, resetsAt - now)
  const elapsed = window.ms - left
  const rate = paceFrom ? (percent - paceFrom.percent) / (now - paceFrom.at) : elapsed >= window.trustMs ? percent / elapsed : 0
  const projected = Math.round(percent + rate * left)
  const fullAt = projected >= 100 && rate > 0 ? now + (100 - percent) / rate : null
  const { orange, red } = limitPercents()
  const tone = projected >= red ? 'error' : projected >= orange ? 'warning' : 'success'
  return { label: window.label, percent, resetsAt, fullAt, tone }
}

export async function measureLimits($: EngineInterface, limits: SessionRateLimit[]) {
  const now = await $.clock.now()
  const tracked = limits.filter(limit => limit.kind in WINDOWS)
  const history = (await read($, samples)).filter(s => tracked.some(l => l.kind === s.kind && l.percentUsed >= s.percent))
  const paceFrom = new Map(tracked.map(l => [l.kind, history.filter(s => s.kind === l.kind && now - s.at >= PACE_MS).at(-1)]))
  const kept = history.filter(s => now - s.at < PACE_MS || paceFrom.get(s.kind) === s)
  await update($, samples, () => [...kept, ...tracked.map(l => ({ kind: l.kind, at: now, percent: l.percentUsed }))])
  await update($, views, () => tracked.map(l => view(l, WINDOWS[l.kind]!, paceFrom.get(l.kind), now)))
}

export function currentLimits($: EngineInterface) {
  return read($, views)
}

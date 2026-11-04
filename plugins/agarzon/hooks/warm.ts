import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { WarmPing } from '../types'
import { noteRequest, readCache, TTL_MS } from './cache'
import { forkEffort } from './models'
import { isOn, warmAfterMs } from './options'

const isArmed = atom({ plugin: 'agarzon', key: 'warmArmed' } as const, false)
const stopAt = atom({ plugin: 'agarzon', key: 'warmStopAt' } as const, null as number | null)
const pings = atom({ plugin: 'agarzon', key: 'warmPings' } as const, [] as WarmPing[])
const inRow = atom({ plugin: 'agarzon', key: 'warmInRow' } as const, 0)

export const WARM_COMMAND = 'warm'
const TICK_MS = 15_000
const RETRY_MS = 30_000
const LAST_MINUTE_MS = 60_000
const MAX_IN_ROW = 10
const LOG_SIZE = 20
const HIT_SHARE = 0.5
const PING_TEXT = 'Keep-warm ping. Reply with just "ok".'
const DURATION = /^(\d+)\s*(m|h)$/

let retryAt = 0

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

async function disarm($: EngineInterface, why: string) {
  await update($, isArmed, () => false)
  await update($, stopAt, () => null)
  await update($, inRow, () => 0)
  $.ui.toast(why, { timeoutMs: 30_000 })
}

async function arm($: EngineInterface, until: number | null) {
  await update($, isArmed, () => true)
  await update($, stopAt, () => until)
  await update($, inRow, () => 0)
  retryAt = 0
}

async function tick($: EngineInterface) {
  if (!isOn('keepWarm') || !(await read($, isArmed))) return
  const now = await $.clock.now()
  const until = await read($, stopAt)
  if (until !== null && now >= until) return disarm($, `Keep-warm stopped at ${hhmm(until)} as asked; the cache will expire normally.`)
  const { at, busy } = await readCache($)
  if (at === null || busy || now < retryAt) return
  const idle = now - at
  if (idle < warmAfterMs() || idle >= TTL_MS - LAST_MINUTE_MS) return
  if ((await read($, inRow)) >= MAX_IN_ROW) return disarm($, `Keep-warm stopped after ${MAX_IN_ROW} pings in a row; the cache will expire normally.`)

  retryAt = now + RETRY_MS
  const effort = await forkEffort($)
  const r = await $.model.fork({ prompt: PING_TEXT, ...(effort === undefined ? {} : { effort }) })
  if (!r.isAnswered && r.reason === 'nothing-to-fork') return disarm($, 'Keep-warm needs one answer from Claude in this run before it can ping; turned off.')
  if (!r.isAnswered && r.reason === 'api-error') {
    if (r.status !== null && r.status >= 400 && r.status < 500 && r.status !== 429) return disarm($, `Keep-warm ping refused (HTTP ${r.status}); turned off.`)
    $.ui.toast(`Keep-warm ping failed (HTTP ${r.status ?? '?'}); retrying in ${RETRY_MS / 1000} s.`)
    return
  }
  const { cache_read_input_tokens: cached, cache_creation_input_tokens: written } = r.usage
  const isHit = cached > 0 && cached >= HIT_SHARE * (cached + written)
  await update($, pings, log => [...log, { at: now, cached, written, isHit }].slice(-LOG_SIZE))
  await update($, inRow, n => n + 1)
  if (!isHit) return disarm($, `Keep-warm ping found the cache cold (re-cached ${Math.round(written / 1000)}k tokens); turned off.`)
  await noteRequest($, now)
}

export function startWarm($: EngineInterface) {
  $.clock.every(TICK_MS, () => void tick($))
}

export async function noteActivity($: EngineInterface) {
  await update($, inRow, () => 0)
}

export async function toggleWarm($: EngineInterface) {
  if (await read($, isArmed)) return disarm($, 'Keep-warm off; the cache will expire normally.')
  await arm($, null)
  $.ui.toast(`Keep-warm on: a ping after ${warmAfterMs() / 60_000} min idle, up to ${MAX_IN_ROW} in a row.`)
}

export async function warmCommand($: EngineInterface, args: string) {
  if (!isOn('keepWarm')) return 'Keep-warm is switched off in /config (agarzon, Keep-warm).'
  const text = args.trim().toLowerCase()
  if (text === 'off') {
    await disarm($, 'Keep-warm off; the cache will expire normally.')
    return 'Keep-warm off.'
  }
  const duration = DURATION.exec(text)
  if (text !== '' && duration === null) return 'Usage: /warm (on until stopped), /warm 90m or /warm 2h (on for that long), /warm off.'
  const until = duration === null ? null : (await $.clock.now()) + Number(duration[1]) * (duration[2] === 'h' ? 3_600_000 : 60_000)
  await arm($, until)
  const log = (await read($, pings)).map(p => `  ${hhmm(p.at)}  ${p.isHit ? 'warm' : 'COLD'}  read ${Math.round(p.cached / 1000)}k, wrote ${Math.round(p.written / 1000)}k`)
  return [
    `Keep-warm on${until === null ? '' : ` until ${hhmm(until)}`}: a ping after ${warmAfterMs() / 60_000} min idle, up to ${MAX_IN_ROW} in a row.`,
    ...(log.length === 0 ? [] : ['Pings this session:', ...log]),
  ].join('\n')
}

export async function readWarm($: EngineInterface) {
  return read($, isArmed)
}

export async function clearWarm($: EngineInterface) {
  await update($, isArmed, () => false)
  await update($, stopAt, () => null)
  await update($, inRow, () => 0)
  await update($, pings, () => [])
}

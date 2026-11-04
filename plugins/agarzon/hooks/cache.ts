import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CacheAlert } from '../types'
import { chime } from './sounds'

const lastAt = atom({ plugin: 'agarzon', key: 'cacheLastAt' } as const, null)
const leftMin = atom({ plugin: 'agarzon', key: 'cacheLeftMin' } as const, null)
const alert = atom({ plugin: 'agarzon', key: 'cacheAlert' } as const, 'none' as CacheAlert)
const isBusy = atom({ plugin: 'agarzon', key: 'isBusy' } as const, false)

const TTL_MS = 60 * 60 * 1000
const WARN_MS = 10 * 60 * 1000
const TICK_MS = 15 * 1000

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

export function startCache($: EngineInterface) {
  $.clock.every(TICK_MS, () => void tick($))
}

export async function markBusy($: EngineInterface) {
  await update($, isBusy, () => true)
}

export async function completeCache($: EngineInterface, hasUsage: boolean) {
  await update($, isBusy, () => false)
  if (!hasUsage) return
  const now = await $.clock.now()
  await update($, lastAt, () => now)
  await update($, alert, () => 'none' as const)
  await tick($)
}

export async function clearCache($: EngineInterface) {
  await update($, lastAt, () => null)
  await update($, leftMin, () => null)
  await update($, alert, () => 'none' as const)
}

export async function readCache($: EngineInterface) {
  const [min, busy] = await Promise.all([read($, leftMin), read($, isBusy)])
  return { min, busy }
}

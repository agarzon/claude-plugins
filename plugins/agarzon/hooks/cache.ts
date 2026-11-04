import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput } from 'claude-code'

import type { CacheAlert } from '../types'
import { guardFloorTokens, isOn } from './options'
import { play } from './sounds'

const lastAt = atom({ plugin: 'agarzon', key: 'cacheLastAt' } as const, null)
const leftMin = atom({ plugin: 'agarzon', key: 'cacheLeftMin' } as const, null)
const alert = atom({ plugin: 'agarzon', key: 'cacheAlert' } as const, 'none' as CacheAlert)
const isBusy = atom({ plugin: 'agarzon', key: 'isBusy' } as const, false)
const isGuarded = atom({ plugin: 'agarzon', key: 'cacheGuarded' } as const, false)

export const TTL_MS = 60 * 60 * 1000
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
    void play($, 'cacheCold')
    $.ui.toast(`Prompt cache expired: the next message re-caches ~${Math.round(tokens / 1000)}k tokens`, { timeoutMs: 60_000 })
  } else if (left > 0 && left <= WARN_MS && state === 'none' && !(await read($, isBusy))) {
    await update($, alert, () => 'soon' as const)
    $.ui.toast(`Prompt cache expires in ${min}m: send a message to keep it warm`, { timeoutMs: 60_000 })
    void play($, 'cacheExpiring')
  }
}

export function startCache($: EngineInterface) {
  $.clock.every(TICK_MS, () => void tick($))
}

export async function markBusy($: EngineInterface) {
  await update($, isBusy, () => true)
}

export async function completeCache($: EngineInterface) {
  await update($, isBusy, () => false)
}

export async function noteRequest($: EngineInterface, sentAt: number) {
  await update($, lastAt, () => sentAt)
  await update($, alert, () => 'none' as const)
  await update($, isGuarded, () => false)
  await tick($)
}

export async function clearCache($: EngineInterface) {
  await update($, lastAt, () => null)
  await update($, leftMin, () => null)
  await update($, alert, () => 'none' as const)
  await update($, isGuarded, () => false)
}

export async function guardColdSend($: EngineInterface, e: PromptSubmitInput) {
  if (!isOn('cacheGuard') || e.origin.kind !== 'composer' || e.command || e.isMeta || e.attachments?.length) return null
  if ((await read($, alert)) !== 'cold' || (await read($, isGuarded))) return null
  const tokens = (await $.session.usage()).context.tokens ?? 0
  if (tokens < guardFloorTokens()) return null
  await update($, isGuarded, () => true)
  await $.prompt.fill({ text: e.text, mode: 'replace' })
  return `Prompt cache is cold: this send re-caches ~${Math.round(tokens / 1000)}k tokens. Press Enter again to send it anyway, or /agarzon:handoff first.`
}

export async function readCache($: EngineInterface) {
  const [at, min, busy] = await Promise.all([read($, lastAt), read($, leftMin), read($, isBusy)])
  return { at, min, busy }
}

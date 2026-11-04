import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { readCache, TTL_MS } from './cache'
import { HANDOFF_COMMAND } from './context'
import { isOn } from './options'

const isArmed = atom({ plugin: 'agarzon', key: 'autoHandoffArmed' } as const, false)
const warnedFor = atom({ plugin: 'agarzon', key: 'autoHandoffWarnedFor' } as const, null as number | null)
const queuedAt = atom({ plugin: 'agarzon', key: 'handoffQueuedAt' } as const, null as number | null)
const isQueuedByUs = atom({ plugin: 'agarzon', key: 'handoffQueuedByUs' } as const, false)
const autoTurnId = atom({ plugin: 'agarzon', key: 'autoHandoffTurnId' } as const, null as string | null)

const TICK_MS = 15_000
const LEAD_MS = 5 * 60_000
const WARN_MS = 60_000
const QUEUE_MS = 60_000
export const AUTO_HANDOFF_DECLINE =
  'agarzon auto-handoff declined this call: the handoff runs unattended, so nothing in it waits for approval. ' +
  'Do not retry it or reach the same goal with another tool; write the handoff with what you can do without approval.'

async function tick($: EngineInterface) {
  if (!isOn('autoHandoff') || !(await read($, isArmed)) || (await read($, queuedAt)) !== null) return
  const { at, busy } = await readCache($)
  if (at === null || busy) return
  const idle = (await $.clock.now()) - at
  const fireAt = TTL_MS - LEAD_MS
  if (idle >= TTL_MS || idle < fireAt - WARN_MS) return
  if (idle < fireAt) {
    if ((await read($, warnedFor)) === at) return
    await update($, warnedFor, () => at)
    $.ui.toast(`Auto-handoff in 1 min, before the prompt cache expires. Send anything to cancel.`, { timeoutMs: WARN_MS })
    return
  }
  await update($, isArmed, () => false)
  await runHandoff($, true)
}

export async function runHandoff($: EngineInterface, byUs = false) {
  await noteHandoffCommand($)
  await update($, isQueuedByUs, () => byUs)
  await $.command.run({ command: HANDOFF_COMMAND })
}

export function startAutoHandoff($: EngineInterface) {
  $.clock.every(TICK_MS, () => void tick($))
}

export async function noteHandoffCommand($: EngineInterface) {
  const now = await $.clock.now()
  await update($, queuedAt, () => now)
}

export async function noteTurnStart($: EngineInterface, turnId: string) {
  const queued = await read($, queuedAt)
  const isHandoff = queued !== null && (await $.clock.now()) - queued < QUEUE_MS
  const byUs = await read($, isQueuedByUs)
  await update($, queuedAt, () => null)
  await update($, isQueuedByUs, () => false)
  if (!isHandoff) {
    await update($, isArmed, () => true)
    return
  }
  await update($, isArmed, () => false)
  if (byUs) await update($, autoTurnId, () => turnId)
}

export async function noteTurnEnd($: EngineInterface, turnId: string) {
  if ((await read($, autoTurnId)) === turnId) await update($, autoTurnId, () => null)
}

export async function isAutoHandoffRunning($: EngineInterface) {
  return (await read($, autoTurnId)) !== null
}

export async function clearAutoHandoff($: EngineInterface) {
  await update($, isArmed, () => false)
  await update($, warnedFor, () => null)
  await update($, queuedAt, () => null)
  await update($, isQueuedByUs, () => false)
  await update($, autoTurnId, () => null)
}

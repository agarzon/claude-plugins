import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

const contextNudge = atom({ plugin: 'agarzon', key: 'contextNudge' } as const, null)


const NUDGE_PERCENT = 60

export async function measureContext($: EngineInterface, percent: number) {
  const nudged = await read($, contextNudge)
  if (percent < NUDGE_PERCENT) {
    if (nudged !== null) await update($, contextNudge, () => null)
  } else {
    if (nudged === null) $.ui.toast(`Context at ${percent}%: time to /handoff`, { timeoutMs: 30_000 })
    if (nudged !== percent) await update($, contextNudge, () => percent)
  }
}

export async function clearContext($: EngineInterface) {
  await update($, contextNudge, () => null)
}

export function currentNudge($: EngineInterface) {
  return read($, contextNudge)
}

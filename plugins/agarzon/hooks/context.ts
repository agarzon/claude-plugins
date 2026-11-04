import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ContextFill } from '../types'
import { contextLimitTokens } from './options'
import { play } from './sounds'

const contextFill = atom({ plugin: 'agarzon', key: 'contextFill' } as const, null as ContextFill | null)

const BAR_WIDTH = 8

export const HANDOFF_COMMAND = 'agarzon:handoff'

export async function measureContext($: EngineInterface, tokens: number, window: number) {
  const limit = contextLimitTokens()
  const before = (await read($, contextFill))?.tokens
  if (tokens >= limit && (before === undefined || before < limit)) {
    $.ui.toast(`Context at ${Math.round(tokens / 1000)}k: time to /${HANDOFF_COMMAND}`, { timeoutMs: 30_000 })
    void play($, 'contextLimit')
  }
  await update($, contextFill, () => ({ tokens, window }))
}

export async function clearContext($: EngineInterface) {
  await update($, contextFill, () => null)
}

export async function readContext($: EngineInterface) {
  const fill = await read($, contextFill)
  if (fill === null) return null
  const { tokens, window } = fill
  const limit = contextLimitTokens()
  const tone = tokens >= limit ? 'error' : tokens >= limit / 2 ? 'warning' : 'success'
  const filled = Math.min(BAR_WIDTH, Math.floor((tokens / window) * BAR_WIDTH))
  return { k: Math.round(tokens / 1000), bar: '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled), tone, isOverLimit: tokens >= limit } as const
}

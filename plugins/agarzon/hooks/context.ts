import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ContextFill, ContextView } from '../types'
import { contextLimitTokens } from './options'
import { play } from './sounds'

const contextFill = atom({ plugin: 'agarzon', key: 'contextFill' } as const, null as ContextFill | null)
const contextView = atom({ plugin: 'agarzon', key: 'contextView' } as const, null as ContextView | null)

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

export async function refreshBreakdown($: EngineInterface) {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (b === undefined) return
  const servers = new Map<string, number>()
  for (const tool of b.mcpTools) servers.set(tool.serverName, (servers.get(tool.serverName) ?? 0) + tool.tokens)
  const view: ContextView = {
    total: b.totalTokens,
    max: b.rawMaxTokens,
    categories: b.categories.filter(c => c.kind === 'used' && c.tokens > 0).map(c => ({ name: c.name, tokens: c.tokens })),
    memory: b.memoryFiles.map(f => ({ name: f.path, tokens: f.tokens })),
    mcp: [...servers].map(([name, tokens]) => ({ name, tokens })).sort((x, y) => y.tokens - x.tokens),
  }
  await update($, contextView, () => view)
}

export function readBreakdown($: EngineInterface) {
  return read($, contextView)
}

export async function clearContext($: EngineInterface) {
  await update($, contextFill, () => null)
  await update($, contextView, () => null)
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

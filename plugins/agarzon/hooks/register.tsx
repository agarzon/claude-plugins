import type { Register } from 'claude-code'

import { installBand } from './band'
import { clearCache, completeCache, markBusy, startCache } from './cache'
import { clearContext, measureContext } from './context'
import { loadStyle, noteStyle } from './controls'
import { acceptHandoff, HANDOFF_TOOL, registerHandoffTool, renameIfHandedOff } from './handoff'
import { clearSkills, refreshLedger, startSkills } from './skills'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerHandoffTool($)
    startCache($)
    await loadStyle($)
    await startSkills($)
    return next(e)
  })

  on('tool.call', { tool: HANDOFF_TOOL }, async ($, e) => acceptHandoff($, e as Record<string, unknown>))

  on('turn.start', async ($, e, next) => {
    await markBusy($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await completeCache($, Boolean(e.usage))
      await refreshLedger($)
      await renameIfHandedOff($)
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.context.percent !== undefined && e.changed.includes('context')) await measureContext($, e.context.percent)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await clearCache($)
      await clearContext($)
      await clearSkills($)
    }
    return next(e)
  })

  on('config.set', { key: 'outputStyle' }, async ($, e, next) => {
    const result = await next(e)
    if ('value' in result) await noteStyle($, result.value)
    return result
  })

  installBand(on)
}

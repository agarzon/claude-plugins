import type { Register } from 'claude-code'

import { AUTO_HANDOFF_DECLINE, clearAutoHandoff, isAutoHandoffRunning, noteHandoffCommand, noteTurnEnd, noteTurnStart, startAutoHandoff } from './autohandoff'
import { installBand } from './band'
import { clearCache, completeCache, guardColdSend, markBusy, noteRequest, startCache } from './cache'
import { clearContext, HANDOFF_COMMAND, measureContext } from './context'
import { loadStyle, noteStyle } from './controls'
import { acceptHandoff, HANDOFF_TOOL, registerHandoffTool, renameIfHandedOff } from './handoff'
import { afterCommand, refreshGit, startGit } from './git'
import { measureLimits } from './limits'
import { applyOverrides, noteServed } from './models'
import { clearRail, installRail } from './rail'
import { setOptions, turnSoundMs } from './options'
import { clearSkills, guardSkill, loadingInMain, refreshLedger, startSkills } from './skills'
import { play, SOUNDS_COMMAND, soundsCommand, startSounds } from './sounds'
import { clearWarm, noteActivity, startWarm, WARM_COMMAND, warmCommand } from './warm'

export const register: Register = (on, options) => {
  setOptions(options)

  on('session.start', async ($, e, next) => {
    await registerHandoffTool($)
    await startSounds($, e.isInteractive)
    await $.command.register({ name: SOUNDS_COMMAND, description: 'Mute or unmute agarzon sounds: /sounds [on|off] or /sounds <event> on|off' })
    await $.command.register({ name: WARM_COMMAND, description: 'Keep the prompt cache warm while you are away: /warm, /warm 90m, /warm off' })
    startCache($)
    startWarm($)
    startAutoHandoff($)
    await startGit($)
    await loadStyle($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.transcript_path) await startSkills($, e.transcript_path)
    return next(e)
  })

  on('tool.call', { tool: HANDOFF_TOOL }, async ($, e) => acceptHandoff($, e as Record<string, unknown>))

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog') void play($, 'needsYou')
    return next(e)
  })

  on('command.run', { command: SOUNDS_COMMAND }, async ($, e) => ({ text: await soundsCommand($, e.args) }))

  on('command.run', { command: WARM_COMMAND }, async ($, e) => ({ text: await warmCommand($, e.args) }))

  on('prompt.submit', async ($, e, next) => {
    const drop = await guardColdSend($, e)
    if (drop !== null) return { drop }
    return e.command ? loadingInMain(e.command.name, () => next(e)) : next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await afterCommand($, e.command)
    return result
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => (e.agentId === undefined ? loadingInMain(e.skill, () => next(e)) : next(e)))

  on('skill.prompt', async ($, e, next) => {
    const pointer = await guardSkill($, e)
    return pointer === null ? next(e) : { text: pointer }
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) await clearSkills($)
    return result
  })

  on('command.run', { command: HANDOFF_COMMAND }, async ($, e, next) => {
    await noteHandoffCommand($)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    if (r.decision || e.agent_id || !(await isAutoHandoffRunning($))) return r
    return { ...r, decision: { behavior: 'deny', message: AUTO_HANDOFF_DECLINE } }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await markBusy($)
      await noteTurnStart($, e.turnId)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const result = yield* next(await applyOverrides($, e))
    await noteServed($, e, result)
    const u = result.usage
    if (e.agentId === undefined && u && u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) await noteRequest($, sentAt)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await completeCache($)
      void refreshGit($)
      await noteTurnEnd($, e.turnId)
      if (e.usage) await noteActivity($)
      await refreshLedger($)
      await renameIfHandedOff($)
      if (!e.isAborted && e.durationMs >= turnSoundMs()) void play($, 'turnDone')
    } else if (!e.isAborted && (await $.agent.list()).some(agent => agent.id === e.agentId)) {
      void play($, 'subagentDone')
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.context.tokens !== undefined && e.changed.includes('context')) await measureContext($, e.context.tokens, e.context.window)
    if (e.changed.includes('rateLimits')) await measureLimits($, e.rateLimits)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await clearCache($)
      await clearContext($)
      await clearSkills($)
      await clearRail($)
      await clearWarm($)
      await clearAutoHandoff($)
    }
    return next(e)
  })

  on('config.set', { key: 'outputStyle' }, async ($, e, next) => {
    const result = await next(e)
    if ('value' in result) await noteStyle($, result.value)
    return result
  })

  installRail(on)
  installBand(on)
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer, TurnStepInput, TurnStepResult } from 'claude-code'

import type { EffortLevel, Pending, ServedModel } from '../types'

import { readContext } from './context'
import { isOn } from './options'

const modelOverride = atom({ plugin: 'agarzon', key: 'modelOverride' } as const, null as string | null)
const effortOverride = atom({ plugin: 'agarzon', key: 'effortOverride' } as const, null as EffortLevel | null)
const servedModel = atom({ plugin: 'agarzon', key: 'servedModel' } as const, null as ServedModel | null)
const stepEffort = atom({ plugin: 'agarzon', key: 'stepEffort' } as const, null as string | null)
const modelPending = atom({ plugin: 'agarzon', key: 'modelPending' } as const, null as Pending<string> | null)
const effortPending = atom({ plugin: 'agarzon', key: 'effortPending' } as const, null as Pending<EffortLevel> | null)

const EFFORTS: (EffortLevel | null)[] = [null, 'low', 'medium', 'high', 'xhigh', 'max']
const SETTLE_MS = 1500
const SKIPPED = ['best', 'opusplan']

let settling: Timer | undefined

async function modelOptions($: EngineInterface) {
  const row = (await $.config.list()).find(r => r.key === 'model')
  return row?.kind === 'choice' ? (row.options ?? []).filter(name => !SKIPPED.includes(name)) : []
}

export async function cycleModel($: EngineInterface) {
  const options = await modelOptions($)
  if (options.length === 0) return
  const current = ((await read($, modelPending)) ?? { pick: await read($, modelOverride) }).pick ?? 'default'
  const picked = options[(options.indexOf(current) + 1) % options.length] ?? 'default'
  await update($, modelPending, () => ({ pick: picked === 'default' ? null : picked }))
  settle($)
}

export async function cycleEffort($: EngineInterface) {
  const current = ((await read($, effortPending)) ?? { pick: await read($, effortOverride) }).pick
  await update($, effortPending, () => ({ pick: EFFORTS[(EFFORTS.indexOf(current) + 1) % EFFORTS.length] ?? null }))
  settle($)
}

function settle($: EngineInterface) {
  settling?.cancel()
  settling = $.clock.after(SETTLE_MS, () => void applyPending($))
}

async function applyPending($: EngineInterface) {
  const [model, effort] = [await read($, modelPending), await read($, effortPending)]
  if (effort !== null) await update($, effortOverride, () => effort.pick)
  await update($, effortPending, () => null)
  if (model === null) return
  await update($, modelOverride, () => model.pick)
  await update($, modelPending, () => null)
  await warnRecache($)
}

async function warnRecache($: EngineInterface) {
  const context = await readContext($)
  const model = (await read($, modelOverride)) ?? 'the default model'
  const size = context === null ? 'the context' : `${context.k}k of context`
  $.ui.toast(`Next send uses ${model} and re-caches ${size}`)
}

export async function forkEffort($: EngineInterface) {
  const [level, sent] = [await read($, effortOverride), await read($, stepEffort)]
  return level === null || sent === null ? undefined : level
}

export async function applyOverrides($: EngineInterface, e: TurnStepInput) {
  if (e.agentId !== undefined || !isOn('models')) return e
  const effort = e.effort === undefined ? null : String(e.effort)
  if ((await read($, stepEffort)) !== effort) await update($, stepEffort, () => effort)
  const [model, level] = [await read($, modelOverride), await read($, effortOverride)]
  return { ...e, ...(model === null ? {} : { model }), ...(level === null || e.effort === undefined ? {} : { effort: level }) }
}

export async function noteServed($: EngineInterface, e: TurnStepInput, result: TurnStepResult) {
  if (e.agentId !== undefined || !result.usage) return
  const served = { id: result.usage.model, pick: await read($, modelOverride) }
  const before = await read($, servedModel)
  if (before?.id !== served.id || before.pick !== served.pick) await update($, servedModel, () => served)
}

const version = (id: string) => id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, '-$1.$2')

function modelLabel(pick: string | null, served: ServedModel | null) {
  if (served !== null && served.pick === pick) return `${version(served.id)}${pick?.endsWith('[1m]') ? ' 1m' : ''}`
  if (served === null && pick === null) return 'model'
  return `${pick ?? 'default'}?`
}

export async function currentModels($: EngineInterface) {
  const [model, effort, served, seenEffort, nextModel, nextEffort] = await Promise.all([read($, modelOverride), read($, effortOverride), read($, servedModel), read($, stepEffort), read($, modelPending), read($, effortPending)])
  return {
    model: nextModel === null ? modelLabel(model, served) : `${nextModel.pick ?? 'default'}…`,
    effort: nextEffort === null ? effort ?? seenEffort ?? 'effort' : `${nextEffort.pick ?? seenEffort ?? 'effort'}…`,
  }
}

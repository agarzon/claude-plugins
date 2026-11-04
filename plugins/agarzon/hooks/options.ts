import type { PluginOptions } from 'claude-code'

const SOUND_OPTIONS = {
  turnDone: 'soundTurnDone',
  needsYou: 'soundNeedsYou',
  subagentDone: 'soundSubagentDone',
  cacheExpiring: 'soundCacheExpiring',
  contextLimit: 'soundContextLimit',
  cacheCold: 'soundCacheCold',
} as const

export type SoundEvent = keyof typeof SOUND_OPTIONS
export const SOUND_EVENTS = Object.keys(SOUND_OPTIONS) as SoundEvent[]

const FEATURE_OPTIONS = {
  rail: 'showPromptRail',
  models: 'showModelButtons',
  limits: 'showUsageLimits',
  context: 'showContext',
  cache: 'showCache',
  skills: 'showLoadedSkills',
  cacheGuard: 'guardColdSend',
  keepWarm: 'keepWarm',
  autoHandoff: 'autoHandoff',
  skillGuard: 'skillGuard',
  soundButton: 'showSoundButton',
  git: 'showGitRow',
} as const

export type Feature = keyof typeof FEATURE_OPTIONS

let current: PluginOptions = {}

export function setOptions(options: PluginOptions) {
  current = options
}

export const soundFile = (event: SoundEvent) => String(current[SOUND_OPTIONS[event]]).trim()
export const turnSoundMs = () => Number(current.turnSoundSeconds) * 1000
export const limitPercents = () => ({ orange: Number(current.limitOrangePercent), red: Number(current.limitRedPercent) })
export const warmAfterMs = () => Number(current.keepWarmAfterMin) * 60_000
export const guardFloorTokens = () => Number(current.guardColdSendMinK) * 1000
export const contextLimitTokens = () => Number(current.contextLimitK) * 1000
export const isOn = (feature: Feature) => current[FEATURE_OPTIONS[feature]] !== false

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Platform } from '../types'
import { SOUND_EVENTS, soundFile, type SoundEvent } from './options'

export const SOUNDS_COMMAND = 'sounds'

const isInteractive = atom({ plugin: 'agarzon', key: 'isInteractive' } as const, false)
const platform = atom({ plugin: 'agarzon', key: 'platform' } as const, null as Platform | null)
const muted = atom({ plugin: 'agarzon', key: 'soundsMuted' } as const, [] as string[])

const MUTED_KEY = 'sounds-muted'
const ALL_SOUNDS = 'all'

async function detectPlatform($: EngineInterface): Promise<Platform> {
  if (await $.env.get('WSL_DISTRO_NAME')) return 'wsl'
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  const ran = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => null)
  return ran?.stdout.trim() === 'Darwin' ? 'macos' : 'linux'
}

export async function startSounds($: EngineInterface, interactive: boolean) {
  await update($, isInteractive, () => interactive)
  const os = await detectPlatform($)
  await update($, platform, () => os)
  const stored = await $.store.get(MUTED_KEY)
  await update($, muted, () => (Array.isArray(stored) ? stored.map(String) : []))
}

function isAbsolute(path: string) {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

async function playFile($: EngineInterface, os: Platform, path: string) {
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 10_000 })
  if (os === 'macos') return run(['afplay', path])
  if (os === 'linux') {
    const pulse = await run(['paplay', path]).catch(() => null)
    return pulse?.exitCode === 0 ? pulse : run(['aplay', '-q', path])
  }
  const winPath = os === 'wsl' ? (await run(['wslpath', '-w', path])).stdout.trim() : path
  return run(['powershell.exe', '-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${winPath.replace(/'/g, "''")}').PlaySync()`])
}

export async function play($: EngineInterface, event: SoundEvent) {
  const [interactive, os, off] = await Promise.all([read($, isInteractive), read($, platform), read($, muted)])
  const choice = soundFile(event)
  if (!interactive || os === null || choice === '' || off.includes(ALL_SOUNDS) || off.includes(event)) return
  const isBundled = !isAbsolute(choice)
  try {
    if (isBundled && os === 'macos') await $.audio.play({ asset: `sounds/${choice}.wav` })
    else await playFile($, os, isBundled ? `${$.plugin.root}/sounds/${choice}.wav` : choice)
  } catch {
    // A missing player or file must never fail the hook that rang.
  }
}

async function setMuted($: EngineInterface, name: string, isOff: boolean) {
  const next = [...(await read($, muted)).filter(item => item !== name), ...(isOff ? [name] : [])]
  await update($, muted, () => next)
  await $.store.set(MUTED_KEY, next)
}

export async function soundsCommand($: EngineInterface, args: string) {
  const [first = '', second = ''] = args.trim().split(/\s+/)
  const isSwitch = (word: string) => word === 'on' || word === 'off'
  if (isSwitch(first)) await setMuted($, ALL_SOUNDS, first === 'off')
  else if ((SOUND_EVENTS as string[]).includes(first) && isSwitch(second)) await setMuted($, first, second === 'off')
  else if (first !== '') return `Usage: /sounds [on|off], or /sounds <event> on|off. Events: ${SOUND_EVENTS.join(', ')}`
  const off = await read($, muted)
  const rows = SOUND_EVENTS.map(event => {
    const file = soundFile(event)
    return `${event.padEnd(14)} ${off.includes(event) || file === '' ? 'off' : 'on '}  ${file || '(no file)'}`
  })
  return [`Sounds ${off.includes(ALL_SOUNDS) ? 'muted' : 'on'}.`, ...rows, 'Files: /config → agarzon, a bundled name or an absolute .wav path.'].join('\n')
}

export async function isMuted($: EngineInterface) {
  return (await read($, muted)).includes(ALL_SOUNDS)
}

export async function toggleAllSounds($: EngineInterface) {
  await setMuted($, ALL_SOUNDS, !(await read($, muted)).includes(ALL_SOUNDS))
}

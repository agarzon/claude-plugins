import { atom, read, update } from 'claude-code'
import type { EngineInterface, SkillPromptInput } from 'claude-code'

import type { LedgerItem } from '../types'
import { isOn } from './options'

const transcriptPath = atom({ plugin: 'agarzon', key: 'transcriptPath' } as const, null)
const ledger = atom({ plugin: 'agarzon', key: 'ledger' } as const, [] as LedgerItem[])
const loaded = atom({ plugin: 'agarzon', key: 'skillsLoaded' } as const, [] as string[])

const BIG_TOKENS = 8000
const mainLoads = new Set<string>()

const bare = (name: string) => name.split(':').pop() ?? name
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const skillKey = (e: SkillPromptInput) => (e.path ? folderOf(e.path) : e.pluginName ? `${e.pluginName}:${bare(e.skill)}` : e.skill)

const SKILL_MARK = 'Base directory for this skill: '

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : String((part as { text?: unknown }).text ?? ''))).join('\n')
  return ''
}

export function parseLedger(transcript: string): LedgerItem[] {
  let items = new Map<string, LedgerItem>()
  for (const line of transcript.split('\n')) {
    if (!line.includes(SKILL_MARK) && !line.includes('compact_boundary')) continue
    let entry: { type?: string; subtype?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      items = new Map()
    } else if (entry.type === 'user' && entry.isMeta) {
      const text = textOf(entry.message?.content)
      if (!text.startsWith(SKILL_MARK)) continue
      const folder = text.slice(SKILL_MARK.length).split('\n')[0]!
      const item = items.get(folder) ?? { folder, tokens: 0, count: 0 }
      items.set(folder, { folder, tokens: item.tokens + Math.round(text.length / 4), count: item.count + 1 })
    }
  }
  return [...items.values()]
}

export async function refreshLedger($: EngineInterface) {
  const path = await read($, transcriptPath)
  if (path === null) return
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string') return
  const items = parseLedger(text)
  await update($, ledger, () => items)
}

export async function startSkills($: EngineInterface, path: string) {
  await update($, transcriptPath, () => path)
  await refreshLedger($)
}

export async function clearSkills($: EngineInterface) {
  await update($, ledger, () => [])
  await update($, loaded, () => [])
}

export async function loadingInMain<T>(name: string, load: () => Promise<T>) {
  mainLoads.add(bare(name))
  try {
    return await load()
  } finally {
    mainLoads.delete(bare(name))
  }
}

export async function guardSkill($: EngineInterface, e: SkillPromptInput) {
  const name = bare(e.skill)
  if (!isOn('skillGuard') || !mainLoads.has(name)) return null
  const key = skillKey(e)
  const k = (e.text.length / 4000).toFixed(1)
  const inLedger = (await read($, ledger)).some(item => item.folder === key)
  if (inLedger || (await read($, loaded)).includes(key)) {
    $.ui.toast(`Skipped a second copy of ${name} (~${k}k tokens): it is still in context.`)
    return `The ${name} skill is already loaded earlier in this conversation. Follow the instructions from that copy; this second copy was skipped to save ~${k}k tokens of context.`
  }
  await update($, loaded, keys => [...keys, key])
  if (e.text.length / 4 >= BIG_TOKENS) $.ui.toast(`${name} loaded: ~${k}k tokens of context.`)
  return null
}

export function loadedItems($: EngineInterface) {
  return read($, ledger)
}

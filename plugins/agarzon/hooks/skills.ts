import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LedgerItem } from '../types'

const transcriptDir = atom({ plugin: 'agarzon', key: 'transcriptDir' } as const, null)
const ledger = atom({ plugin: 'agarzon', key: 'ledger' } as const, [] as LedgerItem[])

const SKILL_MARK = 'Base directory for this skill: '

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : String((part as { text?: unknown }).text ?? ''))).join('\n')
  return ''
}

function hookLabel(text: string, plugins: string[]) {
  const lower = text.replace(/\S*\/\S*/g, ' ').toLowerCase()
  const hits = plugins.map(name => [name, lower.indexOf(name.toLowerCase())] as const).filter(([, at]) => at >= 0)
  if (hits.length) return hits.sort((a, b) => a[1] - b[1])[0]![0]
  const line = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.replace(/<[^>]+>/g, '').trim())
    .find(l => l && !l.startsWith('Output too large') && !l.startsWith('Preview')) ?? 'hook'
  return line.length > 28 ? line.slice(0, 27) + '…' : line
}

function hookChars(text: string) {
  const persisted = /Output too large \(([\d.]+)KB\)/.exec(text)
  return persisted ? Number(persisted[1]) * 1024 : text.length
}

export function parseLedger(transcript: string, plugins: string[]): LedgerItem[] {
  let items = new Map<string, LedgerItem>()
  const add = (name: string, kind: LedgerItem['kind'], chars: number) => {
    const item = items.get(`${kind}:${name}`) ?? { name, kind, tokens: 0, count: 0 }
    items.set(`${kind}:${name}`, { ...item, tokens: item.tokens + Math.round(chars / 4), count: item.count + 1 })
  }
  for (const line of transcript.split('\n')) {
    if (!line.includes(SKILL_MARK) && !line.includes('"hook_') && !line.includes('compact_boundary')) continue
    let entry: { type?: string; subtype?: string; isMeta?: boolean; message?: { content?: unknown }; attachment?: { type?: string; content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      items = new Map()
    } else if (entry.type === 'user' && entry.isMeta) {
      const text = textOf(entry.message?.content)
      if (text.startsWith(SKILL_MARK)) add(text.slice(SKILL_MARK.length).split('\n')[0]!.split('/').pop() ?? '?', 'skill', text.length)
    } else if (/^hook_(success|additional_context|system_message)$/.test(entry.attachment?.type ?? '')) {
      const text = textOf(entry.attachment?.content)
      if (text.trim()) add(hookLabel(text, plugins), 'hook', hookChars(text))
    }
  }
  return [...items.values()]
}

export async function refreshLedger($: EngineInterface) {
  const dir = await read($, transcriptDir)
  if (dir === null) return
  const text = await $.fs.read(`${dir}/${await $.session.id()}.jsonl`).catch(() => null)
  if (typeof text !== 'string') return
  const plugins = Object.keys((await $.settings.read()).enabledPlugins ?? {}).map(key => key.split('@')[0]!)
  const items = parseLedger(text, plugins)
  await update($, ledger, () => items)
}

export async function startSkills($: EngineInterface) {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  const projectDir = `${configDir}/projects/${(await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')}`
  await update($, transcriptDir, () => projectDir)
  await refreshLedger($)
}

export async function clearSkills($: EngineInterface) {
  await update($, ledger, () => [])
}

export function loadedItems($: EngineInterface) {
  return read($, ledger)
}

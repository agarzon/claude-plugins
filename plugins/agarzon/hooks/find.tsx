import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionMessage } from 'claude-code'

import type { FindKind, FindSearch } from '../types'
import { PROVISIONAL_ID } from './rail'

const search = atom({ plugin: 'agarzon', key: 'findSearch' } as const, { text: '', kind: 'all' } as FindSearch)

const MAX_HITS = 50
const LEAD = 12
const FILTERS: { kind: FindKind; label: string }[] = [
  { kind: 'all', label: 'all' },
  { kind: 'you', label: 'you' },
  { kind: 'claude', label: 'Claude' },
  { kind: 'tools', label: 'tools' },
]

type Hit = { rowId: string | undefined; label: string }
type Ui = ReturnType<EngineInterface['ui']['resolve']>

// session.messages carries no row ids, so message rows are remembered as they draw and matched by text.
const rows = new Map<string, string>()

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

function noteRow(requestId: string, text: string) {
  if (requestId !== PROVISIONAL_ID) rows.set(requestId, flat(text))
}

function snippet(text: string, at: number, width: number) {
  const start = at > LEAD ? at - LEAD : 0
  const prefix = start > 0 ? '…' : ''
  const chars = Array.from(text.slice(start, start + width * 2).replace(/^[\uDC00-\uDFFF]/, ''))
  const room = width - prefix.length
  return prefix + (chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : chars.join(''))
}

export function findHits(messages: SessionMessage[], rowTexts: Map<string, string>, { text, kind }: FindSearch, width: number) {
  const needle = flat(text).toLowerCase()
  const idsByText = new Map<string, string[]>()
  for (const [id, rowText] of rowTexts) idsByText.set(rowText, [...(idsByText.get(rowText) ?? []), id])
  const hits: Hit[] = []
  const add = (tag: string, body: string, rowId: string | undefined) => {
    const at = body.toLowerCase().indexOf(needle)
    if (at >= 0) hits.push({ rowId, label: `${tag} ${snippet(body, at, width - tag.length - 1)}` })
  }
  for (const message of messages) {
    const body = flat(message.text)
    const rowId = body ? idsByText.get(body)?.shift() : undefined
    if (body && (kind === 'all' || kind === (message.role === 'user' ? 'you' : 'claude'))) add(message.role === 'user' ? 'you' : 'Claude', body, rowId)
    if (kind !== 'all' && kind !== 'tools') continue
    for (const use of message.toolUses) add(use.tool, flat(`${JSON.stringify(use.input)} ${use.text ?? ''}`), use.tool_use_id)
  }
  return hits.reverse()
}

async function jump($: EngineInterface, rowId: string | undefined) {
  if (rowId === undefined) {
    $.ui.toast('That message is not in the transcript view.')
    return
  }
  const result = await $.ui.scroll({ to: { requestId: rowId }, block: 'start' }).catch((error: unknown) => ({ deny: String(error) }))
  if ('deny' in result && result.deny) $.ui.toast(`Not reachable: ${result.deny}`)
}

export async function setFindText($: EngineInterface, text: string) {
  await update($, search, current => ({ ...current, text }))
}

export async function clearFind($: EngineInterface) {
  rows.clear()
  await update($, search, () => ({ text: '', kind: 'all' }))
}

export async function findTab($: EngineInterface, ui: Ui, columns: number) {
  const current = await read($, search)
  const hits = current.text.trim() ? findHits(await $.session.messages(), rows, current, columns - 2) : null
  return (
    <ui.Box flexDirection="column">
      <ui.Input key="find-query" placeholder="search this session" value={current.text} submitLabel="search" autoFocus onSubmit={text => void setFindText($, text)} />
      <ui.Box flexDirection="row" gap={1}>
        {FILTERS.map(({ kind, label }) => (
          <ui.Button key={`find-filter-${kind}`} plain label={kind === current.kind ? `[${label}]` : label} onPress={() => void update($, search, now => ({ ...now, kind }))} />
        ))}
      </ui.Box>
      {hits === null ? <ui.Text dimColor>Type, then Enter. Click a result to jump to it.</ui.Text> : null}
      {hits?.length === 0 ? <ui.Text dimColor>No matches.</ui.Text> : null}
      {hits !== null && hits.length > MAX_HITS ? <ui.Text dimColor>Newest {MAX_HITS} of {hits.length} matches.</ui.Text> : null}
      {hits?.slice(0, MAX_HITS).map((hit, index) => (
        <ui.Button key={`find-hit-${index}`} plain label={hit.label} onPress={() => jump($, hit.rowId)} />
      ))}
    </ui.Box>
  )
}

export function installFind(on: On) {
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    noteRow(e.requestId, e.props.text)
    return next(e)
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    noteRow(e.requestId, e.props.text)
    return next(e)
  })
}

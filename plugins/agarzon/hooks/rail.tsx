import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { RailPrompt } from '../types'

const prompts = atom({ plugin: 'agarzon', key: 'railPrompts' } as const, [] as RailPrompt[])
const cursor = atom({ plugin: 'agarzon', key: 'railCursor' } as const, null as number | null)

const PAGE = 9
const NARROW_COLUMNS = 70
const PROMPT_KINDS = new Set(['composer', 'bridge', 'sdk'])
export const PROVISIONAL_ID = 'placeholder'
const INTERRUPTED = /^\[Request interrupted by user/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Claude Code splits one message into several rows whose ids share the message id's first 24 characters.
const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)
const seen = new Set<string>()

async function record($: EngineInterface, requestId: string, text: string) {
  if ((await read($, prompts)).some(p => rowKey(p.requestId) === rowKey(requestId))) return
  await update($, prompts, list => [...list, { requestId, text }])
  await update($, cursor, () => null)
}

export function installRail(on: On) {
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const text = e.props.text.trim()
    const key = rowKey(e.requestId)
    if (PROMPT_KINDS.has(e.props.origin.kind) && e.requestId !== PROVISIONAL_ID && text && !text.startsWith('/') && !INTERRUPTED.test(text) && !seen.has(key)) {
      seen.add(key)
      $.clock.after(0, () => void record($, e.requestId, text))
    }
    return next(e)
  })
}

export async function clearRail($: EngineInterface) {
  seen.clear()
  await update($, prompts, () => [])
  await update($, cursor, () => null)
}

async function jump($: EngineInterface, index: number, requestId: string | undefined) {
  if (requestId === undefined) return
  const result = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch((error: unknown) => ({ deny: String(error) }))
  await update($, cursor, () => index)
  if ('deny' in result && result.deny) $.ui.toast(`Prompt ${index + 1} not reachable: ${result.deny}`)
}

export async function readRail($: EngineInterface) {
  const [list, at] = await Promise.all([read($, prompts), read($, cursor)])
  if (list.length === 0) return null
  const current = at ?? list.length - 1
  const start = Math.max(0, Math.min(current - Math.floor(PAGE / 2), list.length - PAGE))
  const page = list.slice(start, start + PAGE).map((p, i) => ({ index: start + i, preview: p.text.split('\n')[0] ?? '' }))
  return { current, total: list.length, page, jump: (index: number) => jump($, index, list[index]?.requestId) }
}

type Rail = NonNullable<Awaited<ReturnType<typeof readRail>>>
type Elements = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Button' | 'Text'>

export function RailRow({ rail, columns, ui: { Box, Button, Text } }: { rail: Rail; columns: number; ui: Elements }) {
  const { current, total, page, jump } = rail
  const prev = <Button key="rail-prev" plain label="‹" dimColor={current === 0} onPress={() => jump(current - 1)} />
  const next = <Button key="rail-next" plain label="›" dimColor={current === total - 1} onPress={() => jump(current + 1)} />
  const count = <Text dimColor>{current + 1}/{total}</Text>
  if (columns < NARROW_COLUMNS) {
    return <Box flexDirection="row" gap={1}>{prev}{count}{next}</Box>
  }
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>prompts</Text>
      {prev}
      {page.map(({ index }) => (
        <Box key={`rail-chip-${index}`} hover={{ scope: `rail-${index}` }}>
          <Button key={`rail-${index}`} plain label={index === current ? `[${index + 1}]` : `${index + 1}`} onPress={() => jump(index)} />
        </Box>
      ))}
      {next}
      {count}
      {page.map(({ index, preview }) => (
        <Box key={`rail-preview-${index}`} display="none" flexShrink={1} hover={{ scope: `rail-${index}`, display: 'flex' }}>
          <Text dimColor wrap="truncate-end">{preview}</Text>
        </Box>
      ))}
    </Box>
  )
}

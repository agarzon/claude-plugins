import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

const style = atom({ plugin: 'agarzon', key: 'style' } as const, null)


async function readStyle($: EngineInterface) {
  return (await $.config.list()).find(row => row.key === 'outputStyle')
}

export async function cycleStyle($: EngineInterface) {
  const row = await readStyle($)
  if (!row || row.kind !== 'choice') return
  const options = row.options ?? []
  const value = options[(options.indexOf(String(row.value)) + 1) % options.length]
  if (value === undefined) return
  const result = await $.config.set({ key: 'outputStyle', value })
  if ('deny' in result && result.deny) $.ui.toast(`Output style not changed: ${result.deny}`)
  else await update($, style, () => value)
}

export async function loadStyle($: EngineInterface) {
  const row = await readStyle($)
  await update($, style, () => (row ? String(row.value) : null))
}

export async function noteStyle($: EngineInterface, value: unknown) {
  await update($, style, () => String(value))
}

export function currentStyle($: EngineInterface) {
  return read($, style)
}

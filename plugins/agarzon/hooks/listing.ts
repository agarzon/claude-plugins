import type { EngineInterface } from 'claude-code'

import { isOn } from './options'

const DENIED_SKILL = /^Skill\(([^)\s]+)\)$/
const ENTRY = /^- (\S+?):(?: |$)/

let hidden = new Set<string>()

export async function loadHiddenSkills($: EngineInterface) {
  const permissions = (await $.settings.read({ key: 'permissions' })) as { deny?: unknown } | undefined
  const deny: unknown[] = Array.isArray(permissions?.deny) ? permissions.deny : []
  hidden = new Set(deny.flatMap(rule => (typeof rule === 'string' ? (DENIED_SKILL.exec(rule)?.[1] ?? []) : [])))
}

export function hideSkills(listing: string, names: ReadonlySet<string>) {
  let isHidden = false
  return listing
    .split('\n')
    .filter(line => {
      const entry = ENTRY.exec(line)
      if (entry) isHidden = names.has(entry[1]!)
      else if (line.trim() === '') isHidden = false
      return !isHidden
    })
    .join('\n')
}

export function filterListing(text: string) {
  return isOn('hideDeniedSkills') && hidden.size > 0 ? hideSkills(text, hidden) : text
}

export function hiddenCount() {
  return hidden.size
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

const pendingHandoff = atom({ plugin: 'agarzon', key: 'pendingHandoff' } as const, null)


export const HANDOFF_TOOL = 'mcp__agarzon__handoff_ready'

function checkName(name: unknown) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(name) ? name : null
}

export async function registerHandoffTool($: EngineInterface) {
  await $.tool.register({
    name: 'handoff_ready',
    description: 'Call at the end of a handoff. Renames this session when the turn ends.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'kebab-case name for the session that is ending' },
      },
      required: ['name'],
    },
  })
}

export async function acceptHandoff($: EngineInterface, input: Record<string, unknown>) {
  const name = checkName(input.name)
  if (name === null) return { deny: 'name must be kebab-case, up to 60 characters' }
  await update($, pendingHandoff, () => name)
  return { result: 'Handoff accepted: the session is renamed when this turn ends. End your turn now.' }
}

export async function renameIfHandedOff($: EngineInterface) {
  const name = await read($, pendingHandoff)
  if (!name) return
  await update($, pendingHandoff, () => null)
  $.clock.after(0, () => void $.command.run({ command: 'rename', args: name }))
}

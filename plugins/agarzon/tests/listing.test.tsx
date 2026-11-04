import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hideSkills } from '../hooks/listing'
import { world } from './world'

const LISTING = [
  'The following skills are available for use with the Skill tool:',
  '',
  '- skill-creator:skill-creator: Create new skills.',
  '- claude-mem:babysit: Watch a pull request.',
  '- claude-api: Reference for the Claude API.',
  'TRIGGER — read BEFORE opening the target file.',
  '- claude-mem:do: Execute a plan.',
  '- agarzon:handoff: Close the session.',
].join('\n')

test('denied skills and their continuation lines leave the listing; the rest stays as written', () => {
  expect(hideSkills(LISTING, new Set(['claude-mem:babysit', 'claude-api', 'claude-mem:do']))).toBe([
    'The following skills are available for use with the Skill tool:',
    '',
    '- skill-creator:skill-creator: Create new skills.',
    '- agarzon:handoff: Close the session.',
  ].join('\n'))
})

async function listingSeen($: Engine, on: On) {
  const { settings } = world(on, {})
  settings.deny = ['Skill(claude-mem:babysit)', 'Bash(rm -rf*)', 'Skill(claude-mem:do)']
  let seen = ''
  on('prompt.attachment', (_$, e) => {
    seen = e.text
    return { text: e.text }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } } as never)
  return seen
}

test('the listing Claude reads leaves out every skill a Skill(...) deny names', async ($, on) => {
  const seen = await listingSeen($, on)
  expect(seen).not.toContain('claude-mem:babysit')
  expect(seen).not.toContain('claude-mem:do')
  expect(seen).toContain('- claude-api: Reference')
  expect(seen).toContain('TRIGGER')
})

test('switched off, the listing is untouched', { options: { hideDeniedSkills: false } }, async ($, on) => {
  expect(await listingSeen($, on)).toBe(LISTING)
})

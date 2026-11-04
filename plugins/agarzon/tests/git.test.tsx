import { expect, test } from 'claude-code/testing'

import { BAND, MIN, world } from './world'
import { parseGitHub, parseGitLab, parseStatus } from '../hooks/git'

const start = { cwd: '/home/me/w', surface: 'terminal', isInteractive: true } as const
const STATUS = '# branch.oid abcdef1234\n# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b hooks/x.ts'
const DIRS = '/home/me/w/.git/worktrees/wt\n/home/me/w/.git\n/home/me/wt'

test('git status, diff and dirs parse into the row data', () => {
  expect(parseStatus(STATUS, ' 3 files changed, 12 insertions(+), 3 deletions(-)', DIRS)).toEqual({ branch: 'feat/x', isDirty: true, ahead: 2, behind: 1, added: 12, removed: 3, worktree: 'wt' })
  expect(parseStatus('# branch.oid abcdef1234\n# branch.head (detached)', '', '/a/.git\n/a/.git\n/a')).toEqual({ branch: 'abcdef1', isDirty: false, ahead: 0, behind: 0, added: 0, removed: 0, worktree: null })
})

test('open PRs and MRs parse with review tone and CI; closed ones are dropped', () => {
  expect(parseGitHub(JSON.stringify({ number: 11, state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }))).toEqual({ label: 'PR #11', tone: 'success', ci: '✓' })
  expect(parseGitHub(JSON.stringify({ number: 11, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ status: 'IN_PROGRESS' }, { conclusion: 'FAILURE' }] }))).toEqual({ label: 'PR #11', tone: 'error', ci: '✗' })
  expect(parseGitHub(JSON.stringify({ number: 11, state: 'MERGED' }))).toBeNull()
  expect(parseGitLab(JSON.stringify({ iid: 547, state: 'opened', detailed_merge_status: 'mergeable', head_pipeline: { status: 'running' } }))).toEqual({ label: 'MR !547', tone: 'success', ci: '⧗' })
  expect(parseGitLab(JSON.stringify({ iid: 547, state: 'merged' }))).toBeNull()
})

test('the row shows branch, changes, worktree, MR, folder, version and session time; glab for a non-GitHub remote', async ($, on) => {
  const { clock, repo } = world(on, { HOME: '/home/me' })
  Object.assign(repo, { status: STATUS, shortstat: ' 1 file changed, 12 insertions(+), 3 deletions(-)', dirs: DIRS, remote: 'git@gitlab.example.com:g/p.git', review: JSON.stringify({ iid: 5, state: 'opened', head_pipeline: { status: 'success' } }) })
  await $.session.start(start)
  await clock.advance(75 * MIN)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  const row = await ui.find({ type: 'Text', props: { wrap: 'truncate-end' } } as never)
  expect(row?.text).toBe('⎇ feat/x* (wt) ↑2 ↓1 +12 −3 │ MR !5 ✓ │ ~/w │ v2.1.318 │ 1h15m')
  expect(repo.runs).toContain('glab mr view feat/x --output json')
})

test('a git command in Bash refreshes the row; a push asks the forge again', async ($, on) => {
  const { clock, repo } = world(on, {})
  Object.assign(repo, { status: STATUS, remote: 'git@github.com:o/r.git', review: null })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' } }) as never)
  await $.session.start(start)
  await clock.settle()
  repo.runs.length = 0
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(repo.runs).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(repo.runs.some(r => r.startsWith('gh'))).toBe(false)
  expect(repo.runs.filter(r => r.startsWith('git status --porcelain=v2'))).toHaveLength(1)
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await clock.settle()
  expect(repo.runs.filter(r => r.startsWith('gh pr view'))).toHaveLength(1)
})

test('outside a repo only the folder, version and time show', async ($, on) => {
  world(on, {})
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'agarzon', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', props: { wrap: 'truncate-end' } } as never))?.text).toBe('/home/me/w │ v2.1.318 │ 0m')
})

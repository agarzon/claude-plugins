import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { GitInfo, ReviewInfo } from '../types'

const gitInfo = atom({ plugin: 'agarzon', key: 'gitInfo' } as const, null as GitInfo | null)
const review = atom({ plugin: 'agarzon', key: 'review' } as const, null as ReviewInfo | null)
const version = atom({ plugin: 'agarzon', key: 'version' } as const, null as string | null)
const startedAt = atom({ plugin: 'agarzon', key: 'startedAt' } as const, null as number | null)
const folder = atom({ plugin: 'agarzon', key: 'folder' } as const, null as string | null)

const REVIEW_EVERY_MS = 5 * 60_000
const GIT_COMMAND = /\b(git|gh|glab)\b/
const PUSHED = /\bgit\s+push\b|\bgh\s+pr\b|\bglab\s+mr\b/

async function run($: EngineInterface, cwd: string, argv: string[]) {
  const r = await $.process.run(argv, { cwd, timeoutMs: 15_000 }).catch(() => null)
  return r?.exitCode === 0 ? r.stdout.trim() : null
}

export function parseStatus(status: string, shortstat: string, dirs: string) {
  const head = /^# branch\.head (.+)$/m.exec(status)?.[1] ?? '?'
  const oid = /^# branch\.oid (\w{7})/m.exec(status)?.[1]
  const ab = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(status)
  const [gitDir, commonDir, top] = dirs.split('\n')
  return {
    branch: head === '(detached)' ? (oid ?? head) : head,
    isDirty: status.split('\n').some(line => line !== '' && !line.startsWith('#')),
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
    added: Number(/(\d+) insertion/.exec(shortstat)?.[1] ?? 0),
    removed: Number(/(\d+) deletion/.exec(shortstat)?.[1] ?? 0),
    worktree: gitDir && commonDir && gitDir !== commonDir ? (top?.split('/').pop() ?? null) : null,
  }
}

export async function refreshGit($: EngineInterface) {
  const [cwd, home] = await Promise.all([$.session.cwd(), $.env.get('HOME')])
  await update($, folder, () => (home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd))
  const [status, shortstat, dirs] = await Promise.all([
    run($, cwd, ['git', 'status', '--porcelain=v2', '--branch']),
    run($, cwd, ['git', 'diff', '--shortstat', 'HEAD']),
    run($, cwd, ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel']),
  ])
  await update($, gitInfo, () => (status === null ? null : parseStatus(status, shortstat ?? '', dirs ?? '')))
}

const ciMark = (status: string) => (/success|pass/i.test(status) ? '✓' : /fail|error|cancel|timed/i.test(status) ? '✗' : status ? '⧗' : '')

export function parseGitHub(json: string): ReviewInfo | null {
  const pr = JSON.parse(json) as { number: number; state: string; reviewDecision?: string; statusCheckRollup?: { conclusion?: string; status?: string; state?: string }[] }
  if (pr.state !== 'OPEN') return null
  const checks = (pr.statusCheckRollup ?? []).map(c => c.conclusion || c.state || c.status || 'pending')
  const ci = checks.length === 0 ? '' : checks.some(s => /fail|error|cancel|timed/i.test(s)) ? '✗' : checks.every(s => /success|neutral|skipped/i.test(s)) ? '✓' : '⧗'
  const tone = pr.reviewDecision === 'APPROVED' ? 'success' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'error' : null
  return { label: `PR #${pr.number}`, tone, ci }
}

export function parseGitLab(json: string): ReviewInfo | null {
  const mr = JSON.parse(json) as { iid: number; state: string; detailed_merge_status?: string; head_pipeline?: { status?: string } | null }
  if (mr.state !== 'opened') return null
  return { label: `MR !${mr.iid}`, tone: mr.detailed_merge_status === 'mergeable' ? 'success' : null, ci: ciMark(mr.head_pipeline?.status ?? '') }
}

export async function refreshReview($: EngineInterface) {
  const repo = await $.session.repo()
  const branch = (await read($, gitInfo))?.branch
  if (repo === null || repo.remote === null || branch === undefined) return update($, review, () => null)
  const cwd = await $.session.cwd()
  const isGitHub = /github\.com[:/]/.test(repo.remote)
  const json = isGitHub
    ? await run($, cwd, ['gh', 'pr', 'view', '--json', 'number,state,reviewDecision,statusCheckRollup'])
    : await run($, cwd, ['glab', 'mr', 'view', branch, '--output', 'json'])
  let found: ReviewInfo | null = null
  try {
    found = json === null ? null : isGitHub ? parseGitHub(json) : parseGitLab(json)
  } catch {
    found = null
  }
  await update($, review, () => found)
}

export async function startGit($: EngineInterface) {
  const [{ version: v }, usage] = await Promise.all([$.session.version(), $.session.usage()])
  await update($, version, () => v)
  await update($, startedAt, () => usage.startedAt)
  await refreshGit($)
  void refreshReview($)
  $.clock.every(REVIEW_EVERY_MS, () => void refreshReview($))
}

export async function afterCommand($: EngineInterface, command: string) {
  if (!GIT_COMMAND.test(command)) return
  await refreshGit($)
  if (PUSHED.test(command)) void refreshReview($)
}

export async function readGit($: EngineInterface) {
  const [info, pr, v, since, where] = await Promise.all([read($, gitInfo), read($, review), read($, version), read($, startedAt), read($, folder)])
  return { info, pr, version: v, startedAt: since, folder: where }
}

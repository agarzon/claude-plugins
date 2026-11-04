import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { GitFile, GitInfo, GitScope, ReviewInfo } from '../types'

const gitInfo = atom({ plugin: 'agarzon', key: 'gitInfo' } as const, null as GitInfo | null)
const review = atom({ plugin: 'agarzon', key: 'review' } as const, null as ReviewInfo | null)
const version = atom({ plugin: 'agarzon', key: 'version' } as const, null as string | null)
const startedAt = atom({ plugin: 'agarzon', key: 'startedAt' } as const, null as number | null)
const folder = atom({ plugin: 'agarzon', key: 'folder' } as const, null as string | null)
const gitRoot = atom({ plugin: 'agarzon', key: 'gitRoot' } as const, null as string | null)
const gitFiles = atom({ plugin: 'agarzon', key: 'gitFiles' } as const, [] as GitFile[])
const touched = atom({ plugin: 'agarzon', key: 'touched' } as const, [] as string[])
const scope = atom({ plugin: 'agarzon', key: 'gitScope' } as const, 'all' as GitScope)

const REVIEW_EVERY_MS = 5 * 60_000
const GIT_COMMAND = /\b(git|gh|glab)\b/
const PUSHED = /\bgit\s+push\b|\bgh\s+pr\b|\bglab\s+mr\b/

async function output($: EngineInterface, cwd: string, argv: string[]) {
  const r = await $.process.run(argv, { cwd, timeoutMs: 15_000 }).catch(() => null)
  return r?.exitCode === 0 ? r.stdout : null
}

async function run($: EngineInterface, cwd: string, argv: string[]) {
  return (await output($, cwd, argv))?.trim() ?? null
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

export function parseFiles(status: string, numstat: string): GitFile[] {
  const counts = new Map<string, [number | null, number | null]>()
  const stats = numstat.split('\0')
  for (let i = 0; i < stats.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(stats[i]!)
    if (!m) continue
    const path = m[3] === '' ? stats[(i += 2)] : m[3]
    if (path) counts.set(path, [m[1] === '-' ? null : Number(m[1]), m[2] === '-' ? null : Number(m[2])])
  }
  const files: GitFile[] = []
  const entries = status.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (/[RC]/.test(code)) i++
    const [added, removed] = counts.get(path) ?? [null, null]
    files.push({ path, status: code === '??' ? '?' : code.trim(), added, removed })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function refreshGit($: EngineInterface) {
  const [cwd, home] = await Promise.all([$.session.cwd(), $.env.get('HOME')])
  await update($, folder, () => (home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd))
  const [status, shortstat, dirs, changed, numstat] = await Promise.all([
    run($, cwd, ['git', 'status', '--porcelain=v2', '--branch']),
    run($, cwd, ['git', 'diff', '--shortstat', 'HEAD']),
    run($, cwd, ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel']),
    output($, cwd, ['git', 'status', '--porcelain=v1', '-z', '-uall']),
    output($, cwd, ['git', 'diff', 'HEAD', '--numstat', '-z']),
  ])
  await update($, gitInfo, () => (status === null ? null : parseStatus(status, shortstat ?? '', dirs ?? '')))
  await update($, gitRoot, () => (status === null ? null : (dirs?.split('\n')[2] ?? null)))
  await update($, gitFiles, () => (changed === null ? [] : parseFiles(changed, numstat ?? '')))
}

export async function noteTouched($: EngineInterface, path: string) {
  await update($, touched, paths => (paths.includes(path) ? paths : [...paths, path]))
  await refreshGit($)
}

export async function toggleScope($: EngineInterface) {
  await update($, scope, value => (value === 'all' ? 'session' : 'all'))
}

export async function clearGit($: EngineInterface) {
  await update($, touched, () => [])
}

export async function readFiles($: EngineInterface) {
  const [root, files, paths, view] = await Promise.all([read($, gitRoot), read($, gitFiles), read($, touched), read($, scope)])
  const mine = new Set(root === null ? [] : paths.filter(p => p.startsWith(`${root}/`)).map(p => p.slice(root.length + 1)))
  const rows = files.map(file => ({ ...file, isMine: mine.has(file.path) }))
  const committed = [...mine].filter(path => !files.some(file => file.path === path)).map(path => ({ path, status: '', added: null, removed: null, isMine: true }))
  return { root, scope: view, rows: view === 'all' ? rows : [...rows.filter(row => row.isMine), ...committed].sort((a, b) => a.path.localeCompare(b.path)) }
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

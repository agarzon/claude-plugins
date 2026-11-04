import type { EngineInterface } from 'claude-code'

import { AUTO_HANDOFF_DECLINE, isAutoHandoffRunning } from './autohandoff'
import { isOn } from './options'

export type Check = { label: string; argv: string[]; cwd?: string; isCount?: true }
export type Risk = { reason: string; checks: Check[]; note?: string }
type Where = { cwd?: string | null; host?: string }

const PROCEED = 'Proceed'
const CANCEL = 'Cancel'
const MAX_LINES = 8
const MAX_SHOWN_COMMAND = 300
const NO_PREVIEW = "can't preview: only the shell can resolve this path"

const PREFIXES = new Set(['sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'timeout', 'xargs', 'if', 'elif', 'else', 'then', 'while', 'until', 'do', '!', '{'])
const PREFIX_VALUE_FLAGS = new Set(['-u', '-g', '-h', '-p', '-n', '-I', '-L', '-P'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh'])
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3'])
const SSH_VALUE_FLAG = /^-[bcDEeFIiJLlmOoPpQRSWw]$/
const SHELL_ONLY_PATH = /[$`*?[\]{}]|^~[^/]/
const SQL_WIPE = /\b(?:drop\s+(?:table|database|schema)|truncate)\b/i
const MIGRATION = /^(?:(?:npx|bunx|pnpx|pnpm(?: exec)?|yarn|bundle exec|php|python3?)\s+)?(?:\S*\/)?(?:prisma (?:migrate (?:deploy|dev|reset)|db push)|supabase (?:db (?:reset|push)|migration up)|drizzle-kit (?:push|migrate)|knex migrate|sequelize(?:-cli)? db:migrate|(?:rails|rake) db:(?:migrate|reset|drop)|alembic (?:upgrade|downgrade)|typeorm migration:run|flyway (?:migrate|clean)|liquibase update|artisan (?:migrate(?!:status)|db:wipe)|manage\.py migrate)/
// A repo's core.fsmonitor is a program git runs on status: previews must not start code from a folder the command only names.
const GIT = ['git', '-c', 'core.fsmonitor=false', '--no-optional-locks']

function segments(command: string): string[][] {
  const result: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote = ''
  let isInBacktick = false
  let isRedirectTarget = false
  const endWord = () => {
    if (hasWord && !isRedirectTarget) words.push(word)
    if (hasWord) isRedirectTarget = false
    word = ''
    hasWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) result.push(words)
    words = []
    isRedirectTarget = false
  }
  const substitution = () => {
    word += '$'
    hasWord = true
    endSegment()
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    const following = command[i + 1]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"') word += command[++i] ?? ''
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      hasWord = true
    } else if (c === '\\') {
      if (following !== '\n') {
        word += following ?? ''
        hasWord = true
      }
      i++
    } else if (c === '#' && !hasWord) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (c === '$' && following === '(') {
      i++
      substitution()
    } else if (c === '`') {
      if (isInBacktick) endSegment()
      else substitution()
      isInBacktick = !isInBacktick
    } else if (c === '>' || c === '<' || (c === '&' && following === '>')) {
      if (/^\d+$/.test(word)) {
        word = ''
        hasWord = false
      } else endWord()
      while (i + 1 < command.length && '<>&'.includes(command[i + 1]!)) i++
      isRedirectTarget = true
    } else if (';|&\n()'.includes(c)) {
      endSegment()
    } else if (/\s/.test(c)) {
      endWord()
    } else {
      word += c
      hasWord = true
    }
  }
  endSegment()
  return result
}

function stripPrefixes(words: string[]) {
  let rest = words
  while (rest[0] !== undefined) {
    const first = rest[0]
    if (/^\w+=/.test(first)) {
      rest = rest.slice(1)
      continue
    }
    if (!PREFIXES.has(first)) break
    rest = rest.slice(1)
    while (rest[0]?.startsWith('-')) rest = rest.slice(PREFIX_VALUE_FLAGS.has(rest[0]) ? 2 : 1)
    if (first === 'timeout') rest = rest.slice(1)
  }
  return rest
}

function expandHome(path: string, home: string) {
  return path.replace(/^~(?=\/|$)/, home)
}

function resolveDir(dir: string, from: string | null | undefined, home: string) {
  const expanded = expandHome(dir, home)
  if (from === null || SHELL_ONLY_PATH.test(expanded)) return null
  return expanded.startsWith('/') || from === undefined ? expanded : `${from}/${expanded}`
}

function rm(args: string[], home: string): Risk | null {
  const end = args.indexOf('--')
  const before = end < 0 ? args : args.slice(0, end)
  if (!before.some(arg => arg === '--recursive' || /^-[a-zA-Z]*[rR]/.test(arg))) return null
  const paths = [...before.filter(arg => !arg.startsWith('-')), ...(end < 0 ? [] : args.slice(end + 1))].map(path => expandHome(path, home))
  const reason = paths.length > 0 ? `Recursive delete of ${paths.join(' ')}` : 'Recursive delete'
  if (paths.length === 0 || paths.some(path => SHELL_ONLY_PATH.test(path))) return { reason, checks: [], note: NO_PREVIEW }
  const safe = paths.map(path => (path.startsWith('-') ? `./${path}` : path))
  return {
    reason,
    checks: [
      { label: 'size', argv: ['du', '-sh', '--', ...safe] },
      { label: 'files', argv: ['find', ...safe, '-type', 'f'], isCount: true },
    ],
  }
}

function git(args: string[], where: Where, home: string): Risk | null {
  let dir: string | null | undefined = where.cwd
  let rest = args
  while (rest[0]?.startsWith('-')) {
    const flag = rest[0]
    if (flag === '-C') dir = resolveDir(rest[1] ?? '', dir, home)
    rest = rest.slice(flag === '-C' || flag === '-c' ? 2 : 1)
  }
  const [sub, ...opts] = rest
  const hasShort = (letter: string) => opts.some(opt => new RegExp(`^-[a-zA-Z]*${letter}`).test(opt))
  const run = (label: string, ...command: string[]): Check => ({ label, argv: [...GIT, ...command] })
  const found = (reason: string, checks: Check[]): Risk => {
    if (dir === null) return { reason, checks: [], note: NO_PREVIEW }
    return { reason, checks: checks.map(check => (dir === undefined ? check : { ...check, cwd: dir })) }
  }
  if (sub === 'reset' && opts.includes('--hard')) return found('git reset --hard discards uncommitted changes', [run('uncommitted', 'status', '--short'), run('diff', 'diff', '--stat', 'HEAD')])
  if (sub === 'clean' && (opts.includes('--force') || hasShort('f'))) {
    const kept = opts.filter(opt => opt !== '--force' && opt !== '--interactive').map(opt => (opt.startsWith('--') ? opt : opt.startsWith('-') ? opt.replace(/[fi]/g, '') : opt)).filter(opt => opt !== '-')
    return found('git clean deletes untracked files', [run('would remove', 'clean', '-n', ...kept)])
  }
  if (sub === 'push' && (hasShort('f') || opts.some(opt => opt.startsWith('--force') || opt.startsWith('+')))) return found('Force push rewrites the remote branch', [run('remote commits lost, current branch, as of the last fetch', 'log', '--oneline', 'HEAD..@{u}')])
  if (sub === 'branch' && (hasShort('D') || (opts.some(opt => opt === '--delete' || opt === '-d') && opts.some(opt => opt === '--force' || opt === '-f')))) {
    const names = opts.filter(opt => !opt.startsWith('-'))
    return found(`Force-deleting branch ${names.join(' ')}`, names.map(name => run(`unpushed on ${name}`, 'log', '--oneline', name, '--not', '--remotes')))
  }
  return null
}

const hasVerb = (args: string[], verb: RegExp) => args.some((arg, i) => verb.test(arg) && !args[i - 1]?.startsWith('-'))

function other(name: string, words: string[], args: string[]): Risk | null {
  const noPreview = (reason: string): Risk => ({ reason, checks: [] })
  if (MIGRATION.test(words.join(' '))) return noPreview('Database migration')
  if (name === 'aws' && (hasVerb(args, /^(?:delete|terminate)/) || /\bs3 (?:rm|rb)\b/.test(args.join(' ')))) return noPreview('AWS delete or terminate')
  if (name === 'doctl' && hasVerb(args, /^(?:delete|rm|d)$/)) return noPreview('DigitalOcean delete')
  if (name === 'kubectl' && hasVerb(args, /^delete$/)) return noPreview('kubectl delete removes cluster resources')
  if (name === 'docker' && /\b(?:system|volume) prune\b/.test(args.join(' '))) return noPreview('docker prune deletes unused data')
  if (SQL_CLIENTS.has(name) && SQL_WIPE.test(args.join(' '))) return noPreview('SQL that drops or wipes data')
  return null
}

function walk(command: string, start: Where, home: string): Risk[] {
  const risks: Risk[] = []
  const where = { ...start }
  for (const segment of segments(command)) {
    const words = stripPrefixes(segment)
    const [first, ...args] = words
    if (first === undefined) continue
    const name = first.split('/').pop() ?? first
    const { cwd, host } = where
    if (name === 'cd') {
      if (args[0] !== undefined) where.cwd = resolveDir(args[0], where.cwd, home)
    } else if (name === 'eval') {
      risks.push(...walk(args.join(' '), where, home))
    } else if (SHELLS.has(name)) {
      const flag = args.findIndex(arg => /^-[a-z]*c$/.test(arg))
      if (flag >= 0) risks.push(...walk(args[flag + 1] ?? '', where, home))
    } else if (name === 'ssh') {
      let i = 0
      while (args[i]?.startsWith('-')) i += SSH_VALUE_FLAG.test(args[i]!) ? 2 : 1
      risks.push(...walk(args.slice(i + 1).join(' '), { host: args[i] ?? 'remote' }, home))
    } else {
      const risk = name === 'rm' ? rm(args, home) : name === 'git' ? git(args, where, home) : other(name, [name, ...args], args)
      if (risk === null) continue
      if (host !== undefined) risks.push({ reason: `${risk.reason}, on ${host}`, checks: [] })
      else if (cwd === null) risks.push({ reason: risk.reason, checks: [], note: NO_PREVIEW })
      else risks.push({ ...risk, checks: risk.checks.map(check => (check.cwd === undefined && cwd !== undefined ? { ...check, cwd } : check)) })
    }
  }
  return risks
}

export function classify(command: string, home: string): Risk[] {
  return walk(command, {}, home)
}

async function preview($: EngineInterface, check: Check, from: string) {
  try {
    const cwd = check.cwd === undefined ? from : check.cwd.startsWith('/') ? check.cwd : `${from}/${check.cwd}`
    const ran = await $.process.run(check.argv, { cwd, timeoutMs: 5_000 })
    const lines = ran.stdout.trim().split('\n').filter(Boolean)
    if (check.isCount) return `  ${check.label}: ${lines.length}${ran.isStdoutTruncated ? '+' : ''}`
    if (lines.length === 0) return `  ${check.label}: ${ran.exitCode === 0 ? 'nothing' : 'preview failed'}`
    if (lines.length === 1) return `  ${check.label}: ${lines[0]}`
    const more = lines.length > MAX_LINES ? [`    … ${lines.length - MAX_LINES} more`] : []
    return [`  ${check.label}:`, ...lines.slice(0, MAX_LINES).map(line => `    ${line}`), ...more].join('\n')
  } catch {
    return `  ${check.label}: preview failed`
  }
}

export async function holdRisky($: EngineInterface, command: string): Promise<string | null> {
  if (!isOn('holdRisky')) return null
  const risks = classify(command, (await $.env.get('HOME')) ?? '')
  if (risks.length === 0) return null
  if (await isAutoHandoffRunning($)) return AUTO_HANDOFF_DECLINE
  const from = await $.session.cwd()
  const reports = await Promise.all(
    risks.map(async risk => {
      const lines = await Promise.all(risk.checks.map(check => preview($, check, from)))
      return [`⚠ ${risk.reason}`, ...(risk.note === undefined ? [] : [`  ${risk.note}`]), ...lines].join('\n')
    }),
  )
  const shown = command.length > MAX_SHOWN_COMMAND ? `${command.slice(0, MAX_SHOWN_COMMAND)}…` : command
  const question = `$ ${shown}\n\n${reports.join('\n')}\n\nRun it?`
  let answer: string
  try {
    answer = await $.ui.ask(question, { header: 'Risky', options: [CANCEL, PROCEED] })
  } catch {
    return 'agarzon held this risky command and nobody answered (dismissed, or no one to ask), so it did not run. Do not retry it or reach the same goal another way; ask the user.'
  }
  if (answer === PROCEED) return null
  if (answer === CANCEL) return 'The user cancelled this command after seeing what it would touch. Do not retry it or reach the same goal another way; ask the user.'
  return `The user did not approve this command and said: ${answer}`
}

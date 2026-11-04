import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify } from '../hooks/blast'
import { ask, usage, world } from './world'

const HOME = '/home/me'
const reasons = (command: string) => classify(command, HOME).map(risk => risk.reason)
const isHeld = (command: string) => classify(command, HOME).length > 0
const checks = (command: string) => classify(command, HOME).flatMap(risk => risk.checks)
const GIT = 'git -c core.fsmonitor=false --no-optional-locks'
const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const

for (const command of [
  'rm -rf build',
  'rm -r build',
  'rm -fR build',
  'rm --recursive build',
  '/bin/rm -rf build',
  '\\rm -rf build',
  'git reset --hard',
  'git -C /r reset --hard HEAD~1',
  'git clean -fd',
  'git clean --force',
  'git push --force',
  'git push -f origin main',
  'git push --force-with-lease',
  'git push origin +main',
  'git branch -D old',
  'git branch --delete --force old',
  'npx prisma migrate deploy',
  'prisma db push',
  'bundle exec rails db:migrate',
  'php artisan migrate',
  'alembic upgrade head',
  'knex migrate:latest',
  'aws ec2 terminate-instances --instance-ids i-1',
  'aws --profile x s3api delete-bucket --bucket b',
  'aws s3 rm s3://b/k',
  'aws s3 rb s3://b',
  'doctl compute droplet delete 1',
  'kubectl delete pod p',
  'kubectl -n x delete pod p',
  'psql -c "DROP TABLE users"',
  'mysql -e "truncate table users"',
  'sqlite3 a.db "drop table t"',
  'docker system prune -af',
  'docker volume prune',
]) {
  test(`held: ${command}`, () => {
    expect(isHeld(command)).toBe(true)
  })
}

for (const command of [
  'rm file.txt',
  'rm -f file.txt',
  'git reset --soft HEAD~1',
  'git reset',
  'git clean -n',
  'git push origin main',
  'git branch -d merged',
  'git commit -m "rm -rf build"',
  'echo "rm -rf build"',
  'echo rm -rf build',
  'grep -r "git push --force" .',
  '# rm -rf build',
  'prisma migrate status',
  'aws s3 ls',
  'aws ec2 describe-instances --filters delete-me',
  'kubectl get pods',
  'doctl compute droplet list',
  'psql -c "select 1"',
  'docker ps',
  'docker image ls',
]) {
  test(`not held: ${command}`, () => {
    expect(isHeld(command)).toBe(false)
  })
}

for (const command of [
  'cd x && rm -rf build',
  'true; rm -rf build',
  'false || rm -rf build',
  'ls | xargs rm -rf',
  'sleep 1 & rm -rf build',
  'ls\nrm -rf build',
  'echo $(rm -rf build)',
  '(rm -rf build)',
  '{ rm -rf build; }',
  'if true; then rm -rf build; fi',
  'for d in a; do rm -rf $d; done',
  'sudo rm -rf build',
  'sudo -u root rm -rf build',
  'FOO=1 rm -rf build',
  'env FOO=1 rm -rf build',
  'nohup rm -rf build',
  'timeout 5 rm -rf build',
  'command rm -rf build',
  'bash -c "rm -rf build"',
  "sh -lc 'cd x && rm -rf build'",
  'eval "rm -rf build"',
  'ssh host "rm -rf build"',
  'ssh -i key -p 22 host rm -rf build',
  "ssh host 'bash -c \"rm -rf build\"'",
  "ssh host 'psql -c \"DROP TABLE t\"'",
]) {
  test(`found where a command starts: ${command}`, () => {
    expect(isHeld(command)).toBe(true)
  })
}

test('every risk in a compound command is reported', () => {
  expect(reasons('git reset --hard && git clean -fd')).toHaveLength(2)
})

test('rm previews size and file count, with ~ expanded and following cd', () => {
  expect(checks('cd ~/w && rm -rf build ~/old')).toEqual([
    { label: 'size', argv: ['du', '-sh', '--', 'build', '/home/me/old'], cwd: '/home/me/w' },
    { label: 'files', argv: ['find', 'build', '/home/me/old', '-type', 'f'], cwd: '/home/me/w', isCount: true },
  ])
})

test('a path named like a flag cannot become a find option', () => {
  expect(checks('rm -rf -- -delete').map(check => check.argv)).toEqual([
    ['du', '-sh', '--', './-delete'],
    ['find', './-delete', '-type', 'f'],
  ])
})

for (const command of ['rm -rf $DIR', 'rm -rf "$HOME/x"', 'rm -rf build/*', 'rm -rf `pwd`/x', 'cd $DIR && rm -rf build']) {
  test(`no preview for a path only the shell can resolve: ${command}`, () => {
    expect(classify(command, HOME)[0]?.note).toContain("can't preview")
    expect(checks(command)).toEqual([])
  })
}

test('git previews are read-only and never run the repo hook', () => {
  expect(checks('git -C /r reset --hard').map(check => [check.argv.join(' '), check.cwd])).toEqual([
    [`${GIT} status --short`, '/r'],
    [`${GIT} diff --stat HEAD`, '/r'],
  ])
  expect(checks('git clean -fdx src').map(check => check.argv.join(' '))).toEqual([`${GIT} clean -n -dx src`])
  expect(checks('git push -f').map(check => check.argv.join(' '))).toEqual([`${GIT} log --oneline HEAD..@{u}`])
  expect(checks('git branch -D old').map(check => check.argv.join(' '))).toEqual([`${GIT} log --oneline old --not --remotes`])
})

test('nothing is previewed over ssh', () => {
  expect(reasons('ssh host "git reset --hard"')[0]).toContain('host')
  expect(checks('ssh host "git reset --hard"')).toEqual([])
  expect(checks('ssh host "rm -rf build"')).toEqual([])
})

for (const command of ['npx prisma migrate deploy', 'aws s3 rb s3://b', 'kubectl delete pod p', 'psql -c "DROP TABLE t"', 'docker system prune']) {
  test(`no local preview exists for ${command}`, () => {
    expect(checks(command)).toEqual([])
  })
}

function bash(on: On) {
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })
  return ran
}

function answering(on: On, answer: string | null) {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    expect(e.questions[0]?.options[0]?.label).toBe('Cancel')
    if (answer === null) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [question]: answer } } as never }
  })
  return asked
}

test('Proceed runs the command, after showing it and its preview from the session folder', async ($, on) => {
  const ran = bash(on)
  const asked = answering(on, 'Proceed')
  const { previews, previewRuns } = world(on, {})
  previews.set('du -sh -- build', '12M\tbuild\n')
  previews.set('find build -type f', 'build/a\nbuild/b\n')
  await $.session.start(start)
  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(result.deny).toBeUndefined()
  expect(ran).toEqual(['rm -rf build'])
  expect(asked[0]).toContain('$ rm -rf build')
  expect(asked[0]).toContain('size: 12M')
  expect(asked[0]).toContain('files: 2')
  expect(asked[0]?.endsWith('?')).toBe(true)
  expect(previewRuns).toEqual([{ argv: 'du -sh -- build', cwd: '/home/me/w' }, { argv: 'find build -type f', cwd: '/home/me/w' }])
})

test('Cancel refuses the command and the model is told', async ($, on) => {
  const ran = bash(on)
  answering(on, 'Cancel')
  world(on, {})
  await $.session.start(start)
  const result = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(ran).toEqual([])
  expect(result.deny).toContain('cancelled')
})

test('text typed under Other refuses the command and reaches the model', async ($, on) => {
  const ran = bash(on)
  answering(on, 'only delete build/tmp')
  world(on, {})
  await $.session.start(start)
  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran).toEqual([])
  expect(result.deny).toContain('only delete build/tmp')
})

test('with nobody to answer the command is refused', async ($, on) => {
  const ran = bash(on)
  answering(on, null)
  world(on, {})
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran).toEqual([])
  expect(result.deny).toContain('nobody')
})

test('a subagent command is held too', async ($, on) => {
  const ran = bash(on)
  const asked = answering(on, 'Cancel')
  world(on, {})
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', agentId: 'a1' } as never)
  expect(asked).toHaveLength(1)
  expect(ran).toEqual([])
})

test('a safe command runs without asking', async ($, on) => {
  const ran = bash(on)
  const asked = answering(on, 'Cancel')
  world(on, {})
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(asked).toEqual([])
  expect(ran).toEqual(['ls'])
})

test('a preview that fails still asks', async ($, on) => {
  bash(on)
  const asked = answering(on, 'Cancel')
  const { failing } = world(on, {})
  failing.add('du')
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(asked[0]).toContain('size: preview failed')
})

test('during an auto-handoff it refuses without asking', { options: { autoHandoff: true } }, async ($, on) => {
  const ran = bash(on)
  const asked = answering(on, 'Proceed')
  const { clock } = world(on, {})
  on('classic.PermissionRequest', () => ({}))
  await $.session.start(start)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await ask($, { turnId: 't1' })
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1', usage, reason: 'answer' })
  await clock.advance(55 * 60_000)
  await $.turn.start({ text: '', turnId: 'h1' })
  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(asked).toEqual([])
  expect(ran).toEqual([])
  expect(result.deny).toContain('auto-handoff')
})

test('switched off, nothing is held', { options: { holdRiskyCommands: false } }, async ($, on) => {
  const ran = bash(on)
  const asked = answering(on, 'Cancel')
  world(on, {})
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(asked).toEqual([])
  expect(ran).toEqual(['rm -rf build'])
})

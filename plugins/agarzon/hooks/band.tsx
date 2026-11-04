import type { On, RenderElement } from 'claude-code'

import type { LimitView } from '../types'

import { readCache } from './cache'
import { HANDOFF_COMMAND, readContext } from './context'
import { currentStyle, cycleStyle } from './controls'
import { currentLimits } from './limits'
import { currentModels, cycleEffort, cycleModel } from './models'
import { isOn } from './options'
import { runHandoff } from './autohandoff'
import { readGit } from './git'
import { RailRow, readRail } from './rail'
import { isMuted, toggleAllSounds } from './sounds'
import { readWarm, toggleWarm } from './warm'
import { loadedItems } from './skills'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const day = (ms: number) => new Date(ms).toLocaleDateString('en', { weekday: 'short' })

function limitSuffix({ label, resetsAt, fullAt }: LimitView) {
  if (fullAt !== null) return `⚠ ${label === '7d' ? `${day(fullAt)} ` : ''}${clock(fullAt)}`
  if (resetsAt === null) return null
  return `@${label === '7d' ? day(resetsAt) : clock(resetsAt)}`
}

type Segment = [number, (RenderElement | null)[]]
const SEPARATOR = 3

function fitting(columns: number, segments: (Segment | null)[]) {
  const kept: (RenderElement | null)[][] = []
  let used = 0
  for (const segment of segments) {
    if (segment === null) continue
    const width = segment[0] + (kept.length === 0 ? 0 : SEPARATOR)
    if (used + width > columns) break
    used += width
    kept.push(segment[1])
  }
  return kept
}

function sessionTime(ms: number) {
  const min = Math.max(0, Math.floor(ms / 60_000))
  return min >= 60 ? `${Math.floor(min / 60)}h${pad(min % 60)}m` : `${min}m`
}

export function installBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.view.agentId !== undefined) return below
    const [cache, current, context, loaded, limits, models, rail] = await Promise.all([
      isOn('cache') ? readCache($) : null,
      currentStyle($),
      isOn('context') ? readContext($) : null,
      isOn('skills') ? loadedItems($) : [],
      isOn('limits') ? currentLimits($) : [],
      isOn('models') ? currentModels($) : null,
      isOn('rail') ? readRail($) : null,
    ])
    const skills = loaded.length === 0 ? null : {
      count: loaded.length,
      k: (loaded.reduce((sum, item) => sum + item.tokens, 0) / 1000).toFixed(1),
      isRepeated: loaded.some(item => item.count > 1),
    }
    const sounds = isOn('soundButton') ? { isMuted: await isMuted($) } : null
    const git = isOn('git') ? await readGit($) : null
    const elapsed = git?.startedAt == null ? null : sessionTime((await $.clock.now()) - git.startedAt)
    const warm = cache !== null && isOn('keepWarm') ? await readWarm($) : null
    if (e.props.hasSurvey || ((cache?.min ?? null) === null && current === null && context === null && loaded.length === 0 && limits.length === 0 && models === null && rail === null)) return below
    const { min, busy } = cache ?? { min: null, busy: false }

    const { Box, Button, Text } = $.ui.resolve(e)
    const cacheColor = min === null ? 'inactive' : min === 0 ? 'error' : min > 20 ? 'success' : min > 10 ? 'warning' : 'error'
    const cacheText = busy || min === null ? '⧗ cache —' : min === 0 ? '⧗ cache cold' : `⧗ cache ${min}m`

    return (
      <Box flexDirection="column">
        {below}
        {rail === null ? null : <RailRow rail={rail} columns={e.props.bodyColumns} ui={{ Box, Button, Text }} />}
        {git === null ? null : (
          <Text wrap="truncate-end">
            {git.info === null ? null : <Text color="success">⎇ {git.info.branch}{git.info.isDirty ? '*' : ''}</Text>}
            {git.info?.worktree ? <Text dimColor> ({git.info.worktree})</Text> : null}
            {git.info && git.info.ahead > 0 ? <Text color="warning"> ↑{git.info.ahead}</Text> : null}
            {git.info && git.info.behind > 0 ? <Text color="warning"> ↓{git.info.behind}</Text> : null}
            {git.info && git.info.added + git.info.removed > 0 ? [<Text key="add" color="success"> +{git.info.added}</Text>, <Text key="del" color="error"> −{git.info.removed}</Text>] : null}
            {git.pr === null ? null : [<Text key="pr-sep" dimColor> │ </Text>, git.pr.tone === null ? <Text key="pr">{git.pr.label}</Text> : <Text key="pr" color={git.pr.tone}>{git.pr.label}</Text>, git.pr.ci ? <Text key="ci" color={git.pr.ci === '✓' ? 'success' : git.pr.ci === '✗' ? 'error' : 'warning'}> {git.pr.ci}</Text> : null]}
            {git.folder === null ? null : <Text dimColor>{git.info === null ? '' : ' │ '}{git.folder}</Text>}
            {git.version === null ? null : <Text dimColor> │ v{git.version}</Text>}
            {elapsed === null ? null : <Text dimColor> │ {elapsed}</Text>}
          </Text>
        )}
        <Box flexDirection="row" overflow="hidden">
          {fitting(e.props.bodyColumns, [
            cache === null ? null : [cacheText.length + (warm === null ? 0 : 5), [
              <Text key="cache" color={cacheColor} bold={min === 0 && !busy}>{cacheText}</Text>,
              warm === null ? null : (
                <Button key="warm" plain onPress={() => toggleWarm($)}>
                  {warm ? <Text color="success">warm</Text> : <Text dimColor>warm</Text>}
                </Button>
              ),
            ]],
            models === null ? null : [models.model.length + models.effort.length + 1, [
              <Button key="model" plain label={models.model} onPress={() => void cycleModel($)} />,
              <Button key="effort" plain label={models.effort} onPress={() => void cycleEffort($)} />,
            ]],
            current === null ? null : [current.length, [<Button key="style" plain label={current} onPress={() => cycleStyle($)} />]],
            context === null ? null : [`ctx ${context.k}k ${context.bar}`.length + (context.isOverLimit ? HANDOFF_COMMAND.length + 6 : 0), [
              <Text key="ctx">ctx</Text>,
              <Text key="ctx-k" color={context.tone}>{context.k}k</Text>,
              <Text key="ctx-bar" color={context.tone}>{context.bar}</Text>,
              context.isOverLimit ? <Button key="handoff" label={`/${HANDOFF_COMMAND}`} onPress={() => void runHandoff($)} /> : null,
            ]],
            ...limits.map(limit => {
              const suffix = limitSuffix(limit)
              return [`${limit.label} ${limit.percent}% ${suffix ?? ''}`.trim().length, [
                <Text key={limit.label}>{limit.label}</Text>,
                <Text key={`${limit.label}-pct`} color={limit.tone}>{limit.percent}%</Text>,
                suffix === null ? null : <Text key={`${limit.label}-at`} dimColor>{suffix}</Text>,
              ]] as Segment
            }),
            skills === null ? null : [`skills ${skills.count} · ${skills.k}k`.length, [skills.isRepeated ? <Text key="skills" color="error">skills {skills.count} · {skills.k}k</Text> : <Text key="skills" dimColor>skills {skills.count} · {skills.k}k</Text>]],
            sounds === null ? null : [1, [<Button key="sounds-all" plain label="♪" dimColor={sounds.isMuted} onPress={() => toggleAllSounds($)} />]],
          ]).map((segment, i) => (
            <Box key={`segment-${i}`} flexDirection="row" flexShrink={0} gap={1}>
              {i === 0 ? null : <Text dimColor> │</Text>}
              {segment}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

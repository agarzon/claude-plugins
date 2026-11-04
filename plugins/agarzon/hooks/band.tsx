import type { On } from 'claude-code'

import { readCache } from './cache'
import { currentNudge } from './context'
import { currentStyle, cycleStyle } from './controls'
import { loadedItems } from './skills'

export function installBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [{ min, busy }, current, nudge, loaded] = await Promise.all([readCache($), currentStyle($), currentNudge($), loadedItems($)])
    if (e.props.hasSurvey || (min === null && current === null && nudge === null && loaded.length === 0)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const cacheColor = min === null ? 'gray' : min === 0 ? 'red' : min > 20 ? 'green' : min > 10 ? 'yellow' : 'red'
    const cacheText = busy || min === null ? '⧗ cache —' : min === 0 ? '⧗ cache cold' : `⧗ cache ${min}m`

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={cacheColor} bold={min === 0 && !busy}>{cacheText}</Text>
          {current === null ? null : <Text dimColor>│</Text>}
          {current === null ? null : <Button key="style" label={current} onPress={() => cycleStyle($)} />}
          {nudge === null ? null : <Text dimColor>│</Text>}
          {nudge === null ? null : <Text color="yellow">ctx {nudge}% → /handoff</Text>}
        </Box>
        {loaded.length === 0 ? null : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor>loaded:</Text>
            {loaded.map(item => (
              <Text key={`${item.kind}:${item.name}`} color={item.count > 1 ? 'red' : item.kind === 'hook' ? 'magenta' : 'cyan'}>
                {item.name}{item.kind === 'hook' ? '·hook' : ''} {(item.tokens / 1000).toFixed(1)}k{item.count > 1 ? ` ×${item.count}` : ''}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

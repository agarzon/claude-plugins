import type { EngineInterface } from 'claude-code'

const WSL_CHIME = ['powershell.exe', '-NoProfile', '-Command', "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Windows Exclamation.wav').PlaySync()"]
const MAC_CHIME = ['afplay', '/System/Library/Sounds/Glass.aiff']

export async function chime($: EngineInterface) {
  const argv = (await $.env.get('WSL_DISTRO_NAME')) ? WSL_CHIME : MAC_CHIME
  await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => {})
}

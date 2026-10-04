export type CacheAlert = 'none' | 'soon' | 'cold'
export type HandoffMode = 'refresh' | 'wrap'
export type PendingHandoff = { mode: HandoffMode; name: string; path: string }
export type LedgerItem = { name: string; kind: 'skill' | 'hook'; tokens: number; count: number }

declare module 'claude-code' {
  interface PluginState {
    'agarzon': {
      cacheLastAt: number | null
      cacheLeftMin: number | null
      cacheAlert: CacheAlert
      isBusy: boolean
      style: string | null
      contextNudge: number | null
      pendingHandoff: PendingHandoff | null
      transcriptDir: string | null
      ledger: LedgerItem[]
    }
  }
}

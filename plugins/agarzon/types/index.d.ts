export type CacheAlert = 'none' | 'soon' | 'cold'
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
      pendingHandoff: string | null
      transcriptDir: string | null
      ledger: LedgerItem[]
    }
  }
}

export type CacheAlert = 'none' | 'soon' | 'cold'
export type Platform = 'macos' | 'linux' | 'wsl' | 'windows'
export type LimitSample = { kind: string; at: number; percent: number }
export type LimitView = { label: string; percent: number; resetsAt: number | null; fullAt: number | null; tone: 'success' | 'warning' | 'error' }
export type ContextFill = { tokens: number; window: number }
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ServedModel = { id: string; pick: string | null }
export type Pending<T> = { pick: T | null }
export type RailPrompt = { requestId: string; text: string }
export type WarmPing = { at: number; cached: number; written: number; isHit: boolean }
export type GitInfo = { branch: string; isDirty: boolean; ahead: number; behind: number; added: number; removed: number; worktree: string | null }
export type ReviewInfo = { label: string; tone: 'success' | 'error' | null; ci: string }
export type GitFile = { path: string; status: string; added: number | null; removed: number | null }
export type GitScope = 'all' | 'session'
export type TaskRow = { id: string; stopId: string; kind: 'agent' | 'shell'; label: string; detail: string; status: string; startedAt: number }
export type RequestLog = { at: number; read: number; written: number; uncached: number }
export type NamedTokens = { name: string; tokens: number }
export type ContextView = { total: number; max: number; categories: NamedTokens[]; memory: NamedTokens[]; mcp: NamedTokens[] }
export type LedgerItem = { folder: string; tokens: number; count: number }
export type FindKind = 'all' | 'you' | 'claude' | 'tools'
export type FindSearch = { text: string; kind: FindKind }

declare module 'claude-code' {
  interface PluginState {
    'agarzon': {
      cacheLastAt: number | null
      cacheLeftMin: number | null
      cacheAlert: CacheAlert
      isBusy: boolean
      cacheGuarded: boolean
      warmArmed: boolean
      warmStopAt: number | null
      warmPings: WarmPing[]
      warmInRow: number
      autoHandoffArmed: boolean
      autoHandoffWarnedFor: number | null
      handoffQueuedAt: number | null
      handoffQueuedByUs: boolean
      autoHandoffTurnId: string | null
      style: string | null
      contextFill: ContextFill | null
      pendingHandoff: string | null
      transcriptPath: string | null
      ledger: LedgerItem[]
      skillsLoaded: string[]
      isInteractive: boolean
      platform: Platform | null
      soundsMuted: string[]
      limitSamples: LimitSample[]
      limits: LimitView[]
      modelOverride: string | null
      effortOverride: EffortLevel | null
      servedModel: ServedModel | null
      railPrompts: RailPrompt[]
      railCursor: number | null
      gitInfo: GitInfo | null
      review: ReviewInfo | null
      version: string | null
      startedAt: number | null
      folder: string | null
      gitRoot: string | null
      gitFiles: GitFile[]
      touched: string[]
      gitScope: GitScope
      tasks: TaskRow[]
      tasksNow: number
      cacheRequests: RequestLog[]
      contextView: ContextView | null
      stepEffort: string | null
      modelPending: Pending<string> | null
      effortPending: Pending<EffortLevel> | null
      findSearch: FindSearch
    }
  }
}

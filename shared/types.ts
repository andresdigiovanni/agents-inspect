export type Agent = 'claude-code' | 'copilot'
export type AgentScope = Agent | 'all'
export interface ToolCalls { total: number; skills: number; mcp: number; builtin: number }
export interface TokenUsage { input: number; output: number; cacheCreation: number; cacheRead: number; total: number }
export interface SessionSummary {
  id: string; agent: Agent; project: string; title: string; startedAt: string;
  models: string[]; userTurns: number; toolCalls: ToolCalls; toolRatio: number | null;
  tokens: TokenUsage; costUsd: number | null; skills: string[]; mcpServers: string[];
  skillsUsed: string[]; mcpServersUsed: string[]; agentTypes: string[];
  durationMs: number | null; linesAdded: number | null; linesRemoved: number | null;
  entrypoint: string | null; gitBranch: string | null; version: string | null;
  effort: string | null; permissionMode: string | null;
  commits: number; interruptions: number; questions: number; rejections: number; toolErrors: number;
  peakContext: number | null; turnMs: number[];
  apiMs: number | null; toolMs: number | null; retryMs: number | null;
  edits: number; filesEdited: number; reworkEdits: number;
}
export interface DailyPoint {
  date: string; sessions: number; userTurns: number; tokens: TokenUsage; costUsd: number;
  byModel: Record<string, { tokens: number; costUsd: number }>;
}
export interface PeriodMetrics {
  conversations: number; costUsd: number; conversationsTrendPct: number | null;
  cacheHitPct: number | null;
  activeMs: number; linesAdded: number; linesRemoved: number;
  daily: DailyPoint[]; heatmap: number[][];
  costTrendPct: number | null; activeTrendPct: number | null;
  commits: number; commitsTrendPct: number | null; costPerCommit: number | null; costPerCommitTrendPct: number | null;
  costPerActiveHour: number | null; medianCostPerSession: number | null; p90CostPerSession: number | null;
  freshTokens: number; freshTokensTrendPct: number | null; cacheSavingsUsd: number;
  toolsPerTurn: number | null; medianTurnMs: number | null; p90TurnMs: number | null;
  interruptionsPerSession: number | null; toolErrorPct: number | null;
  apiMs: number; toolMs: number; retryMs: number;
  breakdowns: Record<BreakdownDim, BreakdownRow[]>; heatmapCost: number[][];
}
export type BreakdownDim = 'project' | 'branch' | 'version' | 'permissionMode' | 'effort'
export interface BreakdownRow {
  key: string | null; sessions: number; costUsd: number; medianCostPerSession: number | null
  toolErrorPct: number | null; interruptionsPerSession: number | null; commits: number
}
export interface TraceEvent {
  timestamp: string; kind: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  sidechain: boolean; text: string; toolName?: string;
}
export type Verdict = 'useful' | 'occasional' | 'unused' | 'problematic' | 'insufficient'
export interface UsageFunnel {
  sessionsLoaded: number; sessionsUsed: number; adoptionPct: number | null;
  calls: number; errors: number; errorRatePct: number | null;
  usedDays: number; lastUsedAt: string | null; verdict: Verdict;
}
export interface SkillAnalysis extends UsageFunnel {
  name: string; plugin: string | null; tokens: number; costUsd: number
  windows: number; windowErrorRatePct: number | null; interruptedPct: number | null; linesEdited: number
  commitPct: number | null; costPerWindow: number | null; contextTokensEst: number | null
}
export interface SkillSequences {
  top: { path: string[]; sessions: number }[]
  transitions: { from: string; to: string | null; count: number }[]
}
export interface McpToolUsage { name: string; calls: number; errors: number }
export interface McpAnalysis extends UsageFunnel {
  server: string; toolsAvailable: number | null; tools: McpToolUsage[]
  tokens: number; costUsd: number; costPerCall: number | null
}
export interface BuiltinToolStats { name: string; sessions: number; calls: number; errors: number; errorRatePct: number | null; rejections: number }
export interface HookStats { event: string; name: string; sessions: number; runs: number; contextTokensEst: number }
export interface ModelAnalysis {
  model: string; sessions: number; messages: number; tokens: TokenUsage; costUsd: number;
  cacheHitPct: number | null; subagentTokenPct: number | null;
  costPerMessage: number | null; avgContext: number | null; outputPct: number | null; priced: boolean;
}
export interface Analysis {
  sessions: number; skills: SkillAnalysis[]; mcpServers: McpAnalysis[]; sequences: SkillSequences
  toolMix: ToolCalls; loadedSkills: number; loadedMcpServers: number; skillContextTokensEst: number
  builtinTools: BuiltinToolStats[]; hooks: HookStats[]
}
export type Phase = 'explore' | 'plan' | 'implement' | 'test' | 'review' | 'debug' | 'ship' | 'other'
export type PhaseSource = 'skill' | 'tool' | 'inherited' | 'none'
export interface PhaseStats {
  phase: Phase; sessions: number; messages: number; tokens: TokenUsage; costUsd: number; costPct: number | null
  byModel: Record<string, { messages: number; tokens: number; costUsd: number }>
  bySource: Record<PhaseSource, number>
}
export interface SubagentGroup {
  agentType: string; phase: Phase; runs: number; sessions: number; models: Record<string, number>
  tokens: number; costUsd: number; toolCalls: number; toolErrors: number; errorRatePct: number | null
  avgDurationMs: number | null; examples: string[]; costPerRun: number | null
}
export interface HotFile { file: string; project: string; edits: number; sessions: number; reworkEdits: number }
export interface Rework { edits: number; reworkEdits: number; reworkPct: number | null; hotFiles: HotFile[] }
export interface Workflow {
  sessions: number
  phases: PhaseStats[]
  daily: { date: string; byPhase: Record<Phase, number> }[]
  subagents: SubagentGroup[]
  subagentCostPct: number | null
  coverage: Record<PhaseSource, number>
  models: ModelAnalysis[]
  phaseFlow: { from: Phase; to: Phase; count: number }[]
  rework: Rework
}
export type Source = 'all' | 'interactive' | 'automated'
export interface Scope { agent: AgentScope; source: Source; project: string | null }
export interface ProjectOption { project: string; sessions: number }
export interface SubagentRun {
  agentId: string; agentType: string; description: string; model: string; toolUseId: string | null
  startedAt: string | null; durationMs: number | null; tokens: number; costUsd: number
  toolCalls: number; toolErrors: number; phase: Phase
}
export interface SkillWindow {
  skill: string; ts: string | null; toolCalls: number; toolErrors: number
  interrupted: boolean; linesEdited: number; committed: boolean
}
export interface SessionDetail {
  summary: SessionSummary
  costByModel: { model: string; costUsd: number; tokens: number }[]
  costByPhase: Record<Phase, number>
  context: { ts: string | null; context: number }[]
  subagents: Omit<SubagentRun, 'toolUseId'>[]
  skillWindows: SkillWindow[]
  topFiles: { file: string; edits: number }[]
}

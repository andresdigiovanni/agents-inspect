import type { Phase, PhaseSource, SessionSummary, SkillWindow, SubagentRun, TokenUsage } from '../shared/types.ts'
export type { SkillWindow, SubagentRun }

export interface MessageEvent {
  ts: string | null; model: string; tokens: TokenUsage; costUsd: number; sidechain: boolean; skill: string | null
  phase: Phase; phaseSource: PhaseSource; agentId: string | null
  mcpServer: string | null; context: number
}
export interface SkillCall { ts: string | null; skill: string; error: boolean }
export interface McpCall { ts: string | null; server: string; tool: string; error: boolean }
export interface SubagentInput { agentId: string; meta: Record<string, unknown> | null }
export interface ToolStat { calls: number; errors: number; rejections: number }
export interface HookRun { event: string; name: string; contextChars: number }
export interface SessionRecord {
  summary: SessionSummary
  messages: MessageEvent[]
  turnTimes: string[]
  skillCalls: SkillCall[]
  mcpCalls: McpCall[]
  mcpTools: Record<string, string[]>
  subagents: SubagentRun[]
  skillWindows: SkillWindow[]
  skillSequence: string[]
  skillListingChars: Record<string, number>
  toolStats: Record<string, ToolStat>
  hooks: HookRun[]
  fileEdits: Record<string, number>
  phaseFlow: { from: Phase; to: Phase }[]
}

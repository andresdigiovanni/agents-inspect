import type { AgentScope, ProjectOption, Scope, SessionSummary, Source } from '../shared/types.ts'

const SOURCES: Source[] = ['all', 'interactive', 'automated']

const AGENTS: AgentScope[] = ['all', 'claude-code', 'copilot']

export function parseScope(q: { agent?: string; source?: string; project?: string }): Scope | null {
  const source = (q.source ?? 'all') as Source
  const agent = (q.agent ?? 'all') as AgentScope
  if (!SOURCES.includes(source) || !AGENTS.includes(agent)) return null
  return { agent, source, project: q.project ? q.project : null }
}

export const isAutomated = (s: SessionSummary): boolean => s.entrypoint !== null && s.entrypoint !== 'cli'

export function inScope(s: SessionSummary, scope: Scope): boolean {
  if (scope.agent !== 'all' && s.agent !== scope.agent) return false
  if (scope.project !== null && s.project !== scope.project) return false
  if (scope.source === 'automated') return isAutomated(s)
  if (scope.source === 'interactive') return !isAutomated(s)
  return true
}

export function projectList(sessions: SessionSummary[]): ProjectOption[] {
  const counts = new Map<string, number>()
  for (const s of sessions) counts.set(s.project, (counts.get(s.project) ?? 0) + 1)
  return [...counts].map(([project, n]) => ({ project, sessions: n })).sort((a, b) => b.sessions - a.sessions || a.project.localeCompare(b.project))
}

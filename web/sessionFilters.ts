import type { SessionSummary } from '../shared/types.ts'
import type { SessionFilters } from './hash.ts'

function options(values: string[], active: string | null): string[] {
  const set = new Set(values)
  if (active !== null) set.add(active)
  return [...set].sort()
}

export function filterOptions(sessions: SessionSummary[], active: SessionFilters): { models: string[]; skills: string[]; mcp: string[]; agents: string[]; branches: string[] } {
  return {
    models: options(sessions.flatMap((s) => s.models), active.model),
    skills: options(sessions.flatMap((s) => s.skillsUsed), active.skill),
    mcp: options(sessions.flatMap((s) => s.mcpServersUsed), active.mcp),
    agents: options(sessions.flatMap((s) => s.agentTypes), active.agent),
    branches: options(sessions.flatMap((s) => (s.gitBranch === null ? [] : [s.gitBranch])), active.branch),
  }
}

export function matchesFilters(s: SessionSummary, f: SessionFilters): boolean {
  return (f.model === null || s.models.includes(f.model))
    && (f.skill === null || s.skillsUsed.includes(f.skill))
    && (f.mcp === null || s.mcpServersUsed.includes(f.mcp))
    && (f.agent === null || s.agentTypes.includes(f.agent))
    && (f.branch === null || s.gitBranch === f.branch)
}

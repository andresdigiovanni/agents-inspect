import type { Agent, ProjectOption, Scope, SessionSummary } from '../shared/types.ts'
import { ALL_AGENTS } from '../shared/types.ts'

export function parseScope(q: { agent?: string; project?: string; provider?: string }): Scope | null {
  const raw = (q.agent ?? '').trim()
  const agents: Agent[] = raw === '' || raw === 'all'
    ? [...ALL_AGENTS]
    : [...new Set(raw.split(',').map(s => s.trim()).filter(s => s !== ''))] as Agent[]
  if (agents.length === 0 || agents.some(a => !ALL_AGENTS.includes(a))) return null
  const rawP = (q.provider ?? '').trim()
  const list = [...new Set(rawP.split(',').map(s => s.trim()).filter(s => s !== ''))]
  const providers = rawP === '' || rawP === 'all' || list.length === 0 ? null : list
  return { agents, project: q.project ? q.project : null, providers }
}

export function inScope(s: SessionSummary, scope: Scope): boolean {
  if (!scope.agents.includes(s.agent)) return false
  if (scope.providers !== null && s.agent === 'opencode' && !s.providers.some(p => scope.providers!.includes(p))) return false
  if (scope.project !== null && s.project !== scope.project) return false
  return true
}

export function projectList(sessions: SessionSummary[]): ProjectOption[] {
  const counts = new Map<string, number>()
  for (const s of sessions) counts.set(s.project, (counts.get(s.project) ?? 0) + 1)
  return [...counts].map(([project, n]) => ({ project, sessions: n })).sort((a, b) => b.sessions - a.sessions || a.project.localeCompare(b.project))
}

export function providerList(sessions: SessionSummary[]): string[] {
  return [...new Set(sessions.flatMap(s => s.providers))].sort()
}

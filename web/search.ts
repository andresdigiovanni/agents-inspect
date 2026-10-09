import type { SessionSummary } from '../shared/types.ts'

export function matchesQuery(s: SessionSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return [s.title, s.id, s.project, ...s.skills, ...s.mcpServers].some((field) => field.toLowerCase().includes(q))
}

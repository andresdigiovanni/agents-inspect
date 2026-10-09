import type { AgentScope, Analysis, PeriodMetrics, ProjectOption, Scope, SessionDetail, SessionSummary, TraceEvent, Workflow } from '../shared/types.ts'

export interface Query { from: Date; to: Date; scope: Scope }

export function queryString(q: Query): string {
  const params = new URLSearchParams({ from: q.from.toISOString(), to: q.to.toISOString() })
  if (q.scope.agent !== 'all') params.set('agent', q.scope.agent)
  if (q.scope.source !== 'all') params.set('source', q.scope.source)
  if (q.scope.project !== null) params.set('project', q.scope.project)
  return params.toString()
}

async function request(path: string): Promise<Response> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

export async function getSummary(q: Query): Promise<PeriodMetrics> {
  return (await request(`/api/summary?${queryString(q)}`)).json()
}

export async function getSessions(q: Query): Promise<SessionSummary[]> {
  return (await request(`/api/sessions?${queryString(q)}`)).json()
}

export async function getTooling(q: Query): Promise<Analysis> {
  return (await request(`/api/tooling?${queryString(q)}`)).json()
}

export async function getWorkflow(q: Query): Promise<Workflow> {
  return (await request(`/api/workflow?${queryString(q)}`)).json()
}

export const projectsPath = (agent: AgentScope): string => (agent === 'all' ? '/api/projects' : `/api/projects?agent=${agent}`)

export async function getProjects(agent: AgentScope): Promise<ProjectOption[]> {
  return (await request(projectsPath(agent))).json()
}

export async function getDetail(id: string): Promise<SessionDetail> {
  return (await request(`/api/sessions/${encodeURIComponent(id)}/detail`)).json()
}

export async function getTrace(id: string): Promise<TraceEvent[]> {
  return (await request(`/api/sessions/${encodeURIComponent(id)}/trace`)).json()
}

export async function getRaw(id: string): Promise<string> {
  return (await request(`/api/sessions/${encodeURIComponent(id)}/raw`)).text()
}

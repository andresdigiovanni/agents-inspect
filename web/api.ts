import type { Agent, Analysis, PeriodMetrics, ProjectOption, Scope, SessionDetail, SessionSummary, TraceEvent, Workflow } from '../shared/types.ts'
import { ALL_AGENTS } from '../shared/types.ts'

export interface Query { from: Date; to: Date; scope: Scope }

export function isAllAgents(agents: Agent[]): boolean {
  return agents.length === ALL_AGENTS.length && ALL_AGENTS.every(a => agents.includes(a))
}

export function queryString(q: Query): string {
  const params = new URLSearchParams({ from: q.from.toISOString(), to: q.to.toISOString() })
  if (!isAllAgents(q.scope.agents)) params.set('agent', q.scope.agents.join(','))
  if (q.scope.providers !== null) params.set('provider', [...q.scope.providers].sort().join(','))
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

export const providersPath = (agents: Agent[]): string => (isAllAgents(agents) ? '/api/providers' : `/api/providers?agent=${encodeURIComponent(agents.join(','))}`)

export async function getProviders(agents: Agent[]): Promise<string[]> {
  return (await request(providersPath(agents))).json()
}

export const projectsPath = (agents: Agent[], providers: string[] | null): string => {
  const params = new URLSearchParams()
  if (!isAllAgents(agents)) params.set('agent', agents.join(','))
  if (providers !== null) params.set('provider', providers.join(','))
  const qs = params.toString()
  return qs === '' ? '/api/projects' : `/api/projects?${qs}`
}

export async function getProjects(agents: Agent[], providers: string[] | null): Promise<ProjectOption[]> {
  return (await request(projectsPath(agents, providers))).json()
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

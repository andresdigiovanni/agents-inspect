export type Tab = 'overview' | 'tooling' | 'workflow' | 'sessions'
export interface SessionFilters { skill: string | null; mcp: string | null; model: string | null; agent: string | null; branch: string | null }
export interface Route { tab: Tab; filters: SessionFilters }

export const NO_FILTERS: SessionFilters = { skill: null, mcp: null, model: null, agent: null, branch: null }

const KEYS = ['skill', 'mcp', 'model', 'agent', 'branch'] as const

export function parseHash(hash: string): Route {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const q = body.indexOf('?')
  const path = q === -1 ? body : body.slice(0, q)
  const query = q === -1 ? '' : body.slice(q + 1)
  if (path === '/tooling' || path === '/analysis') return { tab: 'tooling', filters: NO_FILTERS }
  if (path === '/workflow') return { tab: 'workflow', filters: NO_FILTERS }
  if (path !== '/sessions') return { tab: 'overview', filters: NO_FILTERS }
  const params = new URLSearchParams(query)
  const get = (key: string): string | null => {
    const v = params.get(key)
    return v === null || v === '' ? null : v
  }
  return { tab: 'sessions', filters: { skill: get('skill'), mcp: get('mcp'), model: get('model'), agent: get('agent'), branch: get('branch') } }
}

export function formatHash(route: Route): string {
  const base = `#/${route.tab}`
  if (route.tab !== 'sessions') return base
  const params = new URLSearchParams()
  for (const key of KEYS) {
    const v = route.filters[key]
    if (v !== null) params.set(key, v)
  }
  const query = params.toString()
  return query === '' ? base : `${base}?${query}`
}

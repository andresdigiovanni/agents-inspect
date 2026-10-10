import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Agent, ProjectOption, Scope } from '../shared/types.ts'
import { ALL_AGENTS } from '../shared/types.ts'
import { getProjects, getProviders } from './api.ts'

const LABELS: Record<Agent, { label: string; title: string }> = {
  'claude-code': { label: 'Claude Code', title: 'Sessions from ~/.claude/projects' },
  copilot: { label: 'Copilot', title: 'GitHub Copilot CLI sessions from ~/.copilot/session-state' },
  opencode: { label: 'opencode', title: 'opencode sessions from ~/.local/share/opencode/opencode.db' },
}

const shortProject = (p: string): string => p.split('/').filter(Boolean).slice(-2).join('/') || p

export function ScopeSelector(props: { scope: Scope; onChange: (s: Scope) => void }): JSX.Element {
  const { scope, onChange } = props
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [providers, setProviders] = useState<string[]>([])
  useEffect(() => {
    getProjects(scope.agents, scope.providers).then(setProjects, () => setProjects([]))
  }, [scope.agents, scope.providers])
  useEffect(() => {
    getProviders(scope.agents).then(setProviders, () => setProviders([]))
  }, [scope.agents])
  const toggle = (agent: Agent): void => {
    const next = scope.agents.includes(agent) ? scope.agents.filter(a => a !== agent) : [...scope.agents, agent]
    if (next.length === 0) return // always keep at least one agent selected
    onChange({ ...scope, agents: next, project: null, ...(agent === 'opencode' && next.includes('opencode') ? { providers: null } : {}) })
  }
  const toggleProvider = (p: string): void => {
    if (providers.length === 0) return
    const cur = scope.providers ?? providers
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]
    if (next.length === 0) return // at least one provider stays checked
    const all = next.length === providers.length && providers.every(x => next.includes(x))
    onChange({ ...scope, providers: all ? null : [...next].sort() })
  }
  const ocOff = !scope.agents.includes('opencode')
  const providerChecked = (p: string): boolean => (scope.providers ?? providers).includes(p)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center divide-x divide-gray-300 rounded-lg border border-gray-300 bg-white shadow-sm" role="group" aria-label="Agent">
        {ALL_AGENTS.map(agent => agent === 'opencode' ? (
          <div key={agent} className="flex items-center">
            <label title={LABELS[agent].title} className={`flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm ${ocOff ? 'text-gray-400' : 'text-gray-700'} hover:bg-gray-100`}>
              <input type="checkbox" checked={!ocOff} onChange={() => toggle(agent)} className="accent-gray-900" />
              {LABELS[agent].label}
            </label>
            {providers.length > 0 && (
              <details className="relative inline-block">
                <summary className={`cursor-pointer list-none px-2 py-1.5 text-xs ${ocOff ? 'text-gray-400' : 'text-gray-500'} hover:text-gray-900`} title="Filter opencode sessions by provider">
                  providers{scope.providers !== null ? ` (${scope.providers.length}/${providers.length})` : ''} ▾
                </summary>
                <div className="absolute right-0 z-10 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-800 shadow-lg">
                  <div className="mb-1 flex gap-3 border-b border-gray-100 pb-1 text-xs">
                    <button type="button" className="cursor-pointer text-sky-700 hover:underline" onClick={() => onChange({ ...scope, providers: null })}>All</button>
                  </div>
                  {providers.map(p => (
                    <label key={p} title={`Filter opencode sessions served by ${p}`} className={`flex items-center gap-2 py-0.5 ${ocOff ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer'}`}>
                      <input type="checkbox" disabled={ocOff} checked={ocOff || providerChecked(p)} onChange={() => toggleProvider(p)} className="accent-gray-900" />
                      <span className="truncate">{p}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : (
          <label key={agent} title={LABELS[agent].title} className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
            <input type="checkbox" checked={scope.agents.includes(agent)} onChange={() => toggle(agent)} className="accent-gray-900" />
            {LABELS[agent].label}
          </label>
        ))}
      </div>
      <select aria-label="Project" value={scope.project ?? ''} onChange={e => onChange({ ...scope, project: e.target.value === '' ? null : e.target.value })}
        className="max-w-56 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700">
        <option value="">All projects</option>
        {projects.map(p => <option key={p.project} value={p.project} title={p.project}>{shortProject(p.project)} ({p.sessions})</option>)}
      </select>
    </div>
  )
}

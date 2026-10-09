import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { AgentScope, ProjectOption, Scope, Source } from '../shared/types.ts'
import { getProjects } from './api.ts'

const agents: { agent: AgentScope; label: string; title: string }[] = [
  { agent: 'all', label: 'All agents', title: 'Claude Code and GitHub Copilot CLI sessions' },
  { agent: 'claude-code', label: 'Claude Code', title: 'Sessions from ~/.claude/projects' },
  { agent: 'copilot', label: 'Copilot', title: 'GitHub Copilot CLI sessions from ~/.copilot/session-state' },
]

const sources: { source: Source; label: string; title: string }[] = [
  { source: 'all', label: 'All', title: 'Interactive and automated sessions' },
  { source: 'interactive', label: 'Interactive', title: 'Started from a terminal CLI' },
  { source: 'automated', label: 'Automated', title: 'Started by an SDK, IDE or other non-CLI entrypoint' },
]

const shortProject = (p: string): string => p.split('/').filter(Boolean).slice(-2).join('/') || p

export function ScopeSelector(props: { scope: Scope; onChange: (s: Scope) => void }): JSX.Element {
  const { scope, onChange } = props
  const [projects, setProjects] = useState<ProjectOption[]>([])
  useEffect(() => {
    getProjects(scope.agent).then(setProjects, () => setProjects([]))
  }, [scope.agent])
  const segment = (active: boolean): string =>
    `px-3 py-1.5 text-sm ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex divide-x divide-gray-300 overflow-hidden rounded-lg border border-gray-300 shadow-sm" role="group" aria-label="Agent">
        {agents.map((a) => (
          <button key={a.agent} type="button" title={a.title} aria-pressed={scope.agent === a.agent} className={segment(scope.agent === a.agent)}
            onClick={() => onChange({ ...scope, agent: a.agent, project: null })}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="inline-flex divide-x divide-gray-300 overflow-hidden rounded-lg border border-gray-300 shadow-sm" role="group" aria-label="Source">
        {sources.map((s) => (
          <button key={s.source} type="button" title={s.title} aria-pressed={scope.source === s.source} className={segment(scope.source === s.source)}
            onClick={() => onChange({ ...scope, source: s.source })}>
            {s.label}
          </button>
        ))}
      </div>
      <select aria-label="Project" value={scope.project ?? ''} onChange={(e) => onChange({ ...scope, project: e.target.value === '' ? null : e.target.value })}
        className="max-w-56 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700">
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.project} value={p.project} title={p.project}>{shortProject(p.project)} ({p.sessions})</option>)}
      </select>
    </div>
  )
}

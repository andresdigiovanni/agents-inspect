import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { ToolingTab } from './ToolingTab.tsx'
import type { Query } from './api.ts'
import type { Scope } from '../shared/types.ts'
import { ALL_AGENTS } from '../shared/types.ts'
import { ScopeSelector } from './ScopeSelector.tsx'
import { formatHash, NO_FILTERS, parseHash } from './hash.ts'
import type { Route, Tab } from './hash.ts'
import { HistoryTab } from './HistoryTab.tsx'
import { OverviewTab } from './OverviewTab.tsx'
import { resolveRange } from './range.ts'
import type { RangeChoice } from './range.ts'
import { RangeSelector } from './RangeSelector.tsx'
import { WorkflowTab } from './WorkflowTab.tsx'

const tabs: { tab: Tab; label: string }[] = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'tooling', label: 'Tooling' },
  { tab: 'workflow', label: 'Workflow' },
  { tab: 'sessions', label: 'History' },
]

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  const [choice, setChoice] = useState<RangeChoice>({ kind: '30d' })
  const [now] = useState(() => new Date())
  const [scope, setScope] = useState<Scope>(() => ({ agents: [...ALL_AGENTS], project: null, providers: null }))
  const range = useMemo<Query | null>(() => {
    const r = resolveRange(choice, now)
    return r === null ? null : { ...r, scope }
  }, [choice, now, scope])

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Agents Inspect</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="inline-flex divide-x divide-gray-300 overflow-hidden rounded-lg border border-gray-300 shadow-sm">
          {tabs.map((t) => {
            const active = route.tab === t.tab
            return (
              <a
                key={t.tab}
                href={formatHash({ tab: t.tab, filters: NO_FILTERS })}
                aria-current={active ? 'page' : undefined}
                className={`px-3 py-1.5 text-sm ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              >
                {t.label}
              </a>
            )
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <ScopeSelector scope={scope} onChange={setScope} />
          <RangeSelector choice={choice} onChange={setChoice} />
        </div>
      </div>
      {route.tab === 'sessions' ? (
        <HistoryTab
          range={range}
          filters={route.filters}
          onFiltersChange={(f) => { location.hash = formatHash({ tab: 'sessions', filters: f }) }}
        />
      ) : route.tab === 'workflow' ? (
        <WorkflowTab range={range} />
      ) : route.tab === 'tooling' ? (
        <ToolingTab range={range} />
      ) : (
        <OverviewTab range={range} />
      )}
    </main>
  )
}

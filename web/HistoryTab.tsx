import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { SessionSummary } from '../shared/types.ts'
import { getSessions } from './api.ts'
import { ErrorBanner, errorMessage } from './ErrorBanner.tsx'
import type { SessionFilters } from './hash.ts'
import { SessionsTable } from './SessionsTable.tsx'
import type { Query } from './api.ts'

type Range = Query | null

export function HistoryTab(props: { range: Range; filters: SessionFilters; onFiltersChange: (f: SessionFilters) => void }): JSX.Element {
  const range = props.range
  const [loaded, setLoaded] = useState<{ range: Range; sessions: SessionSummary[] } | null>(null)
  const [failed, setFailed] = useState<{ range: Range; message: string } | null>(null)
  const sessions = loaded !== null && loaded.range === range ? loaded.sessions : null
  const sessionsError = failed !== null && failed.range === range ? failed.message : null

  useEffect(() => {
    if (range === null) return
    let cancelled = false
    getSessions(range).then(
      (s) => { if (!cancelled) setLoaded({ range, sessions: s }) },
      (e: unknown) => { if (!cancelled) setFailed({ range, message: errorMessage(e) }) },
    )
    return () => { cancelled = true }
  }, [range])

  return (
    <>
      {sessionsError !== null && <ErrorBanner message={sessionsError} />}
      {range === null ? (
        <p className="text-sm text-gray-500">Select a valid date range.</p>
      ) : sessions === null ? (
        sessionsError === null && <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <SessionsTable sessions={sessions} filters={props.filters} onFiltersChange={props.onFiltersChange} />
      )}
    </>
  )
}

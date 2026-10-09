import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { TraceEvent } from '../shared/types.ts'
import { getRaw, getTrace } from './api.ts'
import { SessionSummaryPanel } from './SessionSummary.tsx'

const KIND_STYLES: Record<TraceEvent['kind'], string> = {
  user: 'bg-sky-100 text-sky-800',
  assistant: 'bg-emerald-100 text-emerald-800',
  tool_use: 'bg-amber-100 text-amber-800',
  tool_result: 'bg-gray-200 text-gray-700',
}

function timeOf(timestamp: string): string {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? timestamp : d.toLocaleTimeString('en-US', { hour12: false })
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function SessionDetail(props: { id: string }): JSX.Element {
  const { id } = props
  const [events, setEvents] = useState<TraceEvent[] | null>(null)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  const [rawLoading, setRawLoading] = useState(false)
  const [rawError, setRawError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTrace(id).then(
      (t) => { if (!cancelled) setEvents(t) },
      (e: unknown) => { if (!cancelled) setTraceError(message(e)) },
    )
    return () => { cancelled = true }
  }, [id])

  function toggleRaw(): void {
    if (showRaw) {
      setShowRaw(false)
      return
    }
    setShowRaw(true)
    if (raw !== null || rawLoading) return
    setRawLoading(true)
    setRawError(null)
    getRaw(id).then(
      (r) => { setRaw(r); setRawLoading(false) },
      (e: unknown) => { setRawError(message(e)); setRawLoading(false); setShowRaw(false) },
    )
  }

  return (
    <div className="space-y-3 text-gray-700">
      <SessionSummaryPanel id={id} />
      {traceError !== null ? (
        <p role="alert" className="text-sm text-red-600">Could not load trace: {traceError}</p>
      ) : events === null ? (
        <p role="status" className="text-sm text-gray-500">Loading trace…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-500">No events.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {events.map((ev, i) => (
            <li key={i} className="flex flex-wrap items-start gap-2 px-3 py-1.5">
              <span className="font-mono text-xs whitespace-nowrap text-gray-400">{timeOf(ev.timestamp)}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${KIND_STYLES[ev.kind]}`}>
                {ev.kind === 'tool_use' && ev.toolName ? `tool_use: ${ev.toolName}` : ev.kind}
              </span>
              {ev.sidechain && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs whitespace-nowrap text-violet-800">subagent</span>}
              <span className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">{ev.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <button
          type="button"
          onClick={toggleRaw}
          aria-expanded={showRaw}
          className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm hover:bg-gray-100"
        >
          {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
        </button>
        {showRaw && rawLoading && <p role="status" className="text-sm text-gray-500">Loading JSON…</p>}
        {rawError !== null && <p role="alert" className="text-sm text-red-600">Could not load JSON: {rawError}</p>}
        {showRaw && raw !== null && <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs">{raw}</pre>}
      </div>
    </div>
  )
}

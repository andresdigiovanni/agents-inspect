import type { TraceEvent } from '../../shared/types.ts'
import type { LoadedMessages } from './db.ts'

const MAX_TEXT = 300

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, any> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, any> : {})

function eventsOf(msgs: LoadedMessages, sidechain: boolean): TraceEvent[] {
  const out: TraceEvent[] = []
  for (const row of msgs.rows) {
    const role = str(obj(row.data).role)
    if (role !== 'user' && role !== 'assistant') continue
    const timestamp = new Date(row.time_created).toISOString()
    const push = (kind: TraceEvent['kind'], text: string, toolName?: string) =>
      out.push(toolName === undefined ? { timestamp, kind, sidechain, text: text.slice(0, MAX_TEXT) } : { timestamp, kind, sidechain, text: text.slice(0, MAX_TEXT), toolName })
    for (const p of (msgs.partsByMessage.get(row.id) ?? []).map(p => obj(p))) {
      if (p.type === 'text') {
        if (str(p.text).trim()) push(role === 'user' ? 'user' : 'assistant', str(p.text))
      } else if (p.type === 'tool' && role === 'assistant') {
        const state = obj(p.state)
        push('tool_use', JSON.stringify(obj(state.input)), str(p.tool))
        push('tool_result', state.status === 'error' ? str(state.error) || 'error' : str(state.output))
      }
    }
  }
  return out
}

// Trace of a session: own events first, then each child subagent's as sidechain.
export function buildOpencodeTrace(own: LoadedMessages, children: LoadedMessages[]): TraceEvent[] {
  return [...eventsOf(own, false), ...children.flatMap(c => eventsOf(c, true))]
}

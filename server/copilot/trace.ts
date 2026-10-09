import type { TraceEvent } from '../../shared/types.ts'

const MAX_TEXT = 300
const IGNORED_TOOLS = new Set(['report_intent'])

export function buildCopilotTrace(events: any[]): TraceEvent[] {
  const out: TraceEvent[] = []
  const ignored = new Set<string>()
  for (const e of events) {
    const d = e?.data ?? {}
    const timestamp: string = typeof e?.timestamp === 'string' ? e.timestamp : ''
    const sidechain = typeof d.parentToolCallId === 'string' && d.parentToolCallId !== ''
    const push = (kind: TraceEvent['kind'], text: string, toolName?: string) =>
      out.push(toolName === undefined ? { timestamp, kind, sidechain, text: text.slice(0, MAX_TEXT) } : { timestamp, kind, sidechain, text: text.slice(0, MAX_TEXT), toolName })
    if (e?.type === 'user.message' && typeof d.content === 'string') push('user', d.content)
    else if (e?.type === 'assistant.message' && typeof d.content === 'string' && d.content.trim()) push('assistant', d.content)
    else if (e?.type === 'tool.execution_start' && typeof d.toolName === 'string') {
      if (IGNORED_TOOLS.has(d.toolName)) ignored.add(d.toolCallId)
      else push('tool_use', JSON.stringify(d.arguments ?? {}), d.toolName)
    } else if (e?.type === 'tool.execution_complete' && !ignored.has(d.toolCallId)) {
      push('tool_result', d.success === false ? String(d.error?.message ?? 'error') : String(d.result?.content ?? ''))
    }
  }
  return out
}

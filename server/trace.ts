import type { TraceEvent } from '../shared/types.ts'

const MAX_TEXT = 300

function resultText(c: any): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ')
  return ''
}

function eventsOf(l: any, fromSubagent: boolean): TraceEvent[] {
  const sidechain = l.isSidechain === true || fromSubagent
  const timestamp: string = l.timestamp ?? ''
  const ev = (kind: TraceEvent['kind'], text: string, toolName?: string): TraceEvent =>
    toolName === undefined
      ? { timestamp, kind, sidechain, text: text.slice(0, MAX_TEXT) }
      : { timestamp, kind, sidechain, text: text.slice(0, MAX_TEXT), toolName }
  const c = l.message?.content
  const out: TraceEvent[] = []
  if (l.type === 'user') {
    if (l.isMeta === true) return out
    if (typeof c === 'string') return [ev('user', c)]
    if (!Array.isArray(c)) return out
    for (const b of c) {
      if (b?.type === 'text') out.push(ev('user', String(b.text ?? '')))
      else if (b?.type === 'tool_result') out.push(ev('tool_result', resultText(b.content)))
    }
  } else if (l.type === 'assistant' && Array.isArray(c)) {
    for (const b of c) {
      if (b?.type === 'text') out.push(ev('assistant', String(b.text ?? '')))
      else if (b?.type === 'tool_use') out.push(ev('tool_use', JSON.stringify(b.input ?? {}), String(b.name)))
    }
  }
  return out
}

export function buildTrace(parent: any[], subagents: any[][]): TraceEvent[] {
  const out: TraceEvent[] = []
  for (const l of parent) out.push(...eventsOf(l, false))
  for (const file of subagents) for (const l of file) out.push(...eventsOf(l, true))
  return out
}

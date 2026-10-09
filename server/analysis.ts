import type { Analysis, BuiltinToolStats, HookStats, McpAnalysis, McpToolUsage, SkillAnalysis, SkillSequences, ToolCalls, UsageFunnel, Verdict } from '../shared/types.ts'
import type { SessionRecord } from './record.ts'
import { localDate, recordsInRange } from './aggregate.ts'

export const VERDICT_ORDER: Verdict[] = ['problematic', 'useful', 'occasional', 'unused', 'insufficient']

export function verdict(f: Omit<UsageFunnel, 'verdict'>, w?: { windows: number; interruptedPct: number | null }): Verdict {
  if (f.calls >= 5 && (f.errorRatePct ?? 0) >= 20) return 'problematic'
  if (w && w.windows >= 5 && (w.interruptedPct ?? 0) >= 30) return 'problematic'
  if (f.sessionsUsed >= 1 && (f.adoptionPct ?? 0) >= 10 && f.usedDays >= 2 && (f.errorRatePct ?? 0) < 10) return 'useful'
  if (f.sessionsUsed >= 1) return 'occasional'
  if (f.sessionsLoaded >= 5) return 'unused'
  return 'insufficient'
}

const pct = (n: number, d: number): number | null => (d === 0 ? null : (n / d) * 100)

function funnel(loaded: number, used: number, calls: { error: boolean }[], usedAt: string[]): Omit<UsageFunnel, 'verdict'> {
  const errors = calls.filter(c => c.error).length
  const last = usedAt.reduce<string | null>((m, t) => (m === null || Date.parse(t) > Date.parse(m) ? t : m), null)
  return {
    sessionsLoaded: loaded, sessionsUsed: used, adoptionPct: pct(used, loaded),
    calls: calls.length, errors, errorRatePct: pct(errors, calls.length),
    usedDays: new Set(usedAt.map(t => localDate(new Date(t)))).size, lastUsedAt: last,
  }
}

const byVerdict = <T extends UsageFunnel>(key: (x: T) => string) => (a: T, b: T) =>
  VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.calls - a.calls || key(a).localeCompare(key(b))

const stamps = (xs: { ts: string | null }[]): string[] => xs.flatMap(x => (x.ts === null ? [] : [x.ts]))

function skillSequences(rs: SessionRecord[]): SkillSequences {
  const paths = new Map<string, { path: string[]; sessions: number }>()
  const trans = new Map<string, { from: string; to: string | null; count: number }>()
  for (const { skillSequence: s } of rs) {
    if (s.length >= 2) {
      const k = s.join('\u0000')
      const p = paths.get(k) ?? { path: s, sessions: 0 }
      p.sessions++
      paths.set(k, p)
    }
    s.forEach((from, i) => {
      const to = s[i + 1] ?? null
      const k = `${from}\u0000${to ?? ''}`
      const t = trans.get(k) ?? { from, to, count: 0 }
      t.count++
      trans.set(k, t)
    })
  }
  const label = (p: string[]) => p.join(' → ')
  return {
    top: [...paths.values()].sort((a, b) => b.sessions - a.sessions || label(a.path).localeCompare(label(b.path))).slice(0, 10),
    transitions: [...trans.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from)
      || (a.to === null ? 1 : 0) - (b.to === null ? 1 : 0) || (a.to ?? '').localeCompare(b.to ?? '')),
  }
}

export function computeAnalysis(records: SessionRecord[], from: Date, to: Date): Analysis {
  const rs = recordsInRange(records, from, to)

  const skillNames = new Set(rs.flatMap(r => r.summary.skills))
  const skills: SkillAnalysis[] = [...skillNames].map(name => {
    const loaded = rs.filter(r => r.summary.skills.includes(name)).length
    const used = rs.filter(r => r.summary.skillsUsed.includes(name)).length
    const calls = rs.flatMap(r => r.skillCalls).filter(c => c.skill === name)
    const attributed = rs.flatMap(r => r.messages).filter(m => m.skill === name)
    const f = funnel(loaded, used, calls, [...stamps(calls), ...stamps(attributed)])
    const ws = rs.flatMap(r => r.skillWindows).filter(w => w.skill === name)
    const wCalls = ws.reduce((n, w) => n + w.toolCalls, 0)
    const interruptedPct = pct(ws.filter(w => w.interrupted).length, ws.length)
    const costUsd = attributed.reduce((n, m) => n + m.costUsd, 0)
    const listed = rs.filter(r => r.skillListingChars[name] !== undefined)
      .reduce<SessionRecord | null>((best, r) => (best === null || Date.parse(r.summary.startedAt) > Date.parse(best.summary.startedAt) ? r : best), null)
    return {
      name, plugin: name.includes(':') ? name.slice(0, name.indexOf(':')) : null, ...f,
      tokens: attributed.reduce((n, m) => n + m.tokens.total, 0),
      costUsd,
      verdict: verdict(f, { windows: ws.length, interruptedPct }),
      windows: ws.length,
      windowErrorRatePct: pct(ws.reduce((n, w) => n + w.toolErrors, 0), wCalls),
      interruptedPct,
      linesEdited: ws.reduce((n, w) => n + w.linesEdited, 0),
      commitPct: pct(ws.filter(w => w.committed).length, ws.length),
      costPerWindow: ws.length ? costUsd / ws.length : null,
      contextTokensEst: listed ? Math.ceil(listed.skillListingChars[name] / 4) * loaded : null,
    }
  }).sort(byVerdict(x => x.name))

  const serverNames = new Set(rs.flatMap(r => r.summary.mcpServers))
  const mcpServers: McpAnalysis[] = [...serverNames].map(server => {
    const loaded = rs.filter(r => r.summary.mcpServers.includes(server)).length
    const used = rs.filter(r => r.summary.mcpServersUsed.includes(server)).length
    const calls = rs.flatMap(r => r.mcpCalls).filter(c => c.server === server)
    const f = funnel(loaded, used, calls, stamps(calls))
    const available = new Set(rs.flatMap(r => r.mcpTools[server] ?? []))
    const byTool = new Map<string, McpToolUsage>()
    for (const c of calls) {
      const t = byTool.get(c.tool) ?? { name: c.tool, calls: 0, errors: 0 }
      t.calls++
      if (c.error) t.errors++
      byTool.set(c.tool, t)
    }
    const tools = [...byTool.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    const own = rs.flatMap(r => r.messages).filter(m => m.mcpServer === server)
    const costUsd = own.reduce((n, m) => n + m.costUsd, 0)
    return {
      server, ...f, toolsAvailable: available.size || null, tools, verdict: verdict(f),
      tokens: own.reduce((n, m) => n + m.tokens.total, 0), costUsd, costPerCall: calls.length ? costUsd / calls.length : null,
    }
  }).sort(byVerdict(x => x.server))

  const toolMix: ToolCalls = { total: 0, skills: 0, mcp: 0, builtin: 0 }
  for (const r of rs) for (const k of ['total', 'skills', 'mcp', 'builtin'] as const) toolMix[k] += r.summary.toolCalls[k]

  return {
    sessions: rs.length, skills, mcpServers, sequences: skillSequences(rs),
    toolMix, loadedSkills: skillNames.size, loadedMcpServers: serverNames.size,
    skillContextTokensEst: skills.reduce((n, x) => n + (x.contextTokensEst ?? 0), 0),
    builtinTools: builtinTools(rs), hooks: hookStats(rs),
  }
}

function builtinTools(rs: SessionRecord[]): BuiltinToolStats[] {
  const by = new Map<string, BuiltinToolStats>()
  for (const r of rs) for (const [name, st] of Object.entries(r.toolStats)) {
    const e = by.get(name) ?? { name, sessions: 0, calls: 0, errors: 0, errorRatePct: null, rejections: 0 }
    e.sessions++
    e.calls += st.calls
    e.errors += st.errors
    e.rejections += st.rejections
    by.set(name, e)
  }
  return [...by.values()].map(e => ({ ...e, errorRatePct: pct(e.errors, e.calls) })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

function hookStats(rs: SessionRecord[]): HookStats[] {
  const by = new Map<string, HookStats & { chars: number; ids: Set<string> }>()
  for (const r of rs) for (const h of r.hooks) {
    const k = `${h.event}\u0000${h.name}`
    const e = by.get(k) ?? { event: h.event, name: h.name, sessions: 0, runs: 0, contextTokensEst: 0, chars: 0, ids: new Set<string>() }
    e.runs++
    e.chars += h.contextChars
    e.ids.add(r.summary.id)
    by.set(k, e)
  }
  return [...by.values()].map(({ chars, ids, ...e }) => ({ ...e, sessions: ids.size, contextTokensEst: Math.ceil(chars / 4) }))
    .sort((a, b) => b.runs - a.runs || a.event.localeCompare(b.event) || a.name.localeCompare(b.name))
}

import type { HotFile, Phase, PhaseSource, PhaseStats, Rework, SubagentGroup, Workflow } from '../shared/types.ts'
import type { SessionRecord } from './record.ts'
import { daysInRange, localDate, recordsInRange } from './aggregate.ts'
import { PHASES } from './phase.ts'
import { computeModels } from './models.ts'

const pct = (n: number, d: number): number | null => (d === 0 ? null : (n / d) * 100)
const zeroSources = (): Record<PhaseSource, number> => ({ skill: 0, tool: 0, inherited: 0, none: 0 })
const zeroPhases = (): Record<Phase, number> => Object.fromEntries(PHASES.map(p => [p, 0])) as Record<Phase, number>

export function computeWorkflow(records: SessionRecord[], from: Date, to: Date): Workflow {
  const lo = from.getTime()
  const hi = to.getTime()
  const rs = recordsInRange(records, from, to)

  const stats = new Map<Phase, PhaseStats>(PHASES.map(phase => [phase, {
    phase, sessions: 0, messages: 0, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 },
    costUsd: 0, costPct: null, byModel: {}, bySource: zeroSources(),
  }]))
  const coverage = zeroSources()
  let total = 0
  let count = 0
  for (const r of rs) {
    const seen = new Set<Phase>()
    for (const m of r.messages) {
      const p = stats.get(m.phase)!
      if (!seen.has(m.phase)) { seen.add(m.phase); p.sessions++ }
      p.messages++
      p.tokens.input += m.tokens.input
      p.tokens.output += m.tokens.output
      p.tokens.cacheCreation += m.tokens.cacheCreation
      p.tokens.cacheRead += m.tokens.cacheRead
      p.tokens.total += m.tokens.total
      p.costUsd += m.costUsd
      const bm = p.byModel[m.model] ?? (p.byModel[m.model] = { messages: 0, tokens: 0, costUsd: 0 })
      bm.messages++
      bm.tokens += m.tokens.total
      bm.costUsd += m.costUsd
      p.bySource[m.phaseSource]++
      coverage[m.phaseSource]++
      total += m.costUsd
      count++
    }
  }
  const phases = [...stats.values()].map(p => ({ ...p, costPct: pct(p.costUsd, total) }))

  const byDate = new Map(daysInRange(from, to).map(date => [date, zeroPhases()]))
  for (const r of records) for (const m of r.messages) {
    if (m.ts === null) continue
    const t = Date.parse(m.ts)
    if (!(t >= lo && t < hi)) continue
    byDate.get(localDate(new Date(t)))![m.phase] += m.costUsd
  }

  type Group = SubagentGroup & { ids: Set<string>; durSum: number; durN: number; dated: { at: string; text: string }[] }
  const groups = new Map<string, Group>()
  let subCost = 0
  for (const r of rs) for (const run of r.subagents) {
    const key = `${run.agentType}\u0000${run.phase}`
    const g: Group = groups.get(key) ?? {
      agentType: run.agentType, phase: run.phase, runs: 0, sessions: 0, models: {}, tokens: 0, costUsd: 0,
      toolCalls: 0, toolErrors: 0, errorRatePct: null, avgDurationMs: null, examples: [], costPerRun: null,
      ids: new Set<string>(), durSum: 0, durN: 0, dated: [],
    }
    g.runs++
    g.ids.add(r.summary.id)
    g.models[run.model] = (g.models[run.model] ?? 0) + 1
    g.tokens += run.tokens
    g.costUsd += run.costUsd
    g.toolCalls += run.toolCalls
    g.toolErrors += run.toolErrors
    if (run.durationMs !== null) { g.durSum += run.durationMs; g.durN++ }
    if (run.description) g.dated.push({ at: run.startedAt ?? '', text: run.description })
    subCost += run.costUsd
    groups.set(key, g)
  }
  const subagents: SubagentGroup[] = [...groups.values()].map(({ ids, durSum, durN, dated, ...g }) => ({
    ...g, sessions: ids.size, errorRatePct: pct(g.toolErrors, g.toolCalls), avgDurationMs: durN ? durSum / durN : null, costPerRun: g.runs ? g.costUsd / g.runs : null,
    examples: [...new Set(dated.sort((a, b) => b.at.localeCompare(a.at)).map(d => d.text))].slice(0, 3),
  })).sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs || a.agentType.localeCompare(b.agentType) || a.phase.localeCompare(b.phase))

  return {
    sessions: rs.length, phases,
    daily: [...byDate].map(([date, byPhase]) => ({ date, byPhase })),
    subagents, subagentCostPct: pct(subCost, total),
    models: computeModels(rs), phaseFlow: phaseFlow(rs), rework: rework(rs),
    coverage: count ? { skill: coverage.skill / count * 100, tool: coverage.tool / count * 100, inherited: coverage.inherited / count * 100, none: coverage.none / count * 100 } : zeroSources(),
  }
}

function phaseFlow(rs: SessionRecord[]): { from: Phase; to: Phase; count: number }[] {
  const by = new Map<string, { from: Phase; to: Phase; count: number }>()
  for (const r of rs) for (const { from, to } of r.phaseFlow) {
    const k = `${from}>${to}`
    const e = by.get(k) ?? { from, to, count: 0 }
    e.count++
    by.set(k, e)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
}

export const relativeTo = (file: string, cwd: string): string => {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return file.startsWith(root) ? file.slice(root.length) : file
}

function rework(rs: SessionRecord[]): Rework {
  const by = new Map<string, HotFile>()
  for (const r of rs) for (const [file, n] of Object.entries(r.fileEdits)) {
    const e = by.get(file) ?? { file: relativeTo(file, r.summary.project), project: r.summary.project, edits: 0, sessions: 0, reworkEdits: 0 }
    e.edits += n
    e.sessions++
    e.reworkEdits += Math.max(0, n - 1)
    by.set(file, e)
  }
  const edits = rs.reduce((n, r) => n + r.summary.edits, 0)
  const reworkEdits = rs.reduce((n, r) => n + r.summary.reworkEdits, 0)
  return {
    edits, reworkEdits, reworkPct: pct(reworkEdits, edits),
    hotFiles: [...by.values()].sort((a, b) => b.edits - a.edits || a.file.localeCompare(b.file)).slice(0, 15),
  }
}

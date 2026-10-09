import type { Phase, PhaseStats, SkillSequences, Workflow } from '../shared/types.ts'

export const PHASE_LABEL: Record<Phase, string> = {
  explore: 'Explore', plan: 'Plan', implement: 'Implement', test: 'Test',
  review: 'Review', debug: 'Debug', ship: 'Ship', other: 'Other',
}

// Same hues as PALETTE in Charts.tsx (kept here so node tests can import it); grey for "other".
export const PHASE_COLOR: Record<Phase, string> = {
  explore: '#2a78d6', plan: '#4a3aa7', implement: '#1baf7a', test: '#eda100',
  review: '#e87ba4', debug: '#e34948', ship: '#008300', other: '#9ca3af',
}

export type MatrixMetric = 'costUsd' | 'tokens' | 'messages'

export function phaseModelMatrix(phases: PhaseStats[], metric: MatrixMetric): { models: string[]; rows: { phase: Phase; cells: number[] }[]; max: number } {
  const cost = new Map<string, number>()
  for (const p of phases) for (const [m, v] of Object.entries(p.byModel)) cost.set(m, (cost.get(m) ?? 0) + v.costUsd)
  const models = [...cost].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m)
  const rows = phases.filter(p => p.messages > 0).map(p => ({ phase: p.phase, cells: models.map(m => p.byModel[m]?.[metric] ?? 0) }))
  return { models, rows, max: Math.max(0, ...rows.flatMap(r => r.cells)) }
}

export function phaseDailyRows(daily: Workflow['daily']): ({ date: string } & Record<Phase, number>)[] {
  return daily.map(d => ({ date: d.date, ...d.byPhase }))
}

export function dominantModel(models: Record<string, number>): string | null {
  return Object.entries(models).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

export const sequenceLabel = (path: string[]): string => path.join(' → ')
export const transitionTarget = (to: string | null): string => to ?? 'end'

type Transition = SkillSequences['transitions'][number]

export function transitionOptions(transitions: Transition[]): { from: string[]; to: string[] } {
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort((a, b) => a.localeCompare(b))
  return { from: uniq(transitions.map(t => t.from)), to: uniq(transitions.map(t => transitionTarget(t.to))) }
}

// Filters store the excluded values so values that appear later stay visible by default.
export function filterTransitions(transitions: Transition[], excludedFrom: ReadonlySet<string>, excludedTo: ReadonlySet<string>): Transition[] {
  return transitions.filter(t => !excludedFrom.has(t.from) && !excludedTo.has(transitionTarget(t.to)))
}

export function workflowKpis(w: Workflow): { topPhase: { phase: Phase; costUsd: number; costPct: number | null } | null; subagentCostPct: number | null; classifiedPct: number } {
  const top = w.phases.reduce<PhaseStats | null>((best, p) => (p.costUsd > (best?.costUsd ?? 0) ? p : best), null)
  return {
    topPhase: top ? { phase: top.phase, costUsd: top.costUsd, costPct: top.costPct } : null,
    subagentCostPct: w.subagentCostPct,
    classifiedPct: w.coverage.skill + w.coverage.tool,
  }
}

const PHASES = Object.keys(PHASE_LABEL) as Phase[]

// Only phases that appear on either side, in canonical order; cells[from][to] = transition count.
export function phaseFlowMatrix(flow: Workflow['phaseFlow']): { phases: Phase[]; cells: number[][]; max: number } {
  const seen = new Set<Phase>(flow.flatMap(f => [f.from, f.to]))
  const phases = PHASES.filter(p => seen.has(p))
  const cells = phases.map(from => phases.map(to => flow.find(f => f.from === from && f.to === to)?.count ?? 0))
  return { phases, cells, max: Math.max(0, ...cells.flat()) }
}

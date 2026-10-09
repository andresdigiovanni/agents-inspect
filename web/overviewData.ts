import type { BreakdownDim, BreakdownRow, PeriodMetrics } from '../shared/types.ts'

export interface TimeSegment { key: 'model' | 'retries' | 'tools' | 'other'; label: string; ms: number }

export function timeSplit(m: Pick<PeriodMetrics, 'activeMs' | 'apiMs' | 'retryMs' | 'toolMs'>): TimeSegment[] {
  return [
    { key: 'model', label: 'Model', ms: Math.max(0, m.apiMs - m.retryMs) },
    { key: 'retries', label: 'Retries', ms: m.retryMs },
    { key: 'tools', label: 'Tools', ms: m.toolMs },
    { key: 'other', label: 'Other (you, idle, harness)', ms: Math.max(0, m.activeMs - m.apiMs - m.toolMs) },
  ]
}

export const BREAKDOWN_DIMS: { value: BreakdownDim; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'branch', label: 'Branch' },
  { value: 'version', label: 'Version' },
  { value: 'permissionMode', label: 'Permission mode' },
  { value: 'effort', label: 'Effort' },
]

export const shortPath = (p: string): string => p.split('/').filter(Boolean).slice(-2).join('/') || p

export function breakdownView(rows: BreakdownRow[], dim: BreakdownDim): (BreakdownRow & { label: string; title: string; barPct: number })[] {
  const max = Math.max(0, ...rows.map((r) => r.costUsd))
  return rows.map((r) => ({
    ...r,
    label: r.key === null ? '—' : dim === 'project' ? shortPath(r.key) : r.key,
    title: r.key ?? 'Not recorded',
    barPct: max > 0 ? (r.costUsd / max) * 100 : 0,
  }))
}

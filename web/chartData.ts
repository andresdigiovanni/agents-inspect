import type { DailyPoint } from '../shared/types.ts'

export type ModelMetric = 'costUsd' | 'tokens'

export function modelSeries(
  daily: DailyPoint[],
  metric: ModelMetric,
): { models: string[]; rows: Array<Record<string, string | number>> } {
  const totals = new Map<string, number>()
  for (const d of daily) {
    for (const [model, v] of Object.entries(d.byModel)) totals.set(model, (totals.get(model) ?? 0) + v[metric])
  }
  const models = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b))
  const rows = daily.map((d) => {
    const row: Record<string, string | number> = { date: d.date }
    for (const m of models) row[m] = d.byModel[m]?.[metric] ?? 0
    return row
  })
  return { models, rows }
}

export function modelColors(models: string[], palette: readonly string[]): Record<string, string> {
  const colors: Record<string, string> = {}
  ;[...models].sort().forEach((m, i) => {
    colors[m] = palette[i % palette.length]!
  })
  return colors
}

// Share of the accent colour mixed into an hour cell: 0 for no activity, then 15–100% proportional to n/max.
export function heatPct(n: number, max: number): number {
  return n <= 0 || max <= 0 ? 0 : 15 + (85 * n) / max
}

// SVG polyline points scaled to w×h (y grows downwards, 0 at the bottom).
export function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const step = values.length > 1 ? w / (values.length - 1) : 0
  return values.map((v, i) => `${(i * step).toFixed(1)},${(max > 0 ? h - (v / max) * h : h).toFixed(1)}`).join(' ')
}

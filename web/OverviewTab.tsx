import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { PeriodMetrics } from '../shared/types.ts'
import { getSummary } from './api.ts'
import { modelColors } from './chartData.ts'
import { ActivityChart, BreakdownPanel, Heatmap, ModelChart, PALETTE, TimeSplitBar } from './Charts.tsx'
import { ErrorBanner, errorMessage } from './ErrorBanner.tsx'
import { KpiCards } from './KpiCards.tsx'
import type { Query } from './api.ts'

type Range = Query

function Charts(props: { metrics: PeriodMetrics }): JSX.Element {
  const { metrics } = props
  const models = new Set<string>()
  for (const d of metrics.daily) for (const m of Object.keys(d.byModel)) models.add(m)
  const colors = modelColors([...models], PALETTE)
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ModelChart daily={metrics.daily} colors={colors} />
      </div>
      <ActivityChart daily={metrics.daily} />
      <Heatmap heatmap={metrics.heatmap} heatmapCost={metrics.heatmapCost} />
      <div className="lg:col-span-2">
        <TimeSplitBar metrics={metrics} />
      </div>
      <div className="lg:col-span-2">
        <BreakdownPanel breakdowns={metrics.breakdowns} />
      </div>
    </section>
  )
}

export function OverviewTab(props: { range: Range | null }): JSX.Element {
  const { range } = props
  const [loaded, setLoaded] = useState<{ range: Range; metrics: PeriodMetrics } | null>(null)
  const [failed, setFailed] = useState<{ range: Range; message: string } | null>(null)
  const metrics = loaded !== null && loaded.range === range ? loaded.metrics : null
  const error = failed !== null && failed.range === range ? failed.message : null

  useEffect(() => {
    if (range === null) return
    let cancelled = false
    getSummary(range).then(
      (m) => { if (!cancelled) setLoaded({ range, metrics: m }) },
      (e: unknown) => { if (!cancelled) setFailed({ range, message: errorMessage(e) }) },
    )
    return () => { cancelled = true }
  }, [range])

  if (range === null) return <p className="text-sm text-gray-500">Select a valid date range.</p>
  return (
    <div className="space-y-8">
      {error !== null && <ErrorBanner message={error} />}
      {metrics === null ? (
        error === null && <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <KpiCards metrics={metrics} />
          <Charts metrics={metrics} />
        </>
      )}
    </div>
  )
}

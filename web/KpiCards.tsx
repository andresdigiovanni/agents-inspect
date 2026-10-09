import type { JSX, ReactNode } from 'react'
import type { PeriodMetrics } from '../shared/types.ts'
import { formatCompact, formatDuration, formatHours, formatInt, formatPct, formatRatio, formatUsd, trendView } from './format.ts'

const toneClass = {
  good: 'text-green-700 bg-green-50',
  bad: 'text-red-700 bg-red-50',
  flat: 'text-gray-500 bg-gray-100',
}

// For cost-like metrics an increase is bad, so `invert` swaps the colours (the sign of the label stays).
export function TrendBadge(props: { pct: number | null; invert?: boolean }): JSX.Element {
  const { label, tone } = trendView(props.pct)
  const t = tone === 'flat' ? 'flat' : (tone === 'up') !== (props.invert === true) ? 'good' : 'bad'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[t]}`} title="vs. previous period of the same length">{label}</span>
}

function Card(props: { title: string; children: ReactNode; extra?: ReactNode; note?: ReactNode; help?: string; hero?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" title={props.help}>
      <div className="text-sm text-gray-500">{props.title}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`${props.hero === true ? 'text-3xl' : 'text-2xl'} font-semibold tabular-nums`}>{props.children}</span>
        {props.extra}
      </div>
      {props.note !== undefined && <div className="mt-1 text-xs text-gray-500 tabular-nums">{props.note}</div>}
    </div>
  )
}

function Group(props: { title: string; className: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{props.title}</h2>
      <div className={`grid grid-cols-2 gap-4 ${props.className}`}>{props.children}</div>
    </section>
  )
}

export function KpiCards(props: { metrics: PeriodMetrics }): JSX.Element {
  const m = props.metrics
  return (
    <div className="space-y-4">
      <Group title="Spend and output" className="md:grid-cols-4">
        <Card hero title="Cost" extra={<TrendBadge pct={m.costTrendPct} invert />}>{formatUsd(m.costUsd)}</Card>
        <Card hero title="Sessions" extra={<TrendBadge pct={m.conversationsTrendPct} />}>{formatInt(m.conversations)}</Card>
        <Card hero title="Active time" extra={<TrendBadge pct={m.activeTrendPct} />}>{formatHours(m.activeMs)}</Card>
        <Card hero title="Cost per commit" extra={<TrendBadge pct={m.costPerCommitTrendPct} invert />}
          help="Total cost divided by git commits made by the agent (Bash tool calls running git commit).">
          {formatUsd(m.costPerCommit)}
        </Card>
      </Group>
      <Group title="Efficiency" className="md:grid-cols-5">
        <Card title="Median cost / session" note={`p90 ${formatUsd(m.p90CostPerSession)}`} help="Median is robust to a few huge sessions; p90 shows the expensive tail.">
          {formatUsd(m.medianCostPerSession)}
        </Card>
        <Card title="Cost / active hour">{formatUsd(m.costPerActiveHour)}</Card>
        <Card title="Fresh tokens" extra={<TrendBadge pct={m.freshTokensTrendPct} invert />} help="Input + cache writes + output. Cache reads are excluded: they are cheap and dominate raw totals.">
          {formatCompact(m.freshTokens)}
        </Card>
        <Card title="Cache hit %" note={`saved ≈ ${formatUsd(m.cacheSavingsUsd)}`} help="Estimated savings: cache reads billed at 10% of the input price instead of 100%.">
          {formatPct(m.cacheHitPct)}
        </Card>
        <Card title="Lines" note={`${formatInt(m.commits)} commits`} extra={<TrendBadge pct={m.commitsTrendPct} />}>
          {`+${formatInt(m.linesAdded)} −${formatInt(m.linesRemoved)}`}
        </Card>
      </Group>
      <Group title="Autonomy" className="md:grid-cols-4">
        <Card title="Tools per turn" help="Tool calls per prompt you typed. Higher = the agent does more per request.">{formatRatio(m.toolsPerTurn)}</Card>
        <Card title="Median turn duration" note={`p90 ${formatDuration(m.p90TurnMs)}`} help="Time from your prompt until the agent hands control back (sessions that log turn durations).">
          {formatDuration(m.medianTurnMs)}
        </Card>
        <Card title="Interruptions / session" help="Times you pressed Esc to stop the agent.">{m.interruptionsPerSession === null ? '—' : m.interruptionsPerSession.toFixed(2)}</Card>
        <Card title="Tool error %" help="Tool results flagged as errors over all tool calls (includes permission rejections).">{formatPct(m.toolErrorPct)}</Card>
      </Group>
      <p className="text-xs text-gray-500">
        Cards count sessions that <em>started</em> in the range; charts below place each message and turn on its own timestamp, so their totals can differ slightly.
      </p>
    </div>
  )
}

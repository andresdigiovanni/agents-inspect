import { Fragment, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BreakdownDim, BreakdownRow, DailyPoint, PeriodMetrics, Phase, PhaseStats, Workflow } from '../shared/types.ts'
import { heatPct, modelSeries } from './chartData.ts'
import type { ModelMetric } from './chartData.ts'
import { formatCompact, formatHours, formatInt, formatPct, formatUsd } from './format.ts'
import { BREAKDOWN_DIMS, breakdownView, timeSplit } from './overviewData.ts'
import { PHASE_COLOR, PHASE_LABEL, phaseDailyRows, phaseFlowMatrix, phaseModelMatrix } from './workflowData.ts'
import type { MatrixMetric } from './workflowData.ts'

// Categorical palette from the dataviz skill (light surface; the app has no dark theme). Fixed order; colours repeat after 8 models.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const

const SURFACE = '#ffffff'
const GRID = '#e5e7eb'
const AXIS = { fontSize: 12, fill: '#52514e' }
const HEIGHT = 260
const HEAT_EMPTY = '#f0efec'
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayLabel(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
}

function Panel(props: { title: string; actions?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">{props.title}</h3>
        {props.actions}
      </div>
      {props.children}
    </div>
  )
}

function Swatch(props: { color: string }): JSX.Element {
  return <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: props.color }} />
}

interface TipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ dataKey?: unknown; name?: unknown; value?: unknown; color?: string }>
}

function TipBox(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-800 shadow-md">
      <div className="mb-1 font-semibold">{props.title}</div>
      {props.children}
    </div>
  )
}

function SegmentedButtons<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          className={`px-2 py-1 ${props.value === o.value ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ModelChart(props: { daily: DailyPoint[]; colors: Record<string, string> }): JSX.Element {
  const [metric, setMetric] = useState<ModelMetric>('costUsd')
  const { models, rows } = modelSeries(props.daily, metric)
  const fmt = metric === 'costUsd' ? formatUsd : formatCompact
  const byDate = new Map(props.daily.map((d) => [d.date, d]))
  const tip = ({ active, label }: TipProps): JSX.Element | null => {
    const d = byDate.get(String(label))
    if (active !== true || d === undefined) return null
    return (
      <TipBox title={dayLabel(d.date)}>
        {models
          .filter((m) => d.byModel[m] !== undefined)
          .map((m) => (
            <div key={m} className="flex items-center gap-2 tabular-nums">
              <Swatch color={props.colors[m] ?? PALETTE[0]} />
              <span>{m}</span>
              <span className="ml-auto pl-3">
                {formatUsd(d.byModel[m]!.costUsd)} · {formatCompact(d.byModel[m]!.tokens)} tokens
              </span>
            </div>
          ))}
        {Object.keys(d.byModel).length === 0 && <div className="text-gray-500">No activity</div>}
      </TipBox>
    )
  }
  return (
    <Panel
      title="Cost by model and day"
      actions={
        <SegmentedButtons
          value={metric}
          onChange={setMetric}
          options={[{ value: 'costUsd', label: 'Cost' }, { value: 'tokens', label: 'Tokens' }]}
        />
      }
    >
      {models.length === 0 ? <p className="text-sm text-gray-500">No data</p> : (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <BarChart data={rows}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={dayLabel} tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis tickFormatter={(v: number) => fmt(v)} tick={AXIS} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={tip} />
            <Legend iconType="square" />
            {models.map((m, i) => (
              <Bar
                key={m}
                dataKey={m}
                stackId="m"
                fill={props.colors[m] ?? PALETTE[0]}
                stroke={SURFACE}
                strokeWidth={2}
                maxBarSize={24}
                radius={i === models.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}

function SeriesTip(props: TipProps & { format: (n: number) => string }): JSX.Element | null {
  if (props.active !== true || props.payload === undefined) return null
  return (
    <TipBox title={dayLabel(String(props.label))}>
      {props.payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 tabular-nums">
          <Swatch color={p.color ?? PALETTE[0]} />
          <span>{String(p.name)}</span>
          <span className="ml-auto pl-3">{props.format(Number(p.value))}</span>
        </div>
      ))}
    </TipBox>
  )
}

export function ActivityChart(props: { daily: DailyPoint[] }): JSX.Element {
  return (
    <Panel title="Sessions and turns per day">
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <ComposedChart data={props.daily}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={dayLabel} tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={(p: TipProps) => <SeriesTip {...p} format={formatInt} />} />
          <Legend iconType="square" />
          <Bar dataKey="sessions" name="Sessions" fill={PALETTE[0]} maxBarSize={24} radius={[4, 4, 0, 0]} />
          <Line
            dataKey="userTurns"
            name="User turns"
            stroke={PALETTE[1]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 4, stroke: SURFACE, strokeWidth: 2, fill: PALETTE[1] }}
            activeDot={{ r: 6, stroke: SURFACE, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

const HEAT_OPTIONS = [
  { value: 'turns', label: 'Turns' },
  { value: 'cost', label: 'Cost' },
] as const

export function Heatmap(props: { heatmap: number[][]; heatmapCost: number[][] }): JSX.Element {
  const [metric, setMetric] = useState<'turns' | 'cost'>('turns')
  const grid = metric === 'turns' ? props.heatmap : props.heatmapCost
  const fmt = metric === 'turns' ? (n: number) => `${formatInt(n)} turns` : formatUsd
  const max = Math.max(0, ...grid.flat())
  const [hover, setHover] = useState<{ day: string; hour: number; n: number } | null>(null)
  return (
    <Panel
      title="Activity by hour"
      actions={
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600 tabular-nums" aria-live="polite">
            {hover === null ? 'Hover over a cell' : `${hover.day} ${hover.hour}:00–${hover.hour + 1}:00 · ${fmt(hover.n)}`}
          </span>
          <SegmentedButtons value={metric} options={HEAT_OPTIONS} onChange={setMetric} />
        </div>
      }
    >
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[480px] gap-0.5 text-[10px] text-gray-600"
          style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }}
          onMouseLeave={() => setHover(null)}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center tabular-nums">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
          {DAYS.map((day, r) => (
            <HeatRow key={day} day={day} values={grid[r] ?? []} max={max} fmt={fmt} hoverHour={hover?.day === day ? hover.hour : null} onHover={(hour, n) => setHover({ day, hour, n })} />
          ))}
        </div>
      </div>
    </Panel>
  )
}

function HeatRow(props: { day: string; values: number[]; max: number; fmt: (n: number) => string; hoverHour: number | null; onHover: (hour: number, n: number) => void }): JSX.Element {
  return (
    <>
      <div className="pr-1 text-right leading-5">{props.day}</div>
      {Array.from({ length: 24 }, (_, h) => {
        const n = props.values[h] ?? 0
        return (
          <div
            key={h}
            title={`${props.day} ${h}:00 — ${props.fmt(n)}`}
            onMouseEnter={() => props.onHover(h, n)}
            className={`h-5 rounded-sm ${props.hoverHour === h ? 'ring-2 ring-gray-800' : ''}`}
            style={{ backgroundColor: `color-mix(in srgb, ${PALETTE[0]} ${heatPct(n, props.max)}%, ${HEAT_EMPTY})` }}
          />
        )
      })}
    </>
  )
}

export function BreakdownPanel(props: { breakdowns: Record<BreakdownDim, BreakdownRow[]> }): JSX.Element {
  const [dim, setDim] = useState<BreakdownDim>('project')
  const rows = breakdownView(props.breakdowns[dim], dim)
  return (
    <Panel
      title="Breakdown"
      actions={
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Group by
          <select value={dim} onChange={(e) => setDim(e.target.value as BreakdownDim)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs">
            {BREAKDOWN_DIMS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
      }
    >
      {rows.length === 0 ? <p className="text-sm text-gray-500">No data</p> : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-medium">{BREAKDOWN_DIMS.find((d) => d.value === dim)?.label}</th>
                <th className="py-1 pr-2 font-medium">Cost</th>
                <th className="py-1 pr-2 text-right font-medium">Sessions</th>
                <th className="py-1 pr-2 text-right font-medium">Median / session</th>
                <th className="py-1 pr-2 text-right font-medium">Commits</th>
                <th className="py-1 pr-2 text-right font-medium">Interrupts / session</th>
                <th className="py-1 text-right font-medium">Tool error %</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.key ?? '\0'} className="border-t border-gray-100">
                  <td className="max-w-[16rem] truncate py-1 pr-2" title={r.title}>{r.label}</td>
                  <td className="w-48 py-1 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-sm bg-gray-100">
                        <div className="h-2 rounded-sm" style={{ width: `${r.barPct}%`, backgroundColor: PALETTE[0] }} />
                      </div>
                      <span className="w-16 text-right">{formatUsd(r.costUsd)}</span>
                    </div>
                  </td>
                  <td className="py-1 pr-2 text-right">{formatInt(r.sessions)}</td>
                  <td className="py-1 pr-2 text-right">{formatUsd(r.medianCostPerSession)}</td>
                  <td className="py-1 pr-2 text-right">{formatInt(r.commits)}</td>
                  <td className="py-1 pr-2 text-right">{r.interruptionsPerSession === null ? '—' : r.interruptionsPerSession.toFixed(2)}</td>
                  <td className="py-1 text-right">{formatPct(r.toolErrorPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

const SPLIT_COLOR = { model: PALETTE[0], retries: PALETTE[7], tools: PALETTE[2], other: '#c9c7c1' } as const

export function TimeSplitBar(props: { metrics: PeriodMetrics }): JSX.Element {
  const segs = timeSplit(props.metrics)
  const total = segs.reduce((a, s) => a + s.ms, 0)
  return (
    <Panel title="Where active time goes">
      {total === 0 ? <p className="text-sm text-gray-500">No timing data</p> : (
        <>
          <div className="flex h-4 overflow-hidden rounded-sm">
            {segs.map((s) => s.ms > 0 && (
              <div key={s.key} title={`${s.label}: ${formatHours(s.ms)}`} style={{ width: `${(s.ms / total) * 100}%`, backgroundColor: SPLIT_COLOR[s.key] }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700 tabular-nums">
            {segs.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <Swatch color={SPLIT_COLOR[s.key]} /> {s.label} {formatHours(s.ms)} ({Math.round((s.ms / total) * 100)}%)
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">Model and tool time can overlap (parallel tools), so “other” is a lower bound.</p>
        </>
      )}
    </Panel>
  )
}

const PHASE_ORDER = Object.keys(PHASE_LABEL) as Phase[]

const MATRIX_OPTIONS = [
  { value: 'costUsd', label: 'Cost' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'messages', label: 'Messages' },
] as const

export function PhaseModelHeatmap(props: { phases: PhaseStats[] }): JSX.Element {
  const [metric, setMetric] = useState<MatrixMetric>('costUsd')
  const { models, rows, max } = phaseModelMatrix(props.phases, metric)
  const fmt = metric === 'costUsd' ? formatUsd : metric === 'tokens' ? formatCompact : formatInt
  return (
    <Panel title="Phase × model" actions={<SegmentedButtons value={metric} options={MATRIX_OPTIONS} onChange={setMetric} />}>
      {rows.length === 0 ? <p className="text-sm text-gray-500">No messages in this range.</p> : (
        <div className="overflow-x-auto">
          <div className="grid gap-0.5 text-xs text-gray-700" style={{ gridTemplateColumns: `auto repeat(${models.length}, minmax(5rem, 1fr))` }}>
            <div />
            {models.map((m) => <div key={m} className="truncate px-1 text-center text-[10px] text-gray-600" title={m}>{m}</div>)}
            {rows.map((r) => (
              <Fragment key={r.phase}>
                <div className="pr-2 text-right leading-7">{PHASE_LABEL[r.phase]}</div>
                {r.cells.map((n, i) => (
                  <div
                    key={models[i]}
                    title={`${PHASE_LABEL[r.phase]} · ${models[i]} — ${fmt(n)}`}
                    className="flex h-7 items-center justify-center rounded-sm tabular-nums"
                    style={{ backgroundColor: `color-mix(in srgb, ${PALETTE[0]} ${heatPct(n, max)}%, ${HEAT_EMPTY})` }}
                  >
                    {n > 0 ? fmt(n) : ''}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

export function PhaseFlowHeatmap(props: { flow: Workflow['phaseFlow'] }): JSX.Element {
  const { phases, cells, max } = phaseFlowMatrix(props.flow)
  return (
    <Panel title="Phase flow (from → to)">
      {phases.length === 0 ? <p className="text-sm text-gray-500">No phase changes in this range.</p> : (
        <div className="overflow-x-auto">
          <div className="grid gap-0.5 text-xs text-gray-700" style={{ gridTemplateColumns: `auto repeat(${phases.length}, minmax(3.5rem, 1fr))` }}>
            <div className="pr-2 text-right text-[10px] text-gray-500">from ↓ to →</div>
            {phases.map((p) => <div key={p} className="px-1 text-center text-[10px] text-gray-600">{PHASE_LABEL[p]}</div>)}
            {phases.map((from, r) => (
              <Fragment key={from}>
                <div className="pr-2 text-right leading-7">{PHASE_LABEL[from]}</div>
                {cells[r].map((n, c) => (
                  <div
                    key={phases[c]}
                    title={`${PHASE_LABEL[from]} → ${PHASE_LABEL[phases[c]]}: ${formatInt(n)} times`}
                    className="flex h-7 items-center justify-center rounded-sm tabular-nums"
                    style={{ backgroundColor: from === phases[c] ? '#ffffff' : `color-mix(in srgb, ${PALETTE[0]} ${heatPct(n, max)}%, ${HEAT_EMPTY})` }}
                  >
                    {n > 0 ? formatInt(n) : ''}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">Counts each change of phase between consecutive main-thread messages (“Other” skipped). Strong Test → Implement or Implement → Debug loops suggest rework.</p>
        </div>
      )}
    </Panel>
  )
}

export function PhaseChart(props: { daily: Workflow['daily'] }): JSX.Element {
  const rows = phaseDailyRows(props.daily)
  return (
    <Panel title="Cost by phase and day">
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart data={rows}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={dayLabel} tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tickFormatter={(v: number) => formatUsd(v)} tick={AXIS} axisLine={false} tickLine={false} width={64} />
          <Tooltip content={(p: TipProps) => <SeriesTip {...p} format={formatUsd} />} />
          <Legend iconType="square" />
          {PHASE_ORDER.map((ph, i) => (
            <Bar
              key={ph}
              dataKey={ph}
              name={PHASE_LABEL[ph]}
              stackId="p"
              fill={PHASE_COLOR[ph]}
              stroke={SURFACE}
              strokeWidth={2}
              maxBarSize={24}
              radius={i === PHASE_ORDER.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

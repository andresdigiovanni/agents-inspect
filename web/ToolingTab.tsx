import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ExpandedState, SortingState } from '@tanstack/react-table'
import type { Analysis, BuiltinToolStats, HookStats, McpAnalysis, SkillAnalysis, SkillSequences, Verdict } from '../shared/types.ts'
import { getTooling } from './api.ts'
import { PALETTE } from './Charts.tsx'
import { ErrorBanner, errorMessage } from './ErrorBanner.tsx'
import { formatCompact, formatInt, formatPct, formatUsd } from './format.ts'
import { Badge, dash, ExpandToggle, head, lastUsed, NameLink, SortableTable, th, verdictSort, wrap } from './SortableTable.tsx'
import { countByVerdict, VERDICT_VIEW, VERDICTS } from './verdict.ts'
import { filterTransitions, sequenceLabel, transitionOptions, transitionTarget } from './workflowData.ts'
import { SkillGraphView } from './SkillGraphView.tsx'
import type { Query } from './api.ts'

type Range = Query | null

function VerdictLine(props: { items: readonly { verdict: Verdict }[] }): JSX.Element {
  const counts = countByVerdict(props.items)
  return <p className="text-sm text-gray-700">{VERDICTS.map((v) => `${VERDICT_VIEW[v].label} ${counts[v]}`).join(' · ')}</p>
}

const skillCol = createColumnHelper<SkillAnalysis>()

function Stacked(props: { top: ReactNode; sub: ReactNode }): JSX.Element {
  return (
    <div className="whitespace-nowrap">
      <div>{props.top}</div>
      <div className="text-xs text-gray-500">{props.sub}</div>
    </div>
  )
}

const skillColumns = [
  skillCol.accessor('verdict', { header: 'Verdict', sortingFn: verdictSort, cell: (i) => <Badge verdict={i.getValue()} /> }),
  skillCol.accessor('name', {
    header: 'Skill',
    sortingFn: 'text',
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <ExpandToggle open={row.getIsExpanded()} label={`Details of ${row.original.name}`} onToggle={row.getToggleExpandedHandler()} />{' '}
        <NameLink name={row.original.name} kind="skill" />
      </span>
    ),
  }),
  skillCol.accessor((s) => s.adoptionPct ?? undefined, {
    id: 'adoptionPct',
    header: 'Adoption',
    sortUndefined: 'last',
    cell: ({ row }) => <Stacked top={formatPct(row.original.adoptionPct)} sub={`${formatInt(row.original.sessionsUsed)} / ${formatInt(row.original.sessionsLoaded)} sessions`} />,
  }),
  skillCol.accessor('windows', { header: 'Uses', cell: (i) => formatInt(i.getValue()) }),
  skillCol.accessor('costUsd', { header: 'Cost', cell: (i) => formatUsd(i.getValue()) }),
  skillCol.accessor((s) => s.costPerWindow ?? undefined, { id: 'costPerWindow', header: 'Cost/use', sortUndefined: 'last', cell: ({ row }) => formatUsd(row.original.costPerWindow) }),
  skillCol.accessor((s) => s.commitPct ?? undefined, {
    id: 'outcome',
    header: 'Outcome',
    sortUndefined: 'last',
    cell: ({ row }) => row.original.windows === 0 ? '—' : (
      <span className="whitespace-nowrap" title="Share of uses that end with a git commit · share interrupted with Esc">
        {formatPct(row.original.commitPct)} commit · {formatPct(row.original.interruptedPct)} interrupted
      </span>
    ),
  }),
  skillCol.accessor((s) => s.lastUsedAt ?? undefined, { id: 'lastUsedAt', header: 'Last used', sortDescFirst: true, sortUndefined: 'last', cell: ({ row }) => lastUsed(row.original.lastUsedAt) }),
]

function Facts(props: { items: [string, string][] }): JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
      {props.items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="text-gray-500">{k}</dt>
          <dd className="tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function SkillDetails(props: { skill: SkillAnalysis }): JSX.Element {
  const s = props.skill
  return (
    <Facts items={[
      ['Plugin', s.plugin ?? '—'],
      ['Invocations', formatInt(s.calls)],
      ['% error', formatPct(s.errorRatePct)],
      ['Window error %', formatPct(s.windowErrorRatePct)],
      ['Days used', formatInt(s.usedDays)],
      ['Tokens', formatCompact(s.tokens)],
      ['Lines', formatInt(s.linesEdited)],
      ['Context (est.)', dash(s.contextTokensEst, formatCompact)],
    ]} />
  )
}

function SkillsTable(props: { skills: SkillAnalysis[] }): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const table = useReactTable({
    data: props.skills,
    columns: skillColumns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getRowId: (s) => s.name,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })
  return <SortableTable table={table} renderExpanded={(s) => <SkillDetails skill={s} />} />
}

function ColumnFilter(props: { label: string; options: string[]; excluded: ReadonlySet<string>; onChange: (excluded: Set<string>) => void }): JSX.Element {
  const { options, excluded } = props
  const shown = options.filter((o) => !excluded.has(o)).length
  const toggle = (o: string): void => {
    const next = new Set(excluded)
    if (next.has(o)) next.delete(o)
    else next.add(o)
    props.onChange(next)
  }
  return (
    <details className="relative inline-block">
      <summary className="cursor-pointer list-none uppercase hover:text-gray-900">
        {props.label}{shown < options.length ? ` (${shown}/${options.length})` : ''} ▾
      </summary>
      <div className="absolute left-0 z-10 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal tracking-normal text-gray-800 normal-case shadow-lg">
        <div className="mb-1 flex gap-3 border-b border-gray-100 pb-1 text-xs">
          <button type="button" className="cursor-pointer text-sky-700 hover:underline" onClick={() => props.onChange(new Set())}>All</button>
          <button type="button" className="cursor-pointer text-sky-700 hover:underline" onClick={() => props.onChange(new Set(options))}>None</button>
        </div>
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 py-0.5">
            <input type="checkbox" checked={!excluded.has(o)} onChange={() => toggle(o)} />
            <span className="truncate" title={o}>{o}</span>
          </label>
        ))}
      </div>
    </details>
  )
}

function SequencesPanel(props: { sequences: SkillSequences }): JSX.Element {
  const { top, transitions } = props.sequences
  const [excludedFrom, setExcludedFrom] = useState<ReadonlySet<string>>(new Set())
  const [excludedTo, setExcludedTo] = useState<ReadonlySet<string>>(new Set())
  const options = useMemo(() => transitionOptions(transitions), [transitions])
  const visible = filterTransitions(transitions, excludedFrom, excludedTo)
  if (transitions.length === 0) return <p className="text-sm text-gray-500">No skill invocations in this range.</p>
  return (
    <div className="space-y-4">
    <SkillGraphView transitions={transitions} />
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={wrap}>
        <table className="min-w-full text-sm">
          <thead className={head}><tr><th className={th}>Sequence</th><th className={th}>Sessions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {top.length === 0 ? <tr><td className="px-3 py-2 text-gray-500" colSpan={2}>No session chains two or more skills.</td></tr>
              : top.map((t) => (
                <tr key={t.path.join('\u0000')}>
                  <td className="px-3 py-2">{sequenceLabel(t.path)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatInt(t.sessions)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <details className="self-start">
      <summary className="cursor-pointer text-sm text-gray-700">All transitions ({formatInt(transitions.length)})</summary>
      <div className={`mt-2 ${wrap}`}>
        <table className="min-w-full text-sm">
          <thead className={head}>
            <tr>
              <th className={th}><ColumnFilter label="From" options={options.from} excluded={excludedFrom} onChange={setExcludedFrom} /></th>
              <th className={th}><ColumnFilter label="To" options={options.to} excluded={excludedTo} onChange={setExcludedTo} /></th>
              <th className={th}>Times</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.length === 0 && <tr><td className="px-3 py-2 text-gray-500" colSpan={3}>No transitions match the filter.</td></tr>}
            {visible.map((t) => (
              <tr key={`${t.from}\u0000${t.to ?? ''}`}>
                <td className="px-3 py-2">{t.from}</td>
                <td className={`px-3 py-2 ${t.to === null ? 'text-gray-500 italic' : ''}`}>{transitionTarget(t.to)}</td>
                <td className="px-3 py-2 tabular-nums">{formatInt(t.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
    </div>
    </div>
  )
}

const mcpCol = createColumnHelper<McpAnalysis>()

const mcpColumns = [
  mcpCol.accessor('verdict', { header: 'Verdict', sortingFn: verdictSort, cell: (i) => <Badge verdict={i.getValue()} /> }),
  mcpCol.accessor('server', {
    header: 'Server',
    sortingFn: 'text',
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <ExpandToggle open={row.getIsExpanded()} label={`Tools of ${row.original.server}`} onToggle={row.getToggleExpandedHandler()} />{' '}
        <NameLink name={row.original.server} kind="mcp" />
      </span>
    ),
  }),
  mcpCol.accessor('sessionsLoaded', { header: 'Loaded', cell: (i) => formatInt(i.getValue()) }),
  mcpCol.accessor('sessionsUsed', { header: 'Used', cell: (i) => formatInt(i.getValue()) }),
  mcpCol.accessor((s) => s.adoptionPct ?? undefined, { id: 'adoptionPct', header: 'Adoption', sortUndefined: 'last', cell: ({ row }) => formatPct(row.original.adoptionPct) }),
  mcpCol.accessor('calls', { header: 'Calls', cell: (i) => formatInt(i.getValue()) }),
  mcpCol.accessor((s) => s.errorRatePct ?? undefined, { id: 'errorRatePct', header: '% error', sortUndefined: 'last', cell: ({ row }) => formatPct(row.original.errorRatePct) }),
  mcpCol.accessor((s) => s.tools.length, {
    id: 'tools',
    header: 'Tools',
    cell: ({ row }) => `${row.original.tools.length} / ${dash(row.original.toolsAvailable, formatInt)}`,
  }),
  mcpCol.accessor('costUsd', { header: 'Cost', cell: ({ row }) => <span title={`${formatCompact(row.original.tokens)} tokens`}>{formatUsd(row.original.costUsd)}</span> }),
  mcpCol.accessor((s) => s.costPerCall ?? undefined, { id: 'costPerCall', header: 'Cost/call', sortUndefined: 'last', cell: ({ row }) => formatUsd(row.original.costPerCall) }),
  mcpCol.accessor('usedDays', { header: 'Days used', cell: (i) => formatInt(i.getValue()) }),
  mcpCol.accessor((s) => s.lastUsedAt ?? undefined, { id: 'lastUsedAt', header: 'Last used', sortDescFirst: true, sortUndefined: 'last', cell: ({ row }) => lastUsed(row.original.lastUsedAt) }),
]

function McpToolsTable(props: { mcp: McpAnalysis }): JSX.Element {
  if (props.mcp.tools.length === 0) return <p className="text-sm text-gray-500">No tool calls in this range.</p>
  return (
    <table className="text-sm">
      <thead className={head}>
        <tr><th className={th}>Tool</th><th className={th}>Calls</th><th className={th}>Errors</th></tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {props.mcp.tools.map((t) => (
          <tr key={t.name}>
            <td className="px-3 py-1 font-mono text-xs">{t.name}</td>
            <td className="px-3 py-1 tabular-nums">{formatInt(t.calls)}</td>
            <td className="px-3 py-1 tabular-nums">{formatInt(t.errors)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function McpTable(props: { servers: McpAnalysis[] }): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const table = useReactTable({
    data: props.servers,
    columns: mcpColumns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getRowId: (s) => s.server,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })
  return <SortableTable table={table} renderExpanded={(m) => <McpToolsTable mcp={m} />} />
}

const toolCol = createColumnHelper<BuiltinToolStats>()

const toolColumns = [
  toolCol.accessor('name', { header: 'Tool', sortingFn: 'text', cell: (i) => <span className="font-mono text-xs">{i.getValue()}</span> }),
  toolCol.accessor('sessions', { header: 'Sessions', cell: (i) => formatInt(i.getValue()) }),
  toolCol.accessor('calls', { header: 'Calls', cell: (i) => formatInt(i.getValue()) }),
  toolCol.accessor('errors', { header: 'Errors', cell: (i) => formatInt(i.getValue()) }),
  toolCol.accessor((t) => t.errorRatePct ?? undefined, { id: 'errorRatePct', header: '% error', sortUndefined: 'last', cell: ({ row }) => formatPct(row.original.errorRatePct) }),
  toolCol.accessor('rejections', { header: 'Rejections', cell: (i) => formatInt(i.getValue()) }),
]

function BuiltinToolsTable(props: { tools: BuiltinToolStats[] }): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'calls', desc: true }])
  const table = useReactTable({
    data: props.tools,
    columns: toolColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (t) => t.name,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  if (props.tools.length === 0) return <p className="text-sm text-gray-500">No built-in tool calls in this range.</p>
  return <SortableTable table={table} />
}

const hookCol = createColumnHelper<HookStats>()

const hookColumns = [
  hookCol.accessor('event', { header: 'Event', sortingFn: 'text' }),
  hookCol.accessor('name', { header: 'Name', sortingFn: 'text', cell: (i) => <span className="font-mono text-xs">{i.getValue()}</span> }),
  hookCol.accessor('sessions', { header: 'Sessions', cell: (i) => formatInt(i.getValue()) }),
  hookCol.accessor('runs', { header: 'Runs', cell: (i) => formatInt(i.getValue()) }),
  hookCol.accessor('contextTokensEst', { header: 'Injected context (est.)', cell: (i) => `${formatCompact(i.getValue())} tokens` }),
]

function HooksTable(props: { hooks: HookStats[] }): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'runs', desc: true }])
  const table = useReactTable({
    data: props.hooks,
    columns: hookColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (h) => `${h.event}\u0000${h.name}`,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  if (props.hooks.length === 0) return <p className="text-sm text-gray-500">No hook runs in this range.</p>
  return <SortableTable table={table} />
}

const MIX = [
  { key: 'builtin', label: 'Built-in', color: PALETTE[0] },
  { key: 'skills', label: 'Skills', color: PALETTE[1] },
  { key: 'mcp', label: 'MCP', color: PALETTE[2] },
] as const

function Stat(props: { label: string; value: string; help?: string }): JSX.Element {
  return (
    <div title={props.help}>
      <div className="text-xs text-gray-500">{props.label}</div>
      <div className="text-xl font-semibold tabular-nums">{props.value}</div>
    </div>
  )
}

function SummaryStrip(props: { analysis: Analysis }): JSX.Element {
  const a = props.analysis
  const total = a.toolMix.total
  return (
    <section className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
      <div>
        <div className="text-xs text-gray-500">Tool calls · {formatInt(total)}</div>
        <div className="mt-2 flex h-3 overflow-hidden rounded-sm bg-gray-100">
          {total > 0 && MIX.map((m) => a.toolMix[m.key] > 0 && (
            <div key={m.key} title={`${m.label}: ${formatInt(a.toolMix[m.key])}`} style={{ width: `${(a.toolMix[m.key] / total) * 100}%`, backgroundColor: m.color }} />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-700 tabular-nums">
          {MIX.map((m) => (
            <span key={m.key} className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: m.color }} />
              {m.label} {formatInt(a.toolMix[m.key])}
            </span>
          ))}
        </div>
      </div>
      <Stat label="Loaded skills" value={formatInt(a.loadedSkills)} />
      <Stat label="Loaded MCPs" value={formatInt(a.loadedMcpServers)} />
      <Stat label="Skill context (est.)" value={`${formatCompact(a.skillContextTokensEst)} tokens`} help="Skill descriptions are injected into every session that loads them: characters ÷ 4, summed over sessions." />
    </section>
  )
}

function VerdictNote(): JSX.Element {
  const rules: [Verdict, string][] = [
    ['problematic', '5 or more calls and 20% or more errors, or (skills) 5 or more uses and 30% or more of them interrupted by you.'],
    ['useful', 'Used in at least 1 session, adoption of 10% or more, used on 2 or more distinct days in the range and less than 10% errors.'],
    ['occasional', 'Used in at least 1 session.'],
    ['unused', 'Loaded in 5 or more sessions without any use.'],
    ['insufficient', 'Any other case (loaded in fewer than 5 sessions without any use).'],
  ]
  return (
    <details className="text-sm text-gray-700">
      <summary className="cursor-pointer">How is the verdict computed?</summary>
      <p className="mt-2">The first matching rule applies, over the sessions in the selected range:</p>
      <table className="mt-2 text-sm">
        <tbody className="divide-y divide-gray-100">
          {rules.map(([v, rule]) => (
            <tr key={v}>
              <td className="py-1 pr-3 align-top"><Badge verdict={v} /></td>
              <td className="py-1">{rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

export function ToolingTab(props: { range: Range }): JSX.Element {
  const range = props.range
  const [loaded, setLoaded] = useState<{ range: Range; analysis: Analysis } | null>(null)
  const [failed, setFailed] = useState<{ range: Range; message: string } | null>(null)
  const analysis = loaded !== null && loaded.range === range ? loaded.analysis : null
  const error = failed !== null && failed.range === range ? failed.message : null

  useEffect(() => {
    if (range === null) return
    let cancelled = false
    getTooling(range).then(
      (a) => { if (!cancelled) setLoaded({ range, analysis: a }) },
      (e: unknown) => { if (!cancelled) setFailed({ range, message: errorMessage(e) }) },
    )
    return () => { cancelled = true }
  }, [range])

  return (
    <>
      {error !== null && <ErrorBanner message={error} />}
      {range === null ? (
        <p className="text-sm text-gray-500">Select a valid date range.</p>
      ) : analysis === null ? (
        error === null && <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <SummaryStrip analysis={analysis} />
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Skills</h2>
            <VerdictLine items={analysis.skills} />
            <SkillsTable skills={analysis.skills} />
            <p className="text-xs text-gray-500">A <em>window</em> runs from the skill invocation until your next message or another skill; it includes invocations inside subagents. <em>Context (est.)</em> ≈ description characters ÷ 4 × sessions where it was loaded.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Skill sequences</h2>
            <SequencesPanel sequences={analysis.sequences} />
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">MCPs</h2>
            <VerdictLine items={analysis.mcpServers} />
            <McpTable servers={analysis.mcpServers} />
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Built-in tools</h2>
            <BuiltinToolsTable tools={analysis.builtinTools} />
            <p className="text-xs text-gray-500"><em>Rejections</em> are tool calls you denied at the permission prompt; they also count as errors.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Hooks</h2>
            <HooksTable hooks={analysis.hooks} />
          </section>
          <VerdictNote />
        </div>
      )}
    </>
  )
}

import { Fragment, useMemo, useState } from 'react'
import type { JSX } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ExpandedState, SortingState } from '@tanstack/react-table'
import type { SessionSummary } from '../shared/types.ts'
import { formatCompact, formatDuration, formatInt, formatLines, formatRatio, formatUsd } from './format.ts'
import { SIGNAL_VIEW, signals, signalWeight } from './signals.ts'
import type { SessionFilters } from './hash.ts'
import { filterOptions, matchesFilters } from './sessionFilters.ts'
import { matchesQuery } from './search.ts'
import { SessionDetail } from './SessionDetail.tsx'

const MAX_CHIPS = 6

function lastSegment(path: string): string {
  const parts = path.split('/').filter((p) => p !== '')
  return parts.length === 0 ? path : parts[parts.length - 1]
}

function Chip(props: { text: string; className: string }): JSX.Element {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${props.className}`}>{props.text}</span>
}

function HeaderHelp(props: { label: string; help: string }): JSX.Element {
  return (
    <span title={props.help} className="cursor-help underline decoration-gray-300 decoration-dotted underline-offset-2">{props.label}</span>
  )
}

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])]

function NameChips(props: { skills: string[]; skillsUsed: string[]; mcpServers: string[]; mcpServersUsed: string[] }): JSX.Element {
  const usedSkills = new Set(props.skillsUsed)
  const usedMcp = new Set(props.mcpServersUsed)
  const all = [
    ...union(props.skills, props.skillsUsed).map((name) => ({ name, used: usedSkills.has(name), className: 'bg-violet-50 text-violet-700 ring-1 ring-violet-300' })),
    ...union(props.mcpServers, props.mcpServersUsed).map((name) => ({ name, used: usedMcp.has(name), className: 'bg-amber-50 text-amber-800 ring-1 ring-amber-300' })),
  ].sort((a, b) => Number(b.used) - Number(a.used))
  const shown = all.slice(0, MAX_CHIPS)
  const rest = all.slice(MAX_CHIPS)
  const used = all.filter((c) => c.used).length
  if (all.length === 0) return <span className="text-gray-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      <span title={`${used} of ${all.length} loaded skills/MCPs were used`}><Chip text={`${used}/${all.length}`} className={used > 0 ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'} /></span>
      {shown.map((c, i) => (
        <span key={`${i}-${c.name}`} title={c.used ? 'Used' : 'Available, unused'}>
          <Chip text={c.name} className={c.used ? c.className : 'bg-gray-50 text-gray-400'} />
        </span>
      ))}
      {rest.length > 0 && <span title={rest.map((c) => c.name).join('\n')}><Chip text={`+${rest.length}`} className="bg-gray-100 text-gray-600" /></span>}
    </div>
  )
}

const col = createColumnHelper<SessionSummary>()

const columns = [
  col.accessor('title', {
    header: 'Session',
    cell: ({ row }) => (
      <button type="button" aria-expanded={row.getIsExpanded()} onClick={row.getToggleExpandedHandler()} className="cursor-pointer text-left">
        <div className="font-medium text-gray-900">
          {row.getIsExpanded() ? '▾' : '▸'} {row.original.title}{' '}
          <Chip text={row.original.agent === 'copilot' ? 'Copilot' : row.original.agent === 'opencode' ? 'opencode' : 'CC'} className={row.original.agent === 'copilot' ? 'bg-sky-100 text-sky-800' : row.original.agent === 'opencode' ? 'bg-violet-100 text-violet-800' : 'bg-orange-100 text-orange-800'} />
        </div>
        <div className="font-mono text-xs text-gray-400">{row.original.id}</div>
      </button>
    ),
  }),
  col.accessor('project', {
    header: 'Project',
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <div title={row.original.project}>{lastSegment(row.original.project)}</div>
        {row.original.gitBranch !== null && <div className="max-w-[12rem] truncate font-mono text-xs text-gray-500" title={row.original.gitBranch}>{row.original.gitBranch}</div>}
      </div>
    ),
  }),
  col.accessor('startedAt', {
    header: 'Started',
    cell: (info) => <span className="whitespace-nowrap">{new Date(info.getValue()).toLocaleString('en-US')}</span>,
  }),
  col.accessor('models', {
    header: 'Models',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.models.map((m) => <Chip key={m} text={m} className="bg-sky-50 text-sky-700" />)}
        {row.original.providers.map((p) => (
          <span key={p} title="opencode provider"><Chip text={p} className="bg-gray-100 text-gray-600" /></span>
        ))}
      </div>
    ),
  }),
  col.accessor('userTurns', {
    header: 'Turns',
    cell: (info) => formatInt(info.getValue()),
  }),
  col.accessor((s) => s.toolCalls.total, {
    id: 'toolCalls',
    header: () => <HeaderHelp label="Tools" help="Tool calls in the session; subline: tool calls per user turn (high = more autonomous). Hover for the skills / MCP / built-in split." />,
    cell: ({ row }) => {
      const t = row.original.toolCalls
      return (
        <div className="whitespace-nowrap" title={`${formatInt(t.skills)} skills · ${formatInt(t.mcp)} MCP · ${formatInt(t.builtin)} built-in`}>
          <div>{formatInt(t.total)}</div>
          <div className="text-xs text-gray-500">{formatRatio(row.original.toolRatio)} / turn</div>
        </div>
      )
    },
  }),
  col.accessor((s) => s.costUsd ?? undefined, {
    id: 'costUsd',
    header: 'Cost',
    sortUndefined: 'last',
    cell: ({ row }) => {
      const t = row.original.tokens
      const breakdown = `Tokens: ${formatCompact(t.total)}\nInput: ${formatInt(t.input)}\nOutput: ${formatInt(t.output)}\nCache write: ${formatInt(t.cacheCreation)}\nCache read: ${formatInt(t.cacheRead)}`
      return <span title={breakdown}>{formatUsd(row.original.costUsd)}</span>
    },
  }),
  col.accessor((s) => s.durationMs ?? undefined, {
    id: 'durationMs',
    header: 'Duration',
    sortUndefined: 'last',
    cell: ({ row }) => <span className="whitespace-nowrap">{formatDuration(row.original.durationMs)}</span>,
  }),
  col.accessor((s) => (s.linesAdded !== null || s.linesRemoved !== null ? (s.linesAdded ?? 0) + (s.linesRemoved ?? 0) : undefined), {
    id: 'lines',
    header: 'Lines',
    sortUndefined: 'last',
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <div>{formatLines(row.original.linesAdded, row.original.linesRemoved)}</div>
        {row.original.commits > 0 && <div className="text-xs text-gray-500">{formatInt(row.original.commits)} commit{row.original.commits === 1 ? '' : 's'}</div>}
      </div>
    ),
  }),
  col.display({
    id: 'names',
    header: () => <HeaderHelp label="Skills / MCPs" help="Badge: used / loaded. Color: used in the session · Grey: available but unused" />,
    cell: ({ row }) => <NameChips skills={row.original.skills} skillsUsed={row.original.skillsUsed} mcpServers={row.original.mcpServers} mcpServersUsed={row.original.mcpServersUsed} />,
  }),
  col.accessor((s) => signalWeight(s), {
    id: 'signals',
    header: () => <HeaderHelp label="Signals" help="Friction in the session: tool errors, interruptions (Esc), permission rejections, questions the agent asked you" />,
    sortDescFirst: true,
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1 whitespace-nowrap">
        {signals(row.original).map((x) => (
          <span key={x.kind} title={`${x.count} ${SIGNAL_VIEW[x.kind].label}`} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
            {SIGNAL_VIEW[x.kind].icon} {formatInt(x.count)}
          </span>
        ))}
      </div>
    ),
  }),
]

function FilterSelect(props: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void }): JSX.Element {
  return (
    <label className="flex items-center gap-1 text-sm text-gray-600">
      {props.label}
      <select
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm"
      >
        <option value="">All</option>
        {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

export function SessionsTable(props: { sessions: SessionSummary[]; filters: SessionFilters; onFiltersChange: (f: SessionFilters) => void }): JSX.Element {
  const { filters, onFiltersChange } = props
  const data = useMemo(() => props.sessions.filter((s) => matchesFilters(s, filters)), [props.sessions, filters])
  const opts = useMemo(() => filterOptions(props.sessions, filters), [props.sessions, filters])
  const [query, setQuery] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'startedAt', desc: true }])
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter: query, sorting, expanded },
    onGlobalFilterChange: setQuery,
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    globalFilterFn: (row, _columnId, q: string) => matchesQuery(row.original, q),
    getRowCanExpand: () => true,
    getRowId: (s) => s.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  const rows = table.getRowModel().rows
  const filteredCount = table.getFilteredRowModel().rows.length
  const columnCount = table.getVisibleLeafColumns().length

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          aria-label="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, project, skill or MCP…"
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
        />
        <FilterSelect label="Model" value={filters.model} options={opts.models} onChange={(v) => onFiltersChange({ ...filters, model: v })} />
        <FilterSelect label="Skill used" value={filters.skill} options={opts.skills} onChange={(v) => onFiltersChange({ ...filters, skill: v })} />
        <FilterSelect label="MCP used" value={filters.mcp} options={opts.mcp} onChange={(v) => onFiltersChange({ ...filters, mcp: v })} />
        <FilterSelect label="Branch" value={filters.branch} options={opts.branches} onChange={(v) => onFiltersChange({ ...filters, branch: v })} />
        <FilterSelect label="Subagent" value={filters.agent} options={opts.agents} onChange={(v) => onFiltersChange({ ...filters, agent: v })} />
        <span className="text-sm text-gray-500">{formatInt(filteredCount)} of {formatInt(props.sessions.length)} sessions</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  return (
                    <th
                      key={h.id}
                      className="px-3 py-2 whitespace-nowrap"
                      aria-sort={h.column.getCanSort() ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
                    >
                      {h.column.getCanSort() ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="cursor-pointer uppercase hover:text-gray-900">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr className="align-top hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 tabular-nums">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {row.getIsExpanded() && (
                  <tr>
                    <td colSpan={columnCount} className="bg-gray-50 px-3 py-3"><div className="w-0 min-w-full"><SessionDetail id={row.original.id} /></div></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

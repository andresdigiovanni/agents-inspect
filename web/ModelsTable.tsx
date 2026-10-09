import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import type { ModelAnalysis } from '../shared/types.ts'
import { formatCompact, formatInt, formatPct, formatUsd } from './format.ts'
import { dash, NameLink, SortableTable } from './SortableTable.tsx'

const modelCol = createColumnHelper<ModelAnalysis>()

function modelColumns(total: number) {
  return [
    modelCol.accessor('model', { header: 'Model', sortingFn: 'text', cell: (i) => <NameLink name={i.getValue()} kind="model" /> }),
    modelCol.accessor('sessions', { header: 'Sessions', cell: (i) => formatInt(i.getValue()) }),
    modelCol.accessor('messages', { header: 'Messages', cell: (i) => formatInt(i.getValue()) }),
    modelCol.accessor((m) => m.tokens.total, {
      id: 'tokens',
      header: 'Tokens',
      cell: ({ row }) => {
        const t = row.original.tokens
        const breakdown = `Input: ${formatInt(t.input)}\nOutput: ${formatInt(t.output)}\nCache write: ${formatInt(t.cacheCreation)}\nCache read: ${formatInt(t.cacheRead)}`
        return <span title={breakdown}>{formatCompact(t.total)}</span>
      },
    }),
    modelCol.accessor('costUsd', {
      header: 'Cost',
      cell: ({ row }) => (row.original.priced ? formatUsd(row.original.costUsd)
        : <span className="text-amber-700" title="No list price for this Copilot model; its cost counts as $0">no price</span>),
    }),
    modelCol.accessor((m) => (total > 0 ? (m.costUsd / total) * 100 : undefined), { id: 'costPct', header: '% of cost', sortUndefined: 'last', cell: (i) => (i.getValue() === undefined ? '—' : formatPct(i.getValue()!)) }),
    modelCol.accessor((m) => m.cacheHitPct ?? undefined, { id: 'cacheHitPct', header: 'Cache hit %', sortUndefined: 'last', cell: ({ row }) => formatPct(row.original.cacheHitPct) }),
    modelCol.accessor((m) => m.costPerMessage ?? undefined, { id: 'costPerMessage', header: 'Cost/message', sortUndefined: 'last', cell: ({ row }) => formatUsd(row.original.costPerMessage) }),
    modelCol.accessor((m) => m.avgContext ?? undefined, { id: 'avgContext', header: 'Avg context', sortUndefined: 'last', cell: ({ row }) => dash(row.original.avgContext, formatCompact) }),
    modelCol.accessor((m) => m.outputPct ?? undefined, { id: 'outputPct', header: 'Output %', sortUndefined: 'last', cell: ({ row }) => formatPct(row.original.outputPct) }),
    modelCol.accessor((m) => m.subagentTokenPct ?? undefined, { id: 'subagentTokenPct', header: '% subagents', sortUndefined: 'last', cell: ({ row }) => formatPct(row.original.subagentTokenPct) }),
  ]
}

export function ModelsTable(props: { models: ModelAnalysis[] }): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'costUsd', desc: true }])
  const columns = useMemo(() => modelColumns(props.models.reduce((a, m) => a + m.costUsd, 0)), [props.models])
  const table = useReactTable({
    data: props.models,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (m) => m.model,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  return <SortableTable table={table} />
}

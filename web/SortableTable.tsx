import { Fragment } from 'react'
import type { JSX } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Row, Table } from '@tanstack/react-table'
import type { Verdict } from '../shared/types.ts'
import { formatHash, NO_FILTERS } from './hash.ts'
import { VERDICT_VIEW, VERDICTS } from './verdict.ts'

export const th = 'px-3 py-2 whitespace-nowrap'
export const wrap = 'overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm'
export const head = 'bg-gray-50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase'

export function dash(n: number | null, f: (n: number) => string): string {
  return n === null ? '—' : f(n)
}

export function lastUsed(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleDateString('en-US')
}

export function Badge(props: { verdict: Verdict }): JSX.Element {
  const v = VERDICT_VIEW[props.verdict]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${v.className}`}>{v.label}</span>
}

export function NameLink(props: { name: string; kind: 'skill' | 'mcp' | 'model' }): JSX.Element {
  const href = formatHash({ tab: 'sessions', filters: { ...NO_FILTERS, [props.kind]: props.name } })
  return <a href={href} className="text-sky-700 hover:underline">{props.name}</a>
}

export function verdictSort<T extends { verdict: Verdict }>(a: Row<T>, b: Row<T>): number {
  return VERDICTS.indexOf(a.original.verdict) - VERDICTS.indexOf(b.original.verdict)
}

export function ExpandToggle(props: { open: boolean; label: string; onToggle: () => void }): JSX.Element {
  return (
    <button type="button" aria-expanded={props.open} aria-label={props.label} onClick={props.onToggle} className="cursor-pointer">
      {props.open ? '▾' : '▸'}
    </button>
  )
}

export function SortableTable<T>(props: { table: Table<T>; renderExpanded?: (row: T) => JSX.Element }): JSX.Element {
  const { table } = props
  const columnCount = table.getVisibleLeafColumns().length
  return (
    <div className={wrap}>
      <table className="min-w-full text-sm">
        <thead className={head}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted()
                return (
                  <th key={h.id} className={th} aria-sort={h.column.getCanSort() ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}>
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
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <tr className="align-top hover:bg-gray-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 tabular-nums">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
              {row.getIsExpanded() && props.renderExpanded !== undefined && (
                <tr>
                  <td colSpan={columnCount} className="bg-gray-50 px-3 py-3">{props.renderExpanded(row.original)}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

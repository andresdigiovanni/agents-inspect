import { useState } from 'react'
import type { JSX } from 'react'
import type { RangeChoice } from './range.ts'

const presets = [
  { kind: '7d', label: 'Last 7 days' },
  { kind: '30d', label: 'Last 30 days' },
] as const

export function RangeSelector(props: { choice: RangeChoice; onChange: (c: RangeChoice) => void }): JSX.Element {
  const { choice, onChange } = props
  const [customFrom, setCustomFrom] = useState(choice.kind === 'custom' ? choice.from : '')
  const [customTo, setCustomTo] = useState(choice.kind === 'custom' ? choice.to : '')

  function selectCustom(from: string, to: string): void {
    setCustomFrom(from)
    setCustomTo(to)
    onChange({ kind: 'custom', from, to })
  }

  const segment = (active: boolean): string =>
    `px-3 py-1.5 text-sm ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex divide-x divide-gray-300 overflow-hidden rounded-lg border border-gray-300 shadow-sm">
        {presets.map((p) => (
          <button key={p.kind} type="button" aria-pressed={choice.kind === p.kind} className={segment(choice.kind === p.kind)} onClick={() => onChange({ kind: p.kind })}>
            {p.label}
          </button>
        ))}
        <button type="button" aria-pressed={choice.kind === 'custom'} className={segment(choice.kind === 'custom')} onClick={() => selectCustom(customFrom, customTo)}>
          Custom range
        </button>
      </div>
      {choice.kind === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          <label className="flex items-center gap-1">
            From
            <input type="date" value={customFrom} onChange={(e) => selectCustom(e.target.value, customTo)} className="rounded-md border border-gray-300 px-2 py-1" />
          </label>
          <label className="flex items-center gap-1">
            To
            <input type="date" value={customTo} onChange={(e) => selectCustom(customFrom, e.target.value)} className="rounded-md border border-gray-300 px-2 py-1" />
          </label>
        </div>
      )}
    </div>
  )
}

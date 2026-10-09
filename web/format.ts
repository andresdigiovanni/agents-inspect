const intFormat = new Intl.NumberFormat('en-US', { useGrouping: 'always' })
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function formatInt(n: number): string {
  return intFormat.format(n)
}

export function formatCompact(n: number): string {
  return compactFormat.format(n)
}

export function formatUsd(n: number | null): string {
  return n === null ? '—' : '$' + n.toFixed(2)
}

export function formatRatio(r: number | null): string {
  return r === null ? '—' : r.toFixed(1)
}

export function trendView(p: number | null): { label: string; tone: 'up' | 'down' | 'flat' } {
  if (p === null) return { label: '—', tone: 'flat' }
  const rounded = Math.round(p)
  if (rounded > 0) return { label: `+${rounded}%`, tone: 'up' }
  if (rounded < 0) return { label: `${rounded}%`, tone: 'down' }
  return { label: '0%', tone: 'flat' }
}

const hoursFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatPct(p: number | null): string {
  return p === null ? '—' : `${Math.round(p)}%`
}

export function formatHours(ms: number): string {
  return hoursFormat.format(ms / 3_600_000) + ' h'
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.floor(ms / 1000)
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`
}

export function formatLines(added: number | null, removed: number | null): string {
  if (added === null || removed === null) return '—'
  return `+${formatInt(added)} −${formatInt(removed)}`
}

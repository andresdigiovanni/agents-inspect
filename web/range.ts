export type RangeChoice = { kind: '7d' } | { kind: '30d' } | { kind: 'custom'; from: string; to: string }

const DAY_MS = 86_400_000

function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m === null) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

export function resolveRange(choice: RangeChoice, now: Date): { from: Date; to: Date } | null {
  if (choice.kind === '7d' || choice.kind === '30d') {
    const days = choice.kind === '7d' ? 7 : 30
    return { from: new Date(now.getTime() - days * DAY_MS), to: new Date(now.getTime()) }
  }
  const from = parseLocalDate(choice.from)
  const toDay = parseLocalDate(choice.to)
  if (from === null || toDay === null || from.getTime() > toDay.getTime()) return null
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1)
  return { from, to }
}

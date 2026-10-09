import type { Verdict } from '../shared/types.ts'

export const VERDICTS: readonly Verdict[] = ['problematic', 'useful', 'occasional', 'unused', 'insufficient']

export const VERDICT_VIEW: Record<Verdict, { label: string; className: string }> = {
  problematic: { label: '🟠 Problematic', className: 'bg-orange-50 text-orange-800' },
  useful: { label: '🟢 Useful', className: 'bg-green-50 text-green-700' },
  occasional: { label: '🟡 Occasional', className: 'bg-yellow-50 text-yellow-800' },
  unused: { label: '🔴 Unused', className: 'bg-red-50 text-red-700' },
  insufficient: { label: '⚪ No data', className: 'bg-gray-100 text-gray-600' },
}

export function countByVerdict(items: readonly { verdict: Verdict }[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { problematic: 0, useful: 0, occasional: 0, unused: 0, insufficient: 0 }
  for (const item of items) counts[item.verdict]++
  return counts
}

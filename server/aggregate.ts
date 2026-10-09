import type { BreakdownDim, BreakdownRow, DailyPoint, PeriodMetrics, SessionSummary } from '../shared/types.ts'
import type { MessageEvent, SessionRecord } from './record.ts'
import { costWeight } from './parse.ts'
import { median, quantile } from './stats.ts'

export function trendPct(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100
}

export function sessionsInRange(sessions: SessionSummary[], from: Date, to: Date): SessionSummary[] {
  const lo = from.getTime()
  const hi = to.getTime()
  return sessions
    .filter(s => {
      const t = Date.parse(s.startedAt)
      return t >= lo && t < hi
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

const pad = (n: number) => String(n).padStart(2, '0')

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysInRange(from: Date, to: Date): string[] {
  const out: string[] = []
  if (to.getTime() <= from.getTime()) return out
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  for (; d.getTime() < to.getTime(); d.setDate(d.getDate() + 1)) out.push(localDate(d))
  return out
}

const trendOf = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null ? null : trendPct(cur, prev))
const ratio = (n: number, d: number): number | null => (d ? n / d : null)
export const freshTokens = (s: SessionSummary): number => s.tokens.input + s.tokens.cacheCreation + s.tokens.output
export const cacheSavings = (m: MessageEvent): number => {
  const w = costWeight(m.tokens)
  return w > 0 ? m.costUsd * 0.9 * m.tokens.cacheRead / w : 0
}
const costed = (l: SessionSummary[]): number[] => l.flatMap(s => (s.costUsd === null ? [] : [s.costUsd]))
const sumOf = (l: SessionSummary[], f: (s: SessionSummary) => number) => l.reduce((n, s) => n + f(s), 0)
const costPerCommitOf = (l: SessionSummary[]) => ratio(sumOf(l, s => s.costUsd ?? 0), sumOf(l, s => s.commits))
const BREAKDOWN_KEYS: Record<BreakdownDim, (s: SessionSummary) => string | null> = {
  project: s => s.project, branch: s => s.gitBranch, version: s => s.version, permissionMode: s => s.permissionMode, effort: s => s.effort,
}

export function breakdown(list: SessionSummary[], key: (s: SessionSummary) => string | null): BreakdownRow[] {
  const groups = new Map<string | null, SessionSummary[]>()
  for (const s of list) {
    const k = key(s)
    const g = groups.get(k)
    if (g) g.push(s)
    else groups.set(k, [s])
  }
  return [...groups].map(([k, g]) => {
    const calls = sumOf(g, s => s.toolCalls.total)
    const errPct = ratio(sumOf(g, s => s.toolErrors), calls)
    return {
      key: k, sessions: g.length, costUsd: sumOf(g, s => s.costUsd ?? 0), medianCostPerSession: median(costed(g)),
      toolErrorPct: errPct === null ? null : errPct * 100, interruptionsPerSession: ratio(sumOf(g, s => s.interruptions), g.length),
      commits: sumOf(g, s => s.commits),
    }
  }).sort((a, b) => (b.costUsd - a.costUsd) || (b.sessions - a.sessions) || String(a.key).localeCompare(String(b.key)))
}

export function recordsInRange(records: SessionRecord[], from: Date, to: Date): SessionRecord[] {
  const lo = from.getTime()
  const hi = to.getTime()
  return records.filter(r => {
    const t = Date.parse(r.summary.startedAt)
    return t >= lo && t < hi
  })
}

export function computeSummary(records: SessionRecord[], from: Date, to: Date): PeriodMetrics {
  const lo = from.getTime()
  const hi = to.getTime()
  const inRange = (ts: string) => { const t = Date.parse(ts); return t >= lo && t < hi }
  const curRecords = recordsInRange(records, from, to)
  const cur = curRecords.map(r => r.summary)
  const prev = recordsInRange(records, new Date(lo - (hi - lo)), from).map(r => r.summary)
  const sum = (f: (s: SessionSummary) => number) => cur.reduce((n, s) => n + f(s), 0)
  const costUsd = sum(s => s.costUsd ?? 0)
  const toolCallsTotal = sum(s => s.toolCalls.total)
  const cacheRead = sum(s => s.tokens.cacheRead)
  const cacheDen = sum(s => s.tokens.input + s.tokens.cacheCreation + s.tokens.cacheRead)

  const dates = daysInRange(from, to)
  const byDate = new Map<string, DailyPoint>(dates.map(date => [date, {
    date, sessions: 0, userTurns: 0, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: 0, byModel: {},
  }]))
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  const heatmapCost = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const r of records) {
    if (inRange(r.summary.startedAt)) byDate.get(localDate(new Date(r.summary.startedAt)))!.sessions++
    for (const ts of r.turnTimes) {
      if (!inRange(ts)) continue
      const d = new Date(ts)
      const day = byDate.get(localDate(d))!
      day.userTurns++
      heatmap[(d.getDay() + 6) % 7][d.getHours()]++
    }
    for (const m of r.messages) {
      if (m.ts === null || !inRange(m.ts)) continue
      const day = byDate.get(localDate(new Date(m.ts)))!
      day.tokens.input += m.tokens.input
      day.tokens.output += m.tokens.output
      day.tokens.cacheCreation += m.tokens.cacheCreation
      day.tokens.cacheRead += m.tokens.cacheRead
      day.tokens.total += m.tokens.total
      day.costUsd += m.costUsd
      const md = new Date(m.ts)
      heatmapCost[(md.getDay() + 6) % 7][md.getHours()] += m.costUsd
      const bm = day.byModel[m.model] ?? (day.byModel[m.model] = { tokens: 0, costUsd: 0 })
      bm.tokens += m.tokens.total
      bm.costUsd += m.costUsd
    }
  }
  const prevCost = sumOf(prev, s => s.costUsd ?? 0)
  const activeMs = sum(s => s.durationMs ?? 0)
  const commits = sum(s => s.commits)
  const fresh = sum(freshTokens)
  const turnMs = cur.flatMap(s => s.turnMs)
  const errPct = ratio(sum(s => s.toolErrors), toolCallsTotal)
  return {
    conversations: cur.length, costUsd,
    costTrendPct: trendPct(costUsd, prevCost),
    activeTrendPct: trendPct(activeMs, sumOf(prev, s => s.durationMs ?? 0)),
    commits, commitsTrendPct: trendPct(commits, sumOf(prev, s => s.commits)),
    costPerCommit: costPerCommitOf(cur), costPerCommitTrendPct: trendOf(costPerCommitOf(cur), costPerCommitOf(prev)),
    costPerActiveHour: ratio(costUsd, activeMs / 3_600_000),
    medianCostPerSession: median(costed(cur)), p90CostPerSession: quantile(costed(cur), 0.9),
    freshTokens: fresh, freshTokensTrendPct: trendPct(fresh, sumOf(prev, freshTokens)),
    cacheSavingsUsd: curRecords.reduce((n, r) => n + r.messages.reduce((k, m) => k + cacheSavings(m), 0), 0),
    toolsPerTurn: ratio(toolCallsTotal, sum(s => s.userTurns)),
    medianTurnMs: median(turnMs), p90TurnMs: quantile(turnMs, 0.9),
    interruptionsPerSession: ratio(sum(s => s.interruptions), cur.length),
    toolErrorPct: errPct === null ? null : errPct * 100,
    apiMs: sum(s => s.apiMs ?? 0), toolMs: sum(s => s.toolMs ?? 0), retryMs: sum(s => s.retryMs ?? 0),
    breakdowns: Object.fromEntries(Object.entries(BREAKDOWN_KEYS).map(([d, k]) => [d, breakdown(cur, k)])) as Record<BreakdownDim, BreakdownRow[]>,
    heatmapCost,
    cacheHitPct: cacheDen ? (cacheRead / cacheDen) * 100 : null,
    activeMs, linesAdded: sum(s => s.linesAdded ?? 0), linesRemoved: sum(s => s.linesRemoved ?? 0),
    daily: dates.map(d => byDate.get(d)!), heatmap,
    conversationsTrendPct: trendPct(cur.length, prev.length),
  }
}

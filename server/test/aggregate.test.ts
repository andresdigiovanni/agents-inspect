process.env.TZ = 'UTC'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionsInRange, recordsInRange, trendPct, computeSummary } from '../aggregate.ts'
import type { SessionSummary } from '../../shared/types.ts'
import type { SessionRecord, MessageEvent } from '../record.ts'
import { summaryExtras, recordExtras } from './factories.ts'

const now = new Date('2026-10-07T12:00:00.000Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
const s = (id: string, startedAt: string, o: Partial<SessionSummary> = {}): SessionSummary => ({
  id, project: '/p', title: id, startedAt, models: [], userTurns: 1,
  toolCalls: { total: 3, skills: 1, mcp: 1, builtin: 1 }, toolRatio: 3,
  tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 100 }, costUsd: 1, skills: ['a'], mcpServers: ['m'],
  skillsUsed: [], mcpServersUsed: [], durationMs: null, linesAdded: null, linesRemoved: null, agentTypes: [], ...summaryExtras(), ...o,
})

const rec = (summary: SessionSummary, o: Partial<SessionRecord> = {}): SessionRecord =>
  ({ summary, messages: [], turnTimes: [], skillCalls: [], mcpCalls: [], mcpTools: {}, subagents: [], skillWindows: [], skillSequence: [], skillListingChars: {}, ...recordExtras(), ...o })
const last = (records: SessionRecord[], days: number) => computeSummary(records, new Date(now.getTime() - days * 86_400_000), now)
const msg = (ts: string, model: string, total: number, costUsd: number): MessageEvent =>
  ({ ts, model, provider: null, tokens: { input: 0, output: total, cacheCreation: 0, cacheRead: 0, total }, costUsd, sidechain: false, skill: null, phase: 'other', phaseSource: 'none', agentId: null, mcpServer: null, context: 0 })

test('trendPct', () => {
  assert.equal(trendPct(15, 10), 50); assert.equal(trendPct(5, 10), -50); assert.equal(trendPct(3, 0), null); assert.equal(trendPct(0, 0), null)
})

test('sessionsInRange is start-inclusive, end-exclusive, newest first', () => {
  const list = [s('old', daysAgo(10)), s('edge', daysAgo(7)), s('new', daysAgo(1)), s('future', now.toISOString())]
  assert.deepEqual(sessionsInRange(list, new Date(daysAgo(7)), now).map(x => x.id), ['new', 'edge'])
})

test('recordsInRange is start-inclusive, end-exclusive', () => {
  const from = new Date(daysAgo(7))
  const list = [
    rec(s('before', new Date(from.getTime() - 1).toISOString())),
    rec(s('edge', daysAgo(7))),
    rec(s('new', daysAgo(1))),
    rec(s('end', now.toISOString())),
  ]
  assert.deepEqual(recordsInRange(list, from, now).map(r => r.summary.id), ['edge', 'new'])
})

test('computeSummary: counts, tokens, cost, distinct loaded names, tool split, trends', () => {
  const list = [
    s('a', daysAgo(1), { skills: ['x', 'y'], mcpServers: ['m1'], costUsd: 0.5 }),
    s('b', daysAgo(3), { skills: ['y'], mcpServers: ['m2'], costUsd: null, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 300 } }),
    s('c', daysAgo(10)),
    s('d', daysAgo(40)),
  ]
  const all: Record<string, unknown> = { ...last(list.map(x => rec(x)), 7) }
  const keys = ['conversations', 'costUsd', 'conversationsTrendPct']
  const base = Object.fromEntries(keys.map(k => [k, all[k]]))
  assert.deepEqual(base, { conversations: 2, costUsd: 0.5, conversationsTrendPct: 100 })
  for (const k of ['tokens', 'tokensTrendPct', 'costPerSession', 'loadedSkills', 'loadedMcpServers', 'toolCalls', 'topProjects']) assert.ok(!(k in all), k)
  assert.equal(last(list.map(x => rec(x)), 30).conversations, 3)
  assert.equal(last(list.map(x => rec(x)), 30).conversationsTrendPct, 200)   // 3 vs 1 (d at 40 days)
})

test('computeSummary with no sessions', () => {
  assert.equal(last([], 7).conversationsTrendPct, null)
  assert.equal(last([], 30).toolsPerTurn, null)
})

test('tools per turn sums tool calls over user turns', () => {
  const list = [
    s('a', daysAgo(1), { toolCalls: { total: 14, skills: 1, mcp: 3, builtin: 10 }, userTurns: 2 }),
    s('b', daysAgo(2), { toolCalls: { total: 33, skills: 2, mcp: 6, builtin: 25 }, userTurns: 3 }),
  ]
  assert.equal(last(list.map(x => rec(x)), 7).toolsPerTurn, 47 / 5)
})

test('period additions: cache hit, active time, lines', () => {
  const t = (cacheRead: number) => ({ input: 10, output: 0, cacheCreation: 10, cacheRead, total: 20 + cacheRead })
  const list = [
    rec(s('a', daysAgo(1), { project: '/x', costUsd: 1, tokens: t(80), durationMs: 3_600_000, linesAdded: 10, linesRemoved: 2 })),
    rec(s('b', daysAgo(2), { project: '/y', costUsd: 3, tokens: t(0) })),
    rec(s('c', daysAgo(3), { project: '/x', costUsd: 2, tokens: t(0) })),
  ]
  const p = last(list, 7)
  assert.equal(p.cacheHitPct, 80 / 140 * 100)
  assert.deepEqual([p.activeMs, p.linesAdded, p.linesRemoved], [3_600_000, 10, 2])
  const empty = last([], 7)
  assert.equal(empty.cacheHitPct, null)
})

test('daily: one point per local day touching the range, zero-filled, each message and turn on its own day', () => {
  const r = rec(s('a', '2026-10-06T23:30:00.000Z'), {
    turnTimes: ['2026-10-06T23:30:00.000Z', '2026-10-07T00:10:00.000Z', '2026-09-01T05:00:00.000Z'],
    messages: [msg('2026-10-06T23:40:00.000Z', 'opus', 100, 1), msg('2026-10-07T00:20:00.000Z', 'opus', 50, 0.5),
      msg('2026-10-07T00:30:00.000Z', 'haiku', 10, 0.1), msg('2026-09-01T00:00:00.000Z', 'opus', 999, 9), { ...msg('', 'opus', 7, 7), ts: null }],
  })
  const tok = (output: number) => ({ input: 0, output, cacheCreation: 0, cacheRead: 0, total: output })
  const d = last([r], 7).daily
  assert.deepEqual(d.map(x => x.date), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])
  assert.deepEqual(d[0], { date: '2026-09-30', sessions: 0, userTurns: 0, tokens: tok(0), costUsd: 0, byModel: {} })
  assert.deepEqual(d[6], { date: '2026-10-06', sessions: 1, userTurns: 1, tokens: tok(100), costUsd: 1, byModel: { opus: { tokens: 100, costUsd: 1 } } })
  assert.deepEqual(d[7], { date: '2026-10-07', sessions: 0, userTurns: 1, tokens: tok(60), costUsd: 0.6, byModel: { opus: { tokens: 50, costUsd: 0.5 }, haiku: { tokens: 10, costUsd: 0.1 } } })
  assert.equal(last([r], 30).daily.length, 31)
})

test('daily and heatmap count only events inside [from, to), also on the partial edge days', () => {
  const from = new Date('2026-09-30T12:00:00.000Z')
  const r = rec(s('a', '2026-09-30T13:00:00.000Z'), {
    turnTimes: ['2026-09-30T11:59:59.999Z', '2026-09-30T12:00:00.000Z', now.toISOString()],
    messages: [msg('2026-09-30T11:00:00.000Z', 'opus', 1, 1), msg('2026-09-30T12:00:00.000Z', 'opus', 2, 2), msg(now.toISOString(), 'opus', 4, 4)],
  })
  const before = rec(s('b', '2026-09-30T11:00:00.000Z'))
  const p = computeSummary([r, before], from, now)
  assert.deepEqual([p.daily[0].sessions, p.daily[0].userTurns, p.daily[0].tokens.total, p.daily[0].costUsd], [1, 1, 2, 2])
  assert.equal(p.daily.reduce((n, d) => n + d.tokens.total, 0), 2)
  assert.equal(p.heatmap.flat().reduce((a, b) => a + b, 0), 1)
})

test('custom range: trend compares with the previous window of equal length', () => {
  const from = new Date('2026-09-21T00:00:00.000Z')
  const to = new Date('2026-10-01T00:00:00.000Z')
  const list = [
    rec(s('in1', '2026-09-25T00:00:00.000Z')), rec(s('in2', '2026-09-30T23:00:00.000Z')),
    rec(s('prev', '2026-09-11T00:00:00.000Z')), rec(s('tooOld', '2026-09-10T23:59:59.999Z')), rec(s('after', '2026-10-01T00:00:00.000Z')),
  ]
  const p = computeSummary(list, from, to)
  assert.equal(p.conversations, 2)
  assert.equal(p.conversationsTrendPct, 100)
  assert.equal(p.daily.length, 10)
})

test('empty range gives no days and no sessions', () => {
  const p = computeSummary([rec(s('a', now.toISOString()))], now, now)
  assert.deepEqual([p.conversations, p.daily.length, p.conversationsTrendPct], [0, 0, null])
})

test('heatmap: 7 x 24 user turns, Monday first, local hour, window only', () => {
  const r = rec(s('a', daysAgo(1)), { turnTimes: ['2026-10-06T23:30:00.000Z', '2026-10-07T00:10:00.000Z', '2026-09-01T05:00:00.000Z'] })
  const h = last([r], 7).heatmap
  assert.equal(h.length, 7); assert.ok(h.every(row => row.length === 24))
  assert.equal(h[1][23], 1)   // Tue 2026-10-06 23:xx
  assert.equal(h[2][0], 1)    // Wed 2026-10-07 00:xx
  assert.equal(h.flat().reduce((a, b) => a + b, 0), 2)
})

test('daily sums each token type separately and byModel tokens use the total', () => {
  const m: MessageEvent = { ts: '2026-10-07T01:00:00.000Z', model: 'opus', provider: null, tokens: { input: 1, output: 2, cacheCreation: 3, cacheRead: 4, total: 10 }, costUsd: 0, sidechain: false, skill: null, phase: 'other', phaseSource: 'none', agentId: null, mcpServer: null, context: 0 }
  const day = last([rec(s('a', daysAgo(1)), { messages: [m, m] })], 7).daily[7]
  assert.deepEqual(day.tokens, { input: 2, output: 4, cacheCreation: 6, cacheRead: 8, total: 20 })
  assert.deepEqual(day.byModel, { opus: { tokens: 20, costUsd: 0 } })
})

test('cache hit excludes output tokens and counts only the period', () => {
  const t = { input: 10, output: 1000, cacheCreation: 10, cacheRead: 20, total: 1040 }
  const list = [rec(s('a', daysAgo(1), { tokens: t })), rec(s('old', daysAgo(20), { tokens: { ...t, cacheRead: 0 } }))]
  assert.equal(last(list, 7).cacheHitPct, 50)
})

test('a range in years 0-99 ends and yields one point per day', () => {
  const p = computeSummary([], new Date('0050-01-01T00:00:00.000Z'), new Date('0050-01-03T00:00:00.000Z'))
  assert.equal(p.daily.length, 2)
})

test('cost KPIs: trends, cost per commit, cost per active hour, median and p90 cost per session', () => {
  const list = [
    rec(s('a', daysAgo(1), { costUsd: 1, commits: 1, durationMs: 3_600_000 })),
    rec(s('b', daysAgo(2), { costUsd: 3, commits: 1, durationMs: 3_600_000 })),
    rec(s('c', daysAgo(3), { costUsd: 8, commits: 0 })),
    rec(s('n', daysAgo(4), { costUsd: null })),
    rec(s('p', daysAgo(10), { costUsd: 6, commits: 2, durationMs: 3_600_000 })),
  ]
  const m = last(list, 7)
  assert.equal(m.costUsd, 12); assert.equal(m.costTrendPct, 100)
  assert.equal(m.commits, 2); assert.equal(m.commitsTrendPct, 0)
  assert.equal(m.costPerCommit, 6); assert.equal(m.costPerCommitTrendPct, 100)
  assert.equal(m.costPerActiveHour, 6); assert.equal(m.activeTrendPct, 100)
  assert.equal(m.medianCostPerSession, 3); assert.equal(m.p90CostPerSession, 7)
  const none = last([rec(s('a', daysAgo(1), { durationMs: null }))], 7)
  assert.deepEqual([none.costPerCommit, none.costPerCommitTrendPct, none.costPerActiveHour], [null, null, null])
})

test('fresh tokens exclude cache reads; cache savings = cost × 0.9 × cacheRead / weight', () => {
  const tokens = { input: 10, output: 2, cacheCreation: 4, cacheRead: 100, total: 116 }
  const m: MessageEvent = { ...msg(daysAgo(1), 'opus', 0, 0), tokens, costUsd: 2.5 }
  const weight = 10 + 5 * 2 + 1.25 * 4 + 0.1 * 100
  const r = last([rec(s('a', daysAgo(1), { tokens }), { messages: [m, { ...m, tokens: { ...tokens, input: 0, output: 0, cacheCreation: 0, cacheRead: 0 } }] }),
    rec(s('p', daysAgo(10), { tokens: { ...tokens, input: 8 } }))], 7)
  assert.equal(r.freshTokens, 16)
  assert.equal(r.freshTokensTrendPct, ((16 - 14) / 14) * 100)
  assert.equal(r.cacheSavingsUsd, 2.5 * 0.9 * 100 / weight)
})

test('autonomy KPIs: tools per turn, turn duration quantiles, interruptions, tool error %, time split sums', () => {
  const r = last([
    rec(s('a', daysAgo(1), { userTurns: 2, toolCalls: { total: 6, skills: 0, mcp: 0, builtin: 6 }, turnMs: [1000, 3000], interruptions: 1, toolErrors: 3, apiMs: 10, toolMs: 5, retryMs: 1 })),
    rec(s('b', daysAgo(1), { userTurns: 1, toolCalls: { total: 4, skills: 0, mcp: 0, builtin: 4 }, turnMs: [2000], interruptions: 0, toolErrors: 0, apiMs: null })),
  ], 7)
  assert.equal(r.toolsPerTurn, 10 / 3)
  assert.equal(r.medianTurnMs, 2000); assert.equal(r.p90TurnMs, 2800)
  assert.equal(r.interruptionsPerSession, 0.5)
  assert.equal(r.toolErrorPct, 30)
  assert.deepEqual([r.apiMs, r.toolMs, r.retryMs], [10, 5, 1])
  const empty = last([], 7)
  assert.deepEqual([empty.toolsPerTurn, empty.medianTurnMs, empty.interruptionsPerSession, empty.toolErrorPct], [null, null, null, null])
})

test('breakdowns group by session attribute, null keys kept, sorted by cost', () => {
  const r = last([
    rec(s('a', daysAgo(1), { project: '/x', gitBranch: 'main', version: '1', costUsd: 1, toolCalls: { total: 10, skills: 0, mcp: 0, builtin: 10 }, toolErrors: 1, interruptions: 2, commits: 1 })),
    rec(s('b', daysAgo(1), { project: '/x', gitBranch: 'main', version: '2', costUsd: 3, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 } })),
    rec(s('c', daysAgo(1), { project: '/y', gitBranch: null, version: '2', costUsd: 5 })),
  ], 7)
  assert.deepEqual(r.breakdowns.branch, [
    { key: null, sessions: 1, costUsd: 5, medianCostPerSession: 5, toolErrorPct: 0, interruptionsPerSession: 0, commits: 0 },
    { key: 'main', sessions: 2, costUsd: 4, medianCostPerSession: 2, toolErrorPct: 10, interruptionsPerSession: 1, commits: 1 },
  ])
  assert.deepEqual(r.breakdowns.version.map(b => [b.key, b.costUsd]), [['2', 8], ['1', 1]])
  assert.deepEqual(r.breakdowns.project.map(b => b.key), ['/y', '/x'])
  assert.deepEqual(r.breakdowns.effort.map(b => b.key), [null])
  assert.equal(r.breakdowns.permissionMode.length, 1)
})

test('breakdown by provider: single id, mixed when several, null when none', () => {
  const r = last([
    rec(s('a', daysAgo(1), { agent: 'opencode', providers: ['zai-coding-plan'], costUsd: 3 })),
    rec(s('b', daysAgo(1), { agent: 'opencode', providers: ['zai-coding-plan'], costUsd: 1 })),
    rec(s('c', daysAgo(1), { agent: 'opencode', providers: ['minimax-coding-plan', 'opencode'], costUsd: 2 })),
    rec(s('d', daysAgo(1), { costUsd: 5 })),
  ], 7)
  assert.deepEqual(r.breakdowns.provider.map(b => [b.key, b.sessions, b.costUsd]), [[null, 1, 5], ['zai-coding-plan', 2, 4], ['mixed', 1, 2]])
})

test('heatmapCost buckets message cost by weekday and hour of the message timestamp', () => {
  const r = rec(s('a', daysAgo(1)), { messages: [msg('2026-10-06T23:30:00.000Z', 'o', 1, 2), msg('2026-10-06T23:40:00.000Z', 'o', 1, 1), msg('2026-09-01T00:00:00.000Z', 'o', 1, 9)] })
  const h = last([r], 7).heatmapCost
  assert.equal(h[1][23], 3)
  assert.equal(h.flat().reduce((a, b) => a + b, 0), 3)
})

process.env.TZ = 'UTC'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeWorkflow } from '../workflow.ts'
import type { MessageEvent, SessionRecord, SubagentRun } from '../record.ts'
import type { Phase, PhaseSource, SessionSummary } from '../../shared/types.ts'
import { summaryExtras, recordExtras } from './factories.ts'

const from = new Date('2026-10-01T00:00:00.000Z')
const to = new Date('2026-10-03T00:00:00.000Z')
const zero = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }
const summary = (id: string, startedAt: string): SessionSummary => ({
  id, project: '/p', title: id, startedAt, models: [], userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0,
  tokens: zero, costUsd: null, skills: [], mcpServers: [], skillsUsed: [], mcpServersUsed: [], agentTypes: [], durationMs: null, linesAdded: null, linesRemoved: null, ...summaryExtras(),
})
const rec = (s: SessionSummary, o: Partial<SessionRecord> = {}): SessionRecord => ({
  summary: s, messages: [], turnTimes: [], skillCalls: [], mcpCalls: [], mcpTools: {}, subagents: [], skillWindows: [], skillSequence: [], skillListingChars: {}, ...recordExtras(), ...o,
})
const msg = (ts: string, model: string, phase: Phase, phaseSource: PhaseSource, costUsd: number, agentId: string | null = null): MessageEvent =>
  ({ ts, model, provider: null, tokens: { ...zero, output: 10, total: 10 }, costUsd, sidechain: agentId !== null, skill: null, phase, phaseSource, agentId, mcpServer: null, context: 0 })
const run = (o: Partial<SubagentRun>): SubagentRun => ({
  agentId: 'a', agentType: 'general-purpose', description: '', model: 'haiku', toolUseId: null, startedAt: null, durationMs: null,
  tokens: 0, costUsd: 0, toolCalls: 0, toolErrors: 0, phase: 'implement', ...o,
})

const records = [
  rec(summary('s1', '2026-10-01T10:00:00.000Z'), {
    messages: [
      msg('2026-10-01T10:00:00.000Z', 'opus', 'plan', 'skill', 2),
      msg('2026-10-01T10:01:00.000Z', 'opus', 'implement', 'tool', 1),
      msg('2026-10-02T09:00:00.000Z', 'haiku', 'implement', 'inherited', 1, 'a1'),
    ],
    subagents: [
      run({ agentId: 'a1', costUsd: 1, tokens: 10, toolCalls: 4, toolErrors: 1, durationMs: 1000, description: 'Implement Task 1', startedAt: '2026-10-02T09:00:00.000Z' }),
      run({ agentId: 'a2', costUsd: 0, toolCalls: 0, durationMs: null, description: 'Implement Task 2', startedAt: '2026-10-02T10:00:00.000Z', model: 'sonnet' }),
      run({ agentId: 'a3', agentType: 'Explore', phase: 'explore', costUsd: 0, description: '' }),
    ],
  }),
  rec(summary('s2', '2026-10-02T12:00:00.000Z'), { messages: [msg('2026-10-02T12:00:00.000Z', 'sonnet', 'other', 'none', 0)] }),
  rec(summary('old', '2026-09-30T23:00:00.000Z'), { messages: [msg('2026-10-01T01:00:00.000Z', 'opus', 'ship', 'tool', 4)] }),
]

test('phases: fixed order, zero rows, totals, costPct, byModel, bySource', () => {
  const w = computeWorkflow(records, from, to)
  assert.equal(w.sessions, 2)
  assert.deepEqual(w.phases.map(p => p.phase), ['explore', 'plan', 'implement', 'test', 'review', 'debug', 'ship', 'other'])
  const impl = w.phases.find(p => p.phase === 'implement')!
  assert.deepEqual([impl.sessions, impl.messages, impl.tokens.total, impl.costUsd, impl.costPct], [1, 2, 20, 2, 50])
  assert.deepEqual(impl.byModel, { opus: { messages: 1, tokens: 10, costUsd: 1 }, haiku: { messages: 1, tokens: 10, costUsd: 1 } })
  assert.deepEqual(impl.bySource, { skill: 0, tool: 1, inherited: 1, none: 0 })
  assert.deepEqual(w.phases.find(p => p.phase === 'ship'), {
    phase: 'ship', sessions: 0, messages: 0, tokens: zero, costUsd: 0, costPct: 0, byModel: {}, bySource: { skill: 0, tool: 0, inherited: 0, none: 0 },
  })
  assert.equal(w.phases.reduce((n, p) => n + p.messages, 0), 4)
})

test('daily: every day, cost by message day, includes messages of sessions started before the range', () => {
  const w = computeWorkflow(records, from, to)
  assert.deepEqual(w.daily.map(d => d.date), ['2026-10-01', '2026-10-02'])
  assert.deepEqual([w.daily[0].byPhase.plan, w.daily[0].byPhase.implement, w.daily[0].byPhase.ship], [2, 1, 4])
  assert.deepEqual([w.daily[1].byPhase.implement, w.daily[1].byPhase.other], [1, 0])
})

test('subagents: grouping, models, error rate, duration, examples, order; cost pct; coverage', () => {
  const w = computeWorkflow(records, from, to)
  assert.deepEqual(w.subagents.map(g => [g.agentType, g.phase, g.runs]), [['general-purpose', 'implement', 2], ['Explore', 'explore', 1]])
  const g = w.subagents[0]
  assert.deepEqual([g.sessions, g.models, g.tokens, g.costUsd, g.toolCalls, g.toolErrors, g.errorRatePct, g.avgDurationMs, g.examples],
    [1, { haiku: 1, sonnet: 1 }, 10, 1, 4, 1, 25, 1000, ['Implement Task 2', 'Implement Task 1']])
  assert.deepEqual([w.subagents[1].errorRatePct, w.subagents[1].avgDurationMs, w.subagents[1].examples], [null, null, []])
  assert.equal(w.subagentCostPct, 25)
  assert.deepEqual(w.coverage, { skill: 25, tool: 25, inherited: 25, none: 25 })
})

test('empty range: nulls and zeros, no crash', () => {
  const w = computeWorkflow([], from, to)
  assert.deepEqual([w.sessions, w.subagents, w.subagentCostPct, w.coverage], [0, [], null, { skill: 0, tool: 0, inherited: 0, none: 0 }])
  assert.equal(w.phases[0].costPct, null)
  assert.equal(w.daily.length, 2)
})

test('a malformed message timestamp is skipped, not a crash', () => {
  const w = computeWorkflow([rec(summary('s3', '2026-10-01T10:00:00.000Z'), { messages: [msg('garbage', 'opus', 'plan', 'tool', 1)] })], from, to)
  assert.deepEqual(w.daily.map(d => d.byPhase.plan), [0, 0])
})

test('models: cost per message, avg context, output pct', () => {
  const m = (context: number, costUsd: number): MessageEvent => ({ ...msg('2026-10-01T10:00:00.000Z', 'opus', 'plan', 'tool', costUsd), tokens: { input: 10, output: 30, cacheCreation: 20, cacheRead: 100, total: 160 }, context })
  const w = computeWorkflow([rec(summary('s', '2026-10-01T10:00:00.000Z'), { messages: [m(100, 1), m(200, 3)] })], from, to)
  assert.deepEqual([w.models[0].model, w.models[0].costPerMessage, w.models[0].avgContext, w.models[0].outputPct], ['opus', 2, 150, 50])
})

test('phase flow aggregates transitions across sessions, most frequent first', () => {
  const w = computeWorkflow([
    rec(summary('a', '2026-10-01T10:00:00.000Z'), { phaseFlow: [{ from: 'explore', to: 'implement' }, { from: 'implement', to: 'test' }] }),
    rec(summary('b', '2026-10-01T11:00:00.000Z'), { phaseFlow: [{ from: 'implement', to: 'test' }] }),
  ], from, to)
  assert.deepEqual(w.phaseFlow, [{ from: 'implement', to: 'test', count: 2 }, { from: 'explore', to: 'implement', count: 1 }])
})

test('rework: totals, pct, hot files relative to the session cwd, top 15', () => {
  const a = summary('a', '2026-10-01T10:00:00.000Z')
  const w = computeWorkflow([
    rec({ ...a, project: '/repo', edits: 4, reworkEdits: 2 }, { fileEdits: { '/repo/src/x.ts': 3, '/elsewhere/y.ts': 1 } }),
    rec({ ...summary('b', '2026-10-01T11:00:00.000Z'), project: '/repo/', edits: 1, reworkEdits: 0 }, { fileEdits: { '/repo/src/x.ts': 1 } }),
  ], from, to)
  assert.deepEqual([w.rework.edits, w.rework.reworkEdits, w.rework.reworkPct], [5, 2, 40])
  assert.deepEqual(w.rework.hotFiles, [
    { file: 'src/x.ts', project: '/repo', edits: 4, sessions: 2, reworkEdits: 2 },
    { file: '/elsewhere/y.ts', project: '/repo', edits: 1, sessions: 1, reworkEdits: 0 },
  ])
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`/f${i}`, 1]))
  assert.equal(computeWorkflow([rec(a, { fileEdits: many })], from, to).rework.hotFiles.length, 15)
})

test('subagent groups carry cost per run', () => {
  const w = computeWorkflow(records, from, to)
  assert.deepEqual(w.subagents.map(g => g.costPerRun), [0.5, 0])
})

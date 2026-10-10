process.env.TZ = 'UTC'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAnalysis, verdict } from '../analysis.ts'
import { recordsInRange } from '../aggregate.ts'
import { computeModels } from '../models.ts'
import type { MessageEvent, SessionRecord, SkillWindow } from '../record.ts'
import type { SessionSummary, UsageFunnel } from '../../shared/types.ts'
import { summaryExtras, recordExtras } from './factories.ts'

const from = new Date('2026-10-01T00:00:00.000Z')
const to = new Date('2026-10-08T00:00:00.000Z')
const zero = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }
const summary = (id: string, startedAt: string, o: Partial<SessionSummary> = {}): SessionSummary => ({
  id, project: '/p', title: id, startedAt, models: [], userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0,
  tokens: zero, costUsd: null, skills: [], mcpServers: [], skillsUsed: [], mcpServersUsed: [], durationMs: null, linesAdded: null, linesRemoved: null, agentTypes: [], ...summaryExtras(), ...o,
})
const rec = (s: SessionSummary, o: Partial<SessionRecord> = {}): SessionRecord => ({ summary: s, messages: [], turnTimes: [], skillCalls: [], mcpCalls: [], mcpTools: {}, subagents: [], skillWindows: [], skillSequence: [], skillListingChars: {}, ...recordExtras(), ...o })
const msg = (ts: string, model: string, total: number, costUsd: number, skill: string | null, sidechain = false): MessageEvent =>
  ({ ts, model, provider: null, tokens: { ...zero, output: total, total }, costUsd, sidechain, skill, phase: 'other', phaseSource: 'none', agentId: null, mcpServer: null, context: 0 })
const fun = (o: Partial<Omit<UsageFunnel, 'verdict'>>): Omit<UsageFunnel, 'verdict'> =>
  ({ sessionsLoaded: 10, sessionsUsed: 0, adoptionPct: 0, calls: 0, errors: 0, errorRatePct: null, usedDays: 0, lastUsedAt: null, ...o })

test('verdict rules and precedence', () => {
  assert.equal(verdict(fun({ calls: 5, errors: 1, errorRatePct: 20, sessionsUsed: 5, adoptionPct: 50, usedDays: 3 })), 'problematic')
  assert.equal(verdict(fun({ calls: 4, errors: 4, errorRatePct: 100, sessionsUsed: 1, adoptionPct: 10, usedDays: 2 })), 'occasional')
  assert.equal(verdict(fun({ sessionsUsed: 1, adoptionPct: 10, usedDays: 2 })), 'useful')
  assert.equal(verdict(fun({ sessionsUsed: 1, adoptionPct: 10, usedDays: 2, calls: 10, errors: 1, errorRatePct: 10 })), 'occasional')
  assert.equal(verdict(fun({ sessionsUsed: 1, adoptionPct: 9.9, usedDays: 5 })), 'occasional')
  assert.equal(verdict(fun({ sessionsUsed: 1, adoptionPct: 50, usedDays: 1 })), 'occasional')
  assert.equal(verdict(fun({ sessionsLoaded: 5 })), 'unused')
  assert.equal(verdict(fun({ sessionsLoaded: 4 })), 'insufficient')
})

test('computeAnalysis: skills, mcp servers and models over sessions started in range', () => {
  const a = rec(summary('a', '2026-10-02T09:00:00.000Z', {
    skills: ['dev-debug', 'dataviz', 'superpowers:brainstorming'], skillsUsed: ['dev-debug'], mcpServers: ['engram', 'codegraph'], mcpServersUsed: ['engram'],
  }), {
    skillCalls: [{ ts: '2026-10-02T10:00:00.000Z', skill: 'dev-debug', error: false }],
    messages: [msg('2026-10-02T10:01:00.000Z', 'opus', 100, 1, 'dev-debug'), msg('2026-10-03T09:00:00.000Z', 'haiku', 50, 0.2, null, true)],
    mcpCalls: [{ ts: '2026-10-02T11:00:00.000Z', server: 'engram', tool: 'mem_save', error: true }, { ts: '2026-10-04T11:00:00.000Z', server: 'engram', tool: 'mem_search', error: false }],
    mcpTools: { engram: ['mem_save', 'mem_search', 'mem_context'], codegraph: ['codegraph_explore'] },
  })
  const b = rec(summary('b', '2026-10-05T09:00:00.000Z', { skills: ['dev-debug'], skillsUsed: ['dev-debug'], mcpServers: ['engram'] }), {
    skillCalls: [{ ts: '2026-10-05T10:00:00.000Z', skill: 'dev-debug', error: true }],
    messages: [msg('2026-10-05T10:00:00.000Z', 'opus', 300, 3, 'dev-debug')],
    mcpTools: { engram: ['mem_save'] },
  })
  const old = rec(summary('c', '2026-09-01T00:00:00.000Z', { skills: ['old'], skillsUsed: ['old'] }))
  const r = computeAnalysis([a, b, old], from, to)
  const models = computeModels(recordsInRange([a, b, old], from, to))
  assert.equal(r.sessions, 2)
  assert.deepEqual(r.skills.map(x => x.name), ['dev-debug', 'dataviz', 'superpowers:brainstorming'])
  assert.deepEqual(r.skills[0], {
    name: 'dev-debug', plugin: null, sessionsLoaded: 2, sessionsUsed: 2, adoptionPct: 100, calls: 2, errors: 1, errorRatePct: 50,
    usedDays: 2, lastUsedAt: '2026-10-05T10:00:00.000Z', tokens: 400, costUsd: 4, verdict: 'occasional',
    windows: 0, windowErrorRatePct: null, interruptedPct: null, linesEdited: 0, commitPct: null, costPerWindow: null, contextTokensEst: null,
  })
  assert.deepEqual(r.skills[2], {
    name: 'superpowers:brainstorming', plugin: 'superpowers', sessionsLoaded: 1, sessionsUsed: 0, adoptionPct: 0, calls: 0, errors: 0, errorRatePct: null,
    usedDays: 0, lastUsedAt: null, tokens: 0, costUsd: 0, verdict: 'insufficient',
    windows: 0, windowErrorRatePct: null, interruptedPct: null, linesEdited: 0, commitPct: null, costPerWindow: null, contextTokensEst: null,
  })
  assert.deepEqual(r.mcpServers.map(x => x.server), ['engram', 'codegraph'])
  assert.deepEqual(r.mcpServers[0], {
    server: 'engram', sessionsLoaded: 2, sessionsUsed: 1, adoptionPct: 50, calls: 2, errors: 1, errorRatePct: 50, usedDays: 2,
    lastUsedAt: '2026-10-04T11:00:00.000Z', toolsAvailable: 3, tools: [{ name: 'mem_save', calls: 1, errors: 1 }, { name: 'mem_search', calls: 1, errors: 0 }], verdict: 'occasional', tokens: 0, costUsd: 0, costPerCall: 0,
  })
  assert.equal(r.mcpServers[1].toolsAvailable, 1)
  assert.ok(!('models' in r))
  assert.deepEqual(models, [
    { model: 'opus', sessions: 2, messages: 2, tokens: { ...zero, output: 400, total: 400 }, costUsd: 4, cacheHitPct: null, subagentTokenPct: 0, costPerMessage: 2, avgContext: 0, outputPct: 100, priced: true },
    { model: 'haiku', sessions: 1, messages: 1, tokens: { ...zero, output: 50, total: 50 }, costUsd: 0.2, cacheHitPct: null, subagentTokenPct: 100, costPerMessage: 0.2, avgContext: 0, outputPct: 100, priced: true },
  ])
})

test('usedDays for a skill counts attributed messages; toolsAvailable null when no tool list was seen', () => {
  const a = rec(summary('a', '2026-10-02T09:00:00.000Z', { skills: ['vlt'], skillsUsed: ['vlt'], mcpServers: ['hermes'] }), {
    messages: [msg('2026-10-02T10:00:00.000Z', 'opus', 1, 0, 'vlt'), msg('2026-10-03T10:00:00.000Z', 'opus', 1, 0, 'vlt')],
  })
  const r = computeAnalysis([a], from, to)
  assert.deepEqual([r.skills[0].usedDays, r.skills[0].calls, r.skills[0].lastUsedAt, r.skills[0].verdict], [2, 0, '2026-10-03T10:00:00.000Z', 'useful'])
  assert.equal(r.mcpServers[0].toolsAvailable, null)
})

test('verdict: problematic needs an error rate of at least 20', () => {
  assert.equal(verdict(fun({ calls: 5, errors: 1, errorRatePct: 19.9, sessionsUsed: 1, adoptionPct: 10, usedDays: 1 })), 'occasional')
})

test('skills and servers sort by verdict, then calls desc, then name asc', () => {
  const used = (name: string, calls: number) => Array.from({ length: calls }, () => ({ ts: '2026-10-02T10:00:00.000Z', skill: name, error: false }))
  const a = rec(summary('a', '2026-10-02T09:00:00.000Z', {
    skills: ['zeta', 'beta', 'alpha', 'idle', 'busy'], skillsUsed: ['zeta', 'beta', 'alpha', 'busy'],
    mcpServers: ['s2', 's1', 's3'], mcpServersUsed: ['s2', 's1'],
  }), {
    skillCalls: [...used('zeta', 1), ...used('beta', 1), ...used('alpha', 1), ...used('busy', 3)],
    mcpCalls: [{ ts: null, server: 's2', tool: 't', error: false }, { ts: null, server: 's1', tool: 't', error: false }, { ts: null, server: 's1', tool: 't', error: false }],
  })
  const r = computeAnalysis([a], from, to)
  assert.deepEqual(r.skills.map(x => x.name), ['busy', 'alpha', 'beta', 'zeta', 'idle'])
  assert.deepEqual(r.mcpServers.map(x => x.server), ['s1', 's2', 's3'])
  const p = rec(summary('p', '2026-10-03T09:00:00.000Z', { skills: ['bad', 'ok'], skillsUsed: ['bad', 'ok'] }), {
    skillCalls: [...Array.from({ length: 5 }, () => ({ ts: '2026-10-03T10:00:00.000Z', skill: 'bad', error: true })), { ts: '2026-10-03T10:00:00.000Z', skill: 'ok', error: false }],
  })
  assert.deepEqual(computeAnalysis([p], from, to).skills.map(x => [x.name, x.verdict]), [['bad', 'problematic'], ['ok', 'occasional']])
  const u = rec(summary('u', '2026-10-03T09:00:00.000Z', { skills: ['two-days', 'one-day'], skillsUsed: ['two-days', 'one-day'] }), {
    skillCalls: [
      { ts: '2026-10-03T10:00:00.000Z', skill: 'two-days', error: false }, { ts: '2026-10-04T10:00:00.000Z', skill: 'two-days', error: false },
      ...Array.from({ length: 3 }, () => ({ ts: '2026-10-03T10:00:00.000Z', skill: 'one-day', error: false })),
    ],
  })
  assert.deepEqual(computeAnalysis([u], from, to).skills.map(x => [x.name, x.verdict]), [['two-days', 'useful'], ['one-day', 'occasional']])
})

test('tools sort by calls desc then name; models count a session once, tie-break by name, cache hit uses all input kinds', () => {
  const m = (model: string, cacheRead: number, cacheCreation: number, input: number, costUsd = 0.5) =>
    ({ ts: null, model, provider: null, tokens: { input, output: 0, cacheCreation, cacheRead, total: input + cacheCreation + cacheRead }, costUsd, sidechain: false, skill: null, phase: 'other' as const, phaseSource: 'none' as const, agentId: null, mcpServer: null, context: 0 })
  const a = rec(summary('a', '2026-10-02T09:00:00.000Z', { mcpServers: ['x'], mcpServersUsed: ['x'] }), {
    mcpCalls: [{ ts: null, server: 'x', tool: 'b', error: false }, { ts: null, server: 'x', tool: 'a', error: false }, { ts: null, server: 'x', tool: 'c', error: false }, { ts: null, server: 'x', tool: 'c', error: false }],
    messages: [m('zz', 50, 25, 25), m('zz', 0, 0, 0), m('aa', 0, 0, 1, 1)],
  })
  const r = computeAnalysis([a], from, to)
  assert.deepEqual(r.mcpServers[0].tools.map(t => t.name), ['c', 'a', 'b'])
  assert.deepEqual(computeModels([a]).map(x => [x.model, x.sessions, x.messages, x.cacheHitPct]), [['aa', 1, 1, 0], ['zz', 1, 2, 50]])
})

test('skills: window outcomes, cost per window and context estimate', () => {
  const win = (o: Partial<SkillWindow>): SkillWindow =>
    ({ skill: 'dev-plan', ts: null, toolCalls: 0, toolErrors: 0, interrupted: false, linesEdited: 0, committed: false, ...o })
  const r1 = rec(summary('r1', '2026-10-02T09:00:00.000Z', { skills: ['dev-plan', 'vlt'], skillsUsed: ['dev-plan'] }), {
    skillWindows: [win({ toolCalls: 4, toolErrors: 1, interrupted: true, linesEdited: 10, committed: true }), win({ linesEdited: 2 })],
    messages: [msg('2026-10-02T09:01:00.000Z', 'opus', 10, 3, 'dev-plan')],
    skillListingChars: { 'dev-plan': 40 },
  })
  const r2 = rec(summary('r2', '2026-10-03T09:00:00.000Z', { skills: ['dev-plan'] }), { skillListingChars: { 'dev-plan': 81 } })
  const r3 = rec(summary('r3', '2026-10-01T09:00:00.000Z', { skills: ['dev-plan'] }), { skillListingChars: { 'dev-plan': 8 } })
  const a = computeAnalysis([r1, r2, r3], from, to)
  const plan = a.skills.find(s => s.name === 'dev-plan')!
  assert.deepEqual(
    [plan.windows, plan.windowErrorRatePct, plan.interruptedPct, plan.linesEdited, plan.commitPct, plan.costPerWindow, plan.contextTokensEst],
    [2, 25, 50, 12, 50, 1.5, 63])
  const vlt = a.skills.find(s => s.name === 'vlt')!
  assert.deepEqual(
    [vlt.windows, vlt.windowErrorRatePct, vlt.interruptedPct, vlt.linesEdited, vlt.commitPct, vlt.costPerWindow, vlt.contextTokensEst],
    [0, null, null, 0, null, null, null])
})

test('sequences: top paths (length >= 2) and transitions with end', () => {
  const seq = (id: string, day: string, skillSequence: string[]) => rec(summary(id, `2026-10-0${day}T09:00:00.000Z`), { skillSequence })
  const a = computeAnalysis([
    seq('a', '2', ['dev-plan', 'dev-implement', 'dev-ship']),
    seq('b', '3', ['dev-plan', 'dev-implement', 'dev-ship']),
    seq('c', '4', ['dev-plan', 'dev-debug']),
    seq('d', '5', ['dev-plan']),
    seq('e', '6', []),
    seq('old', '9', ['x', 'y']),
  ], from, to)
  assert.deepEqual(a.sequences.top, [
    { path: ['dev-plan', 'dev-implement', 'dev-ship'], sessions: 2 },
    { path: ['dev-plan', 'dev-debug'], sessions: 1 },
  ])
  assert.deepEqual(a.sequences.transitions, [
    { from: 'dev-implement', to: 'dev-ship', count: 2 },
    { from: 'dev-plan', to: 'dev-implement', count: 2 },
    { from: 'dev-ship', to: null, count: 2 },
    { from: 'dev-debug', to: null, count: 1 },
    { from: 'dev-plan', to: 'dev-debug', count: 1 },
    { from: 'dev-plan', to: null, count: 1 },
  ])
})

test('verdict: frustration (>= 5 windows, >= 30% interrupted) is problematic', () => {
  const f = fun({ calls: 5, sessionsUsed: 5, adoptionPct: 50, usedDays: 3, errorRatePct: 0 })
  assert.equal(verdict(f, { windows: 5, interruptedPct: 30 }), 'problematic')
  assert.equal(verdict(f, { windows: 4, interruptedPct: 100 }), 'useful')
  assert.equal(verdict(f, { windows: 5, interruptedPct: 29 }), 'useful')
  const w = (interrupted: boolean): SkillWindow => ({ skill: 'k', ts: '2026-10-02T09:00:00.000Z', toolCalls: 1, toolErrors: 0, interrupted, linesEdited: 0, committed: false })
  const r = rec(summary('a', '2026-10-02T09:00:00.000Z', { skills: ['k'], skillsUsed: ['k'] }), { skillWindows: [w(true), w(true), w(false), w(false), w(false)] })
  assert.equal(computeAnalysis([r], from, to).skills[0].verdict, 'problematic')
})

test('tooling: tool mix, loaded counts, skill context, built-in tools, hooks, mcp cost', () => {
  const a = rec(summary('a', '2026-10-02T09:00:00.000Z', { skills: ['k'], mcpServers: ['x'], mcpServersUsed: ['x'], toolCalls: { total: 5, skills: 1, mcp: 2, builtin: 2 } }), {
    toolStats: { Bash: { calls: 4, errors: 1, rejections: 1 }, Read: { calls: 1, errors: 0, rejections: 0 } },
    hooks: [{ event: 'SessionStart', name: 'init', contextChars: 10 }, { event: 'SessionStart', name: 'init', contextChars: 3 }],
    mcpCalls: [{ ts: null, server: 'x', tool: 't', error: false }, { ts: null, server: 'x', tool: 't', error: false }],
    messages: [{ ...msg('2026-10-02T09:00:00.000Z', 'o', 10, 0.4, null), mcpServer: 'x' }, msg('2026-10-02T09:00:00.000Z', 'o', 5, 9, null)],
    skillListingChars: { k: 40 },
  })
  const b = rec(summary('b', '2026-10-03T09:00:00.000Z', { skills: ['k', 'j'], toolCalls: { total: 1, skills: 0, mcp: 0, builtin: 1 } }), {
    toolStats: { Bash: { calls: 6, errors: 0, rejections: 0 } }, hooks: [{ event: 'Stop', name: 'z', contextChars: 0 }],
  })
  const r = computeAnalysis([a, b], from, to)
  assert.deepEqual(r.toolMix, { total: 6, skills: 1, mcp: 2, builtin: 3 })
  assert.deepEqual([r.loadedSkills, r.loadedMcpServers], [2, 1])
  assert.equal(r.skillContextTokensEst, 20)
  assert.deepEqual(r.builtinTools, [
    { name: 'Bash', sessions: 2, calls: 10, errors: 1, errorRatePct: 10, rejections: 1 },
    { name: 'Read', sessions: 1, calls: 1, errors: 0, errorRatePct: 0, rejections: 0 },
  ])
  assert.deepEqual(r.hooks, [{ event: 'SessionStart', name: 'init', sessions: 1, runs: 2, contextTokensEst: 4 }, { event: 'Stop', name: 'z', sessions: 1, runs: 1, contextTokensEst: 0 }])
  const x = r.mcpServers[0]
  assert.deepEqual([x.tokens, x.costUsd, x.costPerCall], [10, 0.4, 0.2])
})

test('computeModels: priced is false only for Copilot models missing from the price table', () => {
  const cc = rec(summary('a', '2026-10-02T09:00:00.000Z'), { messages: [msg('2026-10-02T09:00:00.000Z', 'mystery-cc', 1, 0, null)] })
  const cp = rec(summary('b', '2026-10-02T09:00:00.000Z', { agent: 'copilot' }), {
    messages: [msg('2026-10-02T09:00:00.000Z', 'mystery-cp', 1, 0, null), msg('2026-10-02T09:00:00.000Z', 'claude-sonnet-5', 1, 0, null)],
  })
  assert.deepEqual(computeModels([cc, cp]).map(m => [m.model, m.priced]).sort(), [['claude-sonnet-5', true], ['mystery-cc', true], ['mystery-cp', false]])
})

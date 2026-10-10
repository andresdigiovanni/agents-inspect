import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDetail } from '../detail.ts'
import { parseRecord } from '../parse.ts'
import * as f from './fixtures.ts'
import { recordExtras, summaryExtras } from './factories.ts'
import type { MessageEvent, SessionRecord } from '../record.ts'

const msg = (provider: string | null): MessageEvent => ({
  ts: '2026-10-01T00:00:00.000Z', model: 'glm-5.3', provider, tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0, total: 2 }, costUsd: 1, sidechain: false, skill: null,
  phase: 'other', phaseSource: 'none', agentId: null, mcpServer: null, context: 1,
})
const rec = (messages: MessageEvent[]): SessionRecord => ({
  summary: { id: 'x', project: '/p', title: 'x', startedAt: '2026-10-01T00:00:00Z', models: [], userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: 0, skills: [], mcpServers: [], skillsUsed: [], mcpServersUsed: [], agentTypes: [], durationMs: null, linesAdded: null, linesRemoved: null, ...summaryExtras() },
  messages, turnTimes: [], skillCalls: [], mcpCalls: [], mcpTools: {}, subagents: [], skillWindows: [], skillSequence: [], skillListingChars: {}, ...recordExtras(),
})

test('detail: cost by model and phase, parent context series, subagents without toolUseId, top files', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm1', model: 'opus', usage: { input_tokens: 10, output_tokens: 1 }, tools: [{ id: 'e1', name: 'Edit', input: { file_path: '/repo/demo/a.ts' } }] }),
    f.assistant({ id: 'm2', model: 'haiku', usage: { input_tokens: 20, output_tokens: 1 }, tools: [{ id: 'r1', name: 'Read' }] }),
    f.costState(3, { modelUsage: { opus: { costUSD: 2 }, haiku: { costUSD: 1 } } }),
  ], [[f.assistant({ id: 's1', model: 'haiku', sidechain: true, usage: { input_tokens: 99 }, tools: [{ id: 'e2', name: 'Write', input: { file_path: '/repo/demo/a.ts' } }] })]],
  { id: 'x', projectDir: 'p' }, [{ agentId: 'a1', meta: { toolUseId: 'ag', agentType: 'Explore' } }])!
  const d = computeDetail(r)
  assert.equal(d.summary.id, 'x')
  assert.deepEqual(d.costByModel.map(c => c.model), ['opus', 'haiku'])
  assert.deepEqual(d.costByModel.map(c => c.provider), [null, null])
  assert.equal(Object.values(d.costByPhase).reduce((a, b) => a + b, 0), 3)
  assert.deepEqual(d.context.map(c => c.context), [10, 20])
  assert.equal(d.subagents.length, 1)
  assert.equal('toolUseId' in d.subagents[0], false)
  assert.deepEqual(d.topFiles, [{ file: 'a.ts', edits: 2 }])
})

test('detail: costByModel keeps the provider when a model is served by one; null when mixed or absent', () => {
  const one = computeDetail(rec([msg('zai-coding-plan'), msg('zai-coding-plan')]))
  assert.deepEqual(one.costByModel.map(c => [c.model, c.provider]), [['glm-5.3', 'zai-coding-plan']])
  const mixed = computeDetail(rec([msg('zai-coding-plan'), msg('opencode')]))
  assert.deepEqual(mixed.costByModel.map(c => [c.model, c.provider]), [['glm-5.3', null]])
  const none = computeDetail(rec([msg(null)]))
  assert.deepEqual(none.costByModel.map(c => [c.model, c.provider]), [['glm-5.3', null]])
  const nullFirst = computeDetail(rec([msg(null), msg('zai-coding-plan')]))
  assert.deepEqual(nullFirst.costByModel.map(c => [c.model, c.provider]), [['glm-5.3', null]])
})

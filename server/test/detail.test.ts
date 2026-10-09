import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDetail } from '../detail.ts'
import { parseRecord } from '../parse.ts'
import * as f from './fixtures.ts'

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
  assert.equal(Object.values(d.costByPhase).reduce((a, b) => a + b, 0), 3)
  assert.deepEqual(d.context.map(c => c.context), [10, 20])
  assert.equal(d.subagents.length, 1)
  assert.equal('toolUseId' in d.subagents[0], false)
  assert.deepEqual(d.topFiles, [{ file: 'a.ts', edits: 2 }])
})

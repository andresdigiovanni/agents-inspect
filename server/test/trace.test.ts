import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrace } from '../trace.ts'
import * as f from './fixtures.ts'

test('trace: user, assistant text, tool_use, tool_result; meta and attachments skipped; subagents flagged', () => {
  const parent = [f.skillListing(['x']), f.userText('meta', { isMeta: true }), f.userText('hello', { ts: '2026-10-01T10:00:01.000Z' }),
    f.assistant({ id: 'm1', text: 'thinking out loud', tools: [{ id: 't1', name: 'Bash', input: { command: 'ls' } }] }), f.toolResult('t1')]
  const sub = [f.assistant({ id: 'm2', sidechain: true, text: 'z'.repeat(400) })]
  const t = buildTrace(parent, [sub])
  assert.deepEqual(t.map(e => [e.kind, e.sidechain, e.toolName]), [
    ['user', false, undefined], ['assistant', false, undefined], ['tool_use', false, 'Bash'], ['tool_result', false, undefined], ['assistant', true, undefined]])
  assert.equal(t[0].text, 'hello'); assert.equal(t[0].timestamp, '2026-10-01T10:00:01.000Z')
  assert.equal(t[2].text, '{"command":"ls"}')
  assert.equal(t[4].text.length, 300)
})

test('trace: subagent lines are sidechain even without isSidechain; user text blocks and tool_result variants', () => {
  const parent = [
    { type: 'user', timestamp: 't1', message: { content: [{ type: 'text', text: 'block text' }] } },
    { type: 'user', timestamp: 't2', message: { content: [{ type: 'tool_result', content: 'plain result' }] } },
    { type: 'user', timestamp: 't3', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }] } },
    { type: 'system', timestamp: 't4', message: { content: [{ type: 'text', text: 'not an event' }] } },
  ]
  const sub = [f.assistant({ id: 'm3', sidechain: false, text: 'from subagent' })]
  const t = buildTrace(parent, [sub])
  assert.deepEqual(t.map(e => [e.kind, e.text, e.sidechain]), [
    ['user', 'block text', false], ['tool_result', 'plain result', false], ['tool_result', 'a b', false], ['assistant', 'from subagent', true]])
})

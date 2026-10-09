import { test } from 'node:test'
import assert from 'node:assert/strict'
import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadRecords } from '../load.ts'
import { findCopilotSession, parseWorkspaceYaml } from '../copilot/load.ts'
import { buildCopilotTrace } from '../copilot/trace.ts'
import * as f from './fixtures.ts'
import * as c from './copilotFixtures.ts'

test('parseWorkspaceYaml reads flat key: value pairs and strips quotes', () => {
  assert.deepEqual(parseWorkspaceYaml('id: c1\nname: "Fix: the bug"\nbranch: main\n  nested: x\n'), { id: 'c1', name: 'Fix: the bug', branch: 'main' })
})

test('loadRecords merges Claude and Copilot; Copilot reads workspace.yaml and vscode metadata; cache invalidates', async () => {
  const claude = await f.makeProjectsDir({ 'p/s1.jsonl': f.jsonl([f.userText('claude')]) })
  const copilot = await f.makeProjectsDir({
    'c1/events.jsonl': f.jsonl([c.start({ id: 'c1' }), c.user('copilot')]),
    'c1/workspace.yaml': 'id: c1\nname: "Named"\n',
    'c2/events.jsonl': f.jsonl([c.start({ id: 'c2' }), c.user('two')]),
    'c2/vscode.metadata.json': '{"origin":"vscode"}',
    'c3/workspace.yaml': 'id: c3\n',
  })
  const rows = async (cp?: string) => (await loadRecords(claude, cp)).map(r => [r.summary.id, r.summary.agent, r.summary.title, r.summary.entrypoint, r.summary.userTurns])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  assert.deepEqual(await rows(copilot), [['c1', 'copilot', 'Named', 'cli', 1], ['c2', 'copilot', 'two', 'vscode', 1], ['s1', 'claude-code', 'claude', null, 1]])
  assert.deepEqual(await rows(), [['s1', 'claude-code', 'claude', null, 1]])
  const ev = join(copilot, 'c1/events.jsonl')
  await writeFile(ev, f.jsonl([c.start({ id: 'c1' }), c.user('a'), c.user('b')]))
  await utimes(ev, new Date(), new Date(Date.now() + 5000))
  assert.equal((await rows(copilot))[0][4], 2)
})

test('findCopilotSession: existing id, missing events.jsonl, unsafe id', async () => {
  const copilot = await f.makeProjectsDir({ 'c2/events.jsonl': f.jsonl([c.start()]), 'c3/workspace.yaml': 'id: c3\n' })
  assert.deepEqual(await findCopilotSession(copilot, 'c2'), { id: 'c2', dir: join(copilot, 'c2'), events: join(copilot, 'c2/events.jsonl') })
  assert.equal(await findCopilotSession(copilot, 'c3'), null)
  assert.equal(await findCopilotSession(copilot, '../x'), null)
})

test('buildCopilotTrace: user, assistant text, tool use/result, sidechain; skips report_intent and empty text', () => {
  const t = buildCopilotTrace([c.start(), c.user('hi', c.T(1)), c.assistant({ content: 'ok', tools: ['a'] }), c.assistant({ content: '' }),
    c.toolStart('a', 'bash', { command: 'ls' }), c.toolDone('a', { result: 'file' }),
    c.toolStart('r', 'report_intent', {}), c.toolDone('r'),
    c.toolStart('s', 'view', {}, { parent: 't1' }), c.toolDone('s', { ok: false, error: 'nope', parent: 't1' })])
  assert.deepEqual(t.map(e => [e.kind, e.text, e.toolName ?? null, e.sidechain]), [
    ['user', 'hi', null, false], ['assistant', 'ok', null, false], ['tool_use', '{"command":"ls"}', 'bash', false], ['tool_result', 'file', null, false],
    ['tool_use', '{}', 'view', true], ['tool_result', 'nope', null, true]])
  assert.equal(t[0].timestamp, c.T(1))
})

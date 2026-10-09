import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, utimes, stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listSessionFiles, loadSessions, loadRecords, findSession } from '../load.ts'
import * as f from './fixtures.ts'

const tree = () => ({
  'proj-a/s1.jsonl': f.jsonl([f.userText('hello'), f.assistant({ id: 'm1', usage: { output_tokens: 10 } })]),
  'proj-a/s1/subagents/agent-x.jsonl': f.jsonl([f.assistant({ id: 'm2', sidechain: true, usage: { output_tokens: 5 }, tools: [{ id: 't1', name: 'Read' }] })]),
  'proj-b/s2.jsonl': f.jsonl([f.userText('b')]),
  'proj-b/empty.jsonl': '',
  'proj-b/notes.txt': 'ignored',
})

test('pairs parents with subagents, ignores non-jsonl, skips sessions with no timestamp', async () => {
  const dir = await f.makeProjectsDir(tree())
  const files = await listSessionFiles(dir)
  assert.deepEqual(files.map(x => x.id).sort(), ['empty', 's1', 's2'])
  assert.equal(files.find(x => x.id === 's1')!.subagents.length, 1)
  const sessions = await loadSessions(dir)
  assert.deepEqual(sessions.map(s => s.id).sort(), ['s1', 's2'])
  const s1 = sessions.find(s => s.id === 's1')!
  assert.equal(s1.tokens.output, 15); assert.equal(s1.toolCalls.builtin, 1)
})

test('missing projects dir yields no sessions', async () => {
  assert.deepEqual(await loadSessions('/nonexistent/agents-inspect'), [])
})

test('re-parses a session only when one of its files changes', async () => {
  const dir = await f.makeProjectsDir(tree())
  const first = await loadSessions(dir)
  const again = await loadSessions(dir)
  assert.equal(again.find(s => s.id === 's1'), first.find(s => s.id === 's1'))   // same object: cached
  const sub = join(dir, 'proj-a/s1/subagents/agent-x.jsonl')
  await writeFile(sub, f.jsonl([f.assistant({ id: 'm3', sidechain: true, usage: { output_tokens: 50 } })]))
  await utimes(sub, new Date(), new Date(Date.now() + 5000))
  const changed = (await loadSessions(dir)).find(s => s.id === 's1')!
  assert.equal(changed.tokens.output, 60)
})

test('a size change alone invalidates the cache', async () => {
  const dir = await f.makeProjectsDir(tree())
  const sub = join(dir, 'proj-a/s1/subagents/agent-x.jsonl')
  const mtime = new Date(1_700_000_000_000)             // whole-ms, so restoring it is exact
  await utimes(sub, mtime, mtime)
  const size = (await stat(sub)).size
  await loadSessions(dir)
  await writeFile(sub, f.jsonl([f.assistant({ id: 'm9', sidechain: true, usage: { output_tokens: 500 } })]))
  await utimes(sub, mtime, mtime)                       // same mtime, different size
  assert.notEqual((await stat(sub)).size, size)
  assert.equal((await loadSessions(dir)).find(s => s.id === 's1')!.tokens.output, 510)
})

test('an mtime change alone invalidates the cache', async () => {
  const dir = await f.makeProjectsDir(tree())
  const sub = join(dir, 'proj-a/s1/subagents/agent-x.jsonl')
  const before = await readFile(sub, 'utf8')
  await loadSessions(dir)
  const after = before.replace('"output_tokens":5', '"output_tokens":7')
  assert.equal(after.length, before.length); assert.notEqual(after, before)
  await writeFile(sub, after)
  await utimes(sub, new Date(), new Date(Date.now() + 5000))
  assert.equal((await loadSessions(dir)).find(s => s.id === 's1')!.tokens.output, 17)
})

test('findSession returns files for a known id and null otherwise', async () => {
  const dir = await f.makeProjectsDir(tree())
  assert.equal((await findSession(dir, 's2'))!.projectDir, 'proj-b')
  assert.equal(await findSession(dir, 'nope'), null)
  assert.equal(await findSession(dir, '../proj-a/s1'), null)
})

test('loadRecords returns records whose summaries are what loadSessions returns', async () => {
  const dir = await f.makeProjectsDir(tree())
  const records = await loadRecords(dir)
  const sessions = await loadSessions(dir)
  assert.deepEqual(records.map(r => r.summary), sessions)
  assert.equal(records.find(r => r.summary.id === 's1')!.messages.length, 2)
})

test('loadRecords reads agent-<id>.meta.json next to each subagent file', async () => {
  const dir = await f.makeProjectsDir({
    'p/s9.jsonl': f.jsonl([f.userText('go'), f.assistant({ id: 'm1', tools: [{ id: 'ag1', name: 'Agent', input: { description: 'x' } }] })]),
    'p/s9/subagents/agent-abc.jsonl': f.jsonl([f.assistant({ id: 'm2', sidechain: true })]),
    'p/s9/subagents/agent-abc.meta.json': JSON.stringify({ agentType: 'general-purpose', description: 'Do x', toolUseId: 'ag1' }),
    'p/s9/subagents/agent-def.jsonl': f.jsonl([f.assistant({ id: 'm3', sidechain: true })]),
    'p/s9/subagents/agent-def.meta.json': '{not json',
  })
  const r = (await loadRecords(dir)).find(x => x.summary.id === 's9')!
  assert.deepEqual(r.subagents.map(s => [s.agentId, s.agentType, s.description, s.toolUseId]).sort(),
    [['abc', 'general-purpose', 'Do x', 'ag1'], ['def', 'unknown', '', null]])
})

test('a meta.json appearing later invalidates the cache', async () => {
  const dir = await f.makeProjectsDir({
    'p/s8.jsonl': f.jsonl([f.userText('go'), f.assistant({ id: 'm1' })]),
    'p/s8/subagents/agent-q.jsonl': f.jsonl([f.assistant({ id: 'm2', sidechain: true })]),
  })
  const before = (await loadRecords(dir)).find(x => x.summary.id === 's8')!
  assert.equal(before.subagents[0].agentType, 'unknown')
  await writeFile(`${dir}/p/s8/subagents/agent-q.meta.json`, JSON.stringify({ agentType: 'explore' }))
  const after = (await loadRecords(dir)).find(x => x.summary.id === 's8')!
  assert.equal(after.subagents[0].agentType, 'explore')
})

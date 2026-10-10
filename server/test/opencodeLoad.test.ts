import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { loadRecords } from '../load.ts'
import { findOpencodeSession, loadOpencodeRecords, opencodeRaw, opencodeTrace } from '../opencode/load.ts'
import { computeModels } from '../models.ts'
import * as f from './fixtures.ts'
import * as oc from './opencodeFixtures.ts'

test('loadOpencodeRecords: parents only, orphans as roots, cache invalidates on new messages or child updates', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p' }), oc.sess({ id: 'ses_c', parent: 'ses_p', agent: 'explore' }), oc.sess({ id: 'ses_o', parent: 'ses_gone' })],
    [oc.userMsg({ id: 'm1', session: 'ses_p' })],
    [oc.textPart({ msg: 'm1', session: 'ses_p', text: 'one' })],
  )
  let rows = await loadOpencodeRecords(path)
  assert.deepEqual(rows.map(r => r.summary.id).sort(), ['ses_o', 'ses_p'])
  const db = new DatabaseSync(path)
  const m = oc.userMsg({ session: 'ses_p', created: oc.ms(70) })
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(String(m.id), String(m.session_id), Number(m.time_created), Number(m.time_updated), String(m.data))
  const p = oc.textPart({ msg: String(m.id), session: 'ses_p', text: 'two' })
  db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(String(p.id), String(p.message_id), String(p.session_id), Number(p.time_created), Number(p.time_updated), String(p.data))
  db.prepare('UPDATE session SET time_updated = ? WHERE id = ?').run(oc.ms(80), 'ses_c')
  db.close()
  rows = await loadOpencodeRecords(path)
  const parent = rows.find(r => r.summary.id === 'ses_p')!
  assert.equal(parent.summary.userTurns, 2)
  assert.equal(parent.subagents.length, 1)

  // A child-message insert alone (child session row untouched) must still invalidate the parent's cached record.
  const path2 = await oc.makeDb(
    [oc.sess({ id: 'ses_p2' }), oc.sess({ id: 'ses_c2', parent: 'ses_p2' })],
    [oc.userMsg({ id: 'm1', session: 'ses_p2' })],
    [oc.textPart({ msg: 'm1', session: 'ses_p2', text: 'one' })],
  )
  const first = await loadOpencodeRecords(path2)
  assert.equal(first.find(r => r.summary.id === 'ses_p2')!.subagents[0].toolCalls, 0)
  const db2 = new DatabaseSync(path2)
  const cm = oc.assistantMsg({ session: 'ses_c2', created: oc.ms(70), completed: oc.ms(71) })
  db2.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(String(cm.id), String(cm.session_id), Number(cm.time_created), Number(cm.time_updated), String(cm.data))
  const cp = oc.toolPart({ msg: String(cm.id), session: 'ses_c2', tool: 'read', input: {} })
  db2.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(String(cp.id), String(cp.message_id), String(cp.session_id), Number(cp.time_created), Number(cp.time_updated), String(cp.data))
  db2.close()
  const second = await loadOpencodeRecords(path2)
  assert.equal(second.find(r => r.summary.id === 'ses_p2')!.subagents[0].toolCalls, 1)
})

// A part-only insert on an existing message (message and session rows untouched) must still invalidate the cached record.
test('loadOpencodeRecords: part-only writes invalidate the per-root cache', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p3' })],
    [oc.userMsg({ id: 'm1', session: 'ses_p3' }), oc.assistantMsg({ id: 'm2', session: 'ses_p3', created: oc.ms(1), completed: oc.ms(2) })],
    [oc.textPart({ msg: 'm1', session: 'ses_p3', text: 'go' }), oc.textPart({ msg: 'm2', session: 'ses_p3', text: 'ok' })],
  )
  const before = await loadOpencodeRecords(path)
  assert.equal(before.find(r => r.summary.id === 'ses_p3')!.summary.toolErrors, 0)
  const db = new DatabaseSync(path)
  const ep = oc.toolPart({ msg: 'm2', session: 'ses_p3', tool: 'grep', status: 'error', error: 'boom', created: oc.ms(70) })
  db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(String(ep.id), String(ep.message_id), String(ep.session_id), Number(ep.time_created), Number(ep.time_updated), String(ep.data))
  db.close()
  const after = await loadOpencodeRecords(path)
  assert.equal(after.find(r => r.summary.id === 'ses_p3')!.summary.toolErrors, 1)
})

test('loadOpencodeRecords: summary sessions stay roots and never attach as subagents', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p3' }), oc.sess({ id: 'ses_sum3', parent: 'ses_p3', agent: 'summary' })],
    [oc.userMsg({ id: 'm1', session: 'ses_p3' })],
    [oc.textPart({ msg: 'm1', session: 'ses_p3', text: 'one' })],
  )
  const rows = await loadOpencodeRecords(path)
  assert.deepEqual(rows.map(r => r.summary.id).sort(), ['ses_p3', 'ses_sum3'])
  assert.equal(rows.find(r => r.summary.id === 'ses_p3')!.subagents.length, 0)
})

test('findOpencodeSession: exists, missing, unsafe id', async () => {
  const path = await oc.makeDb([oc.sess({ id: 'ses_x' })], [], [])
  assert.equal(await findOpencodeSession(path, 'ses_x'), true)
  assert.equal(await findOpencodeSession(path, 'nope'), false)
  assert.equal(await findOpencodeSession(path, '../x'), false)
  assert.equal(await findOpencodeSession('/nonexistent/opencode.db', 'ses_x'), false)
})

test('opencodeTrace and opencodeRaw expose messages, tools and children as sidechain', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p' }), oc.sess({ id: 'ses_c', parent: 'ses_p' })],
    [oc.userMsg({ id: 'm1', session: 'ses_p' }), oc.assistantMsg({ id: 'm2', session: 'ses_p', completed: oc.ms(5) }),
     oc.assistantMsg({ id: 'm3', session: 'ses_c', completed: oc.ms(8) })],
    [oc.textPart({ msg: 'm1', session: 'ses_p', text: 'hi' }),
     oc.toolPart({ msg: 'm2', session: 'ses_p', tool: 'bash', input: { command: 'ls' }, output: 'x' }),
     oc.textPart({ msg: 'm3', session: 'ses_c', text: 'sub' })],
  )
  const trace = await opencodeTrace(path, 'ses_p')
  assert.deepEqual(trace!.map(e => [e.kind, e.sidechain]), [['user', false], ['tool_use', false], ['tool_result', false], ['assistant', true]])
  assert.equal(trace![1].toolName, 'bash')
  assert.equal(trace![0].timestamp, oc.ISO(0))
  assert.equal(await opencodeTrace(path, 'nope'), null)
  const raw = await opencodeRaw(path, 'ses_p')
  const lines = raw!.trim().split('\n').map(l => JSON.parse(l))
  assert.equal(lines.length, 6)
  assert.equal(lines.filter(l => typeof l.role === 'string').length, 3)
  assert.equal(lines.filter(l => typeof l.messageId === 'string').length, 3)
})

test('loadRecords merges Claude, Copilot and opencode', async () => {
  const claude = await f.makeProjectsDir({ 'p/s1.jsonl': f.jsonl([f.userText('hi')]) })
  const path = await oc.makeDb([oc.sess({ id: 'ses_oc' })], [oc.userMsg({ id: 'm1', session: 'ses_oc' })], [oc.textPart({ msg: 'm1', session: 'ses_oc', text: 'x' })])
  const rows = (await loadRecords(claude, undefined, path)).map(r => [r.summary.id, r.summary.agent]).sort()
  assert.deepEqual(rows, [['s1', 'claude-code'], ['ses_oc', 'opencode']])
})

test('models: opencode models with reported cost are priced; unpriced are not', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_a', cost: 1.5 }), oc.sess({ id: 'ses_b', cost: 0 })],
    [oc.assistantMsg({ session: 'ses_a', model: 'big-pickle', cost: 1.5, completed: oc.ms(1) }),
     oc.assistantMsg({ session: 'ses_b', model: 'glm-5.3', completed: oc.ms(1) })],
    [],
  )
  const models = computeModels(await loadOpencodeRecords(path))
  assert.equal(models.find(m => m.model === 'big-pickle')!.priced, true)
  assert.equal(models.find(m => m.model === 'glm-5.3')!.priced, false)
})

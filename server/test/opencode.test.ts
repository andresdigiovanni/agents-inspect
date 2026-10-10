import { test } from 'node:test'
import assert from 'node:assert/strict'
import { childRows, listSessions, loadMessages, loadParts, openDb } from '../opencode/db.ts'
import { parseOpencodeRecord } from '../opencode/parse.ts'
import { BUILTIN_TOOLS, claudeEquivalent, editTargets, mcpServerOf } from '../opencode/tools.ts'
import * as oc from './opencodeFixtures.ts'

const parse = (path: string, id = 'ses_1') => {
  const db = openDb(path)!
  try {
    const row = listSessions(db).find(r => r.id === id)!
    const kids = childRows(db, id).map(cr => ({ row: cr, msgs: { rows: loadMessages(db, cr.id), partsByMessage: loadParts(db, cr.id) } }))
    return parseOpencodeRecord(row, { rows: loadMessages(db, id), partsByMessage: loadParts(db, id) }, kids)
  } finally { db.close() }
}

test('db: sessions, messages, parts and children round-trip; corrupt JSON degrades', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p', agent: 'build' }), oc.sess({ id: 'ses_c', parent: 'ses_p', agent: 'explore', created: oc.ms(1) })],
    [oc.userMsg({ id: 'm1', session: 'ses_p' }), oc.assistantMsg({ id: 'm2', session: 'ses_p', completed: oc.ms(30) }),
     { id: 'm3', session_id: 'ses_p', time_created: oc.ms(31), time_updated: oc.ms(31), data: 'not-json' }],
    [oc.textPart({ msg: 'm1', session: 'ses_p', text: 'hi' }),
     oc.toolPart({ msg: 'm2', session: 'ses_p', tool: 'bash', input: { command: 'ls' }, output: 'a b' })],
  )
  const db = openDb(path)!
  assert.notEqual(db, null)
  const rows = listSessions(db)
  assert.deepEqual(rows.map(r => [r.id, r.parent_id]), [['ses_p', null], ['ses_c', 'ses_p']])
  assert.equal(rows[0].msg_updated, oc.ms(31))
  assert.equal(rows[1].msg_updated, null)
  const msgs = loadMessages(db, 'ses_p')
  assert.deepEqual(msgs.map(m => [m.id, m.data.role]), [['m1', 'user'], ['m2', 'assistant'], ['m3', undefined]])
  assert.deepEqual(msgs[2].data, {})
  const parts = loadParts(db, 'ses_p')
  assert.equal(parts.get('m2')![0].tool, 'bash')
  assert.deepEqual(childRows(db, 'ses_p').map(r => r.id), ['ses_c'])
  db.close()
  assert.equal(openDb('/nonexistent/opencode.db'), null)
  const missing = path.slice(0, path.lastIndexOf('/')) + '/missing.db'
  assert.equal(openDb(missing), null)
  const fs = await import('node:fs')
  assert.equal(fs.existsSync(missing), false)
})

test('tools: claude equivalents, builtin set, mcp server, edit targets', () => {
  assert.deepEqual(claudeEquivalent('bash', { command: 'ls' }), { name: 'Bash', input: { command: 'ls' } })
  assert.deepEqual(claudeEquivalent('edit', { filePath: '/a.ts' }), { name: 'Edit', input: { file_path: '/a.ts' } })
  assert.deepEqual(claudeEquivalent('task', { description: 'review' }), { name: 'Task', input: { description: 'review' } })
  assert.deepEqual(claudeEquivalent('read', {}), { name: 'Read', input: {} })
  assert.deepEqual(claudeEquivalent('write', { path: '/b.ts' }), { name: 'Write', input: { file_path: '/b.ts' } })
  assert.deepEqual(claudeEquivalent('agent-repertoire_search_tools', { q: 1 }), { name: 'mcp__agent-repertoire__agent-repertoire_search_tools', input: { q: 1 } })
  assert.deepEqual(claudeEquivalent('websearch', { query: 'x' }), { name: 'WebSearch', input: { query: 'x' } })
  assert.equal(BUILTIN_TOOLS.has('bash'), true)
  assert.equal(BUILTIN_TOOLS.has('websearch'), true)
  assert.equal(BUILTIN_TOOLS.has('agent-repertoire_search_tools'), false)
  assert.equal(mcpServerOf('agent-repertoire_search_tools'), 'agent-repertoire')
  assert.equal(mcpServerOf('custom'), 'custom')
  assert.deepEqual(editTargets('edit', { filePath: '/a.ts' }), ['/a.ts'])
  assert.deepEqual(editTargets('bash', { command: 'x' }), [])
  assert.deepEqual(editTargets('write', {}), [])
})

test('parse: metadata, classification and cost reporting', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_1', dir: '/repo/x', title: 'Fix bug', version: '1.18.4', cost: 0.5, input: 100, output: 10, reasoning: 5, cacheRead: 200, cacheWrite: 0, added: 12, removed: 3 })],
    [oc.userMsg({ id: 'm1', session: 'ses_1' })],
    [oc.textPart({ msg: 'm1', session: 'ses_1', text: 'hola' })],
  )
  const r = parse(path)
  assert.equal(r.summary.agent, 'opencode')
  assert.equal(r.summary.project, '/repo/x')
  assert.equal(r.summary.title, 'Fix bug')
  assert.equal(r.summary.version, '1.18.4')
  assert.equal(r.summary.entrypoint, 'cli')
  assert.equal(r.summary.gitBranch, null)
  assert.equal(r.summary.startedAt, oc.ISO(0))
  assert.deepEqual(r.summary.tokens, { input: 100, output: 15, cacheCreation: 0, cacheRead: 200, total: 315 })
  assert.equal(r.summary.costUsd, 0.5)
  assert.equal(r.costReported, true)
  assert.equal(r.summary.linesAdded, 12)
  assert.equal(r.summary.linesRemoved, 3)
})

test('parse: reported cost includes child session costs', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p', cost: 0.5 }), oc.sess({ id: 'ses_c', parent: 'ses_p', agent: 'explore', cost: 0.25, created: oc.ms(5), updated: oc.ms(25) })],
    [oc.userMsg({ id: 'm1', session: 'ses_p' }),
      oc.assistantMsg({ id: 'm2', session: 'ses_c', created: oc.ms(6), completed: oc.ms(20), cost: 0.25 })],
    [oc.textPart({ msg: 'm1', session: 'ses_p', text: 'go' })],
  )
  const r = parse(path, 'ses_p')
  assert.equal(r.costReported, true)
  assert.equal(r.subagents[0].costUsd, 0.25)
  assert.equal(r.summary.costUsd, 0.75)
})

test('parse: agent summary is automated; unpriced models get null cost', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_1', agent: 'summary', cost: 0 })],
    [oc.userMsg({ id: 'm1', session: 'ses_1' }), oc.assistantMsg({ id: 'm2', session: 'ses_1', model: 'glm-5.3', completed: oc.ms(5) })],
    [oc.textPart({ msg: 'm1', session: 'ses_1', text: 'bg' }), oc.textPart({ msg: 'm2', session: 'ses_1', text: 'ok' })],
  )
  const r = parse(path)
  assert.equal(r.summary.entrypoint, 'automated')
  assert.equal(r.summary.costUsd, null)
  assert.equal(r.costReported, false)
  assert.equal(r.summary.userTurns, 1)
})

test('parse: unreported provider with list price estimates cost', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_1', cost: 0 })],
    [oc.assistantMsg({ id: 'm1', session: 'ses_1', model: 'MiniMax-M3', input: 1_000_000, completed: oc.ms(5) }),
      // Top-level modelID shape (older opencode rows), as a plain row like the corrupt-json precedent.
      { id: 'm2', session_id: 'ses_1', time_created: oc.ms(6), time_updated: oc.ms(6), data: JSON.stringify({ role: 'assistant', modelID: 'deepseek-v4-flash', tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: oc.ms(6) } }) }],
    [],
  )
  const r = parse(path)
  assert.equal(r.messages.some(m => m.model === 'deepseek-v4-flash'), true)
  assert.equal(r.messages.find(m => m.model === 'minimax-m3')!.costUsd, 0.3) // minimax-m3: $0.30/M input
  assert.equal(r.messages.find(m => m.model === 'deepseek-v4-flash')!.costUsd, 0.15) // deepseek-v4-flash: $0.15/M input
  assert.equal(r.summary.costUsd, 0.3 + 0.15)
  assert.equal(r.costReported, false)
})

test('parse: provider per message with fallback to root; summary aggregates distinct providers', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_1', provider: 'zai-coding-plan', model: 'glm-5.3' }),
     oc.sess({ id: 'ses_c', parent: 'ses_1', agent: 'explore', provider: 'minimax-coding-plan', model: 'MiniMax-M3', created: oc.ms(5), updated: oc.ms(25) })],
    [oc.userMsg({ id: 'm1', session: 'ses_1' }),
     oc.assistantMsg({ id: 'm2', session: 'ses_1', provider: 'zai-coding-plan', completed: oc.ms(2) }),
     // Older row shape: top-level modelID/providerID only.
     { id: 'm3', session_id: 'ses_1', time_created: oc.ms(3), time_updated: oc.ms(3), data: JSON.stringify({ role: 'assistant', modelID: 'glm-5.3', providerID: 'opencode', tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: oc.ms(3) } }) },
     // Assistant message with empty provider data → falls back to the root session provider.
     { id: 'm4', session_id: 'ses_1', time_created: oc.ms(4), time_updated: oc.ms(4), data: JSON.stringify({ role: 'assistant', model: {}, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: oc.ms(4) } }) },
     oc.assistantMsg({ id: 'm5', session: 'ses_c', model: 'MiniMax-M3', provider: 'minimax-coding-plan', created: oc.ms(6), completed: oc.ms(20) }),
     // Child message with empty provider data → falls back to the child session provider, not the parent's.
     { id: 'm6', session_id: 'ses_c', time_created: oc.ms(7), time_updated: oc.ms(7), data: JSON.stringify({ role: 'assistant', model: {}, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: oc.ms(7) } }) }],
    [oc.textPart({ msg: 'm1', session: 'ses_1', text: 'go' })],
  )
  const r = parse(path, 'ses_1')
  assert.deepEqual(r.messages.map(m => [m.model, m.provider]), [
    ['glm-5.3', 'zai-coding-plan'],        // nested providerID
    ['glm-5.3', 'opencode'],               // top-level providerID (older shape)
    ['glm-5.3', 'zai-coding-plan'],        // empty provider → root fallback
    ['minimax-m3', 'minimax-coding-plan'], // child session provider
    ['minimax-m3', 'minimax-coding-plan'], // child fallback → child session provider, not the parent's
  ])
  assert.deepEqual(r.summary.providers, ['minimax-coding-plan', 'opencode', 'zai-coding-plan'])
})

test('parse: turns, tools, skills, mcp, edits, commits and errors', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_1' })],
    [
      oc.userMsg({ id: 'm1', session: 'ses_1', created: oc.ms(0) }),
      oc.assistantMsg({ id: 'm2', session: 'ses_1', created: oc.ms(1), completed: oc.ms(40), input: 10, output: 5 }),
      oc.userMsg({ id: 'm3', session: 'ses_1', created: oc.ms(50) }),
      oc.assistantMsg({ id: 'm4', session: 'ses_1', created: oc.ms(51), completed: oc.ms(60), input: 10, output: 5 }),
    ],
    [
      oc.textPart({ msg: 'm1', session: 'ses_1', text: 'fix it' }),
      oc.textPart({ msg: 'm2', session: 'ses_1', text: 'on it' }),
      oc.toolPart({ msg: 'm2', session: 'ses_1', tool: 'skill', input: { name: 'dev-implement' } }),
      oc.toolPart({ msg: 'm2', session: 'ses_1', tool: 'bash', input: { command: 'npm test' } }),
      oc.toolPart({ msg: 'm2', session: 'ses_1', tool: 'edit', input: { filePath: '/a.ts', newString: 'x\ny' } }),
      oc.toolPart({ msg: 'm2', session: 'ses_1', tool: 'agent-repertoire_search_tools', input: {} }),
      oc.toolPart({ msg: 'm2', session: 'ses_1', tool: 'grep', input: {}, status: 'error', error: 'boom' }),
      oc.textPart({ msg: 'm3', session: 'ses_1', text: 'commit now' }),
      oc.textPart({ msg: 'm4', session: 'ses_1', text: 'done' }),
      oc.toolPart({ msg: 'm4', session: 'ses_1', tool: 'bash', input: { command: 'git commit -m x' } }),
      oc.patchPart({ msg: 'm4', session: 'ses_1', files: ['/a.ts'] }),
    ],
  )
  const r = parse(path)
  assert.equal(r.summary.userTurns, 2)
  assert.deepEqual(r.turnTimes, [oc.ISO(0), oc.ISO(50)])
  assert.deepEqual(r.summary.toolCalls, { total: 6, skills: 1, mcp: 1, builtin: 4 })
  assert.deepEqual(r.summary.skillsUsed, ['dev-implement'])
  assert.deepEqual(r.skillSequence, ['dev-implement'])
  assert.deepEqual(r.summary.mcpServers, ['agent-repertoire'])
  assert.equal(r.summary.commits, 1)
  assert.equal(r.summary.toolErrors, 1)
  assert.equal(r.summary.edits, 1)
  assert.equal(r.summary.filesEdited, 1)
  assert.equal(r.summary.reworkEdits, 0)
  assert.equal(r.summary.questions, 0)
  assert.deepEqual(r.toolStats['grep'], { calls: 1, errors: 1, rejections: 0 })
  assert.equal(r.skillWindows.length, 1)
  assert.equal(r.skillWindows[0].skill, 'dev-implement')
  assert.equal(r.skillWindows[0].toolCalls, 4)
  assert.equal(r.skillWindows[0].toolErrors, 1)
  assert.equal(r.skillWindows[0].linesEdited, 2)
  assert.equal(r.skillWindows[0].committed, true)
  assert.deepEqual([...r.summary.turnMs].sort((a, b) => a - b), [10000, 40000])
  assert.equal(r.messages[0].phase, 'implement')
  assert.equal(r.messages[1].phase, 'ship')
})

test('parse: subagent sessions attach to the parent', async () => {
  const path = await oc.makeDb(
    [oc.sess({ id: 'ses_p', cost: 0 }), oc.sess({ id: 'ses_c', parent: 'ses_p', agent: 'explore', title: 'Find adapter', input: 50, output: 10, cacheRead: 0, created: oc.ms(5), updated: oc.ms(25) })],
    [
      oc.userMsg({ id: 'm1', session: 'ses_p' }),
      oc.assistantMsg({ id: 'm2', session: 'ses_p', created: oc.ms(1), completed: oc.ms(2) }),
      oc.assistantMsg({ id: 'm3', session: 'ses_c', created: oc.ms(6), completed: oc.ms(20), model: 'glm-5.3-flash' }),
    ],
    [
      oc.textPart({ msg: 'm1', session: 'ses_p', text: 'go' }),
      oc.toolPart({ msg: 'm2', session: 'ses_p', tool: 'task', input: { description: 'Find adapter' } }),
      oc.toolPart({ msg: 'm3', session: 'ses_c', tool: 'read', input: {} }),
    ],
  )
  const r = parse(path, 'ses_p')
  assert.equal(r.summary.userTurns, 1)
  assert.deepEqual(r.turnTimes, [oc.ISO(0)])
  assert.deepEqual(r.summary.toolCalls, { total: 2, skills: 0, mcp: 0, builtin: 2 })
  assert.deepEqual(r.summary.agentTypes, ['explore'])
  assert.equal(r.subagents.length, 1)
  const sub = r.subagents[0]
  assert.equal(sub.agentId, 'ses_c')
  assert.equal(sub.agentType, 'explore')
  assert.equal(sub.description, 'Find adapter')
  assert.equal(sub.tokens, 60)
  assert.equal(sub.toolCalls, 1)
  assert.equal(sub.phase, 'explore')
  const childMsg = r.messages.find(m => m.agentId === 'ses_c')!
  assert.equal(childMsg.sidechain, true)
  assert.equal(childMsg.phase, 'explore')
})

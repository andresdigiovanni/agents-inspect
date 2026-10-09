import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLines, parseSession, parseRecord, costWeight } from '../parse.ts'
import * as f from './fixtures.ts'

const fb = { id: 'sess-1', projectDir: '-repo-demo' }

test('parseLines skips malformed and empty lines', () => {
  assert.deepEqual(parseLines('{"a":1}\n\nnot json\n{"b":2}\n{"trunc'), [{ a: 1 }, { b: 2 }])
})

test('returns null when the parent has no timestamp', () => {
  assert.equal(parseSession([f.aiTitle('x')], [], fb), null)
})

test('dedupes usage by message.id and sums the four fields', () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }
  const s = parseSession([f.userText('hi'), f.assistant({ id: 'm1', usage: u, text: 'a' }), f.assistant({ id: 'm1', usage: u, tools: [{ id: 't1', name: 'Bash' }] }), f.assistant({ id: 'm2', usage: { output_tokens: 7 } })], [], fb)!
  assert.deepEqual(s.tokens, { input: 10, output: 12, cacheCreation: 100, cacheRead: 1000, total: 1122 })
})

test('counts user turns: string or text-array, not meta, not tool_result, not sidechain', () => {
  const textArray = { ...f.userText('x'), message: { role: 'user', content: [{ type: 'text', text: 'array turn' }] } }
  const s = parseSession([f.userText('one'), f.userText('meta', { isMeta: true }), f.toolResult('t1'), textArray, f.userText('side', { sidechain: true }), f.userText('')], [], fb)!
  assert.equal(s.userTurns, 2)
})

test('user turns are what the user typed: harness-injected and non-human origins excluded', () => {
  const slash = '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>'
  const s = parseSession([
    f.userText('agent finished', { origin: 'task-notification' }),
    f.userText('  <task-notification>old style</task-notification>'),
    f.userText('<local-command-stdout>out</local-command-stdout>'),
    f.userText('<bash-stdout>x</bash-stdout>'),
    f.userText('[Request interrupted by user for tool use]'),
    f.userText('plain prompt', { origin: 'human' }),
    f.userText(slash),
    f.userText('<bash-input>ls -la</bash-input>'),
  ], [], fb)!
  assert.equal(s.userTurns, 3)
})

test('title fallback: slash command becomes /name args, bash-input becomes ! cmd', () => {
  const slash = '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>'
  assert.equal(parseSession([f.userText(slash)], [], fb)!.title, '/model opus')
  assert.equal(parseSession([f.userText('<command-name>/model</command-name><command-message>model</command-message><command-args></command-args>')], [], fb)!.title, '/model')
  assert.equal(parseSession([f.userText('<bash-input>ls -la</bash-input>')], [], fb)!.title, '! ls -la')
})

test('mcp: authenticate tools and needsAuth servers are not loaded unless actually used', () => {
  const sv = (...l: any[]) => parseSession([f.userText('go'), ...l], [], fb)!.mcpServers
  assert.deepEqual(sv(f.deferredDelta(['mcp__claude_ai_Asana__authenticate', 'mcp__claude_ai_Asana__complete_authentication', 'mcp__engram__mem_save'])), ['engram'])
  assert.deepEqual(sv(f.deferredDelta(['mcp__claude_ai_Box__search'], ['claude.ai Box'])), [])
  assert.deepEqual(sv(f.deferredDelta(['mcp__claude_ai_Box__search'], ['claude.ai Box']), f.assistant({ id: 'm1', tools: [{ id: 't1', name: 'mcp__claude_ai_Box__search' }] })), ['claude_ai_Box'])
  assert.deepEqual(sv(f.deferredDelta([], ['claude.ai Adobe for creativity']), f.mcpDelta(['claude_ai_Adobe_for_creativity'])), [])
})

test('buckets tool calls into skills / mcp / builtin, folding subagents, once per block id', () => {
  const parent = [f.userText('go'), f.assistant({ id: 'm1', tools: [{ id: 't1', name: 'Skill', input: { skill: 'dev-explore' } }, { id: 't2', name: 'mcp__engram__mem_save' }, { id: 't3', name: 'Bash' }] }),
    f.assistant({ id: 'm1', tools: [{ id: 't3', name: 'Bash' }] })]
  const sub = [f.userText('sub prompt', { sidechain: true }), f.assistant({ id: 'm9', sidechain: true, model: 'claude-haiku-4-5-20251001', tools: [{ id: 't4', name: 'Read' }] })]
  const s = parseSession(parent, [sub], fb)!
  assert.deepEqual(s.toolCalls, { total: 4, skills: 1, mcp: 1, builtin: 2 })
  assert.equal(s.userTurns, 1)
  assert.equal(s.toolRatio, 4)
  assert.deepEqual(s.models, ['claude-haiku-4.5', 'claude-opus-5.5'])
})

test('toolRatio is null with zero user turns; <synthetic> model excluded', () => {
  const s = parseSession([f.assistant({ id: 'm1', model: '<synthetic>', tools: [{ id: 't1', name: 'Bash' }] })], [], fb)!
  assert.equal(s.toolRatio, null)
  assert.deepEqual(s.models, [])
})

test('skills from skill_listing; mcp servers from instructions, deferred tools and tool_use names', () => {
  const s = parseSession([f.userText('go'), f.skillListing(['dev-plan', 'dataviz']), f.skillListing(['dev-plan']), f.mcpDelta(['engram']),
    f.deferredDelta(['WebFetch', 'mcp__claude_ai_Slack__authenticate']), f.assistant({ id: 'm1', tools: [{ id: 't1', name: 'mcp__codegraph__codegraph_explore' }] })], [], fb)!
  assert.deepEqual(s.skills, ['dataviz', 'dev-plan'])
  assert.deepEqual(s.mcpServers, ['codegraph', 'engram'])
})

test('title: last ai-title, else first user turn collapsed and truncated to 120, else id', () => {
  assert.equal(parseSession([f.userText('q'), f.aiTitle('First'), f.aiTitle('Second')], [], fb)!.title, 'Second')
  const long = 'word  \n'.repeat(40)
  assert.equal(parseSession([f.userText('meta', { isMeta: true }), f.userText(long)], [], fb)!.title, long.replace(/\s+/g, ' ').trim().slice(0, 120))
  assert.equal(parseSession([f.assistant({ id: 'm1' })], [], fb)!.title, 'sess-1')
})

test('id, project from first cwd, startedAt = first timestamp, cost = last cost-state or null', () => {
  const s = parseSession([f.costState(1), f.userText('a', { ts: '2026-10-02T00:00:00.000Z', cwd: '/x/y' }), f.costState(2.5)], [], fb)!
  assert.equal(s.id, 'sess-1'); assert.equal(s.project, '/x/y'); assert.equal(s.startedAt, '2026-10-02T00:00:00.000Z'); assert.equal(s.costUsd, 2.5)
  assert.equal(parseSession([f.userText('a')], [], fb)!.costUsd, null)
  assert.equal(parseSession([{ type: 'user', timestamp: '2026-10-02T00:00:00.000Z', message: { content: 'a' } }], [], fb)!.project, '-repo-demo')
})

test('a user line mixing text and tool_result blocks is not a user turn', () => {
  const mixed = { ...f.userText('x'), message: { role: 'user', content: [{ type: 'text', text: 'note' }, { type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }
  assert.equal(parseSession([mixed, f.userText('real')], [], fb)!.userTurns, 1)
})

test('title fallback uses the first user turn, not the last', () => {
  assert.equal(parseSession([f.userText('first prompt'), f.userText('second prompt')], [], fb)!.title, 'first prompt')
})

test('subagent files never contribute user turns, title or cost', () => {
  const sub = [f.userText('sub prompt'), f.aiTitle('Sub title'), f.costState(99)] // isSidechain false on purpose
  const s = parseSession([f.userText('parent prompt'), f.costState(1)], [sub], fb)!
  assert.equal(s.userTurns, 1)
  assert.equal(s.title, 'parent prompt')
  assert.equal(s.costUsd, 1)
})

test('skill names: first whitespace-free token after "- ", no trailing colon, no alias, bare lines count, continuation lines ignored', () => {
  const content = [
    '- dev-plan: Turns a spec into a plan',
    '  continuation of the description',
    'wrapped text: not a skill',
    '- superpowers:brainstorming: You MUST use this',
    '- _pm_morpheus/edo-ds-pm-lib-morpheus:writing-plans: Use this when',
    '- engram:memory (engram:engram-memory): ALWAYS ACTIVE',
    '- dev-debug',
    '- superpowers:brainstorming',
  ].join('\n')
  const line = { ...f.skillListing([]), attachment: { type: 'skill_listing', content } }
  assert.deepEqual(parseSession([f.userText('go'), line], [], fb)!.skills, [
    '_pm_morpheus/edo-ds-pm-lib-morpheus:writing-plans', 'dev-debug', 'dev-plan', 'engram:memory', 'superpowers:brainstorming',
  ])
})

test('tool_use blocks without an id are each counted; blocks with an id are still deduped', () => {
  const noId = { ...f.assistant({ id: 'm1' }), message: { id: 'm1', model: 'x', content: [{ type: 'tool_use', name: 'Bash', input: {} }, { type: 'tool_use', name: 'Read', input: {} }] } }
  assert.equal(parseSession([f.userText('a'), noId], [], fb)!.toolCalls.total, 2)
})

test('cost-state with a non-numeric totalCostUSD is ignored; ai-title that is not a non-empty string is ignored', () => {
  const s = parseSession([f.userText('first'), f.costState(2), { type: 'cost-state', totalCostUSD: '9' }, { type: 'cost-state' }, f.aiTitle('Good'), { type: 'ai-title', aiTitle: 5 }, { type: 'ai-title', aiTitle: '' }], [], fb)!
  assert.equal(s.costUsd, 2); assert.equal(s.title, 'Good')
  const t = parseSession([f.userText('first'), { type: 'cost-state', totalCostUSD: '9' }, { type: 'ai-title', aiTitle: '' }], [], fb)!
  assert.equal(t.costUsd, null); assert.equal(t.title, 'first')
})

test('record: message cost spreads each model cost by weighted tokens; missing model or cost-state → 0', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm1', ts: '2026-10-01T10:00:00.000Z', usage: { output_tokens: 10 } }),               // weight 50
    f.assistant({ id: 'm1', ts: '2026-10-01T10:00:01.000Z', usage: { output_tokens: 10 } }),               // same id: once
    f.assistant({ id: 'm2', ts: '2026-10-02T10:00:00.000Z', usage: { input_tokens: 100, cache_read_input_tokens: 500 } }), // weight 150
    f.assistant({ id: 'm3', model: 'claude-sonnet-5', usage: { output_tokens: 1 } }),
    f.assistant({ id: 'm4', model: '<synthetic>' }),
    f.costState(2, { modelUsage: { 'claude-opus-5-5': { costUSD: 2 } } }),
  ], [], fb)!
  assert.deepEqual(r.messages.map(m => [m.ts, m.model, m.costUsd]), [
    ['2026-10-01T10:00:00.000Z', 'claude-opus-5.5', 0.5],
    ['2026-10-02T10:00:00.000Z', 'claude-opus-5.5', 1.5],
    ['2026-10-01T10:00:00.000Z', 'claude-sonnet-5', 0],
  ])
  assert.deepEqual(r.messages[0].tokens, { input: 0, output: 10, cacheCreation: 0, cacheRead: 0, total: 10 })
  assert.deepEqual(parseRecord([f.userText('go'), f.assistant({ id: 'm1', usage: { output_tokens: 3 } })], [], fb)!.messages.map(m => m.costUsd), [0])
  assert.deepEqual(parseRecord([f.userText('go'), f.assistant({ id: 'z' }), f.costState(1, { modelUsage: { 'claude-opus-5-5': { costUSD: 1 } } })], [], fb)!.messages.map(m => m.costUsd), [0])
  assert.equal(costWeight({ input: 1, output: 1, cacheCreation: 1, cacheRead: 10, total: 13 }), 8.25)
  const dated = parseRecord([f.userText('go'), f.assistant({ id: 'h1', model: 'claude-haiku-4-5-20251001', usage: { output_tokens: 1 } }),
    f.costState(3, { modelUsage: { 'claude-haiku-4-5-20251001[1m]': { costUSD: 3 } } })], [], fb)!
  assert.deepEqual([dated.summary.models, dated.messages.map(m => [m.model, m.costUsd])], [['claude-haiku-4.5'], [['claude-haiku-4.5', 3]]])
})

test('record: modelUsage keys with a context-window suffix like [1m] match the message model, and keys collapsing to one model are summed', () => {
  const opus = [
    f.userText('go'),
    f.assistant({ id: 'm1', usage: { output_tokens: 2 } }), // weight 10
    f.assistant({ id: 'm2', usage: { input_tokens: 30 } }), // weight 30
  ]
  const merged = parseRecord([...opus, f.costState(3, { modelUsage: { 'claude-opus-5-5[1m]': { costUSD: 2 }, 'claude-opus-5-5': { costUSD: 1 } } })], [], fb)!
  assert.deepEqual(merged.messages.map(m => m.costUsd), [0.75, 2.25])
  const suffixOnly = parseRecord([...opus, f.costState(2, { modelUsage: { 'claude-opus-5-5[1m]': { costUSD: 2 } } })], [], fb)!
  assert.deepEqual(suffixOnly.messages.map(m => m.costUsd), [0.5, 1.5])
})

test('record: a non-numeric modelUsage costUSD is ignored, not added to the model total', () => {
  const lines = [f.userText('go'), f.assistant({ id: 'm1', usage: { output_tokens: 2 } })]
  const usage = (modelUsage: object) => parseRecord([...lines, f.costState(1, { modelUsage })], [], fb)!.messages.map(m => m.costUsd)
  assert.deepEqual(usage({ 'claude-opus-5-5[1m]': { costUSD: '9' }, 'claude-opus-5-5': { costUSD: 1 } }), [1])
  assert.deepEqual(usage({ 'claude-opus-5-5': {} }), [0])
})

test('record: skill and mcp calls, errors joined by tool_use_id across files, attribution, used lists', () => {
  const parent = [
    f.userText('go'),
    f.assistant({ id: 'm1', ts: '2026-10-01T11:00:00.000Z', tools: [{ id: 't1', name: 'Skill', input: { skill: '/dev-debug' } }, { id: 't2', name: 'mcp__engram__mem_save' }, { id: 't5', name: 'Skill', input: {} }] }),
    f.toolResult('t2', { error: true }),
    f.assistant({ id: 'm2', attrSkill: 'dev-debug', tools: [{ id: 't3', name: 'mcp__claude_ai_Box__authenticate' }] }),
  ]
  const sub = [
    f.assistant({ id: 'm9', ts: '2026-10-01T12:00:00.000Z', sidechain: true, attrSkill: 'dev-testing', tools: [{ id: 't4', name: 'mcp__codegraph__codegraph_explore' }] }),
    f.toolResult('t1', { error: true }),
    f.toolResult('t4'),
  ]
  const r = parseRecord(parent, [sub], fb)!
  assert.deepEqual(r.skillCalls.map(c => [c.ts, c.skill, c.error]), [['2026-10-01T11:00:00.000Z', 'dev-debug', true]])
  assert.deepEqual(r.mcpCalls.map(c => [c.ts, c.server, c.tool, c.error]), [['2026-10-01T11:00:00.000Z', 'engram', 'mem_save', true], ['2026-10-01T12:00:00.000Z', 'codegraph', 'codegraph_explore', false]])
  assert.deepEqual(r.messages.map(m => [m.skill, m.sidechain]), [[null, false], ['dev-debug', false], ['dev-testing', true]])
  assert.deepEqual(r.summary.skillsUsed, ['dev-debug', 'dev-testing'])
  assert.deepEqual(r.summary.skills, ['dev-debug', 'dev-testing'])
  assert.deepEqual(r.summary.mcpServersUsed, ['codegraph', 'engram'])
  assert.equal(r.summary.toolCalls.skills, 2)
})

test('record: turn times, mcp tool lists, duration and lines from the last valid cost-state', () => {
  const r = parseRecord([
    f.userText('a', { ts: '2026-10-01T08:00:00.000Z' }), f.userText('meta', { isMeta: true }), f.userText('b', { ts: '2026-10-01T09:00:00.000Z' }),
    f.deferredDelta(['mcp__engram__mem_search', 'mcp__engram__mem_save', 'mcp__claude_ai_Box__authenticate', 'Read']),
    f.costState(1, { totalDuration: 1000, totalLinesAdded: 5, totalLinesRemoved: 2 }),
    f.costState(2, { totalDuration: 4000, totalLinesAdded: 7, totalLinesRemoved: 3 }),
    { type: 'cost-state', totalCostUSD: 'x', totalDuration: 9 },
  ], [], fb)!
  assert.deepEqual(r.turnTimes, ['2026-10-01T08:00:00.000Z', '2026-10-01T09:00:00.000Z'])
  assert.deepEqual(r.mcpTools, { engram: ['mem_save', 'mem_search'] })
  assert.deepEqual([r.summary.durationMs, r.summary.linesAdded, r.summary.linesRemoved], [4000, 7, 3])
  const bare = parseRecord([f.userText('a'), f.costState(1)], [], fb)!.summary
  assert.deepEqual([bare.durationMs, bare.linesAdded, bare.linesRemoved, bare.skillsUsed, bare.mcpServersUsed], [null, null, null, [], []])
})

test('phases: skill > tool > inherited; tool_use on a later line of the same message counts', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm0', text: 'thinking' }),
    f.assistant({ id: 'm1', tools: [{ id: 't1', name: 'Read' }] }),
    f.assistant({ id: 'm2', text: 'reading' }),
    f.assistant({ id: 'm3', attrSkill: 'superpowers:systematic-debugging', tools: [{ id: 't3', name: 'Edit', input: { file_path: '/r/a.ts', new_string: 'x' } }] }),
    f.assistant({ id: 'm4', text: 'about to edit' }),
    f.assistant({ id: 'm4', tools: [{ id: 't4', name: 'Edit', input: { file_path: '/r/a.ts', new_string: 'y' } }, { id: 't5', name: 'Bash', input: { command: 'git commit -m x' } }] }),
  ], [], fb)!
  assert.deepEqual(r.messages.map(m => [m.phase, m.phaseSource, m.agentId]), [
    ['other', 'none', null], ['explore', 'tool', null], ['explore', 'inherited', null], ['debug', 'skill', null], ['ship', 'tool', null],
  ])
})

test('subagent runs: meta join, fallbacks, cost, errors, phase, agentTypes', () => {
  const parent = [
    f.userText('go', { ts: '2026-10-01T10:00:00.000Z' }),
    f.assistant({ id: 'p1', usage: { output_tokens: 10 }, tools: [{ id: 'ag1', name: 'Agent', input: { description: 'Review Task 1 diff' } }, { id: 'ag2', name: 'Agent', input: { description: 'Find callers' } }] }),
    f.costState(3, { modelUsage: { 'claude-opus-5-5': { costUSD: 1 }, 'claude-haiku-4-5': { costUSD: 2 } } }),
  ]
  const sub1 = [
    { ...f.assistant({ id: 's1', model: 'claude-haiku-4-5', sidechain: true, ts: '2026-10-01T10:01:00.000Z', usage: { output_tokens: 20 }, tools: [{ id: 'r1', name: 'Read' }, { id: 'r2', name: 'Grep' }] }), agentId: 'a1', attributionAgent: 'general-purpose' },
    f.toolResult('r2', { error: true, ts: '2026-10-01T10:02:00.000Z' }),
    { ...f.assistant({ id: 's2', model: 'claude-haiku-4-5', sidechain: true, ts: '2026-10-01T10:03:30.000Z', usage: { output_tokens: 20 } }), agentId: 'a1', attributionAgent: 'general-purpose' },
  ]
  const sub2 = [{ ...f.assistant({ id: 's3', sidechain: true, ts: '2026-10-01T10:05:00.000Z', tools: [{ id: 'e1', name: 'Edit', input: { file_path: '/r/x.ts', new_string: 'a' } }] }), agentId: 'a2', attributionAgent: 'Explore' }]
  const r = parseRecord(parent, [sub1, sub2], fb, [
    { agentId: 'a1', meta: { agentType: 'general-purpose', description: 'Review Task 1 diff', toolUseId: 'ag1', model: 'haiku' } },
    { agentId: 'a2', meta: null },
  ])!
  assert.deepEqual(r.messages.map(m => m.agentId), [null, 'a1', 'a1', 'a2'])
  const [a1, a2] = r.subagents
  assert.deepEqual({ ...a1, costUsd: Math.round(a1.costUsd * 100) / 100 }, {
    agentId: 'a1', agentType: 'general-purpose', description: 'Review Task 1 diff', model: 'claude-haiku-4.5', toolUseId: 'ag1',
    startedAt: '2026-10-01T10:01:00.000Z', durationMs: 150_000, tokens: 40, costUsd: 2, toolCalls: 2, toolErrors: 1, phase: 'review',
  })
  assert.deepEqual([a2.agentId, a2.agentType, a2.description, a2.toolUseId, a2.phase, a2.durationMs], ['a2', 'Explore', '', null, 'implement', 0])
  assert.deepEqual(r.summary.agentTypes, ['Explore', 'general-purpose'])
})

test('subagent run phase: phase of the delegating parent message via toolUseId, else dominant own phase', () => {
  const parent = [
    f.userText('go'),
    f.assistant({ id: 'p1', tools: [{ id: 'ag1', name: 'Agent', input: { description: 'Review Task 3 diff' } }] }),
    f.assistant({ id: 'p2', tools: [{ id: 'k1', name: 'Skill', input: { skill: 'superpowers:subagent-driven-development' } }] }),
    f.assistant({ id: 'p3', attrSkill: 'superpowers:subagent-driven-development', tools: [{ id: 'ag2', name: 'Task', input: { description: 'Implement Task 4' } }] }),
  ]
  const reads = (id: string) => [f.assistant({ id, sidechain: true, tools: [{ id: `r-${id}`, name: 'Read' }] })]
  const r = parseRecord(parent, [reads('s1'), reads('s2'), reads('s3'), reads('s4')], fb, [
    { agentId: 'a1', meta: { toolUseId: 'ag1' } },
    { agentId: 'a2', meta: { toolUseId: 'ag2' } },
    { agentId: 'a3', meta: null },
    { agentId: 'a4', meta: { toolUseId: 'missing' } },
  ])!
  assert.deepEqual(r.subagents.map(s => [s.agentId, s.phase]), [['a1', 'review'], ['a2', 'implement'], ['a3', 'explore'], ['a4', 'explore']])
  assert.deepEqual(r.messages.filter(m => m.agentId !== null).map(m => m.phase), ['explore', 'explore', 'explore', 'explore'])
})

test('subagent agentId falls back to sub-<i> without subInfo or agentId lines', () => {
  const r = parseRecord([f.userText('go')], [[f.assistant({ id: 'x1', sidechain: true })]], fb)!
  assert.deepEqual(r.subagents.map(s => [s.agentId, s.agentType, s.model]), [['sub-0', 'unknown', 'claude-opus-5.5']])
})

test('skill windows: boundaries, errors, lines, subagent merge, interruption, commit, sequence', () => {
  const skill = (id: string, name: string) => f.assistant({ id, tools: [{ id: `k-${id}`, name: 'Skill', input: { skill: name } }] })
  const parent = [
    f.userText('plan it'),
    skill('p1', 'dev-plan'),
    f.assistant({ id: 'p2', tools: [{ id: 'w1', name: 'Write', input: { file_path: '/r/docs/specs/x.md', content: 'a\nb' } }] }),
    f.toolResult('w1', { error: true }),
    f.userText('now implement'),
    skill('p3', 'dev-implement'),
    f.assistant({ id: 'p4', tools: [{ id: 'e1', name: 'Edit', input: { file_path: '/r/a.ts', new_string: 'x\ny\nz' } }, { id: 'ag1', name: 'Agent', input: { description: 'Implement Task 1' } }] }),
    f.userText('[Request interrupted by user for tool use]'),
    skill('p5', '/dev-implement'),
    f.assistant({ id: 'p6', tools: [{ id: 'b1', name: 'Bash', input: { command: 'git commit -m x' } }] }),
    f.assistant({ id: 'p7', attrSkill: 'superpowers:brainstorming', text: 'hi' }),
  ]
  const sub = [
    f.assistant({ id: 's1', sidechain: true, tools: [{ id: 'r1', name: 'Read' }, { id: 'e9', name: 'Edit', input: { file_path: '/r/b.ts', new_string: 'q' } }] }),
    f.toolResult('r1', { error: true, sidechain: true }),
  ]
  const r = parseRecord(parent, [sub], fb, [{ agentId: 'a1', meta: { agentType: 'general-purpose', toolUseId: 'ag1' } }])!
  // [skill, toolCalls, toolErrors, interrupted, linesEdited, committed]
  assert.deepEqual(r.skillWindows.map(w => [w.skill, w.toolCalls, w.toolErrors, w.interrupted, w.linesEdited, w.committed]), [
    ['dev-plan', 1, 1, false, 2, true],
    ['dev-implement', 4, 1, true, 3, true],
    ['dev-implement', 1, 0, false, 0, true],
    ['superpowers:brainstorming', 0, 0, false, 0, false],
  ])
  assert.equal(r.skillWindows[0].ts, '2026-10-01T10:00:00.000Z')
  assert.deepEqual(r.skillSequence, ['dev-plan', 'dev-implement'])
})

test('skill windows: subagent files open their own windows, excluded from the parent merge', () => {
  const parent = [
    f.userText('implement'),
    f.assistant({ id: 'p1', tools: [{ id: 'k1', name: 'Skill', input: { skill: 'dev-implement' } }] }),
    f.assistant({ id: 'p2', tools: [{ id: 'ag1', name: 'Agent', input: { description: 'Implement Task 1' } }] }),
  ]
  const sub = [
    f.userText('do task 1', { sidechain: true }),
    f.assistant({ id: 's1', sidechain: true, tools: [{ id: 'r0', name: 'Read' }] }),
    f.toolResult('r0', { error: true, sidechain: true }),
    f.assistant({ id: 's2', sidechain: true, tools: [{ id: 'k2', name: 'Skill', input: { skill: 'dev-testing' } }] }),
    f.assistant({ id: 's3', sidechain: true, tools: [{ id: 'b1', name: 'Bash', input: { command: 'npm test' } }] }),
    f.toolResult('b1', { error: true, sidechain: true }),
    f.userText('keep going', { sidechain: true }),
    f.userText('[Request interrupted by user]', { sidechain: true }),
    f.assistant({ id: 's4', sidechain: true, tools: [{ id: 'w1', name: 'Write', input: { file_path: '/r/t.ts', content: 'a\nb' } }] }),
    f.assistant({ id: 's5', sidechain: true, tools: [{ id: 'c1', name: 'Bash', input: { command: 'git commit -m t' } }] }),
  ]
  const r = parseRecord(parent, [sub], fb, [{ agentId: 'a1', meta: { toolUseId: 'ag1' } }])!
  // [skill, toolCalls, toolErrors, interrupted, linesEdited, committed]
  assert.deepEqual(r.skillWindows.map(w => [w.skill, w.toolCalls, w.toolErrors, w.interrupted, w.linesEdited, w.committed]), [
    ['dev-implement', 3, 1, false, 0, false],
    ['dev-testing', 3, 1, true, 2, true],
  ])
  assert.deepEqual(r.skillSequence, ['dev-implement'])
})

test('skill windows: subagent lines attributed to a skill invoked in the parent do not open windows', () => {
  const parent = [
    f.userText('test'),
    f.assistant({ id: 'p1', tools: [{ id: 'k1', name: 'Skill', input: { skill: 'dev-testing' } }] }),
    f.assistant({ id: 'p2', attrSkill: 'dev-testing', tools: [{ id: 'ag1', name: 'Agent', input: { description: 'Run tests' } }] }),
    f.userText('next'),
    f.assistant({ id: 'p3', attrSkill: 'dev-testing', text: 'later' }),
  ]
  const sub = [f.assistant({ id: 's1', sidechain: true, attrSkill: 'dev-testing', tools: [{ id: 'b1', name: 'Bash', input: { command: 'npm test' } }] })]
  const r = parseRecord(parent, [sub], fb, [{ agentId: 'a1', meta: { toolUseId: 'ag1' } }])!
  assert.deepEqual(r.skillWindows.map(w => [w.skill, w.toolCalls]), [['dev-testing', 2]])
})

test('skill windows: tool_use blocks replayed in a subagent file (same id) are counted once', () => {
  const skill = f.assistant({ id: 'p1', tools: [{ id: 'k1', name: 'Skill', input: { skill: 'dev-plan' } }] })
  const r = parseRecord([f.userText('go'), skill], [[{ ...skill, isSidechain: true }]], fb)!
  assert.deepEqual(r.skillWindows.map(w => w.skill), ['dev-plan'])
})

test('skill windows: attribution of an invoked skill does not open a window; MultiEdit lines', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'p1', tools: [{ id: 'k1', name: 'Skill', input: { skill: 'dev-debug' } }] }),
    f.assistant({ id: 'p2', attrSkill: 'dev-debug', tools: [{ id: 'm1', name: 'MultiEdit', input: { file_path: '/r/a.ts', edits: [{ new_string: 'a\nb' }, { new_string: 'c' }] } }] }),
  ], [], fb)!
  assert.deepEqual(r.skillWindows.map(w => [w.skill, w.toolCalls, w.linesEdited, w.committed]), [['dev-debug', 1, 3, false]])
})

test('skillListingChars: listing line length per skill, last listing wins', () => {
  const r = parseRecord([f.skillListing(['dev-plan', 'vlt']), f.skillListing(['vlt-long']), f.userText('go')], [], fb)!
  assert.deepEqual(r.skillListingChars, { 'dev-plan': 25, vlt: 15, 'vlt-long': 25 })
})

test('session attributes: entrypoint first, version last, branch most frequent non-HEAD, effort and mode most frequent', () => {
  const tag = (l: object, o: object) => ({ ...l, ...o })
  const r = parseRecord([
    tag(f.userText('go'), { entrypoint: 'sdk-cli', version: '1.0.0', gitBranch: 'HEAD', permissionMode: 'default' }),
    tag(f.assistant({ id: 'm1' }), { entrypoint: 'cli', version: '1.0.1', gitBranch: 'feat', effort: 'high' }),
    tag(f.assistant({ id: 'm2' }), { version: '1.0.2', gitBranch: 'HEAD', effort: 'high' }),
    tag(f.assistant({ id: 'm3' }), { gitBranch: 'HEAD', effort: 'medium' }),
    f.permissionMode('auto'), f.permissionMode('auto'),
  ], [], fb)!.summary
  assert.deepEqual([r.entrypoint, r.version, r.gitBranch, r.effort, r.permissionMode], ['sdk-cli', '1.0.2', 'feat', 'high', 'auto'])
  const onlyHead = parseRecord([tag(f.userText('go'), { gitBranch: 'HEAD' })], [], fb)!.summary
  assert.equal(onlyHead.gitBranch, 'HEAD')
  const none = parseRecord([f.userText('go')], [], fb)!.summary
  assert.deepEqual([none.entrypoint, none.version, none.gitBranch, none.effort, none.permissionMode], [null, null, null, null, null])
})

test('signals: commits, questions, interruptions, tool errors, rejections, built-in tool stats', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm1', tools: [{ id: 'b1', name: 'Bash', input: { command: 'git commit -m x' } }, { id: 'b2', name: 'Bash', input: { command: 'ls' } }, { id: 'q1', name: 'AskUserQuestion' }] }),
    f.toolResult('b2', { error: true, text: 'exit 1' }),
    f.assistant({ id: 'm2', tools: [{ id: 'e1', name: 'Edit', input: { file_path: '/repo/demo/a.ts' } }, { id: 'k1', name: 'Skill', input: { skill: 'x' } }, { id: 'mc', name: 'mcp__srv__do' }] }),
    f.toolResult('e1', { error: true, text: "The user doesn't want to proceed with this tool use. The tool use was rejected" }),
    f.toolResult('mc', { error: true, text: 'Permission for this action was denied' }),
    f.userText('[Request interrupted by user]'),
    f.userText('[Request interrupted by user for tool use]'),
  ], [[f.assistant({ id: 's1', sidechain: true, tools: [{ id: 'b1', name: 'Bash', input: { command: 'git commit -m x' } }, { id: 'b3', name: 'Bash', input: { command: 'git commit -am y' } }] })]], fb)!
  const s = r.summary
  assert.deepEqual([s.commits, s.questions, s.interruptions, s.toolErrors, s.rejections], [2, 1, 2, 3, 2])
  assert.deepEqual(r.toolStats, {
    Bash: { calls: 3, errors: 1, rejections: 0 }, AskUserQuestion: { calls: 1, errors: 0, rejections: 0 }, Edit: { calls: 1, errors: 1, rejections: 1 },
  })
})

test('rejection text inside an array of text blocks is detected', () => {
  const res = { ...f.toolResult('b1'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', is_error: true, content: [{ type: 'text', text: 'Permission for this action was denied by policy' }] }] } }
  const r = parseRecord([f.userText('go'), f.assistant({ id: 'm1', tools: [{ id: 'b1', name: 'Bash' }] }), res], [], fb)!
  assert.equal(r.summary.rejections, 1)
})

test('context per message, peak context over parent only, mcp attribution', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm1', usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 7 } }),
    { ...f.assistant({ id: 'm2', usage: { input_tokens: 2, cache_read_input_tokens: 50 } }), attributionMcpServer: 'srv' },
  ], [[f.assistant({ id: 's1', sidechain: true, usage: { input_tokens: 9999 } })]], fb)!
  assert.deepEqual(r.messages.map(m => [m.context, m.mcpServer]), [[111, null], [52, 'srv'], [9999, null]])
  assert.equal(r.summary.peakContext, 111)
  assert.equal(parseRecord([f.userText('go')], [], fb)!.summary.peakContext, null)
})

test('turn durations and time split from cost-state', () => {
  const r = parseRecord([f.userText('go'), f.turnDuration(1000), f.turnDuration(3000),
    f.costState(1, { totalAPIDuration: 500, totalAPIDurationWithoutRetries: 400, totalToolDuration: 200 })], [], fb)!.summary
  assert.deepEqual([r.turnMs, r.apiMs, r.toolMs, r.retryMs], [[1000, 3000], 500, 200, 100])
  const bare = parseRecord([f.userText('go')], [], fb)!.summary
  assert.deepEqual([bare.turnMs, bare.apiMs, bare.toolMs, bare.retryMs], [[], null, null, null])
})

test('hooks: success stdout and additional context (string or string[])', () => {
  const r = parseRecord([f.userText('go'), f.hookSuccess('SessionStart', 'init', 'abcd'), f.hookContext('UserPromptSubmit', 'ctx', ['ab', 'cd']), f.hookContext('UserPromptSubmit', 'ctx', 'xyz')], [], fb)!
  assert.deepEqual(r.hooks, [
    { event: 'SessionStart', name: 'init', contextChars: 4 },
    { event: 'UserPromptSubmit', name: 'ctx', contextChars: 5 },
    { event: 'UserPromptSubmit', name: 'ctx', contextChars: 3 },
  ])
})

test('edits, files edited and rework across parent and subagents, deduped by tool id', () => {
  const ed = (id: string, name: string, file: string) => ({ id, name, input: name === 'NotebookEdit' ? { notebook_path: file } : { file_path: file } })
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm1', tools: [ed('e1', 'Edit', '/a'), ed('e2', 'Write', '/b'), ed('e3', 'MultiEdit', '/a'), { id: 'r1', name: 'Read', input: { file_path: '/a' } }] }),
  ], [[f.assistant({ id: 's1', sidechain: true, tools: [ed('e1', 'Edit', '/a'), ed('e4', 'NotebookEdit', '/c.ipynb'), ed('e5', 'Edit', '/b')] })]], fb)!
  assert.deepEqual([r.summary.edits, r.summary.filesEdited, r.summary.reworkEdits], [5, 3, 2])
  assert.deepEqual(r.fileEdits, { '/a': 2, '/b': 2, '/c.ipynb': 1 })
})

test('phase flow: consecutive distinct parent phases, other skipped', () => {
  const r = parseRecord([
    f.userText('go'),
    f.assistant({ id: 'm1', tools: [{ id: 't1', name: 'Read' }] }),
    f.assistant({ id: 'm2', tools: [{ id: 't2', name: 'Grep' }] }),
    f.assistant({ id: 'm3', tools: [{ id: 't3', name: 'Edit', input: { file_path: '/a' } }] }),
    f.assistant({ id: 'm4', tools: [{ id: 't4', name: 'Read' }] }),
  ], [[f.assistant({ id: 's1', sidechain: true, tools: [{ id: 't5', name: 'Edit', input: { file_path: '/a' } }] })]], fb)!
  const phases = r.messages.filter(m => !m.sidechain).map(m => m.phase)
  const expected: { from: string; to: string }[] = []
  let prev: string | null = null
  for (const p of phases) { if (p === 'other') continue; if (prev && prev !== p) expected.push({ from: prev, to: p }); prev = p }
  assert.ok(expected.length >= 1)
  assert.deepEqual(r.phaseFlow, expected)
})

test('Claude sessions are tagged agent claude-code', () => {
  assert.equal(parseSession([f.userText('hi')], [], { id: 's', projectDir: 'p' })!.agent, 'claude-code')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCopilotRecord } from '../copilot/parse.ts'
import type { CopilotFallback } from '../copilot/parse.ts'
import { claudeEquivalent, editTargets } from '../copilot/tools.ts'
import * as c from './copilotFixtures.ts'

const parse = (events: object[], fb: Partial<CopilotFallback> = {}) => parseCopilotRecord(events, { ...c.FB, ...fb })!
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} != ${b}`)

test('claudeEquivalent maps Copilot tools to Claude names', () => {
  assert.deepEqual(claudeEquivalent('bash', { command: 'ls' }, null), { name: 'Bash', input: { command: 'ls' } })
  assert.deepEqual(claudeEquivalent('edit', { path: '/a' }, null), { name: 'Edit', input: { file_path: '/a' } })
  assert.deepEqual(claudeEquivalent('create', { path: '/a' }, null), { name: 'Write', input: { file_path: '/a' } })
  assert.deepEqual(claudeEquivalent('task', { description: 'd' }, null), { name: 'Task', input: { description: 'd' } })
  assert.equal(claudeEquivalent('view', {}, null).name, 'Read')
  assert.equal(claudeEquivalent('rg', {}, null).name, 'Grep')
  assert.equal(claudeEquivalent('x', {}, { server: 's', tool: 't' }).name, 'mcp__s__t')
  assert.deepEqual(claudeEquivalent('sql', { q: 1 }, null), { name: 'sql', input: { q: 1 } })
})

test('metadata: id, agent, project, title, branch, version, effort, entrypoint', () => {
  const r = parse([c.start(), c.modelChange('claude-sonnet-5', 'high'), c.modelChange('claude-sonnet-5', 'high'), c.user('  fix   the\nbug ', c.T(1)), c.assistant({ out: 5 })])
  const s = r.summary
  assert.deepEqual([s.id, s.agent, s.project, s.title, s.startedAt, s.gitBranch, s.version, s.effort, s.entrypoint, s.permissionMode, s.models, s.userTurns],
    ['c1', 'copilot', '/repo/demo', 'fix the bug', c.T(0), 'main', '1.0.92', 'high', 'cli', null, ['claude-sonnet-5'], 1])
  assert.deepEqual(r.turnTimes, [c.T(1)])
})

test('metadata fallbacks: workspace name and cwd, vscode entrypoint, no timestamps → null', () => {
  const s = parse([c.start(), c.user('hi')], { workspace: { name: 'Named session' }, vscode: true }).summary
  assert.deepEqual([s.title, s.entrypoint], ['Named session', 'vscode'])
  assert.equal(parse([c.user('x')], { workspace: { cwd: '/w' } }).summary.project, '/w')
  assert.equal(parse([c.user('x')]).summary.project, 'c1')
  assert.equal(parseCopilotRecord([{ type: 'x', data: {} }], c.FB), null)
})

test('tokens: last shutdown split per model by output tokens; cost from the price table', () => {
  const r = parse([c.start(), c.user('go'),
    c.assistant({ out: 30 }), c.assistant({ out: 10 }),
    c.shutdown({ 'claude-sonnet-5': { input: 1, output: 1 } }),
    c.shutdown({ 'claude-sonnet-5': { input: 400, output: 80, cacheRead: 4000, cacheWrite: 800 }, 'gpt-5.4-mini': { input: 100, output: 10 } })])
  const [m1, m2, m3] = r.messages
  assert.deepEqual(m1.tokens, { input: 300, output: 60, cacheRead: 3000, cacheCreation: 600, total: 3960 })
  assert.deepEqual(m2.tokens, { input: 100, output: 20, cacheRead: 1000, cacheCreation: 200, total: 1320 })
  assert.equal(m1.context, 3900)
  assert.deepEqual([m3.model, m3.tokens.input, m3.tokens.output, m3.agentId], ['gpt-5.4-mini', 100, 10, null])
  assert.deepEqual(r.summary.tokens, { input: 500, output: 90, cacheCreation: 800, cacheRead: 4000, total: 5390 })
  assert.deepEqual(r.summary.models, ['claude-sonnet-5', 'gpt-5.4-mini'])
  const sonnet = (400 * 3 + 80 * 15 + 4000 * 0.3 + 800 * 3.75) / 1e6, mini = (100 * 0.25 + 10 * 2) / 1e6
  close(r.summary.costUsd, sonnet + mini)
  close(m1.costUsd, sonnet * 0.75)
})

test('model names are normalized; shutdown keys that normalize alike are merged', () => {
  const r = parse([c.start(), c.user('go'), c.assistant({ model: 'gpt-5.4-nano-2026-03-17', out: 1 }), c.assistant({ model: 'gpt-5.4-nano', out: 1 }),
    c.shutdown({ 'gpt-5.4-nano': { input: 10, output: 2 }, 'gpt-5.4-nano-2026-03-17': { input: 30, output: 6 } })])
  assert.deepEqual(r.summary.models, ['gpt-5.4-nano'])
  assert.deepEqual(r.messages.map(m => [m.model, m.tokens.input, m.tokens.output]), [['gpt-5.4-nano', 20, 4], ['gpt-5.4-nano', 20, 4]])
  const sub = parse([c.start(), c.subStart('t1', 'explore', 'claude-haiku-4-5-20251001')]).subagents
  assert.deepEqual(sub.map(s => s.model), ['claude-haiku-4.5'])
})

test('no shutdown → zero tokens and null cost; unknown model with shutdown costs 0', () => {
  const none = parse([c.start(), c.user('a'), c.assistant({ out: 9 })]).summary
  assert.deepEqual([none.costUsd, none.tokens.total], [null, 0])
  const r = parse([c.start(), c.assistant({ model: 'mystery-1', out: 1 }), c.shutdown({ 'mystery-1': { input: 10, output: 1 } })])
  assert.deepEqual([r.summary.costUsd, r.summary.tokens.total], [0, 11])
})

test('tool calls: classes, errors, rejections, interruptions, questions, commits, edits and rework', () => {
  const r = parse([c.start(), c.user('go'),
    ...c.call('b1', 'bash', { command: 'git commit -m x' }),
    ...c.call('b2', 'bash', { command: 'ls' }), c.permission('b2', 'denied-interactively-by-user'),
    ...c.call('v1', 'view', { path: '/repo/a.ts' }, { ok: false }),
    ...c.call('e1', 'edit', { path: '/repo/a.ts', old_str: 'a', new_str: 'b\nc' }),
    ...c.call('e2', 'edit', { path: '/repo/a.ts', old_str: 'b', new_str: 'd' }),
    ...c.call('w1', 'create', { path: '/repo/b.ts', file_text: 'x' }),
    ...c.call('q1', 'ask_user', { message: '?' }),
    ...c.call('i1', 'report_intent', { intent: 'x' }),
    c.permission('e1', 'approved'), c.abort()])
  const s = r.summary
  assert.deepEqual(s.toolCalls, { total: 7, skills: 0, mcp: 0, builtin: 7 })
  assert.deepEqual([s.commits, s.questions, s.interruptions, s.rejections, s.toolErrors], [1, 1, 1, 1, 2])
  assert.deepEqual([s.edits, s.filesEdited, s.reworkEdits, s.toolRatio], [3, 2, 1, 7])
  assert.deepEqual(r.fileEdits, { '/repo/a.ts': 2, '/repo/b.ts': 1 })
  assert.deepEqual(r.toolStats.bash, { calls: 2, errors: 1, rejections: 1 })
  assert.deepEqual(r.toolStats.view, { calls: 1, errors: 1, rejections: 0 })
  assert.equal(r.toolStats.report_intent, undefined)
})

test('durations: session span, turn times, api/tool time, code changes, peak context', () => {
  const r = parse([c.start({ ts: c.T(0) }), c.user('a', c.T(1)),
    c.assistant({ tools: ['x'], ts: c.T(2) }), c.toolStart('x', 'view', {}, { ts: c.T(2) }), c.toolDone('x', { ts: c.T(4) }),
    c.turnEnd(c.T(5)), c.turnEnd(c.T(9)), c.compaction(150000),
    c.user('b', c.T(20)), c.turnEnd(c.T(23)),
    c.shutdown({}, { apiMs: 1234, added: 5, removed: 2, currentTokens: 20000, ts: c.T(30) })])
  const s = r.summary
  assert.deepEqual([s.durationMs, s.turnMs, s.apiMs, s.toolMs, s.retryMs, s.linesAdded, s.linesRemoved, s.peakContext],
    [30000, [8000, 3000], 1234, 2000, null, 5, 2, 150000])
})

test('skills: invocations, windows closed by the next user turn, sequence, skill phase', () => {
  const r = parse([c.start(), c.user('go'),
    ...c.call('s1', 'skill', { skill: 'superpowers:brainstorming' }), c.skillInvoked('brainstorming'),
    ...c.call('e1', 'edit', { path: '/repo/a.ts', new_str: 'x' }),
    ...c.call('t1', 'task', { agent_type: 'explore', description: 'look' }),
    ...c.call('v1', 'view', {}, { parent: 't1', ok: false }),
    ...c.call('b1', 'bash', { command: 'git commit -m done' }),
    c.user('next'), ...c.call('e2', 'edit', { path: '/repo/b.ts', new_str: 'y' })])
  assert.deepEqual(r.skillCalls, [{ ts: c.T(0), skill: 'superpowers:brainstorming', error: false }])
  assert.deepEqual(r.summary.skillsUsed, ['brainstorming', 'superpowers:brainstorming'])
  assert.deepEqual(r.skillSequence, ['superpowers:brainstorming'])
  assert.deepEqual(r.skillWindows, [{ skill: 'superpowers:brainstorming', ts: c.T(0), toolCalls: 4, toolErrors: 1, interrupted: false, linesEdited: 1, committed: true }])
  assert.equal(r.summary.toolCalls.skills, 1)
  assert.deepEqual(r.messages.slice(0, 2).map(m => [m.skill, m.phase, m.phaseSource]),
    [['superpowers:brainstorming', 'plan', 'skill'], ['superpowers:brainstorming', 'plan', 'skill']])
})

test('MCP: servers, tools, calls with errors; MCP git_commit counts as a commit', () => {
  const r = parse([c.start(), c.user('go'),
    ...c.call('m1', 'github-mcp-server-search_code', {}, { mcpServer: 'github-mcp-server', mcpTool: 'search_code', ok: false }),
    ...c.call('m2', 'GitKraken-git_commit', {}, { mcpServer: 'GitKraken', mcpTool: 'git_commit' })])
  const s = r.summary
  assert.deepEqual([s.toolCalls.mcp, s.toolCalls.builtin, s.commits], [2, 0, 1])
  assert.deepEqual(s.mcpServers, ['GitKraken', 'github-mcp-server'])
  assert.deepEqual(s.mcpServersUsed, ['GitKraken', 'github-mcp-server'])
  assert.deepEqual(r.mcpCalls, [{ ts: c.T(0), server: 'github-mcp-server', tool: 'search_code', error: true }, { ts: c.T(0), server: 'GitKraken', tool: 'git_commit', error: false }])
  assert.deepEqual(r.mcpTools, { 'github-mcp-server': ['search_code'], GitKraken: ['git_commit'] })
  assert.equal(r.messages[0].phase, 'explore')
})

test('subagents: runs from subagent events; messages and tools attributed by parentToolCallId', () => {
  const r = parse([c.start(), c.user('go'),
    ...c.call('t1', 'task', { agent_type: 'explore', description: 'review the diff' }),
    c.subStart('t1', 'explore', 'gpt-5.4-mini', c.T(3)),
    ...c.call('x1', 'view', {}, { parent: 't1', model: 'gpt-5.4-mini', out: 10, ok: false }),
    ...c.call('x2', 'grep', {}, { parent: 't1', model: 'gpt-5.4-mini', out: 10 }),
    c.subDone('t1', { tokens: 5000, durationMs: 3000, toolCalls: 2 }),
    c.shutdown({ 'claude-sonnet-5': { input: 10, output: 1 }, 'gpt-5.4-mini': { input: 1000, output: 20 } })])
  const [run] = r.subagents
  assert.deepEqual({ ...run, costUsd: 0 }, { agentId: 't1', agentType: 'explore', description: 'review the diff', model: 'gpt-5.4-mini', toolUseId: 't1',
    startedAt: c.T(3), durationMs: 3000, tokens: 5000, costUsd: 0, toolCalls: 2, toolErrors: 1, phase: 'review' })
  close(run.costUsd, (1000 * 0.25 + 20 * 2) / 1e6)
  assert.deepEqual(r.summary.agentTypes, ['explore'])
  assert.deepEqual(r.messages.filter(m => m.sidechain).map(m => [m.agentId, m.phase]), [['t1', 'explore'], ['t1', 'explore']])
  assert.deepEqual(r.summary.toolCalls, { total: 3, skills: 0, mcp: 0, builtin: 3 })
})

test('hooks and phase flow', () => {
  const r = parse([c.start(), c.user('go'), c.hookEnd('preToolUse'), c.hookEnd('postToolUse'),
    ...c.call('v', 'view', {}), ...c.call('p', 'create', { path: '/repo/docs/specs/x-spec.md', file_text: 'x' }),
    ...c.call('e', 'edit', { path: '/repo/src/a.ts', new_str: 'x' }), ...c.call('t', 'bash', { command: 'npm test' })])
  assert.deepEqual(r.hooks, [{ event: 'preToolUse', name: 'preToolUse', contextChars: 0 }, { event: 'postToolUse', name: 'postToolUse', contextChars: 0 }])
  assert.deepEqual(r.messages.map(m => m.phase), ['explore', 'plan', 'implement', 'test'])
  assert.deepEqual(r.phaseFlow, [{ from: 'explore', to: 'plan' }, { from: 'plan', to: 'implement' }, { from: 'implement', to: 'test' }])
})

test('apply_patch: raw patch string counts Update/Add headers as edits, ignores Delete; second Update is rework', () => {
  const patch = (...h: string[]) => `*** Begin Patch\n${h.join('\n@@\n-a\n+b\n')}\n*** End Patch`
  const r = parse([c.start(), c.user('go'),
    ...c.call('p1', 'apply_patch', patch('*** Update File: /repo/a.ts', '*** Add File: /repo/plan.md', '*** Delete File: /repo/old.ts') as any),
    ...c.call('p2', 'apply_patch', { input: patch('*** Update File: /repo/a.ts') } as any),
    ...c.call('p3', 'apply_patch', { patch: patch('*** Update File: /repo/c.ts') } as any)])
  const s = r.summary
  assert.deepEqual([s.edits, s.filesEdited, s.reworkEdits], [4, 3, 1])
  assert.deepEqual(r.fileEdits, { '/repo/a.ts': 2, '/repo/plan.md': 1, '/repo/c.ts': 1 })
})

test('editTargets: patch headers map Update→Edit and Add→Write; other tools keep their path', () => {
  assert.deepEqual(editTargets('apply_patch', '*** Begin Patch\n*** Update File: /a.ts\n*** Add File: /docs/plans/p.md\n*** Delete File: /d\n*** End Patch'),
    [{ tool: 'edit', path: '/a.ts' }, { tool: 'create', path: '/docs/plans/p.md' }])
  assert.deepEqual(editTargets('apply_patch', { path: '/x' }), [{ tool: 'edit', path: '/x' }])
  assert.deepEqual(editTargets('create', { path: '/x' }), [{ tool: 'create', path: '/x' }])
  assert.deepEqual(editTargets('view', { path: '/x' }), [])
})

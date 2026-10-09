import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inScope, isAutomated, parseScope, projectList } from '../scope.ts'
import type { SessionSummary } from '../../shared/types.ts'
import { summaryExtras } from './factories.ts'

const s = (id: string, o: Partial<SessionSummary> = {}): SessionSummary => ({
  id, project: '/p', title: id, startedAt: '2026-10-01T00:00:00Z', models: [], userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0,
  tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: null, skills: [], mcpServers: [],
  skillsUsed: [], mcpServersUsed: [], durationMs: null, linesAdded: null, linesRemoved: null, agentTypes: [], ...summaryExtras(), ...o,
})

test('parseScope: defaults, explicit values, invalid source or agent', () => {
  assert.deepEqual(parseScope({}), { agent: 'all', source: 'all', project: null })
  assert.deepEqual(parseScope({ source: 'automated', project: '/x', agent: 'copilot' }), { agent: 'copilot', source: 'automated', project: '/x' })
  assert.deepEqual(parseScope({ project: '' }), { agent: 'all', source: 'all', project: null })
  assert.equal(parseScope({ source: 'bogus' }), null)
  assert.equal(parseScope({ agent: 'bogus' }), null)
})

test('automated = entrypoint present and not cli; null is interactive', () => {
  assert.equal(isAutomated(s('a', { entrypoint: 'sdk-cli' })), true)
  assert.equal(isAutomated(s('a', { entrypoint: 'cli' })), false)
  assert.equal(isAutomated(s('a')), false)
})

test('inScope filters by source and project', () => {
  const sdk = s('a', { entrypoint: 'sdk-cli', project: '/x' }), cli = s('b', { entrypoint: 'cli' })
  assert.deepEqual([sdk, cli].filter(x => inScope(x, { agent: 'all', source: 'automated', project: null })).map(x => x.id), ['a'])
  assert.deepEqual([sdk, cli].filter(x => inScope(x, { agent: 'all', source: 'interactive', project: null })).map(x => x.id), ['b'])
  assert.deepEqual([sdk, cli].filter(x => inScope(x, { agent: 'all', source: 'all', project: '/x' })).map(x => x.id), ['a'])
})

test('projectList counts sessions per project, most first, then name', () => {
  assert.deepEqual(projectList([s('a', { project: '/b' }), s('b', { project: '/a' }), s('c', { project: '/c' }), s('d', { project: '/c' })]),
    [{ project: '/c', sessions: 2 }, { project: '/a', sessions: 1 }, { project: '/b', sessions: 1 }])
})

test('inScope filters by agent', () => {
  const cc = s('a'), cp = s('b', { agent: 'copilot' })
  assert.deepEqual([cc, cp].filter(x => inScope(x, { agent: 'copilot', source: 'all', project: null })).map(x => x.id), ['b'])
  assert.deepEqual([cc, cp].filter(x => inScope(x, { agent: 'claude-code', source: 'all', project: null })).map(x => x.id), ['a'])
  assert.deepEqual([cc, cp].filter(x => inScope(x, { agent: 'all', source: 'all', project: null })).map(x => x.id), ['a', 'b'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inScope, parseScope, projectList, providerList } from '../scope.ts'
import type { Agent, SessionSummary } from '../../shared/types.ts'
import { ALL_AGENTS } from '../../shared/types.ts'
import { summaryExtras } from './factories.ts'

const ALL: Agent[] = [...ALL_AGENTS]

const s = (id: string, o: Partial<SessionSummary> = {}): SessionSummary => ({
  id, project: '/p', title: id, startedAt: '2026-10-01T00:00:00Z', models: [], userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0,
  tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: null, skills: [], mcpServers: [],
  skillsUsed: [], mcpServersUsed: [], durationMs: null, linesAdded: null, linesRemoved: null, agentTypes: [], ...summaryExtras(), ...o,
})

test('parseScope: absent, empty or all → every agent; CSV list; rejects unknown', () => {
  const every = { agents: ['claude-code', 'copilot', 'opencode'], project: null, providers: null }
  assert.deepEqual(parseScope({}), every)
  assert.deepEqual(parseScope({ agent: '' }), every)
  assert.deepEqual(parseScope({ agent: 'all' }), every)
  assert.deepEqual(parseScope({ project: '/x', agent: 'copilot' }), { agents: ['copilot'], project: '/x', providers: null })
  assert.deepEqual(parseScope({ agent: 'claude-code,opencode' }), { agents: ['claude-code', 'opencode'], project: null, providers: null })
  assert.deepEqual(parseScope({ agent: 'copilot,copilot' }), { agents: ['copilot'], project: null, providers: null })
  assert.deepEqual(parseScope({ agent: ' copilot ' }), { agents: ['copilot'], project: null, providers: null })
  assert.deepEqual(parseScope({ project: '' }), every)
  assert.equal(parseScope({ agent: 'bogus' }), null)
  assert.equal(parseScope({ agent: 'copilot,bogus' }), null)
})

test('parseScope: provider CSV list; absent/empty/all → null; dedupes', () => {
  assert.deepEqual(parseScope({ provider: 'zai-coding-plan' }), { agents: ['claude-code', 'copilot', 'opencode'], project: null, providers: ['zai-coding-plan'] })
  assert.equal(parseScope({})!.providers, null)
  assert.equal(parseScope({ provider: '' })!.providers, null)
  assert.equal(parseScope({ provider: 'all' })!.providers, null)
  assert.equal(parseScope({ provider: ',,' })!.providers, null)
  assert.deepEqual(parseScope({ provider: 'a,b,a' })!.providers, ['a', 'b'])
})

test('inScope filters by project', () => {
  const a = s('a', { project: '/x' }), b = s('b', { project: '/y' })
  assert.deepEqual([a, b].filter(x => inScope(x, { agents: ALL, project: '/x', providers: null })).map(x => x.id), ['a'])
})

test('projectList counts sessions per project, most first, then name', () => {
  assert.deepEqual(projectList([s('a', { project: '/b' }), s('b', { project: '/a' }), s('c', { project: '/c' }), s('d', { project: '/c' })]),
    [{ project: '/c', sessions: 2 }, { project: '/a', sessions: 1 }, { project: '/b', sessions: 1 }])
})

test('providerList: sorted distinct providers across sessions, empty for none', () => {
  assert.deepEqual(providerList([s('a', { agent: 'opencode', providers: ['zai-coding-plan', 'opencode'] }), s('b')]), ['opencode', 'zai-coding-plan'])
  assert.deepEqual(providerList([s('a')]), [])
})

test('inScope filters by agent list', () => {
  const cc = s('a'), cp = s('b', { agent: 'copilot' }), oc = s('c', { agent: 'opencode' })
  assert.deepEqual([cc, cp, oc].filter(x => inScope(x, { agents: ['copilot'], project: null, providers: null })).map(x => x.id), ['b'])
  assert.deepEqual([cc, cp, oc].filter(x => inScope(x, { agents: ['claude-code', 'opencode'], project: null, providers: null })).map(x => x.id), ['a', 'c'])
  assert.deepEqual([cc, cp, oc].filter(x => inScope(x, { agents: [...ALL], project: null, providers: null })).map(x => x.id), ['a', 'b', 'c'])
})

test('inScope: provider filter narrows only opencode sessions', () => {
  const cc = s('a'), cp = s('b', { agent: 'copilot' })
  const oc1 = s('c', { agent: 'opencode', providers: ['zai-coding-plan'] })
  const oc2 = s('d', { agent: 'opencode', providers: ['minimax-coding-plan', 'opencode'] })
  const scope = (providers: string[] | null) => ({ agents: ALL, project: null, providers })
  assert.deepEqual([cc, cp, oc1, oc2].filter(x => inScope(x, scope(['zai-coding-plan']))).map(x => x.id), ['a', 'b', 'c'])
  assert.deepEqual([cc, cp, oc1, oc2].filter(x => inScope(x, scope(['opencode']))).map(x => x.id), ['a', 'b', 'd'])
  assert.deepEqual([cc, cp, oc1, oc2].filter(x => inScope(x, scope(null))).map(x => x.id), ['a', 'b', 'c', 'd'])
})

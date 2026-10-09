import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterOptions, matchesFilters } from '../sessionFilters.ts'
import { NO_FILTERS } from '../hash.ts'
import type { SessionSummary } from '../../shared/types.ts'
import { summaryExtras } from '../../server/test/factories.ts'

const s = (id: string, o: Partial<SessionSummary>): SessionSummary => ({
  id, project: '/p', title: id, startedAt: '2026-10-01T00:00:00Z', models: [], userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0,
  tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: null, skills: [], mcpServers: [],
  skillsUsed: [], mcpServersUsed: [], durationMs: null, linesAdded: null, linesRemoved: null, agentTypes: [], ...summaryExtras(), ...o,
})
const a = s('a', { models: ['opus'], skills: ['dev-debug', 'vlt'], skillsUsed: ['dev-debug'], mcpServers: ['engram'], mcpServersUsed: ['engram'] })
const b = s('b', { models: ['haiku', 'opus'], skills: ['vlt'], skillsUsed: ['vlt'], mcpServers: ['engram'] })

test('filterOptions: sorted distinct models, used skills, used mcp servers; keeps the active value', () => {
  assert.deepEqual(filterOptions([a, b], NO_FILTERS), { models: ['haiku', 'opus'], skills: ['dev-debug', 'vlt'], mcp: ['engram'], agents: [], branches: [] })
  assert.deepEqual(filterOptions([b], { skill: 'dev-debug', mcp: null, model: null, agent: null, branch: null }).skills, ['dev-debug', 'vlt'])
})

test('matchesFilters: AND of model, used skill, used mcp; loaded-only does not match', () => {
  assert.equal(matchesFilters(a, NO_FILTERS), true)
  assert.equal(matchesFilters(a, { skill: 'dev-debug', mcp: 'engram', model: 'opus', agent: null, branch: null }), true)
  assert.equal(matchesFilters(a, { skill: 'vlt', mcp: null, model: null, agent: null, branch: null }), false)
  assert.equal(matchesFilters(b, { skill: null, mcp: 'engram', model: null, agent: null, branch: null }), false)
  assert.equal(matchesFilters(b, { skill: 'vlt', mcp: null, model: 'haiku', agent: null, branch: null }), true)
})

test('matchesFilters: a model the session did not use does not match', () => {
  assert.equal(matchesFilters(a, { skill: null, mcp: null, model: 'haiku', agent: null, branch: null }), false)
})

test('filterOptions: loaded-but-unused skills and servers are not offered', () => {
  const c = s('c', { skills: ['loaded-only'], mcpServers: ['loaded-srv'] })
  assert.deepEqual(filterOptions([c], NO_FILTERS), { models: [], skills: [], mcp: [], agents: [], branches: [] })
})

test('agent filter: options from agentTypes, AND-matched', () => {
  const x = s('x', { agentTypes: ['general-purpose', 'Explore'] })
  assert.deepEqual(filterOptions([x, a], NO_FILTERS).agents, ['Explore', 'general-purpose'])
  assert.equal(matchesFilters(x, { ...NO_FILTERS, agent: 'Explore' }), true)
  assert.equal(matchesFilters(a, { ...NO_FILTERS, agent: 'Explore' }), false)
})

test('branch filter: options from gitBranch (nulls skipped), exact match', () => {
  const x = s('x', { gitBranch: 'main' }), y = s('y', { gitBranch: null })
  assert.deepEqual(filterOptions([x, y], NO_FILTERS).branches, ['main'])
  assert.equal(matchesFilters(x, { ...NO_FILTERS, branch: 'main' }), true)
  assert.equal(matchesFilters(y, { ...NO_FILTERS, branch: 'main' }), false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesQuery } from '../search.ts'
import type { SessionSummary } from '../../shared/types.ts'
import { summaryExtras } from '../../server/test/factories.ts'

const s = { id: 'abc-123', project: '/Code/agents-inspect', title: 'Fix login bug', startedAt: '2026-10-01T00:00:00Z', models: ['claude-opus-5-5'],
  userTurns: 1, toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 }, toolRatio: 0,
  tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: null, skills: ['dev-debug'], mcpServers: ['engram'],
  skillsUsed: [], mcpServersUsed: [], durationMs: null, linesAdded: null, linesRemoved: null, agentTypes: [], ...summaryExtras() } satisfies SessionSummary

test('matches title, id, project, skills and mcp servers, case-insensitive', () => {
  for (const q of ['', '  ', 'LOGIN', 'abc-1', 'agents-insp', 'Dev-Debug', 'engr']) assert.equal(matchesQuery(s, q), true, q)
  for (const q of ['opus', 'slack']) assert.equal(matchesQuery(s, q), false, q)
})

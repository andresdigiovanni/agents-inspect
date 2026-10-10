import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllAgents, projectsPath, providersPath, queryString } from '../api.ts'
import { ALL_AGENTS } from '../../shared/types.ts'

const from = new Date('2026-10-01T00:00:00.000Z'), to = new Date('2026-10-08T00:00:00.000Z')
const ALL = [...ALL_AGENTS]

test('queryString: range always; agent/provider list unless all/null; project when set', () => {
  assert.equal(queryString({ from, to, scope: { agents: ALL, project: null, providers: null } }), 'from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-08T00%3A00%3A00.000Z')
  const p = new URLSearchParams(queryString({ from, to, scope: { agents: ['copilot'], project: '/Code/a b', providers: null } }))
  assert.deepEqual([p.get('agent'), p.get('project'), p.get('provider')], ['copilot', '/Code/a b', null])
  const q = new URLSearchParams(queryString({ from, to, scope: { agents: ['claude-code', 'opencode'], project: null, providers: ['zai-coding-plan', 'minimax-coding-plan'] } }))
  assert.deepEqual([q.get('agent'), q.get('provider')], ['claude-code,opencode', 'minimax-coding-plan,zai-coding-plan'])
})

test('isAllAgents, projectsPath and providersPath', () => {
  assert.equal(isAllAgents(ALL), true)
  assert.equal(isAllAgents(['claude-code', 'opencode']), false)
  assert.equal(projectsPath(ALL, null), '/api/projects')
  assert.equal(projectsPath(['opencode'], null), '/api/projects?agent=opencode')
  assert.equal(projectsPath(['claude-code', 'opencode'], null), '/api/projects?agent=claude-code%2Copencode')
  assert.equal(projectsPath(ALL, ['zai-coding-plan']), '/api/projects?provider=zai-coding-plan')
  assert.equal(projectsPath(['opencode'], ['zai-coding-plan']), '/api/projects?agent=opencode&provider=zai-coding-plan')
  assert.equal(providersPath(ALL), '/api/providers')
  assert.equal(providersPath(['opencode']), '/api/providers?agent=opencode')
})

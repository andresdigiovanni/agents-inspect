import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectsPath, queryString } from '../api.ts'

const from = new Date('2026-10-01T00:00:00.000Z'), to = new Date('2026-10-08T00:00:00.000Z')

test('queryString: range always; agent/source omitted when all; project omitted when null', () => {
  assert.equal(queryString({ from, to, scope: { agent: 'all', source: 'all', project: null } }), 'from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-08T00%3A00%3A00.000Z')
  const p = new URLSearchParams(queryString({ from, to, scope: { agent: 'copilot', source: 'automated', project: '/Code/a b' } }))
  assert.deepEqual([p.get('agent'), p.get('source'), p.get('project')], ['copilot', 'automated', '/Code/a b'])
})

test('projectsPath adds agent unless all', () => {
  assert.equal(projectsPath('all'), '/api/projects')
  assert.equal(projectsPath('claude-code'), '/api/projects?agent=claude-code')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PHASES, resolvePhases, skillPhase, strongest, toolPhase } from '../phase.ts'

test('PHASES: fixed order with other last', () => {
  assert.deepEqual(PHASES, ['explore', 'plan', 'implement', 'test', 'review', 'debug', 'ship', 'other'])
})

test('skillPhase: maps known skills, strips plugin prefix, null otherwise', () => {
  assert.equal(skillPhase('dev-explore'), 'explore')
  assert.equal(skillPhase('superpowers:brainstorming'), 'plan')
  assert.equal(skillPhase('superpowers:test-driven-development'), 'implement')
  assert.equal(skillPhase('dev-testing'), 'test')
  assert.equal(skillPhase('dev-verify'), 'review')
  assert.equal(skillPhase('superpowers:systematic-debugging'), 'debug')
  assert.equal(skillPhase('dev-ship'), 'ship')
  assert.equal(skillPhase('vlt'), null)
  assert.equal(skillPhase('constructor'), null)
  assert.equal(skillPhase(null), null)
})

test('toolPhase: Bash commands', () => {
  assert.equal(toolPhase('Bash', { command: 'git commit -m "test: x"' }), 'ship')
  assert.equal(toolPhase('Bash', { command: 'git push origin main' }), 'ship')
  assert.equal(toolPhase('Bash', { command: 'gh pr create --fill' }), 'ship')
  assert.equal(toolPhase('Bash', { command: 'cargo test -q' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'npm run test' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'make check' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'git log --oneline' }), 'explore')
  assert.equal(toolPhase('Bash', {}), 'explore')
  assert.equal(toolPhase('Bash', { command: 'git tag v1' }), 'ship')
  assert.equal(toolPhase('Bash', { command: 'gh pr merge 3' }), 'ship')
  assert.equal(toolPhase('Bash', { command: 'cd web && npx vitest run' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'pytest -q' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'node --test server/test' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'make test' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'go test ./...' }), 'test')
  assert.equal(toolPhase('Bash', { command: 'ls test/' }), 'explore')
  assert.equal(toolPhase('Bash', { command: 'cat server/test/x.ts' }), 'explore')
  assert.equal(toolPhase('Bash', { command: 'grep -r jest package.json' }), 'explore')
})

test('toolPhase: NotebookEdit and remaining explore tools', () => {
  assert.equal(toolPhase('NotebookEdit', { notebook_path: '/repo/nb.ipynb' }), 'implement')
  for (const t of ['Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch']) assert.equal(toolPhase(t, {}), 'explore')
})

test('strongest: phases outside priority lose', () => {
  assert.equal(strongest('debug', 'explore'), 'explore')
  assert.equal(strongest('implement', 'other'), 'implement')
})

test('toolPhase: edits, agents, reads, MCP, unknown', () => {
  assert.equal(toolPhase('Edit', { file_path: '/repo/src/a.ts' }), 'implement')
  assert.equal(toolPhase('Write', { file_path: '/repo/docs/specs/2026-x.md' }), 'plan')
  assert.equal(toolPhase('Write', { file_path: '/repo/docs/plans/2026-x.md' }), 'plan')
  assert.equal(toolPhase('MultiEdit', { file_path: '/repo/README.md' }), 'implement')
  assert.equal(toolPhase('Agent', { description: 'Review Task 3 diff' }), 'review')
  assert.equal(toolPhase('Task', { description: 'Implement Task 1' }), null)
  assert.equal(toolPhase('Read', {}), 'explore')
  assert.equal(toolPhase('ToolSearch', {}), 'explore')
  assert.equal(toolPhase('mcp__engram__mem_search', {}), 'explore')
  assert.equal(toolPhase('TaskCreate', {}), null)
})

test('strongest: ship > test > review > implement > plan > explore', () => {
  assert.equal(strongest(null, null), null)
  assert.equal(strongest(null, 'explore'), 'explore')
  assert.equal(strongest('implement', null), 'implement')
  assert.equal(strongest('explore', 'implement'), 'implement')
  assert.equal(strongest('implement', 'ship'), 'ship')
  assert.equal(strongest('test', 'review'), 'test')
  assert.equal(strongest('plan', 'explore'), 'plan')
})

test('resolvePhases: skill beats tool, inheritance from last classified, other before any', () => {
  assert.deepEqual(resolvePhases([
    { skill: null, tool: null },
    { skill: null, tool: 'explore' },
    { skill: null, tool: null },
    { skill: 'debug', tool: 'implement' },
    { skill: null, tool: null },
  ]), [
    { phase: 'other', source: 'none' },
    { phase: 'explore', source: 'tool' },
    { phase: 'explore', source: 'inherited' },
    { phase: 'debug', source: 'skill' },
    { phase: 'debug', source: 'inherited' },
  ])
  assert.deepEqual(resolvePhases([{ skill: null, tool: null }, { skill: null, tool: null }]),
    [{ phase: 'other', source: 'none' }, { phase: 'other', source: 'none' }])
  assert.deepEqual(resolvePhases([]), [])
})

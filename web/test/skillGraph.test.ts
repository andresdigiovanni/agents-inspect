import { test } from 'node:test'
import assert from 'node:assert/strict'
import { END_NODE, skillGraph } from '../skillGraph.ts'

test('skillGraph: columns by feedback-arc ordering, end node last, weights relative to max', () => {
  const g = skillGraph([
    { from: 'brainstorm', to: 'plan', count: 4 },
    { from: 'plan', to: 'tdd', count: 2 },
    { from: 'tdd', to: 'plan', count: 1 },
    { from: 'tdd', to: null, count: 2 },
    { from: 'debug', to: null, count: 1 },
  ])
  const col = Object.fromEntries(g.nodes.map((n) => [n.id, n.col]))
  assert.deepEqual(col, { brainstorm: 0, debug: 0, plan: 1, tdd: 2, [END_NODE]: 3 })
  assert.equal(g.nodes.find((n) => n.id === END_NODE)?.label, 'end')
  const w = Object.fromEntries(g.edges.map((e) => [`${e.from}>${e.to}`, e.weight]))
  assert.equal(w['brainstorm>plan'], 1)
  assert.equal(w['tdd>plan'], 0.25)
  assert.equal(g.edges.find((e) => e.from === 'tdd' && e.to === 'plan')?.backward, true)
  assert.equal(g.edges.find((e) => e.from === 'plan' && e.to === 'tdd')?.backward, false)
})

test('skillGraph: main flow left to right despite back edges', () => {
  const g = skillGraph([
    { from: 'explore', to: 'plan', count: 5 },
    { from: 'plan', to: 'impl', count: 4 },
    { from: 'impl', to: 'test', count: 10 },
    { from: 'test', to: 'verify', count: 7 },
    { from: 'verify', to: 'ship', count: 3 },
    { from: 'ship', to: 'impl', count: 1 },
    { from: 'verify', to: 'explore', count: 1 },
  ])
  assert.deepEqual(g.nodes.map((n) => [n.id, n.col]), [['explore', 0], ['plan', 1], ['impl', 2], ['test', 3], ['verify', 4], ['ship', 5]])
  assert.deepEqual(g.edges.filter((e) => e.backward).map((e) => `${e.from}>${e.to}`), ['ship>impl', 'verify>explore'])
})

test('skillGraph: pure cycle still gets a root; self loops flagged; empty input', () => {
  const g = skillGraph([
    { from: 'a', to: 'b', count: 3 },
    { from: 'b', to: 'a', count: 1 },
    { from: 'b', to: 'b', count: 2 },
  ])
  assert.deepEqual(g.nodes.map((n) => [n.id, n.col]), [['a', 0], ['b', 1]])
  assert.equal(g.edges.find((e) => e.from === 'b' && e.to === 'b')?.self, true)
  assert.deepEqual(skillGraph([]), { nodes: [], edges: [], width: 0, height: 0 })
})

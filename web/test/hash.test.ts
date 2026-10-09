import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatHash, NO_FILTERS, parseHash } from '../hash.ts'

test('parseHash: tabs, default and unknown → overview', () => {
  for (const h of ['', '#', '#/', '#/nope', '#/overview']) assert.deepEqual(parseHash(h), { tab: 'overview', filters: NO_FILTERS }, h)
  assert.equal(parseHash('#/analysis').tab, 'tooling')
  assert.equal(parseHash('#/tooling').tab, 'tooling')
  assert.equal(parseHash('#/sessions').tab, 'sessions')
})

test('parseHash: filters only on sessions, URL-decoded, missing = null', () => {
  assert.deepEqual(parseHash('#/sessions?skill=superpowers%3Abrainstorming&mcp=engram&model=claude-opus-5-5').filters,
    { skill: 'superpowers:brainstorming', mcp: 'engram', model: 'claude-opus-5-5', agent: null, branch: null })
  assert.deepEqual(parseHash('#/sessions?mcp=engram').filters, { skill: null, mcp: 'engram', model: null, agent: null, branch: null })
  assert.deepEqual(parseHash('#/sessions?skill=').filters, NO_FILTERS)
  assert.deepEqual(parseHash('#/overview?skill=x').filters, NO_FILTERS)
})

test('formatHash: omits empty filters and round-trips', () => {
  assert.equal(formatHash({ tab: 'overview', filters: NO_FILTERS }), '#/overview')
  assert.equal(formatHash({ tab: 'sessions', filters: { skill: 'a:b', mcp: null, model: 'm 1', agent: null, branch: null } }), '#/sessions?skill=a%3Ab&model=m+1')
  const r = { tab: 'sessions' as const, filters: { skill: 'x/y:z', mcp: 'e', model: 'claude-opus-5-5', agent: null, branch: null } }
  assert.deepEqual(parseHash(formatHash(r)), r)
})

test('formatHash: filters are written only for sessions', () => {
  assert.equal(formatHash({ tab: 'overview', filters: { skill: 'x', mcp: null, model: null, agent: null, branch: null } }), '#/overview')
  assert.equal(formatHash({ tab: 'tooling', filters: { skill: 'x', mcp: null, model: null, agent: null, branch: null } }), '#/tooling')
})

test('workflow tab and agent filter', () => {
  assert.deepEqual(parseHash('#/workflow'), { tab: 'workflow', filters: NO_FILTERS })
  assert.equal(formatHash({ tab: 'workflow', filters: { ...NO_FILTERS, agent: 'x' } }), '#/workflow')
  const r = { tab: 'sessions' as const, filters: { ...NO_FILTERS, agent: 'general-purpose' } }
  assert.equal(formatHash(r), '#/sessions?agent=general-purpose')
  assert.deepEqual(parseHash(formatHash(r)), r)
})

test('branch filter round-trips on sessions', () => {
  const r = { tab: 'sessions' as const, filters: { ...NO_FILTERS, branch: 'feat/x' } }
  assert.equal(formatHash(r), '#/sessions?branch=feat%2Fx')
  assert.deepEqual(parseHash(formatHash(r)), r)
})

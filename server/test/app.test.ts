process.env.TZ = 'UTC'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../app.ts'
import * as f from './fixtures.ts'
import * as c from './copilotFixtures.ts'

const setup = async () => buildApp({ projectsDir: await f.makeProjectsDir({
  'p/recent.jsonl': f.jsonl([f.userText('r', { ts: '2026-10-06T00:00:00.000Z' })]),
  'p/old.jsonl': f.jsonl([f.userText('o', { ts: '2026-09-01T00:00:00.000Z' })]),
}) })

test('GET /api/summary returns the metrics of the requested range and validates params', async () => {
  const app = await setup()
  const res = await app.inject('/api/summary?from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z')
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().conversations, 1)
  assert.equal(res.json().totalConversations, undefined)
  assert.equal(res.json().daily.length, 7)
  assert.equal((await app.inject('/api/summary?from=nope&to=2026-10-08T00:00:00.000Z')).statusCode, 400)
  assert.equal((await app.inject('/api/summary')).statusCode, 400)
})

test('GET /api/sessions filters by range and validates params', async () => {
  const app = await setup()
  const ok = await app.inject('/api/sessions?from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z')
  assert.deepEqual(ok.json().map((s: { id: string }) => s.id), ['recent'])
  assert.equal((await app.inject('/api/sessions?from=nope&to=2026-10-08T00:00:00.000Z')).statusCode, 400)
  assert.equal((await app.inject('/api/sessions?from=2026-10-01T00:00:00.000Z&to=nope')).statusCode, 400)
  assert.equal((await app.inject('/api/sessions')).statusCode, 400)
})

test('GET trace and raw; 404 on unknown id', async () => {
  const app = await setup()
  const trace = await app.inject('/api/sessions/recent/trace')
  assert.equal(trace.json()[0].text, 'r')
  const raw = await app.inject('/api/sessions/recent/raw')
  assert.match(raw.headers['content-type'] as string, /^text\/plain/)
  assert.match(raw.body, /"type":"user"/)
  assert.equal((await app.inject('/api/sessions/nope/trace')).statusCode, 404)
  assert.equal((await app.inject('/api/sessions/nope/raw')).statusCode, 404)
})

test('staticDir: serves files, falls back to index.html, refuses traversal, /api stays 404 JSON', async () => {
  const root = await f.makeProjectsDir({ 'dist/index.html': '<!doctype html>INDEX', 'dist/assets/app.js': 'console.log(1)', 'secret.txt': 'SECRET' })
  const app = buildApp({ projectsDir: root, staticDir: `${root}/dist` })
  const js = await app.inject('/assets/app.js')
  assert.equal(js.statusCode, 200)
  assert.match(js.headers['content-type'] as string, /^text\/javascript/)
  assert.equal(js.body, 'console.log(1)')
  for (const url of ['/', '/some/client/route']) {
    const r = await app.inject(url)
    assert.equal(r.statusCode, 200)
    assert.match(r.headers['content-type'] as string, /^text\/html/)
    assert.equal(r.body, '<!doctype html>INDEX')
  }
  for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e%2f%2e%2e%2fsecret.txt']) {
    const r = await app.inject(url)
    assert.doesNotMatch(r.body, /SECRET/, url)
  }
  const api = await app.inject('/api/nope')
  assert.equal(api.statusCode, 404)
  assert.equal(typeof api.json().error, 'string')
})

test('staticDir without index.html: unknown path is 404, not a crash', async () => {
  const root = await f.makeProjectsDir({ 'dist/app.js': 'x' })
  const res = await buildApp({ projectsDir: root, staticDir: `${root}/dist` }).inject('/missing')
  assert.equal(res.statusCode, 404)
})

test('GET /api/analysis filters by range and validates params', async () => {
  const app = await setup()
  const ok = await app.inject('/api/analysis?from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z')
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().sessions, 1)
  assert.deepEqual(Object.keys(ok.json()).sort(), ['builtinTools', 'hooks', 'loadedMcpServers', 'loadedSkills', 'mcpServers', 'sequences', 'sessions', 'skillContextTokensEst', 'skills', 'toolMix'])
  assert.equal((await app.inject('/api/analysis?from=nope&to=2026-10-08T00:00:00.000Z')).statusCode, 400)
  assert.equal((await app.inject('/api/analysis')).statusCode, 400)
})

test('GET /api/workflow filters by range and validates params', async () => {
  const app = await setup()
  const ok = await app.inject('/api/workflow?from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z')
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().sessions, 1)
  assert.deepEqual(Object.keys(ok.json()).sort(), ['coverage', 'daily', 'models', 'phaseFlow', 'phases', 'rework', 'sessions', 'subagentCostPct', 'subagents'])
  assert.equal((await app.inject('/api/workflow?from=nope&to=2026-10-08T00:00:00.000Z')).statusCode, 400)
  assert.equal((await app.inject('/api/workflow')).statusCode, 400)
})

test('scope: source and project filter every range endpoint; invalid source is 400; /api/projects lists all', async () => {
  const meta = (o: object) => (l: object) => ({ ...l, ...o })
  const app = buildApp({ projectsDir: await f.makeProjectsDir({
    'p/cli.jsonl': f.jsonl([f.userText('a', { ts: '2026-10-06T00:00:00.000Z', cwd: '/x' })].map(meta({ entrypoint: 'cli' }))),
    'p/sdk.jsonl': f.jsonl([f.userText('b', { ts: '2026-10-06T00:00:00.000Z', cwd: '/y' })].map(meta({ entrypoint: 'sdk-cli' }))),
    'p/sdk2.jsonl': f.jsonl([f.userText('c', { ts: '2026-10-06T00:00:00.000Z', cwd: '/y' })].map(meta({ entrypoint: 'sdk-cli' }))),
  }) })
  const r = '?from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z'
  const ids = async (q: string) => (await app.inject(`/api/sessions${r}${q}`)).json().map((s: { id: string }) => s.id).sort()
  assert.deepEqual(await ids(''), ['cli', 'sdk', 'sdk2'])
  assert.deepEqual(await ids('&source=interactive'), ['cli'])
  assert.deepEqual(await ids('&source=automated'), ['sdk', 'sdk2'])
  assert.deepEqual(await ids('&project=%2Fx'), ['cli'])
  assert.equal((await app.inject(`/api/summary${r}&source=automated`)).json().conversations, 2)
  for (const path of ['summary', 'sessions', 'analysis', 'tooling', 'workflow']) assert.equal((await app.inject(`/api/${path}${r}&source=bogus`)).statusCode, 400, path)
  assert.equal((await app.inject(`/api/tooling${r}`)).statusCode, 200)
  assert.deepEqual((await app.inject('/api/projects')).json(), [{ project: '/y', sessions: 2 }, { project: '/x', sessions: 1 }])
  assert.equal((await app.inject(`/api/sessions${r}&agent=bogus`)).statusCode, 400)
  assert.deepEqual((await app.inject('/api/projects?agent=copilot')).json(), [])
  assert.equal((await app.inject('/api/projects?agent=bogus')).statusCode, 400)
})

test('GET /api/sessions/:id/detail returns the summary panel data; 404 on unknown id', async () => {
  const app = await setup()
  const ok = await app.inject('/api/sessions/recent/detail')
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().summary.id, 'recent')
  assert.deepEqual(Object.keys(ok.json()).sort(), ['context', 'costByModel', 'costByPhase', 'skillWindows', 'subagents', 'summary', 'topFiles'])
  assert.equal((await app.inject('/api/sessions/nope/detail')).statusCode, 404)
})

test('Copilot sessions: agent scope, projects, trace, raw and detail', async () => {
  const projectsDir = await f.makeProjectsDir({ 'p/cc.jsonl': f.jsonl([f.userText('a', { ts: '2026-10-06T00:00:00.000Z', cwd: '/x' })]) })
  const copilotDir = await f.makeProjectsDir({ 'cp/events.jsonl': f.jsonl([c.start({ id: 'cp', cwd: '/y', ts: '2026-10-06T00:00:00.000Z' }), c.user('hello', '2026-10-06T00:00:01.000Z')]) })
  const app = buildApp({ projectsDir, copilotDir })
  const r = '?from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z'
  const ids = async (q: string) => (await app.inject(`/api/sessions${r}${q}`)).json().map((s: { id: string }) => s.id).sort()
  assert.deepEqual(await ids(''), ['cc', 'cp'])
  assert.deepEqual(await ids('&agent=copilot'), ['cp'])
  assert.deepEqual(await ids('&agent=claude-code'), ['cc'])
  assert.deepEqual((await app.inject('/api/projects?agent=copilot')).json(), [{ project: '/y', sessions: 1 }])
  assert.equal((await app.inject('/api/sessions/cp/trace')).json()[0].text, 'hello')
  assert.match((await app.inject('/api/sessions/cp/raw')).body, /"session\.start"/)
  assert.equal((await app.inject('/api/sessions/cp/detail')).json().summary.agent, 'copilot')
})

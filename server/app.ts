import Fastify, { type FastifyInstance } from 'fastify'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { findSession, loadRecords, loadSessions } from './load.ts'
import { findCopilotSession } from './copilot/load.ts'
import { buildCopilotTrace } from './copilot/trace.ts'
import { opencodeRaw, opencodeTrace } from './opencode/load.ts'
import { computeSummary, sessionsInRange } from './aggregate.ts'
import { computeAnalysis } from './analysis.ts'
import { computeWorkflow } from './workflow.ts'
import { computeDetail } from './detail.ts'
import { parseLines } from './parse.ts'
import { buildTrace } from './trace.ts'
import { inScope, parseScope, projectList, providerList } from './scope.ts'
import type { SessionRecord } from './record.ts'
import type { Scope } from '../shared/types.ts'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

async function isFile(p: string): Promise<boolean> {
  try { return (await stat(p)).isFile() } catch { return false }
}

export function buildApp(opts: { projectsDir: string; copilotDir?: string; opencodeDb?: string; staticDir?: string }): FastifyInstance {
  const app = Fastify()
  const dir = opts.projectsDir
  const cp = opts.copilotDir
  const oc = opts.opencodeDb

  type Q = { from?: string; to?: string; project?: string; agent?: string; provider?: string }
  const parseQuery = (q: Q): { from: Date; to: Date; scope: Scope } | { error: string } => {
    const from = Date.parse(q.from ?? '')
    const to = Date.parse(q.to ?? '')
    if (Number.isNaN(from) || Number.isNaN(to)) return { error: 'from and to must be ISO dates' }
    const scope = parseScope(q)
    if (!scope) return { error: 'agent must be a comma-separated list of claude-code, copilot and opencode' }
    return { from: new Date(from), to: new Date(to), scope }
  }
  const providerError = async (scope: Scope): Promise<string | null> => {
    if (scope.providers === null) return null
    const known = new Set(providerList(await loadSessions(dir, cp, oc)))
    return scope.providers.some(p => !known.has(p)) ? 'provider must be a comma-separated list of providers present in the data' : null
  }
  const range = <T>(path: string, compute: (records: SessionRecord[], from: Date, to: Date) => T) =>
    app.get<{ Querystring: Q }>(path, async (req, reply) => {
      const q = parseQuery(req.query)
      if ('error' in q) return reply.code(400).send(q)
      const err = await providerError(q.scope)
      if (err !== null) return reply.code(400).send({ error: err })
      return compute((await loadRecords(dir, cp, oc)).filter(r => inScope(r.summary, q.scope)), q.from, q.to)
    })

  range('/api/summary', computeSummary)
  range('/api/sessions', (records, from, to) => sessionsInRange(records.map(r => r.summary), from, to))
  range('/api/analysis', computeAnalysis)
  range('/api/tooling', computeAnalysis)
  range('/api/workflow', computeWorkflow)
  app.get<{ Querystring: { agent?: string; provider?: string } }>('/api/projects', async (req, reply) => {
    const scope = parseScope({ agent: req.query.agent, provider: req.query.provider })
    if (!scope) return reply.code(400).send({ error: 'agent must be a comma-separated list of claude-code, copilot and opencode' })
    const err = await providerError(scope)
    if (err !== null) return reply.code(400).send({ error: err })
    return projectList((await loadSessions(dir, cp, oc)).filter(s => inScope(s, scope)))
  })
  app.get<{ Querystring: { agent?: string } }>('/api/providers', async (req, reply) => {
    const scope = parseScope({ agent: req.query.agent })
    if (!scope) return reply.code(400).send({ error: 'agent must be a comma-separated list of claude-code, copilot and opencode' })
    return providerList((await loadSessions(dir, cp, oc)).filter(s => inScope(s, scope)))
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id/detail', async (req, reply) => {
    const r = (await loadRecords(dir, cp, oc)).find(x => x.summary.id === req.params.id)
    if (!r) return reply.code(404).send({ error: 'session not found' })
    return computeDetail(r)
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id/trace', async (req, reply) => {
    const s = await findSession(dir, req.params.id)
    if (s) {
      const parent = parseLines(await readFile(s.parent, 'utf8'))
      const subs = await Promise.all(s.subagents.map(async p => parseLines(await readFile(p, 'utf8'))))
      return buildTrace(parent, subs)
    }
    const c = cp ? await findCopilotSession(cp, req.params.id) : null
    if (c) return buildCopilotTrace(parseLines(await readFile(c.events, 'utf8')))
    const ocTrace = oc ? await opencodeTrace(oc, req.params.id) : null
    if (ocTrace) return ocTrace
    return reply.code(404).send({ error: 'session not found' })
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id/raw', async (req, reply) => {
    const s = await findSession(dir, req.params.id)
    if (s) return reply.type('text/plain; charset=utf-8').send(await readFile(s.parent, 'utf8'))
    const c = cp ? await findCopilotSession(cp, req.params.id) : null
    if (c) return reply.type('text/plain; charset=utf-8').send(await readFile(c.events, 'utf8'))
    const raw = oc ? await opencodeRaw(oc, req.params.id) : null
    if (raw !== null) return reply.type('text/plain; charset=utf-8').send(raw)
    return reply.code(404).send({ error: 'session not found' })
  })

  if (opts.staticDir) {
    const root = resolve(opts.staticDir)
    app.setNotFoundHandler(async (req, reply) => {
      const notFound = () => reply.code(404).send({ error: 'not found' })
      let pathname: string
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { return notFound() }
      if (req.method !== 'GET' || pathname === '/api' || pathname.startsWith('/api/')) return notFound()
      const target = join(root, normalize(pathname))
      if (target !== root && !target.startsWith(root + sep)) return notFound()
      const file = (await isFile(target)) ? target : join(root, 'index.html')
      if (!(await isFile(file))) return notFound()
      return reply.type(CONTENT_TYPES[extname(file)] ?? 'application/octet-stream').send(await readFile(file))
    })
  }

  return app
}

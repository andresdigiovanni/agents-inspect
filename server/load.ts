import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadCopilotRecords } from './copilot/load.ts'
import { loadOpencodeRecords } from './opencode/load.ts'
import { parseLines, parseRecord } from './parse.ts'
import type { SessionSummary } from '../shared/types.ts'
import type { SessionRecord, SubagentInput } from './record.ts'

export interface SessionFiles { id: string; projectDir: string; parent: string; subagents: string[] }

const jsonlOnly = (names: string[]) => names.filter(n => n.endsWith('.jsonl'))

export async function listSessionFiles(projectsDir: string): Promise<SessionFiles[]> {
  let dirs
  try { dirs = await readdir(projectsDir, { withFileTypes: true }) } catch { return [] }
  const out: SessionFiles[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dir = join(projectsDir, d.name)
    let entries: string[]
    try { entries = await readdir(dir) } catch { continue }
    for (const file of jsonlOnly(entries)) {
      const id = file.slice(0, -'.jsonl'.length)
      let subs: string[] = []
      try { subs = jsonlOnly(await readdir(join(dir, id, 'subagents'))).map(n => join(dir, id, 'subagents', n)) } catch { /* none */ }
      out.push({ id, projectDir: d.name, parent: join(dir, file), subagents: subs })
    }
  }
  return out
}

async function readMeta(jsonlPath: string): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = JSON.parse(await readFile(jsonlPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch { return null }
}

const subagentInputs = (paths: string[]): Promise<SubagentInput[]> =>
  Promise.all(paths.map(async p => ({ agentId: basename(p, '.jsonl').replace(/^agent-/, ''), meta: await readMeta(p) })))

const cache = new Map<string, { key: string; record: SessionRecord | null }>()

async function cacheKey(s: SessionFiles): Promise<string> {
  const parts = await Promise.all([s.parent, ...s.subagents].map(async p => {
    const st = await stat(p)
    return `${p}:${st.mtimeMs}:${st.size}`
  }))
  const metas = await Promise.all(s.subagents.map(async p => {
    const st = await stat(p.replace(/\.jsonl$/, '.meta.json')).catch(() => null)
    return st ? `${st.mtimeMs}:${st.size}` : '-'
  }))
  return [...parts, ...metas].join('|')
}

export async function loadSessions(projectsDir: string, copilotDir?: string, opencodeDb?: string): Promise<SessionSummary[]> {
  return (await loadRecords(projectsDir, copilotDir, opencodeDb)).map(r => r.summary)
}

export async function loadRecords(projectsDir: string, copilotDir?: string, opencodeDb?: string): Promise<SessionRecord[]> {
  const files = await listSessionFiles(projectsDir)
  const live = new Set(files.map(s => s.parent))
  for (const k of cache.keys()) if (!live.has(k)) cache.delete(k)
  const out: SessionRecord[] = []
  for (const s of files) {
    let key: string
    try { key = await cacheKey(s) } catch { continue }
    let hit = cache.get(s.parent)
    if (!hit || hit.key !== key) {
      try {
        const parent = parseLines(await readFile(s.parent, 'utf8'))
        const subs = await Promise.all(s.subagents.map(async p => parseLines(await readFile(p, 'utf8'))))
        hit = { key, record: parseRecord(parent, subs, { id: s.id, projectDir: s.projectDir }, await subagentInputs(s.subagents)) }
      } catch { continue }
      cache.set(s.parent, hit)
    }
    if (hit.record) out.push(hit.record)
  }
  return [...out, ...(copilotDir ? await loadCopilotRecords(copilotDir) : []), ...(opencodeDb ? await loadOpencodeRecords(opencodeDb) : [])]
}

export async function findSession(projectsDir: string, id: string): Promise<SessionFiles | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  return (await listSessionFiles(projectsDir)).find(s => s.id === id) ?? null
}

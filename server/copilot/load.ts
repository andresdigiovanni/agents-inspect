import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseLines } from '../parse.ts'
import type { SessionRecord } from '../record.ts'
import { parseCopilotRecord } from './parse.ts'

export interface CopilotFiles { id: string; dir: string; events: string }

// workspace.yaml is flat `key: value`; nested or list lines are ignored.
export function parseWorkspaceYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const isFile = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isFile() ?? false
const signature = async (p: string): Promise<string> => {
  const st = await stat(p).catch(() => null)
  return st ? `${st.mtimeMs}:${st.size}` : '-'
}

export async function listCopilotSessions(root: string): Promise<CopilotFiles[]> {
  let dirs
  try { dirs = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const out: CopilotFiles[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dir = join(root, d.name), events = join(dir, 'events.jsonl')
    if (await isFile(events)) out.push({ id: d.name, dir, events })
  }
  return out
}

const cache = new Map<string, { key: string; record: SessionRecord | null }>()

export async function loadCopilotRecords(root: string): Promise<SessionRecord[]> {
  const files = await listCopilotSessions(root)
  const out: SessionRecord[] = []
  for (const s of files) {
    const wsPath = join(s.dir, 'workspace.yaml'), vsPath = join(s.dir, 'vscode.metadata.json')
    const sigs = await Promise.all([s.events, wsPath, vsPath].map(signature))
    const key = sigs.join('|')
    let hit = cache.get(s.events)
    if (!hit || hit.key !== key) {
      let text: string
      try { text = await readFile(s.events, 'utf8') } catch { continue }
      const ws = await readFile(wsPath, 'utf8').catch(() => null)
      try {
        hit = { key, record: parseCopilotRecord(parseLines(text), { id: s.id, workspace: ws === null ? null : parseWorkspaceYaml(ws), vscode: sigs[2] !== '-' }) }
      } catch { continue }
      cache.set(s.events, hit)
    }
    if (hit.record) out.push(hit.record)
  }
  return out
}

export async function findCopilotSession(root: string, id: string): Promise<CopilotFiles | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  const dir = join(root, id), events = join(dir, 'events.jsonl')
  return (await isFile(events)) ? { id, dir, events } : null
}

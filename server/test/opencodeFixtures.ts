import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const T0 = Date.parse('2026-10-01T10:00:00.000Z')
export const ms = (s: number): number => T0 + s * 1000
export const ISO = (s: number): string => new Date(ms(s)).toISOString()

export type Row = Record<string, unknown>

export interface SessOpt {
  id?: string; parent?: string | null; agent?: string | null; dir?: string; title?: string; model?: string; provider?: string
  version?: string; cost?: number; input?: number; output?: number; reasoning?: number
  cacheRead?: number; cacheWrite?: number; added?: number | null; removed?: number | null
  created?: number; updated?: number
}
export const sess = (o: SessOpt = {}): Row => ({
  id: o.id ?? 'ses_1', parent_id: o.parent ?? null, directory: o.dir ?? '/repo/demo', title: o.title ?? 'T',
  agent: o.agent ?? 'build', model: JSON.stringify({ id: o.model ?? 'glm-5.3', providerID: o.provider ?? 'zai-coding-plan' }),
  version: o.version ?? '1.18.4', cost: o.cost ?? 0,
  tokens_input: o.input ?? 0, tokens_output: o.output ?? 0, tokens_reasoning: o.reasoning ?? 0,
  tokens_cache_read: o.cacheRead ?? 0, tokens_cache_write: o.cacheWrite ?? 0,
  summary_additions: o.added ?? null, summary_deletions: o.removed ?? null,
  time_created: o.created ?? ms(0), time_updated: o.updated ?? ms(60),
})

let n = 0
export interface UserOpt { id?: string; session?: string; created?: number }
export const userMsg = (o: UserOpt = {}): Row => {
  const created = o.created ?? ms(0)
  return { id: o.id ?? `msg_${++n}`, session_id: o.session ?? 'ses_1', time_created: created, time_updated: created,
    data: JSON.stringify({ role: 'user', time: { created } }) }
}
export interface AsstOpt {
  id?: string; session?: string; model?: string; provider?: string; agent?: string
  input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number
  cost?: number; created?: number; completed?: number
}
export const assistantMsg = (o: AsstOpt = {}): Row => {
  const created = o.created ?? ms(0)
  const input = o.input ?? 0, output = o.output ?? 0, reasoning = o.reasoning ?? 0
  const cacheRead = o.cacheRead ?? 0, cacheWrite = o.cacheWrite ?? 0
  return { id: o.id ?? `msg_${++n}`, session_id: o.session ?? 'ses_1', time_created: created, time_updated: o.completed ?? created,
    data: JSON.stringify({ role: 'assistant', mode: 'build', agent: o.agent ?? 'build',
      model: { providerID: o.provider ?? 'zai-coding-plan', modelID: o.model ?? 'glm-5.3' }, cost: o.cost ?? 0,
      tokens: { total: input + output + reasoning + cacheRead + cacheWrite, input, output, reasoning, cache: { write: cacheWrite, read: cacheRead } },
      time: { created, ...(o.completed !== undefined ? { completed: o.completed } : {}) } }) }
}
export interface PartOpt { msg?: string; session?: string; created?: number }
export const textPart = (o: PartOpt & { text?: string } = {}): Row =>
  ({ id: `prt_${String(++n).padStart(4, '0')}`, message_id: o.msg ?? 'msg_1', session_id: o.session ?? 'ses_1', time_created: o.created ?? ms(0), time_updated: o.created ?? ms(0),
    data: JSON.stringify({ type: 'text', text: o.text ?? '' }) })
export interface ToolPOpt extends PartOpt { tool?: string; call?: string; status?: string; input?: object; output?: string; error?: string }
export const toolPart = (o: ToolPOpt = {}): Row =>
  ({ id: `prt_${String(++n).padStart(4, '0')}`, message_id: o.msg ?? 'msg_1', session_id: o.session ?? 'ses_1', time_created: o.created ?? ms(0), time_updated: o.created ?? ms(0),
    data: JSON.stringify({ type: 'tool', tool: o.tool ?? 'bash', callID: o.call ?? `call_${String(++n).padStart(4, '0')}`,
      state: { status: o.status ?? 'completed', input: o.input ?? {}, ...(o.output !== undefined ? { output: o.output } : {}), ...(o.error !== undefined ? { error: o.error } : {}) } }) })
export const patchPart = (o: PartOpt & { files?: string[] } = {}): Row =>
  ({ id: `prt_${String(++n).padStart(4, '0')}`, message_id: o.msg ?? 'msg_1', session_id: o.session ?? 'ses_1', time_created: o.created ?? ms(0), time_updated: o.created ?? ms(0),
    data: JSON.stringify({ type: 'patch', hash: 'h', files: o.files ?? [] }) })

const SCHEMA = `
CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT,
  model TEXT, version TEXT NOT NULL, cost REAL NOT NULL DEFAULT 0,
  tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0, tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0, tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  summary_additions INTEGER, summary_deletions INTEGER, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);`

/** Builds a real SQLite db with the column subset the loader reads, and returns its path. */
export async function makeDb(sessions: Row[], messages: Row[], parts: Row[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agents-inspect-oc-'))
  const path = join(dir, 'opencode.db')
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  const insert = (table: string, row: Row) => {
    const cols = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c] as SQLInputValue))
  }
  for (const s of sessions) insert('session', s)
  for (const m of messages) insert('message', m)
  for (const p of parts) insert('part', p)
  db.close()
  return path
}

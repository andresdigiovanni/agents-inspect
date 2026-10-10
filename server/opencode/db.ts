import { DatabaseSync } from 'node:sqlite'

// Read-only access to the opencode SQLite store. Timestamps are ms epoch; JSON columns are parsed here.
export interface SessionRow {
  id: string; parent_id: string | null; directory: string; title: string; agent: string | null
  model: string | null; version: string; cost: number
  tokens_input: number; tokens_output: number; tokens_reasoning: number
  tokens_cache_read: number; tokens_cache_write: number
  summary_additions: number | null; summary_deletions: number | null
  time_created: number; time_updated: number; msg_updated: number | null
}
export type MsgRow = { id: string; time_created: number; data: any }
export type LoadedMessages = { rows: MsgRow[]; partsByMessage: Map<string, any[]> }

export function openDb(path: string): DatabaseSync | null {
  try { return new DatabaseSync(path, { readOnly: true }) } catch { return null }
}

export function listSessions(db: DatabaseSync): SessionRow[] {
  return db.prepare(
    'SELECT s.*, (SELECT max(u) FROM (SELECT m.time_updated u FROM message m WHERE m.session_id = s.id UNION ALL SELECT p.time_updated FROM part p WHERE p.session_id = s.id)) msg_updated FROM session s ORDER BY s.time_created, s.id',
  ).all() as unknown as SessionRow[]
}

export const parseJson = (raw: unknown): any => {
  try { return JSON.parse(String(raw)) } catch { return {} }
}

export function loadMessages(db: DatabaseSync, sessionId: string): MsgRow[] {
  return (db.prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as any[])
    .map(r => ({ id: r.id, time_created: r.time_created, data: parseJson(r.data) }))
}

export function loadParts(db: DatabaseSync, sessionId: string): Map<string, any[]> {
  const out = new Map<string, any[]>()
  const rows = db.prepare('SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as any[]
  for (const r of rows) {
    const list = out.get(r.message_id) ?? []
    list.push(parseJson(r.data))
    out.set(r.message_id, list)
  }
  return out
}

// Summary-agent sessions are roots by spec, so they are never returned as children.
export function childRows(db: DatabaseSync, sessionId: string): SessionRow[] {
  return db.prepare("SELECT s.*, NULL msg_updated FROM session s WHERE s.parent_id = ? AND s.agent IS NOT 'summary' ORDER BY s.time_created, s.id").all(sessionId) as unknown as SessionRow[]
}

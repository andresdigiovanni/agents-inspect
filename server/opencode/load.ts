import { childRows, listSessions, loadMessages, loadParts, openDb, parseJson } from './db.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LoadedMessages } from './db.ts'
import { parseOpencodeRecord } from './parse.ts'
import { buildOpencodeTrace } from './trace.ts'
import type { SessionRecord } from '../record.ts'
import type { TraceEvent } from '../../shared/types.ts'

// One entry per root session, keyed by db path + session id, holding the latest session/message update so only changed sessions re-parse.
const cache = new Map<string, { key: string; record: SessionRecord }>()

const loaded = (db: DatabaseSync, id: string): LoadedMessages =>
  ({ rows: loadMessages(db, id), partsByMessage: loadParts(db, id) })

export async function loadOpencodeRecords(dbPath: string): Promise<SessionRecord[]> {
  const db = openDb(dbPath)
  if (!db) return []
  try {
    const rows = listSessions(db)
    const ids = new Set(rows.map(r => r.id))
    const prefix = `${dbPath}:`
    for (const k of cache.keys()) if (k.startsWith(prefix) && !ids.has(k.slice(prefix.length))) cache.delete(k)
    // Child updates must invalidate the parent record, so fold each child's time_updated and msg_updated into its parent's key. Summary sessions are roots by spec and never fold.
    const childMax = new Map<string, number>()
    for (const r of rows) {
      if (r.parent_id === null || !ids.has(r.parent_id) || r.agent === 'summary') continue
      childMax.set(r.parent_id, Math.max(childMax.get(r.parent_id) ?? 0, r.time_updated, r.msg_updated ?? 0))
    }
    const out: SessionRecord[] = []
    for (const row of rows) {
      if (row.parent_id !== null && ids.has(row.parent_id) && row.agent !== 'summary') continue // rendered inside its parent
      const key = `${row.time_updated}:${row.msg_updated ?? 0}:${childMax.get(row.id) ?? 0}`
      let hit = cache.get(`${dbPath}:${row.id}`)
      if (!hit || hit.key !== key) {
        const children = childRows(db, row.id)
        hit = { key, record: parseOpencodeRecord(row, loaded(db, row.id), children.map(c => ({ row: c, msgs: loaded(db, c.id) }))) }
        cache.set(`${dbPath}:${row.id}`, hit)
      }
      out.push(hit.record)
    }
    return out
  } finally { db.close() }
}

export async function findOpencodeSession(dbPath: string, id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return false
  const db = openDb(dbPath)
  if (!db) return false
  try { return db.prepare('SELECT 1 FROM session WHERE id = ?').get(id) !== undefined } finally { db.close() }
}

export async function opencodeTrace(dbPath: string, id: string): Promise<TraceEvent[] | null> {
  if (!(await findOpencodeSession(dbPath, id))) return null
  const db = openDb(dbPath)
  if (!db) return null
  try { return buildOpencodeTrace(loaded(db, id), childRows(db, id).map(c => loaded(db, c.id))) } finally { db.close() }
}

// Synthesizes JSONL from the message and part rows of a session and its children, mirroring the raw JSONL the other agents serve.
export async function opencodeRaw(dbPath: string, id: string): Promise<string | null> {
  if (!(await findOpencodeSession(dbPath, id))) return null
  const db = openDb(dbPath)
  if (!db) return null
  try {
    const lines: string[] = []
    const emit = (sid: string) => {
      for (const m of loadMessages(db, sid)) lines.push(JSON.stringify({ type: 'message', sessionId: sid, ...m.data }))
      const parts = db.prepare('SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id').all(sid) as any[]
      for (const p of parts) lines.push(JSON.stringify({ sessionId: sid, messageId: p.message_id, ...parseJson(String(p.data)) }))
    }
    emit(id)
    for (const c of childRows(db, id)) emit(c.id)
    return lines.length ? lines.join('\n') + '\n' : ''
  } finally { db.close() }
}

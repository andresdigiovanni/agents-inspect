import type { Phase, SessionSummary, SubagentRun, TokenUsage, ToolCalls } from '../../shared/types.ts'
import type { McpCall, MessageEvent, SessionRecord, SkillCall, SkillWindow, ToolStat } from '../record.ts'
import { resolvePhases, skillPhase, strongest, toolPhase } from '../phase.ts'
import type { PhaseSignals } from '../phase.ts'
import { costOf } from '../pricing.ts'
import { normalizeModel } from '../modelName.ts'
import type { LoadedMessages, SessionRow } from './db.ts'
import { BUILTIN_TOOLS, claudeEquivalent, editTargets, mcpServerOf } from './tools.ts'

const COMMIT = /\bgit commit\b/

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, any> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, any> : {})
const lineCount = (v: unknown): number => (typeof v === 'string' && v ? v.split('\n').length : 0)
const ISO = (ms: number): string => new Date(ms).toISOString()
const zero = (): TokenUsage => ({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 })
const top = <K>(m: Map<K, number>): K | null => { let best: K | null = null, bv = -Infinity; for (const [k, v] of m) if (v > bv) { best = k; bv = v } return best }

const modelIdOf = (row: SessionRow): string => {
  let m: unknown = null
  try { m = JSON.parse(row.model ?? '') } catch { /* not JSON */ }
  return normalizeModel(str(obj(m).id || obj(m).providerID).toLowerCase())
}

const providerOf = (row: SessionRow): string | null => {
  let m: unknown = null
  try { m = JSON.parse(row.model ?? '') } catch { /* not JSON */ }
  return str(obj(m).providerID) || null
}

interface Walk {
  messages: MessageEvent[]; signals: PhaseSignals[]; toolCalls: ToolCalls
  skillsUsed: Set<string>; skillCalls: SkillCall[]; sequence: string[]
  mcpCalls: McpCall[]; mcpTools: Map<string, Set<string>>
  toolStats: Record<string, ToolStat>; edits: number; fileEdits: Record<string, number>; reworkEdits: number
  commits: number; commitMs: number[]; questions: number; toolErrors: number
  turnTimes: string[]; turnMs: number[]; apiMs: number
  windows: SkillWindow[]; windowStarts: number[]
}

const emptyWalk = (): Walk => ({
  messages: [], signals: [], toolCalls: { total: 0, skills: 0, mcp: 0, builtin: 0 },
  skillsUsed: new Set(), skillCalls: [], sequence: [], mcpCalls: [], mcpTools: new Map(),
  toolStats: {}, edits: 0, fileEdits: {}, reworkEdits: 0,
  commits: 0, commitMs: [], questions: 0, toolErrors: 0,
  turnTimes: [], turnMs: [], apiMs: 0, windows: [], windowStarts: [],
})

// One pass over a session's messages (own or a child's), accumulating normalized events and aggregates.
function walk(agentId: string | null, msgs: LoadedMessages, rootModel: string, rootProvider: string | null): Walk {
  const w = emptyWalk()
  let current = null as SkillWindow | null
  let turn: { start: number; end: number | null } | null = null
  const closeTurn = () => { if (turn && turn.end !== null) w.turnMs.push(turn.end - turn.start); turn = null }
  const bumpEdit = (file: string) => {
    w.edits++
    if (w.fileEdits[file]) w.reworkEdits++
    w.fileEdits[file] = (w.fileEdits[file] ?? 0) + 1
  }
  for (const row of msgs.rows) {
    const d = obj(row.data)
    const parts = msgs.partsByMessage.get(row.id) ?? []
    const texts = parts.map(p => obj(p)).filter(p => p.type === 'text').map(p => str(p.text)).join(' ')
    if (d.role === 'user') {
      if (!texts.trim()) continue
      closeTurn()
      w.turnTimes.push(ISO(row.time_created))
      current = null
      turn = { start: row.time_created, end: null }
      continue
    }
    if (d.role !== 'assistant') continue
    // Message rows carry the model both nested (model.modelID) and top-level depending on opencode version.
    const model = normalizeModel(str(obj(d.model).modelID || d.modelID || d.providerID).toLowerCase()) || rootModel
    const provider = str(obj(d.model).providerID || d.providerID) || rootProvider
    const t = zero()
    t.input = num(obj(d.tokens).input)
    t.output = num(obj(d.tokens).output) + num(obj(d.tokens).reasoning)
    t.cacheRead = num(obj(obj(d.tokens).cache).read)
    t.cacheCreation = num(obj(obj(d.tokens).cache).write)
    t.total = t.input + t.output + t.cacheRead + t.cacheCreation
    const costUsd = num(d.cost) > 0 ? num(d.cost) : costOf(model, t) ?? 0
    const completed = num(obj(d.time).completed)
    w.messages.push({
      ts: ISO(completed || row.time_created), model, provider, tokens: t, costUsd,
      sidechain: agentId !== null, skill: current?.skill ?? null, phase: 'other', phaseSource: 'none',
      agentId, mcpServer: null, context: t.input + t.cacheCreation + t.cacheRead,
    })
    w.signals.push({ skill: skillPhase(current?.skill ?? null), tool: null })
    if (completed > 0) { w.apiMs += Math.max(0, completed - row.time_created); if (turn) turn.end = completed }
    for (const p of parts.map(p => obj(p))) {
      if (p.type !== 'tool') continue
      const name = str(p.tool)
      if (!name) continue
      const state = obj(p.state)
      const input = obj(state.input)
      const error = state.status === 'error'
      if (error) w.toolErrors++
      w.toolCalls.total++
      const eq = claudeEquivalent(name, input)
      const signal = w.signals[w.signals.length - 1]
      signal.tool = strongest(signal.tool, toolPhase(eq.name, eq.input))
      if (name === 'skill') {
        w.toolCalls.skills++
        const skill = str(input.name).replace(/^\//, '')
        if (skill) {
          w.skillCalls.push({ ts: ISO(row.time_created), skill, error })
          w.skillsUsed.add(skill)
          if (w.sequence.at(-1) !== skill) w.sequence.push(skill)
          w.messages[w.messages.length - 1].skill = skill
          signal.skill = skillPhase(skill)
          if (agentId === null) {
            current = { skill, ts: ISO(row.time_created), toolCalls: 0, toolErrors: 0, interrupted: false, linesEdited: 0, committed: false }
            w.windows.push(current)
            w.windowStarts.push(row.time_created)
          }
        }
        continue
      }
      if (current) {
        current.toolCalls++
        if (error) current.toolErrors++
        current.linesEdited += lineCount(input.newString)
      }
      if (name === 'question') w.questions++
      if (!BUILTIN_TOOLS.has(name)) {
        w.toolCalls.mcp++
        const server = mcpServerOf(name)
        w.mcpCalls.push({ ts: ISO(row.time_created), server, tool: name, error })
        w.mcpTools.set(server, (w.mcpTools.get(server) ?? new Set()).add(name))
        continue
      }
      w.toolCalls.builtin++
      const st = w.toolStats[name] ??= { calls: 0, errors: 0, rejections: 0 }
      st.calls++
      if (error) st.errors++
      if (eq.name === 'Bash' && COMMIT.test(str(eq.input.command))) {
        w.commits++
        w.commitMs.push(row.time_created)
      }
      for (const file of editTargets(name, input)) bumpEdit(file)
    }
  }
  closeTurn()
  // User turns close the active window, so commits are matched against window starts after the fact (as the Copilot parser does).
  w.windows.forEach((win, i) => { win.committed = w.commitMs.some(c => c >= w.windowStarts[i]) })
  return w
}

const mergeWalk = (dst: Walk, src: Walk): void => {
  dst.toolCalls.total += src.toolCalls.total; dst.toolCalls.skills += src.toolCalls.skills
  dst.toolCalls.mcp += src.toolCalls.mcp; dst.toolCalls.builtin += src.toolCalls.builtin
  dst.edits += src.edits; dst.commits += src.commits
  dst.questions += src.questions; dst.toolErrors += src.toolErrors
  dst.reworkEdits += src.reworkEdits
  for (const [k, v] of Object.entries(src.fileEdits)) {
    const before = dst.fileEdits[k] ?? 0
    dst.fileEdits[k] = before + v
    if (before > 0) dst.reworkEdits += Math.min(v, before)
  }
  dst.skillsUsed = new Set([...dst.skillsUsed, ...src.skillsUsed])
  for (const s of src.sequence) if (dst.sequence.at(-1) !== s) dst.sequence.push(s)
  dst.skillCalls.push(...src.skillCalls); dst.mcpCalls.push(...src.mcpCalls)
  for (const [server, tools] of src.mcpTools) dst.mcpTools.set(server, new Set([...(dst.mcpTools.get(server) ?? new Set()), ...tools]))
  for (const [name, st] of Object.entries(src.toolStats)) {
    const d = dst.toolStats[name] ??= { calls: 0, errors: 0, rejections: 0 }
    d.calls += st.calls; d.errors += st.errors; d.rejections += st.rejections
  }
}

// Normalizes one opencode session (with its child subagent sessions) into the shared SessionRecord shape.
export function parseOpencodeRecord(row: SessionRow, own: LoadedMessages, children: { row: SessionRow; msgs: LoadedMessages }[]): SessionRecord {
  const rootModel = modelIdOf(row)
  const rootProvider = providerOf(row)
  const w = walk(null, own, rootModel, rootProvider)
  const subagents: SubagentRun[] = []
  const models = new Set(w.messages.map(m => m.model))
  for (const c of children) {
    const cw = walk(c.row.id, c.msgs, modelIdOf(c.row), providerOf(c.row))
    mergeWalk(w, cw)
    w.messages.push(...cw.messages)
    w.signals.push(...cw.signals)
    for (const m of cw.messages) models.add(m.model)
    const childTokens = c.row.tokens_input + c.row.tokens_output + c.row.tokens_reasoning + c.row.tokens_cache_read + c.row.tokens_cache_write
    subagents.push({
      agentId: c.row.id, agentType: c.row.agent ?? 'unknown', description: c.row.title, model: modelIdOf(c.row) || 'unknown',
      toolUseId: c.row.id, startedAt: ISO(c.row.time_created),
      durationMs: Math.max(0, c.row.time_updated - c.row.time_created) || null,
      tokens: childTokens, costUsd: c.row.cost > 0 ? c.row.cost : cw.messages.reduce((n, m) => n + m.costUsd, 0),
      toolCalls: cw.toolCalls.total, toolErrors: cw.toolErrors, phase: 'other',
    })
  }
  const providers = [...new Set(w.messages.map(m => m.provider).filter((p): p is string => p !== null))].sort()

  // Phases resolve per trace: the main conversation and each subagent separately.
  const groups = new Map<string | null, number[]>()
  w.messages.forEach((m, i) => groups.set(m.agentId, [...(groups.get(m.agentId) ?? []), i]))
  for (const idxs of groups.values()) resolvePhases(idxs.map(i => w.signals[i])).forEach((r, k) => {
    w.messages[idxs[k]].phase = r.phase
    w.messages[idxs[k]].phaseSource = r.source
  })
  for (const s of subagents) {
    const byPhase = new Map<Phase, number>()
    for (const m of w.messages) if (m.agentId === s.agentId) byPhase.set(m.phase, (byPhase.get(m.phase) ?? 0) + 1)
    s.phase = top(byPhase) ?? 'other'
  }

  const parentMsgs = w.messages.filter(m => m.agentId === null)
  const phaseFlow: { from: Phase; to: Phase }[] = []
  let prev: Phase | null = null
  for (const m of parentMsgs) {
    if (m.phase === 'other') continue
    if (prev !== null && prev !== m.phase) phaseFlow.push({ from: prev, to: m.phase })
    prev = m.phase
  }
  const contexts = parentMsgs.map(m => m.context)
  const tokens: TokenUsage = {
    input: row.tokens_input, output: row.tokens_output + row.tokens_reasoning,
    cacheCreation: row.tokens_cache_write, cacheRead: row.tokens_cache_read,
    total: row.tokens_input + row.tokens_output + row.tokens_reasoning + row.tokens_cache_read + row.tokens_cache_write,
  }
  const estimated = w.messages.reduce((n, m) => n + m.costUsd, 0)
  const reported = row.cost > 0
  const servers = [...w.mcpTools.keys()].sort()
  const summary: SessionSummary = {
    id: row.id, agent: 'opencode', project: row.directory || row.id, title: row.title || row.id, startedAt: ISO(row.time_created),
    models: [...models].sort(), providers, userTurns: w.turnTimes.length, toolCalls: w.toolCalls,
    toolRatio: w.turnTimes.length ? w.toolCalls.total / w.turnTimes.length : null,
    tokens, costUsd: reported ? row.cost + subagents.reduce((n, s) => n + s.costUsd, 0) : (estimated > 0 ? estimated : null),
    skills: [...w.skillsUsed].sort(), mcpServers: servers, skillsUsed: [...w.skillsUsed].sort(), mcpServersUsed: servers,
    agentTypes: [...new Set(subagents.map(s => s.agentType))].sort(),
    durationMs: Math.max(0, row.time_updated - row.time_created) || null,
    linesAdded: row.summary_additions, linesRemoved: row.summary_deletions,
    entrypoint: row.agent === 'summary' ? 'automated' : 'cli', gitBranch: null, version: row.version || null,
    effort: null, permissionMode: null,
    commits: w.commits, interruptions: 0, questions: w.questions, rejections: 0, toolErrors: w.toolErrors,
    peakContext: contexts.length ? Math.max(...contexts) : null, turnMs: w.turnMs,
    apiMs: w.apiMs || null, toolMs: null, retryMs: null,
    edits: w.edits, filesEdited: Object.keys(w.fileEdits).length, reworkEdits: w.reworkEdits,
  }
  return {
    summary, messages: w.messages, turnTimes: w.turnTimes,
    skillCalls: w.skillCalls, mcpCalls: w.mcpCalls,
    mcpTools: Object.fromEntries([...w.mcpTools].map(([k, v]) => [k, [...v].sort()])),
    subagents,
    skillWindows: w.windows,
    skillSequence: w.sequence, skillListingChars: {},
    toolStats: w.toolStats, hooks: [], fileEdits: w.fileEdits, phaseFlow,
    costReported: reported,
  }
}

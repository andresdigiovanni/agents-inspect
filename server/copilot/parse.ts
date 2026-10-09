import type { Phase, SessionSummary, TokenUsage, ToolCalls } from '../../shared/types.ts'
import type { HookRun, McpCall, MessageEvent, SessionRecord, SkillCall, SkillWindow, SubagentRun, ToolStat } from '../record.ts'
import { resolvePhases, skillPhase, strongest, toolPhase } from '../phase.ts'
import type { PhaseSignals } from '../phase.ts'
import { costOf } from '../pricing.ts'
import { normalizeModel } from '../modelName.ts'
import { claudeEquivalent, editTargets } from './tools.ts'

export interface CopilotFallback { id: string; workspace: Record<string, string> | null; vscode: boolean }

const COMMIT = /\bgit commit\b/
const MCP_COMMIT = /git_commit$/
const EDIT_TOOLS = new Set(['edit', 'create', 'str_replace', 'apply_patch'])
const IGNORED_TOOLS = new Set(['report_intent'])
const REJECTED = 'denied-interactively-by-user'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, any> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, any> : {})
const lineCount = (v: unknown): number => (typeof v === 'string' && v ? v.split('\n').length : 0)
const bump = (m: Map<string, number>, k: unknown) => { if (typeof k === 'string' && k) m.set(k, (m.get(k) ?? 0) + 1) }
const zero = (): TokenUsage => ({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 })
const top = <K>(m: Map<K, number>): K | null => {
  let best: K | null = null
  let bv = -Infinity
  for (const [k, v] of m) if (v > bv) { best = k; bv = v }
  return best
}
const editedLines = (name: string, args: Record<string, any>): number => (name === 'create' ? lineCount(args.file_text) : lineCount(args.new_str))

type Window = SkillWindow & { start: number; toolIds: string[] }
interface Run { agentType: string; model: string; startedAt: string | null; durationMs: number | null; tokens: number | null }

export function parseCopilotRecord(events: any[], fb: CopilotFallback): SessionRecord | null {
  const startedAt: string | undefined = events.find(e => typeof e?.timestamp === 'string')?.timestamp
  if (!startedAt) return null
  const ws = fb.workspace ?? {}
  let cwd: string | null = null
  let version: string | null = null
  const branches = new Map<string, number>(), efforts = new Map<string, number>()
  bump(branches, ws.branch)
  const models = new Set<string>()
  const messages: MessageEvent[] = []
  const weights: number[] = []
  const signals: PhaseSignals[] = []
  const msgOfTool = new Map<string, number>()
  const turnTimes: string[] = []
  let firstText: string | null = null
  const turnMs: number[] = []
  let turn = null as { start: number; end: number | null } | null
  const closeTurn = () => { if (turn && turn.end !== null) turnMs.push(turn.end - turn.start); turn = null }
  const toolCalls: ToolCalls = { total: 0, skills: 0, mcp: 0, builtin: 0 }
  const seenTools = new Set<string>()
  const toolStartTs = new Map<string, number>()
  let toolMs = 0, toolSpans = 0
  const errorIds = new Set<string>(), rejectIds = new Set<string>()
  const builtinCalls: { id: string; name: string }[] = []
  const skills = new Set<string>(), skillsUsed = new Set<string>()
  const skillCalls: (SkillCall & { id: string })[] = []
  const sequence: string[] = []
  const mcpCalls: (McpCall & { id: string })[] = []
  const mcpTools = new Map<string, Set<string>>()
  const hooks: HookRun[] = []
  const fileEdits: Record<string, number> = {}
  let edits = 0, reworkEdits = 0, commits = 0, questions = 0, interruptions = 0
  const commitAt: number[] = []
  const windows: Window[] = []
  let current = null as Window | null
  const windowOfTask = new Map<string, Window>()
  const toolsOfAgent = new Map<string, string[]>()
  const descriptions = new Map<string, string>()
  const spawnIdx = new Map<string, number>()
  const runs = new Map<string, Run>()
  const peaks: number[] = []
  let shutdown = null as Record<string, any> | null
  let shutdownTs: string | null = null
  let lastTs = startedAt

  events.forEach((e, i) => {
    const d = obj(e?.data)
    const ts: string | null = typeof e?.timestamp === 'string' ? e.timestamp : null
    if (ts) lastTs = ts
    const parent = str(d.parentToolCallId) || null
    const windowFor = (): Window | null => (parent === null ? current : windowOfTask.get(parent) ?? null)
    switch (e?.type) {
      case 'session.start': {
        const ctx = obj(d.context)
        cwd ??= str(ctx.cwd) || null
        bump(branches, ctx.branch)
        version = str(d.copilotVersion) || version
        bump(efforts, d.reasoningEffort)
        break
      }
      case 'session.model_change':
        bump(efforts, d.reasoningEffort)
        break
      case 'user.message': {
        if (parent !== null) break
        const text = str(d.content)
        if (!text.trim()) break
        closeTurn()
        turnTimes.push(ts ?? startedAt)
        firstText ??= text
        current = null
        if (ts) turn = { start: Date.parse(ts), end: null }
        break
      }
      case 'assistant.turn_end':
        if (turn && ts && parent === null) turn.end = Date.parse(ts)
        break
      case 'assistant.message': {
        const model = normalizeModel(str(d.model))
        if (!model) break
        models.add(model)
        const skill = windowFor()?.skill ?? null
        for (const r of Array.isArray(d.toolRequests) ? d.toolRequests : []) if (typeof r?.toolCallId === 'string') msgOfTool.set(r.toolCallId, messages.length)
        messages.push({ ts, model, tokens: zero(), costUsd: 0, sidechain: parent !== null, skill, phase: 'other', phaseSource: 'none', agentId: parent, mcpServer: null, context: 0 })
        weights.push(Math.max(num(d.outputTokens), 1))
        signals.push({ skill: skillPhase(skill), tool: null })
        break
      }
      case 'tool.execution_start': {
        const tid = str(d.toolCallId), name = str(d.toolName)
        if (!tid || !name || IGNORED_TOOLS.has(name) || seenTools.has(tid)) break
        seenTools.add(tid)
        toolCalls.total++
        if (ts) toolStartTs.set(tid, Date.parse(ts))
        const args = obj(d.arguments)
        const idx = msgOfTool.get(tid)
        const server = str(d.mcpServerName) || null
        const mcpTool = str(d.mcpToolName) || name
        const targets = editTargets(name, d.arguments)
        const eqs = name === 'apply_patch' && targets.length
          ? targets.map(t => claudeEquivalent(t.tool, { path: t.path }, null))
          : [claudeEquivalent(name, args, server ? { server, tool: mcpTool } : null)]
        if (idx !== undefined) for (const eq of eqs) signals[idx].tool = strongest(signals[idx].tool, toolPhase(eq.name, eq.input))
        if (parent !== null) toolsOfAgent.set(parent, [...(toolsOfAgent.get(parent) ?? []), tid])
        if (name === 'skill') {
          toolCalls.skills++
          const skill = str(args.skill).replace(/^\//, '')
          if (!skill) break
          skillCalls.push({ id: tid, ts, skill, error: false })
          skillsUsed.add(skill)
          if (sequence.at(-1) !== skill) sequence.push(skill)
          if (idx !== undefined) { signals[idx].skill = skillPhase(skill); messages[idx].skill = skill }
          if (parent === null) {
            current = { skill, ts, toolCalls: 0, toolErrors: 0, interrupted: false, linesEdited: 0, committed: false, start: i, toolIds: [] }
            windows.push(current)
          }
          break
        }
        const w = windowFor()
        if (w) {
          w.toolCalls++
          w.toolIds.push(tid)
          if (EDIT_TOOLS.has(name)) w.linesEdited += editedLines(name, args)
        }
        if (name === 'task') {
          descriptions.set(tid, str(args.description))
          if (idx !== undefined) spawnIdx.set(tid, idx)
          if (w) windowOfTask.set(tid, w)
        }
        if (server) {
          toolCalls.mcp++
          mcpCalls.push({ id: tid, ts, server, tool: mcpTool, error: false })
          mcpTools.set(server, (mcpTools.get(server) ?? new Set<string>()).add(mcpTool))
          if (MCP_COMMIT.test(mcpTool)) { commits++; commitAt.push(i) }
          break
        }
        toolCalls.builtin++
        builtinCalls.push({ id: tid, name })
        if (name === 'bash' && COMMIT.test(str(args.command))) { commits++; commitAt.push(i) }
        if (name === 'ask_user') questions++
        for (const { path: file } of targets) {
          edits++
          if (fileEdits[file]) reworkEdits++
          fileEdits[file] = (fileEdits[file] ?? 0) + 1
        }
        break
      }
      case 'tool.execution_complete': {
        const tid = str(d.toolCallId)
        if (!tid) break
        if (d.success === false) errorIds.add(tid)
        const st = toolStartTs.get(tid)
        if (st !== undefined && ts) { toolMs += Math.max(0, Date.parse(ts) - st); toolSpans++; toolStartTs.delete(tid) }
        break
      }
      case 'permission.completed': {
        const tid = str(d.toolCallId)
        if (tid && obj(d.result).kind === REJECTED) { rejectIds.add(tid); errorIds.add(tid) }
        break
      }
      case 'abort':
        if (d.reason === 'user_initiated') { interruptions++; if (current) current.interrupted = true }
        break
      case 'subagent.started': {
        const tid = str(d.toolCallId)
        if (tid && !runs.has(tid)) runs.set(tid, { agentType: str(d.agentName) || 'unknown', model: normalizeModel(str(d.model)) || 'unknown', startedAt: ts, durationMs: null, tokens: null })
        break
      }
      case 'subagent.completed': {
        const run = runs.get(str(d.toolCallId))
        if (run) { run.durationMs = numOrNull(d.durationMs); run.tokens = numOrNull(d.totalTokens) }
        break
      }
      case 'skill.invoked': {
        const name = str(d.name)
        if (name) { skills.add(name); skillsUsed.add(name) }
        break
      }
      case 'hook.end': {
        const type = str(d.hookType) || 'unknown'
        hooks.push({ event: type, name: type, contextChars: 0 })
        break
      }
      case 'session.compaction_complete': {
        const n = numOrNull(d.preCompactionTokens)
        if (n !== null) peaks.push(n)
        break
      }
      case 'session.shutdown': {
        shutdown = d
        shutdownTs = ts
        const n = numOrNull(d.currentTokens)
        if (n !== null) peaks.push(n)
        break
      }
    }
  })
  closeTurn()

  // Copilot only logs per-model totals at shutdown (cumulative, last wins): spread them over that model's messages by output tokens.
  const metrics = new Map<string, { fresh: number; out: number; cacheRead: number; cacheWrite: number }>()
  for (const [key, m] of Object.entries(obj(shutdown?.modelMetrics))) {
    const u = obj(obj(m).usage)
    const cacheRead = num(u.cacheReadTokens), cacheWrite = num(u.cacheWriteTokens)
    const acc = metrics.get(normalizeModel(key)) ?? { fresh: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
    acc.fresh += Math.max(0, num(u.inputTokens) - cacheRead - cacheWrite); acc.out += num(u.outputTokens)
    acc.cacheRead += cacheRead; acc.cacheWrite += cacheWrite
    metrics.set(normalizeModel(key), acc)
  }
  for (const [model, { fresh, out, cacheRead, cacheWrite }] of metrics) {
    let idxs = messages.flatMap((msg, i) => (msg.model === model ? [i] : []))
    if (idxs.length === 0) {
      idxs = [messages.length]
      models.add(model)
      messages.push({ ts: shutdownTs, model, tokens: zero(), costUsd: 0, sidechain: false, skill: null, phase: 'other', phaseSource: 'none', agentId: null, mcpServer: null, context: 0 })
      weights.push(1)
      signals.push({ skill: null, tool: null })
    }
    const sum = idxs.reduce((n, i) => n + weights[i], 0)
    for (const i of idxs) {
      const share = weights[i] / sum
      const t = messages[i].tokens
      t.input = fresh * share; t.output = out * share; t.cacheRead = cacheRead * share; t.cacheCreation = cacheWrite * share
      t.total = t.input + t.output + t.cacheRead + t.cacheCreation
    }
  }
  for (const m of messages) {
    m.context = m.tokens.input + m.tokens.cacheCreation + m.tokens.cacheRead
    m.costUsd = costOf(m.model, m.tokens) ?? 0
  }

  // Phases resolve per trace: the main conversation and each subagent separately.
  const groups = new Map<string | null, number[]>()
  messages.forEach((m, i) => groups.set(m.agentId, [...(groups.get(m.agentId) ?? []), i]))
  for (const idxs of groups.values()) resolvePhases(idxs.map(i => signals[i])).forEach((r, k) => {
    messages[idxs[k]].phase = r.phase
    messages[idxs[k]].phaseSource = r.source
  })

  const tokens = zero()
  for (const m of messages) {
    tokens.input += m.tokens.input; tokens.output += m.tokens.output
    tokens.cacheCreation += m.tokens.cacheCreation; tokens.cacheRead += m.tokens.cacheRead
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead

  const subagents: SubagentRun[] = [...runs].map(([tid, run]) => {
    const own = messages.filter(m => m.agentId === tid)
    const tools = toolsOfAgent.get(tid) ?? []
    const byPhase = new Map<Phase, number>()
    for (const m of own) byPhase.set(m.phase, (byPhase.get(m.phase) ?? 0) + 1)
    const spawn = spawnIdx.get(tid)
    return {
      agentId: tid, agentType: run.agentType, description: descriptions.get(tid) ?? '', model: run.model, toolUseId: tid,
      startedAt: run.startedAt, durationMs: run.durationMs,
      tokens: run.tokens ?? own.reduce((n, m) => n + m.tokens.total, 0),
      costUsd: own.reduce((n, m) => n + m.costUsd, 0),
      toolCalls: tools.length, toolErrors: tools.filter(t => errorIds.has(t)).length,
      phase: spawn !== undefined ? messages[spawn].phase : top(byPhase) ?? 'other',
    }
  })

  const parentMsgs = messages.filter(m => m.agentId === null)
  const phaseFlow: { from: Phase; to: Phase }[] = []
  let prev: Phase | null = null
  for (const m of parentMsgs) {
    if (m.phase === 'other') continue
    if (prev !== null && prev !== m.phase) phaseFlow.push({ from: prev, to: m.phase })
    prev = m.phase
  }
  const toolStats: Record<string, ToolStat> = {}
  for (const call of builtinCalls) {
    const st = toolStats[call.name] ??= { calls: 0, errors: 0, rejections: 0 }
    st.calls++
    if (errorIds.has(call.id)) st.errors++
    if (rejectIds.has(call.id)) st.rejections++
  }
  const changes = obj(shutdown?.codeChanges)
  const contexts = [...parentMsgs.map(m => m.context), ...peaks]
  const span = Date.parse(lastTs) - Date.parse(startedAt)
  const servers = [...mcpTools.keys()].sort()
  const title = str(ws.name).trim() || (firstText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || fb.id
  const summary: SessionSummary = {
    id: fb.id, agent: 'copilot', project: cwd ?? (str(ws.cwd) || fb.id), title, startedAt,
    models: [...models].sort(), userTurns: turnTimes.length, toolCalls,
    toolRatio: turnTimes.length ? toolCalls.total / turnTimes.length : null,
    tokens, costUsd: shutdown ? messages.reduce((n, m) => n + m.costUsd, 0) : null,
    skills: [...new Set([...skills, ...skillsUsed])].sort(), mcpServers: servers,
    skillsUsed: [...skillsUsed].sort(), mcpServersUsed: servers,
    agentTypes: [...new Set(subagents.map(s => s.agentType))].sort(),
    durationMs: Number.isNaN(span) ? null : span,
    linesAdded: shutdown ? numOrNull(changes.linesAdded) : null, linesRemoved: shutdown ? numOrNull(changes.linesRemoved) : null,
    entrypoint: fb.vscode ? 'vscode' : 'cli', gitBranch: top(branches), version, effort: top(efforts), permissionMode: null,
    commits, interruptions, questions, rejections: rejectIds.size, toolErrors: errorIds.size,
    peakContext: contexts.length ? Math.max(...contexts) : null, turnMs,
    apiMs: shutdown ? numOrNull(shutdown.totalApiDurationMs) : null, toolMs: toolSpans ? toolMs : null, retryMs: null,
    edits, filesEdited: Object.keys(fileEdits).length, reworkEdits,
  }
  return {
    summary, messages, turnTimes,
    skillCalls: skillCalls.map(({ id, ...s }) => ({ ...s, error: errorIds.has(id) })),
    mcpCalls: mcpCalls.map(({ id, ...m }) => ({ ...m, error: errorIds.has(id) })),
    mcpTools: Object.fromEntries([...mcpTools].map(([k, v]) => [k, [...v].sort()])),
    subagents,
    skillWindows: windows.map(({ start, toolIds, ...w }) => ({ ...w, toolErrors: toolIds.filter(t => errorIds.has(t)).length, committed: commitAt.some(c => c >= start) })),
    skillSequence: sequence, skillListingChars: {},
    toolStats, hooks, fileEdits, phaseFlow,
  }
}

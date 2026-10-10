import type { Phase, SessionSummary, ToolCalls, TokenUsage } from '../shared/types.ts'
import type { HookRun, MessageEvent, SkillCall, ToolStat, McpCall, SessionRecord, SkillWindow, SubagentInput, SubagentRun } from './record.ts'
import { resolvePhases, skillPhase, strongest, toolPhase } from './phase.ts'
import type { PhaseSignals } from './phase.ts'
import { normalizeModel } from './modelName.ts'

export function parseLines(text: string): any[] {
  const out: any[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* partial or corrupt line */ }
  }
  return out
}

export const mcpServerOf = (toolName: string): string | null =>
  toolName.startsWith('mcp__') ? toolName.slice(5).split('__')[0] || null : null

const HARNESS_PREFIXES = ['<task-notification>', '<local-command-stdout>', '<local-command-stderr>', '<bash-stdout>', '<bash-stderr>', '[Request interrupted by user']
const AUTH_TOOL = /^mcp__.+__(authenticate|complete_authentication)$/

const rawText = (l: any): string => {
  const c = l.message?.content
  if (typeof c === 'string') return c
  return Array.isArray(c) ? (c.find((b: any) => b?.type === 'text')?.text ?? '') : ''
}

export function isUserTurn(l: any): boolean {
  if (l.type !== 'user' || l.isMeta === true || l.isSidechain === true) return false
  if (l.origin?.kind != null && l.origin.kind !== 'human') return false
  const c = l.message?.content
  if (typeof c !== 'string' && !(Array.isArray(c) && c.some((b: any) => b?.type === 'text') && !c.some((b: any) => b?.type === 'tool_result'))) return false
  const t = rawText(l).trim()
  return t.length > 0 && !HARNESS_PREFIXES.some(p => t.startsWith(p))
}

export function userTurnText(l: any): string {
  const c = l.message?.content
  const t = typeof c === 'string' ? c : c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ')
  const tag = (n: string) => t.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]
  const name = tag('command-name')
  if (name != null) return `${name.trim()} ${(tag('command-args') ?? '').trim()}`.trim()
  const bash = tag('bash-input')
  if (bash != null) return `! ${bash.trim()}`
  return t
}

export const costWeight = (t: TokenUsage): number => t.input + 5 * t.output + 1.25 * t.cacheCreation + 0.1 * t.cacheRead

export function parseSession(parent: any[], subagents: any[][], fallback: { id: string; projectDir: string }, subInfo: SubagentInput[] = []): SessionSummary | null {
  return parseRecord(parent, subagents, fallback, subInfo)?.summary ?? null
}

const LISTING_LINE = /^- (\S+?)(?: \([^)\n]*\))?:?(?: |$)/
const lineCount = (v: unknown): number => (typeof v === 'string' && v ? v.split('\n').length : 0)

function editedLines(name: string, input: any): number {
  if (name === 'Write') return lineCount(input?.content)
  if (name === 'Edit') return lineCount(input?.new_string)
  if (name === 'MultiEdit') return (Array.isArray(input?.edits) ? input.edits : []).reduce((n: number, e: any) => n + lineCount(e?.new_string), 0)
  return 0
}

const skillName = (input: any): string => (typeof input?.skill === 'string' ? input.skill.replace(/^\//, '') : '')

const toolBlocks = (l: any): any[] => (l.type === 'assistant' && Array.isArray(l.message?.content) ? l.message.content.filter((b: any) => b?.type === 'tool_use') : [])
const COMMIT = /\bgit commit\b/
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const REJECTION_PREFIXES = ["The user doesn't want to proceed with this tool use", 'Permission for this action was denied']
const INTERRUPTED = '[Request interrupted by user'
const resultText = (b: any): string => {
  const c = b?.content
  if (typeof c === 'string') return c
  return Array.isArray(c) ? c.filter((x: any) => x?.type === 'text' && typeof x.text === 'string').map((x: any) => x.text).join('\n') : ''
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bump = (m: Map<string, number>, k: unknown) => { if (typeof k === 'string' && k) m.set(k, (m.get(k) ?? 0) + 1) }

type FileWindow = SkillWindow & { toolIds: string[]; agentIds: string[] }

// One file is one trace: in a subagent file (sidechain) no line is a human turn, so windows end only at the next Skill or end of file.
function fileWindows(lines: any[], invoked: Set<string>, sidechain: boolean, seen: Set<string>): { windows: FileWindow[]; sequence: string[] } {
  const all: (FileWindow & { start: number })[] = []
  const commits: number[] = []
  const sequence: string[] = []
  let cur: FileWindow | null = null
  const open = (skill: string, ts: string | null, start: number) => {
    const w = { skill, ts, toolCalls: 0, toolErrors: 0, interrupted: false, linesEdited: 0, committed: false, start, toolIds: [], agentIds: [] }
    all.push(w)
    cur = w
  }
  lines.forEach((l, i) => {
    const ts = typeof l.timestamp === 'string' ? l.timestamp : null
    if (l.type === 'user') {
      if (!sidechain && isUserTurn(l)) cur = null
      else if (cur && rawText(l).trim().startsWith('[Request interrupted by user')) cur.interrupted = true
      return
    }
    if (l.type !== 'assistant') return
    const attr = typeof l.attributionSkill === 'string' && l.attributionSkill ? l.attributionSkill : null
    if (attr && !invoked.has(attr) && cur?.skill !== attr) open(attr, ts, i)
    for (const b of toolBlocks(l)) {
      if (typeof b.id === 'string') { if (seen.has(b.id)) continue; seen.add(b.id) }
      if (b.name === 'Bash' && COMMIT.test(typeof b.input?.command === 'string' ? b.input.command : '')) commits.push(i)
      if (b.name === 'Skill') {
        const name = skillName(b.input)
        if (!name) continue
        if (sequence.at(-1) !== name) sequence.push(name)
        open(name, ts, i)
        continue
      }
      if (!cur) continue
      const w: FileWindow = cur
      w.toolCalls++
      if (typeof b.id === 'string') w.toolIds.push(b.id)
      w.linesEdited += editedLines(b.name, b.input)
      if ((b.name === 'Agent' || b.name === 'Task') && typeof b.id === 'string') w.agentIds.push(b.id)
    }
  })
  return { windows: all.map(({ start, ...w }) => ({ ...w, committed: commits.some(c => c >= start) })), sequence }
}

export function parseRecord(parent: any[], subagents: any[][], fallback: { id: string; projectDir: string }, subInfo: SubagentInput[] = []): SessionRecord | null {
  const startedAt = parent.find(l => l.timestamp)?.timestamp
  if (!startedAt) return null
  const project = parent.find(l => l.cwd)?.cwd ?? fallback.projectDir

  const models = new Set<string>()
  const skills = new Set<string>()
  const mcpServers = new Set<string>()
  const usedServers = new Set<string>()
  const needsAuth = new Set<string>()
  const seenMessages = new Set<string>()
  const seenToolIds = new Set<string>()
  const tokens: TokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }
  const toolCalls: ToolCalls = { total: 0, skills: 0, mcp: 0, builtin: 0 }
  let userTurns = 0
  let firstTurnText = null as string | null
  let aiTitle = null as string | null
  let costUsd = null as number | null
  const messages: MessageEvent[] = []
  const turnTimes: string[] = []
  const skillCalls: (SkillCall & { id?: string })[] = []
  const mcpCalls: (McpCall & { id?: string })[] = []
  const mcpTools = new Map<string, Set<string>>()
  const skillsUsed = new Set<string>()
  const errorIds = new Set<string>()
  const listingChars: Record<string, number> = {}
  let lastCost: any = null
  const toolOf = (name: string, server: string) => name.slice(5 + server.length + 2)
  const signals: PhaseSignals[] = []
  const msgIndex = new Map<string, number>()
  const agentDescriptions = new Map<string, string>()
  const spawnIdx = new Map<string, number>()
  const sess = { entrypoint: null as string | null, version: null as string | null, branch: new Map<string, number>(), effort: new Map<string, number>(), mode: new Map<string, number>() }
  const rejectIds = new Set<string>()
  const builtinCalls: { id: string | null; name: string }[] = []
  const hooks: HookRun[] = []
  const fileEdits: Record<string, number> = {}
  const turnMs: number[] = []
  let commits = 0, questions = 0, interruptions = 0, edits = 0, reworkEdits = 0
  interface FileStats { toolIds: string[]; firstTs: string | null; lastTs: string | null; attrAgent: string | null }

  const scan = (lines: any[], isParent: boolean, agentId: string | null): FileStats => {
    const stats: FileStats = { toolIds: [], firstTs: null, lastTs: null, attrAgent: null }
    for (const l of lines) {
      if (l.type === 'user' && Array.isArray(l.message?.content)) for (const b of l.message.content) if (b?.type === 'tool_result' && b.is_error === true && typeof b.tool_use_id === 'string') {
        errorIds.add(b.tool_use_id)
        const t = resultText(b)
        if (REJECTION_PREFIXES.some(p => t.startsWith(p))) rejectIds.add(b.tool_use_id)
      }
      if (isParent) {
        if (typeof l.entrypoint === 'string' && l.entrypoint) sess.entrypoint ??= l.entrypoint
        if (typeof l.version === 'string' && l.version) sess.version = l.version
        bump(sess.branch, l.gitBranch)
        if (l.type === 'assistant') bump(sess.effort, l.effort)
        if (l.type === 'user' || l.type === 'permission-mode') bump(sess.mode, l.permissionMode)
      }
      const ts = typeof l.timestamp === 'string' ? l.timestamp : null
      if (ts) { stats.firstTs ??= ts; stats.lastTs = ts }
      if (typeof l.attributionAgent === 'string' && l.attributionAgent) stats.attrAgent ??= l.attributionAgent
      if (l.type === 'assistant') {
        const m = l.message
        const model = typeof m?.model === 'string' && m.model !== '<synthetic>' ? normalizeModel(m.model) : null
        if (model) models.add(model)
        const attr = typeof l.attributionSkill === 'string' && l.attributionSkill ? l.attributionSkill : null
        if (attr) skillsUsed.add(attr)
        if (m?.id && !seenMessages.has(m.id)) {
          seenMessages.add(m.id)
          const u = m.usage ?? {}
          tokens.input += u.input_tokens ?? 0
          tokens.output += u.output_tokens ?? 0
          tokens.cacheCreation += u.cache_creation_input_tokens ?? 0
          tokens.cacheRead += u.cache_read_input_tokens ?? 0
          if (model) {
            const t: TokenUsage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, total: 0 }
            t.total = t.input + t.output + t.cacheCreation + t.cacheRead
            msgIndex.set(m.id, messages.length)
            const mcpServer = typeof l.attributionMcpServer === 'string' && l.attributionMcpServer ? l.attributionMcpServer : null
            messages.push({ ts, model, provider: null, tokens: t, costUsd: 0, sidechain: !isParent, skill: attr, phase: 'other', phaseSource: 'none', agentId, mcpServer, context: t.input + t.cacheCreation + t.cacheRead })
            signals.push({ skill: null, tool: null })
          }
        }
        const idx = m?.id ? msgIndex.get(m.id) : undefined
        if (idx !== undefined && attr) signals[idx].skill ??= skillPhase(attr)
        for (const b of Array.isArray(m?.content) ? m.content : []) {
          if (b?.type !== 'tool_use') continue
          if (b.id != null) {
            if (seenToolIds.has(b.id)) continue
            seenToolIds.add(b.id)
          }
          toolCalls.total++
          if (typeof b.id === 'string') stats.toolIds.push(b.id)
          const input = typeof b.input === 'object' && b.input !== null ? b.input : {}
          if (idx !== undefined) signals[idx].tool = strongest(signals[idx].tool, toolPhase(b.name, input))
          if ((b.name === 'Agent' || b.name === 'Task') && typeof b.id === 'string') {
            if (typeof input.description === 'string') agentDescriptions.set(b.id, input.description)
            if (idx !== undefined) spawnIdx.set(b.id, idx)
          }
          const server = mcpServerOf(b.name)
          if (b.name === 'Skill') {
            toolCalls.skills++
            const name = typeof b.input?.skill === 'string' ? b.input.skill.replace(/^\//, '') : ''
            if (name) { skillCalls.push({ id: b.id, ts, skill: name, error: false }); skillsUsed.add(name) }
          }
          else if (server) {
            toolCalls.mcp++
            if (!AUTH_TOOL.test(b.name)) {
              mcpServers.add(server); usedServers.add(server)
              mcpCalls.push({ id: b.id, ts, server, tool: toolOf(b.name, server), error: false })
            }
          }
          else {
            toolCalls.builtin++
            builtinCalls.push({ id: typeof b.id === 'string' ? b.id : null, name: b.name })
            if (b.name === 'Bash' && COMMIT.test(typeof input.command === 'string' ? input.command : '')) commits++
            if (b.name === 'AskUserQuestion') questions++
            const file = EDIT_TOOLS.has(b.name) ? (input.file_path ?? input.notebook_path) : undefined
            if (typeof file === 'string' && file) {
              edits++
              if (fileEdits[file]) reworkEdits++
              fileEdits[file] = (fileEdits[file] ?? 0) + 1
            }
          }
        }
      } else if (l.type === 'attachment') {
        const a = l.attachment
        if (a?.type === 'skill_listing' && typeof a.content === 'string') {
          for (const line of a.content.split('\n')) {
            const match = line.match(LISTING_LINE)
            if (!match) continue
            skills.add(match[1])
            if (isParent) listingChars[match[1]] = line.length
          }
        } else if (a?.type === 'hook_success' || a?.type === 'hook_additional_context') {
          const text = a.type === 'hook_success' ? a.stdout : Array.isArray(a.content) ? a.content.join('\n') : a.content
          hooks.push({ event: str(a.hookEvent) || 'unknown', name: str(a.hookName) || 'unknown', contextChars: typeof text === 'string' ? text.length : 0 })
        } else if (a?.type === 'mcp_instructions_delta') {
          for (const n of a.addedNames ?? []) mcpServers.add(n)
        } else if (a?.type === 'deferred_tools_delta') {
          for (const n of a.addedNames ?? []) {
            const s = AUTH_TOOL.test(n) ? null : mcpServerOf(n)
            if (!s) continue
            mcpServers.add(s)
            if (!mcpTools.has(s)) mcpTools.set(s, new Set())
            mcpTools.get(s)!.add(toolOf(n, s))
          }
          for (const n of a.needsAuthMcpServers ?? []) if (typeof n === 'string') needsAuth.add(n.replace(/[^A-Za-z0-9]/g, '_'))
        }
      } else if (isParent) {
        if (isUserTurn(l)) {
          userTurns++
          if (ts) turnTimes.push(ts)
          firstTurnText ??= userTurnText(l)
        } else if (l.type === 'user' && rawText(l).trim().startsWith(INTERRUPTED)) interruptions++
        else if (l.type === 'system' && l.subtype === 'turn_duration') { if (typeof l.durationMs === 'number') turnMs.push(l.durationMs) }
        else if (l.type === 'ai-title') { if (typeof l.aiTitle === 'string' && l.aiTitle) aiTitle = l.aiTitle }
        else if (l.type === 'cost-state') { if (typeof l.totalCostUSD === 'number') { costUsd = l.totalCostUSD; lastCost = l } }
      }
    }
    return stats
  }
  const scanFile = (lines: any[], isParent: boolean, agentId: string | null): FileStats => {
    const start = messages.length
    const stats = scan(lines, isParent, agentId)
    resolvePhases(signals.slice(start)).forEach((r, i) => { messages[start + i].phase = r.phase; messages[start + i].phaseSource = r.source })
    return stats
  }
  const agentIdOf = (i: number): string =>
    subInfo[i]?.agentId ?? subagents[i].find((l: any) => typeof l.agentId === 'string')?.agentId ?? `sub-${i}`
  scanFile(parent, true, null)
  const subStats = subagents.map((sub, i) => scanFile(sub, false, agentIdOf(i)))

  const flag = <T extends { id?: string }>({ id, ...rest }: T) => ({ ...rest, error: id != null && errorIds.has(id) })
  const usdOf = new Map<string, number>()
  for (const [key, u] of Object.entries<any>(lastCost?.modelUsage ?? {})) {
    if (typeof u?.costUSD !== 'number') continue
    const model = normalizeModel(key.replace(/\[[^\]]*\]$/, ''))
    usdOf.set(model, (usdOf.get(model) ?? 0) + u.costUSD)
  }
  const weightOf = new Map<string, number>()
  for (const msg of messages) weightOf.set(msg.model, (weightOf.get(msg.model) ?? 0) + costWeight(msg.tokens))
  for (const msg of messages) {
    const usd = usdOf.get(msg.model), w = weightOf.get(msg.model) ?? 0
    msg.costUsd = typeof usd === 'number' && w > 0 ? usd * costWeight(msg.tokens) / w : 0
  }
  const top = <K>(m: Map<K, number>): K | null => {
    let best: K | null = null
    let bv = -Infinity
    for (const [k, v] of m) if (v > bv) { best = k; bv = v }
    return best
  }
  const byAgent = new Map<string, MessageEvent[]>()
  for (const m of messages) if (m.agentId !== null) {
    const list = byAgent.get(m.agentId)
    if (list) list.push(m)
    else byAgent.set(m.agentId, [m])
  }
  const subagentRuns: SubagentRun[] = subagents.map((_, i) => {
    const agentId = agentIdOf(i)
    const meta = subInfo[i]?.meta ?? null
    const st = subStats[i]
    const own = byAgent.get(agentId) ?? []
    const weigh = own.some(m => m.costUsd > 0) ? (m: MessageEvent) => m.costUsd : () => 1
    const byPhase = new Map<Phase, number>()
    const byModel = new Map<string, number>()
    for (const m of own) {
      byPhase.set(m.phase, (byPhase.get(m.phase) ?? 0) + weigh(m))
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + weigh(m))
    }
    const toolUseId = str(meta?.toolUseId) || null
    const spawnedBy = toolUseId === null ? undefined : spawnIdx.get(toolUseId)
    const span = st.firstTs && st.lastTs ? Date.parse(st.lastTs) - Date.parse(st.firstTs) : NaN
    return {
      agentId,
      agentType: str(meta?.agentType) || st.attrAgent || 'unknown',
      description: str(meta?.description) || (toolUseId ? agentDescriptions.get(toolUseId) ?? '' : ''),
      model: top(byModel) ?? (normalizeModel(str(meta?.model)) || 'unknown'),
      toolUseId, startedAt: st.firstTs, durationMs: Number.isNaN(span) ? null : span,
      tokens: own.reduce((n, m) => n + m.tokens.total, 0),
      costUsd: own.reduce((n, m) => n + m.costUsd, 0),
      toolCalls: st.toolIds.length, toolErrors: st.toolIds.filter(id => errorIds.has(id)).length,
      phase: spawnedBy !== undefined ? messages[spawnedBy].phase : top(byPhase) ?? 'other',
    }
  })
  const invoked = new Set([parent, ...subagents].flatMap(ls => ls.flatMap(l => toolBlocks(l).filter(b => b.name === 'Skill').map(b => skillName(b.input)))).filter(Boolean))
  // Shared across files: forked subagents replay parent history with the same tool_use ids.
  const seenTools = new Set<string>()
  const { windows: parentWindows, sequence } = fileWindows(parent, invoked, false, seenTools)
  const subWindows = subagents.map(sub => fileWindows(sub, invoked, true, seenTools).windows)
  // A window absorbs the subagents it spawned, minus the tool calls already counted in their own skill windows.
  const finish = ({ toolIds, agentIds, ...w }: FileWindow): SkillWindow => {
    let toolCalls = w.toolCalls
    let toolErrors = w.toolErrors + toolIds.filter(id => errorIds.has(id)).length
    subagentRuns.forEach((run, i) => {
      if (!run.toolUseId || !agentIds.includes(run.toolUseId)) return
      const covered = new Set(subWindows[i].flatMap(sw => sw.toolIds))
      const rest = subStats[i].toolIds.filter(id => !covered.has(id))
      toolCalls += rest.length
      toolErrors += rest.filter(id => errorIds.has(id)).length
    })
    return { ...w, toolCalls, toolErrors }
  }
  const windows = [...parentWindows, ...subWindows.flat()].map(finish)
  for (const n of skillsUsed) skills.add(n)
  const num = (v: unknown) => (typeof v === 'number' ? v : null)

  for (const n of needsAuth) if (!usedServers.has(n)) mcpServers.delete(n)
  tokens.total = tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead
  const title = aiTitle ?? (firstTurnText?.replace(/\s+/g, ' ').trim().slice(0, 120) || fallback.id)
  const parentMsgs = messages.filter(m => m.agentId === null)
  const phaseFlow: { from: Phase; to: Phase }[] = []
  let prevPhase: Phase | null = null
  for (const m of parentMsgs) {
    if (m.phase === 'other') continue
    if (prevPhase !== null && prevPhase !== m.phase) phaseFlow.push({ from: prevPhase, to: m.phase })
    prevPhase = m.phase
  }
  const toolStats: Record<string, ToolStat> = {}
  for (const c of builtinCalls) {
    const st = toolStats[c.name] ??= { calls: 0, errors: 0, rejections: 0 }
    st.calls++
    if (c.id !== null && errorIds.has(c.id)) st.errors++
    if (c.id !== null && rejectIds.has(c.id)) st.rejections++
  }
  const branch = top(new Map([...sess.branch].filter(([k]) => k !== 'HEAD'))) ?? (sess.branch.has('HEAD') ? 'HEAD' : null)
  const apiMs = num(lastCost?.totalAPIDuration), apiNoRetry = num(lastCost?.totalAPIDurationWithoutRetries)
  const summary = {
    id: fallback.id, agent: 'claude-code' as const, project, title, startedAt,
    models: [...models].sort(), providers: [], userTurns, toolCalls,
    toolRatio: userTurns ? toolCalls.total / userTurns : null,
    tokens, costUsd, skills: [...skills].sort(), mcpServers: [...mcpServers].sort(),
    skillsUsed: [...skillsUsed].sort(), mcpServersUsed: [...usedServers].sort(),
    agentTypes: [...new Set(subagentRuns.map(r => r.agentType))].sort(),
    durationMs: num(lastCost?.totalDuration), linesAdded: num(lastCost?.totalLinesAdded), linesRemoved: num(lastCost?.totalLinesRemoved),
    entrypoint: sess.entrypoint, gitBranch: branch, version: sess.version, effort: top(sess.effort), permissionMode: top(sess.mode),
    commits, interruptions, questions, rejections: rejectIds.size, toolErrors: errorIds.size,
    peakContext: parentMsgs.length ? Math.max(...parentMsgs.map(m => m.context)) : null, turnMs,
    apiMs, toolMs: num(lastCost?.totalToolDuration), retryMs: apiMs !== null && apiNoRetry !== null ? Math.max(0, apiMs - apiNoRetry) : null,
    edits, filesEdited: Object.keys(fileEdits).length, reworkEdits,
  }
  return {
    summary, messages, turnTimes,
    skillCalls: skillCalls.map(flag), mcpCalls: mcpCalls.map(flag),
    mcpTools: Object.fromEntries([...mcpTools].map(([k, v]) => [k, [...v].sort()])),
    subagents: subagentRuns,
    skillWindows: windows, skillSequence: sequence, skillListingChars: listingChars,
    toolStats, hooks, fileEdits, phaseFlow,
  }
}

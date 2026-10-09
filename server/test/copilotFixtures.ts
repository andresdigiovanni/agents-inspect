const T0 = Date.parse('2026-10-01T10:00:00.000Z')
export const T = (s: number): string => new Date(T0 + s * 1000).toISOString()
let n = 0
export const ev = (type: string, data: object, ts: string = T(0)) => ({ type, data, id: `e${++n}`, timestamp: ts, parentId: null })

export const start = (o: { id?: string; cwd?: string; branch?: string; model?: string; effort?: string; version?: string; ts?: string } = {}) =>
  ev('session.start', { sessionId: o.id ?? 'c1', copilotVersion: o.version ?? '1.0.92', startTime: o.ts ?? T(0), selectedModel: o.model ?? 'claude-sonnet-5',
    reasoningEffort: o.effort ?? 'medium', context: { cwd: o.cwd ?? '/repo/demo', branch: o.branch ?? 'main' } }, o.ts)
export const modelChange = (model: string, effort: string, ts?: string) => ev('session.model_change', { newModel: model, reasoningEffort: effort }, ts)
export const user = (content: string, ts?: string) => ev('user.message', { content }, ts)
export const assistant = (o: { model?: string; out?: number; tools?: string[]; parent?: string; content?: string; ts?: string } = {}) =>
  ev('assistant.message', { messageId: `m${++n}`, model: o.model ?? 'claude-sonnet-5', content: o.content ?? '', outputTokens: o.out ?? 0,
    toolRequests: (o.tools ?? []).map(id => ({ toolCallId: id, name: 'x', arguments: {} })), ...(o.parent ? { parentToolCallId: o.parent } : {}) }, o.ts)
export const turnEnd = (ts?: string) => ev('assistant.turn_end', { turnId: '0' }, ts)
export const toolStart = (id: string, name: string, args: object = {}, o: { parent?: string; mcpServer?: string; mcpTool?: string; ts?: string } = {}) =>
  ev('tool.execution_start', { toolCallId: id, toolName: name, arguments: args, ...(o.parent ? { parentToolCallId: o.parent } : {}),
    ...(o.mcpServer ? { mcpServerName: o.mcpServer, mcpToolName: o.mcpTool ?? name } : {}) }, o.ts)
export const toolDone = (id: string, o: { ok?: boolean; result?: string; error?: string; parent?: string; ts?: string } = {}) =>
  ev('tool.execution_complete', { toolCallId: id, success: o.ok ?? true,
    ...(o.ok === false ? { error: { message: o.error ?? 'boom', code: 'failure' } } : { result: { content: o.result ?? 'ok' } }),
    ...(o.parent ? { parentToolCallId: o.parent } : {}) }, o.ts)
/** An assistant message requesting one tool, then the tool's start and complete events. */
export const call = (id: string, name: string, args: object = {}, o: { ok?: boolean; parent?: string; mcpServer?: string; mcpTool?: string; model?: string; out?: number } = {}) =>
  [assistant({ tools: [id], parent: o.parent, model: o.model, out: o.out }), toolStart(id, name, args, o), toolDone(id, { ok: o.ok, parent: o.parent })]
export const permission = (toolCallId: string, kind: string) => ev('permission.completed', { requestId: `r${++n}`, toolCallId, result: { kind } })
export const abort = () => ev('abort', { reason: 'user_initiated' })
export const subStart = (toolCallId: string, agentName: string, model: string, ts?: string) => ev('subagent.started', { toolCallId, agentName, model }, ts)
export const subDone = (toolCallId: string, o: { tokens: number; durationMs: number; toolCalls: number }) =>
  ev('subagent.completed', { toolCallId, totalTokens: o.tokens, durationMs: o.durationMs, totalToolCalls: o.toolCalls })
export const skillInvoked = (name: string) => ev('skill.invoked', { name })
export const hookEnd = (hookType: string) => ev('hook.end', { hookInvocationId: `h${++n}`, hookType, success: true })
export const compaction = (preCompactionTokens: number) => ev('session.compaction_complete', { success: true, preCompactionTokens })
export interface Usage { input: number; output: number; cacheRead?: number; cacheWrite?: number }
/** `input` is the fresh part; the event's inputTokens includes cache reads and writes, like the real log. */
export const shutdown = (metrics: Record<string, Usage>, o: { apiMs?: number; added?: number; removed?: number; currentTokens?: number; ts?: string } = {}) =>
  ev('session.shutdown', { shutdownType: 'routine', totalApiDurationMs: o.apiMs ?? 0, currentTokens: o.currentTokens ?? 0,
    codeChanges: { linesAdded: o.added ?? 0, linesRemoved: o.removed ?? 0, filesModified: [] },
    modelMetrics: Object.fromEntries(Object.entries(metrics).map(([m, u]) => [m, { usage: {
      inputTokens: u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), outputTokens: u.output, cacheReadTokens: u.cacheRead ?? 0, cacheWriteTokens: u.cacheWrite ?? 0 } }])) }, o.ts)
export const FB = { id: 'c1', workspace: null, vscode: false }

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
let n = 0
const ts0 = '2026-10-01T10:00:00.000Z'
const base = (o: { ts?: string; sidechain?: boolean; cwd?: string } = {}) => ({
  uuid: `u${++n}`, timestamp: o.ts ?? ts0, isSidechain: o.sidechain ?? false, cwd: o.cwd ?? '/repo/demo', sessionId: 's1',
})
export function assistant(o: { id: string; model?: string; usage?: Record<string, number>; tools?: { id: string; name: string; input?: object }[]; text?: string; ts?: string; sidechain?: boolean; attrSkill?: string }) {
  const content: object[] = []
  if (o.text) content.push({ type: 'text', text: o.text })
  for (const t of o.tools ?? []) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input ?? {} })
  return { ...base(o), type: 'assistant', message: { id: o.id, model: o.model ?? 'claude-opus-5-5', role: 'assistant', content,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...o.usage } },
    ...(o.attrSkill ? { attributionSkill: o.attrSkill } : {}) }
}
export function userText(text: string, o: { ts?: string; isMeta?: boolean; cwd?: string; sidechain?: boolean; origin?: string } = {}) {
  return { ...base(o), type: 'user', ...(o.isMeta ? { isMeta: true } : {}), ...(o.origin ? { origin: { kind: o.origin } } : {}), message: { role: 'user', content: text } }
}
export function toolResult(toolUseId: string, o: { ts?: string; error?: boolean; sidechain?: boolean; text?: string } = {}) {
  return { ...base(o), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: o.text ?? 'ok', ...(o.error ? { is_error: true } : {}) }] } }
}
const att = (attachment: object) => ({ ...base(), type: 'attachment', attachment })
export const skillListing = (names: string[]) => att({ type: 'skill_listing', content: names.map(s => `- ${s}: does ${s}`).join('\n') })
export const mcpDelta = (servers: string[]) => att({ type: 'mcp_instructions_delta', addedNames: servers, addedBlocks: [] })
export const deferredDelta = (names: string[], needsAuthMcpServers?: string[]) => att({ type: 'deferred_tools_delta', addedNames: names, ...(needsAuthMcpServers ? { needsAuthMcpServers } : {}) })
export const aiTitle = (t: string) => ({ type: 'ai-title', aiTitle: t, sessionId: 's1' })
export const costState = (usd: number, extra: object = {}) => ({ type: 'cost-state', sessionId: 's1', totalCostUSD: usd, ...extra })
export const jsonl = (lines: object[]) => lines.map(l => JSON.stringify(l)).join('\n') + '\n'
export async function makeProjectsDir(tree: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agents-inspect-'))
  for (const [rel, content] of Object.entries(tree)) {
    const p = join(dir, rel)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, content)
  }
  return dir
}
export const turnDuration = (ms: number) => ({ ...base(), type: 'system', subtype: 'turn_duration', durationMs: ms })
export const permissionMode = (mode: string) => ({ type: 'permission-mode', permissionMode: mode, sessionId: 's1' })
export const hookSuccess = (hookEvent: string, hookName: string, stdout: string) => att({ type: 'hook_success', hookEvent, hookName, stdout })
export const hookContext = (hookEvent: string, hookName: string, content: string | string[]) => att({ type: 'hook_additional_context', hookEvent, hookName, content })

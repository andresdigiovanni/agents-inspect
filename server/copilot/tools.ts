// Maps a Copilot CLI tool call to the Claude Code tool it mirrors, so phase heuristics (server/phase.ts) apply unchanged.
const RENAME: Record<string, string> = { view: 'Read', grep: 'Grep', rg: 'Grep', glob: 'Glob', web_fetch: 'WebFetch', web_search: 'WebSearch' }
const EDIT: Record<string, string> = { edit: 'Edit', str_replace: 'Edit', apply_patch: 'Edit', create: 'Write' }

export function claudeEquivalent(name: string, args: Record<string, unknown>, mcp: { server: string; tool: string } | null): { name: string; input: Record<string, unknown> } {
  if (mcp) return { name: `mcp__${mcp.server}__${mcp.tool}`, input: args }
  if (name === 'bash') return { name: 'Bash', input: { command: args.command } }
  if (name === 'task') return { name: 'Task', input: { description: args.description } }
  if (EDIT[name]) return { name: EDIT[name], input: { file_path: args.path } }
  return { name: RENAME[name] ?? name, input: args }
}

const PATCH_HEADER = /^\*\*\* (Update|Add) File: (.+?)\s*$/gm
const patchText = (raw: unknown): string => {
  if (typeof raw === 'string') return raw
  const o = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return typeof o.input === 'string' ? o.input : typeof o.patch === 'string' ? o.patch : ''
}

// Files a tool call writes to. apply_patch carries a raw patch whose Update/Add headers name the files (Delete is ignored).
export function editTargets(name: string, raw: unknown): { tool: 'edit' | 'create'; path: string }[] {
  const args = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (name === 'apply_patch' && patchText(raw)) {
    return [...patchText(raw).matchAll(PATCH_HEADER)].map(m => ({ tool: m[1] === 'Add' ? 'create' as const : 'edit' as const, path: m[2] }))
  }
  if (!EDIT[name] || typeof args.path !== 'string' || !args.path) return []
  return [{ tool: name === 'create' ? 'create' : 'edit', path: args.path }]
}

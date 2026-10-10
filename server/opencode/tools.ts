// Maps an opencode tool call to the Claude Code tool it mirrors, so phase heuristics (server/phase.ts) apply unchanged.
const RENAME: Record<string, string> = { read: 'Read', grep: 'Grep', glob: 'Glob', webfetch: 'WebFetch', websearch: 'WebSearch', todowrite: 'TodoWrite', question: 'AskUserQuestion' }
const EDIT: Record<string, string> = { edit: 'Edit', write: 'Write' }

// Tools opencode ships itself; anything else is a custom/MCP tool, grouped by the segment before the first underscore.
export const BUILTIN_TOOLS = new Set(['bash', 'read', 'edit', 'write', 'glob', 'grep', 'webfetch', 'websearch', 'todowrite', 'skill', 'task', 'question', 'invalid'])

export function claudeEquivalent(name: string, args: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  if (name === 'bash') return { name: 'Bash', input: { command: args.command } }
  if (name === 'task') return { name: 'Task', input: { description: args.description } }
  if (EDIT[name]) return { name: EDIT[name], input: { file_path: args.filePath ?? args.path } }
  if (!BUILTIN_TOOLS.has(name)) return { name: `mcp__${mcpServerOf(name)}__${name}`, input: args }
  return { name: RENAME[name] ?? name, input: args }
}

export function mcpServerOf(name: string): string {
  const i = name.indexOf('_')
  return i > 0 ? name.slice(0, i) : name
}

// Files a builtin tool call writes to.
export function editTargets(name: string, input: Record<string, unknown>): string[] {
  const p = input.filePath ?? input.path
  return (name === 'edit' || name === 'write') && typeof p === 'string' && p ? [p] : []
}

import type { Phase, PhaseSource } from '../shared/types.ts'

export const PHASES: readonly Phase[] = ['explore', 'plan', 'implement', 'test', 'review', 'debug', 'ship', 'other']

const SKILL_PHASE = new Map<string, Phase>([
  ['dev-explore', 'explore'],
  ['dev-plan', 'plan'], ['brainstorming', 'plan'], ['writing-plans', 'plan'],
  ['dev-implement', 'implement'], ['test-driven-development', 'implement'], ['executing-plans', 'implement'], ['subagent-driven-development', 'implement'],
  ['dev-testing', 'test'],
  ['dev-verify', 'review'], ['requesting-code-review', 'review'], ['receiving-code-review', 'review'], ['verification-before-completion', 'review'],
  ['dev-debug', 'debug'], ['systematic-debugging', 'debug'],
  ['dev-ship', 'ship'], ['finishing-a-development-branch', 'ship'],
])

export function skillPhase(skill: string | null): Phase | null {
  if (!skill) return null
  return SKILL_PHASE.get(skill.slice(skill.lastIndexOf(':') + 1)) ?? null
}

const SHIP_CMD = [/\bgit (commit|push|tag)\b/, /\bgh pr (create|merge)\b/]
// Runner names only count in command position, so paths like `ls test/` stay explore.
const TEST_CMD = [
  /(^|&&|\|\||;|\|)\s*((npx|pnpm|yarn|bunx|uv run|poetry run)\s+)?(pytest|vitest|jest|node --test)\b/,
  /\bcargo (test|nextest)\b/, /\b(npm|pnpm|yarn|bun) (run )?test\b/, /\bgo test\b/, /\bmake (test|check)\b/,
]
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch'])
const PLAN_DOC = /\/docs\/.*(spec|plan)/

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function toolPhase(name: string, input: Record<string, unknown>): Phase | null {
  if (name === 'Bash') {
    const cmd = str(input.command)
    if (SHIP_CMD.some(r => r.test(cmd))) return 'ship'
    if (TEST_CMD.some(r => r.test(cmd))) return 'test'
    return 'explore'
  }
  if (EDIT_TOOLS.has(name)) return PLAN_DOC.test(str(input.file_path) || str(input.notebook_path)) ? 'plan' : 'implement'
  if (name === 'Agent' || name === 'Task') return /review/i.test(str(input.description)) ? 'review' : null
  if (EXPLORE_TOOLS.has(name) || name.startsWith('mcp__')) return 'explore'
  return null
}

const PRIORITY: readonly Phase[] = ['ship', 'test', 'review', 'implement', 'plan', 'explore']

export function strongest(a: Phase | null, b: Phase | null): Phase | null {
  if (a === null) return b
  if (b === null) return a
  const ia = PRIORITY.indexOf(a)
  const ib = PRIORITY.indexOf(b)
  if (ia === -1) return b
  if (ib === -1) return a
  return ia <= ib ? a : b
}

export interface PhaseSignals { skill: Phase | null; tool: Phase | null }

export function resolvePhases(items: PhaseSignals[]): { phase: Phase; source: PhaseSource }[] {
  let prev: Phase | null = null
  return items.map(it => {
    if (it.skill !== null) { prev = it.skill; return { phase: it.skill, source: 'skill' as const } }
    if (it.tool !== null) { prev = it.tool; return { phase: it.tool, source: 'tool' as const } }
    if (prev !== null) return { phase: prev, source: 'inherited' as const }
    return { phase: 'other' as const, source: 'none' as const }
  })
}

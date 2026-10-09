import type { ModelAnalysis, TokenUsage } from '../shared/types.ts'
import type { SessionRecord } from './record.ts'
import { priceOf } from './pricing.ts'

const pct = (n: number, d: number): number | null => (d === 0 ? null : (n / d) * 100)

export function computeModels(rs: SessionRecord[]): ModelAnalysis[] {
  const byModel = new Map<string, { sessions: number; messages: number; tokens: TokenUsage; costUsd: number; sidechain: number; context: number; claude: boolean }>()
  for (const r of rs) {
    const seen = new Set<string>()
    for (const m of r.messages) {
      const e = byModel.get(m.model) ?? { sessions: 0, messages: 0, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }, costUsd: 0, sidechain: 0, context: 0, claude: false }
      if (r.summary.agent === 'claude-code') e.claude = true
      if (!seen.has(m.model)) { seen.add(m.model); e.sessions++ }
      e.messages++
      e.tokens.input += m.tokens.input
      e.tokens.output += m.tokens.output
      e.tokens.cacheCreation += m.tokens.cacheCreation
      e.tokens.cacheRead += m.tokens.cacheRead
      e.tokens.total += m.tokens.total
      e.costUsd += m.costUsd
      e.context += m.context
      if (m.sidechain) e.sidechain += m.tokens.total
      byModel.set(m.model, e)
    }
  }
  return [...byModel].map(([model, e]) => ({
    model, sessions: e.sessions, messages: e.messages, tokens: e.tokens, costUsd: e.costUsd,
    cacheHitPct: pct(e.tokens.cacheRead, e.tokens.input + e.tokens.cacheCreation + e.tokens.cacheRead),
    subagentTokenPct: pct(e.sidechain, e.tokens.total),
    costPerMessage: e.messages ? e.costUsd / e.messages : null,
    avgContext: e.messages ? e.context / e.messages : null,
    outputPct: pct(e.tokens.output, e.tokens.input + e.tokens.cacheCreation + e.tokens.output),
    priced: e.claude || priceOf(model) !== null,
  })).sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model))
}

import type { Phase, SessionDetail } from '../shared/types.ts'
import type { SessionRecord } from './record.ts'
import { PHASES } from './phase.ts'
import { relativeTo } from './workflow.ts'

export function computeDetail(r: SessionRecord): SessionDetail {
  const byModel = new Map<string, { model: string; costUsd: number; tokens: number }>()
  const costByPhase = Object.fromEntries(PHASES.map(p => [p, 0])) as Record<Phase, number>
  for (const m of r.messages) {
    const e = byModel.get(m.model) ?? { model: m.model, costUsd: 0, tokens: 0 }
    e.costUsd += m.costUsd
    e.tokens += m.tokens.total
    byModel.set(m.model, e)
    costByPhase[m.phase] += m.costUsd
  }
  return {
    summary: r.summary,
    costByModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens || a.model.localeCompare(b.model)),
    costByPhase,
    context: r.messages.filter(m => m.agentId === null).map(m => ({ ts: m.ts, context: m.context })),
    subagents: r.subagents.map(run => { const { toolUseId, ...rest } = run; void toolUseId; return rest }),
    skillWindows: r.skillWindows,
    topFiles: Object.entries(r.fileEdits).map(([f, edits]) => ({ file: relativeTo(f, r.summary.project), edits }))
      .sort((a, b) => b.edits - a.edits || a.file.localeCompare(b.file)).slice(0, 10),
  }
}

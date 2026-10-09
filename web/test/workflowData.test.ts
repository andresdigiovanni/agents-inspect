import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dominantModel, filterTransitions, transitionOptions, PHASE_COLOR, PHASE_LABEL, phaseDailyRows, phaseModelMatrix, sequenceLabel, transitionTarget, workflowKpis, phaseFlowMatrix } from '../workflowData.ts'
import type { Phase, PhaseStats, Workflow } from '../../shared/types.ts'

const zero = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 }
const PH: Phase[] = ['explore', 'plan', 'implement', 'test', 'review', 'debug', 'ship', 'other']
const stats = (phase: Phase, byModel: PhaseStats['byModel'] = {}): PhaseStats => {
  const v = Object.values(byModel)
  const costUsd = v.reduce((n, x) => n + x.costUsd, 0)
  return { phase, sessions: v.length ? 1 : 0, messages: v.reduce((n, x) => n + x.messages, 0), tokens: zero, costUsd, costPct: null, byModel, bySource: { skill: 0, tool: 0, inherited: 0, none: 0 } }
}
const phases = PH.map(p => p === 'explore' ? stats(p, { haiku: { messages: 3, tokens: 30, costUsd: 0.5 }, opus: { messages: 1, tokens: 10, costUsd: 1 } })
  : p === 'implement' ? stats(p, { opus: { messages: 2, tokens: 20, costUsd: 4 } }) : stats(p))

test('labels and colours cover every phase', () => {
  for (const p of PH) { assert.ok(PHASE_LABEL[p]); assert.match(PHASE_COLOR[p], /^#[0-9a-f]{6}$/) }
  assert.equal(PHASE_LABEL.implement, 'Implement')
})

test('phaseModelMatrix: models by total cost, rows with messages only, metric switch, max', () => {
  assert.deepEqual(phaseModelMatrix(phases, 'costUsd'), {
    models: ['opus', 'haiku'],
    rows: [{ phase: 'explore', cells: [1, 0.5] }, { phase: 'implement', cells: [4, 0] }],
    max: 4,
  })
  assert.deepEqual(phaseModelMatrix(phases, 'messages').rows[0].cells, [1, 3])
  assert.equal(phaseModelMatrix(phases, 'tokens').max, 30)
  assert.deepEqual(phaseModelMatrix(PH.map(p => stats(p)), 'costUsd'), { models: [], rows: [], max: 0 })
})

test('phaseDailyRows flattens byPhase', () => {
  const byPhase = Object.fromEntries(PH.map(p => [p, p === 'ship' ? 2 : 0])) as Record<Phase, number>
  assert.deepEqual(phaseDailyRows([{ date: '2026-10-01', byPhase }]), [{ date: '2026-10-01', ...byPhase }])
})

test('dominantModel, sequenceLabel, transitionTarget', () => {
  assert.equal(dominantModel({ sonnet: 2, haiku: 2, opus: 1 }), 'haiku')
  assert.equal(dominantModel({}), null)
  assert.equal(sequenceLabel(['dev-plan', 'dev-implement']), 'dev-plan → dev-implement')
  assert.equal(transitionTarget(null), 'end')
  assert.equal(transitionTarget('dev-ship'), 'dev-ship')
})

test('workflowKpis: top phase, subagent share, classified share', () => {
  const w: Workflow = {
    sessions: 1, phases: phases.map(p => ({ ...p, costPct: p.phase === 'implement' ? 72.7 : null })), daily: [], subagents: [],
    subagentCostPct: 12.5, coverage: { skill: 20, tool: 50, inherited: 25, none: 5 },
    models: [], phaseFlow: [], rework: { edits: 0, reworkEdits: 0, reworkPct: null, hotFiles: [] },
  }
  assert.deepEqual(workflowKpis(w), { topPhase: { phase: 'implement', costUsd: 4, costPct: 72.7 }, subagentCostPct: 12.5, classifiedPct: 70 })
  assert.equal(workflowKpis({ ...w, phases: PH.map(p => stats(p)) }).topPhase, null)
})

test('transitionOptions and filterTransitions', () => {
  const ts = [
    { from: 'b', to: 'a', count: 3 },
    { from: 'a', to: null, count: 2 },
    { from: 'a', to: 'b', count: 1 },
  ]
  assert.deepEqual(transitionOptions(ts), { from: ['a', 'b'], to: ['a', 'b', 'end'] })
  assert.deepEqual(filterTransitions(ts, new Set(), new Set()), ts)
  assert.deepEqual(filterTransitions(ts, new Set(['b']), new Set()), [ts[1], ts[2]])
  assert.deepEqual(filterTransitions(ts, new Set(), new Set(['end'])), [ts[0], ts[2]])
  assert.deepEqual(filterTransitions(ts, new Set(['b']), new Set(['b'])), [ts[1]])
})

test('phaseFlowMatrix: canonical order, only seen phases, zero-filled', () => {
  const m = phaseFlowMatrix([{ from: 'test', to: 'implement', count: 3 }, { from: 'explore', to: 'implement', count: 5 }])
  assert.deepEqual(m.phases, ['explore', 'implement', 'test'])
  assert.deepEqual(m.cells, [[0, 5, 0], [0, 0, 0], [0, 3, 0]])
  assert.equal(m.max, 5)
  assert.deepEqual(phaseFlowMatrix([]), { phases: [], cells: [], max: 0 })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heatPct, modelColors, modelSeries, sparkPoints } from '../chartData.ts'
import type { DailyPoint } from '../../shared/types.ts'

const tok = (input: number, output: number) => ({ input, output, cacheCreation: 1, cacheRead: 2, total: input + output + 3 })
const day = (date: string, byModel: DailyPoint['byModel']): DailyPoint => ({ date, sessions: 0, userTurns: 0, tokens: tok(1, 2), costUsd: 0, byModel })
const daily = [day('2026-10-06', { opus: { tokens: 100, costUsd: 1 } }), day('2026-10-07', { haiku: { tokens: 500, costUsd: 0.1 }, opus: { tokens: 10, costUsd: 2 } })]

test('modelSeries: one row per day, zero-filled, models by metric total desc', () => {
  assert.deepEqual(modelSeries(daily, 'costUsd'), {
    models: ['opus', 'haiku'],
    rows: [{ date: '2026-10-06', opus: 1, haiku: 0 }, { date: '2026-10-07', opus: 2, haiku: 0.1 }],
  })
  assert.deepEqual(modelSeries(daily, 'tokens').models, ['haiku', 'opus'])
  assert.deepEqual(modelSeries([], 'tokens'), { models: [], rows: [] })
})

test('modelColors: alphabetical index into the palette, wrapping, independent of input order', () => {
  const p = ['#a', '#b']
  assert.deepEqual(modelColors(['opus', 'haiku', 'sonnet'], p), { haiku: '#a', opus: '#b', sonnet: '#a' })
  assert.deepEqual(modelColors(['sonnet', 'opus', 'haiku'], p), modelColors(['opus', 'haiku', 'sonnet'], p))
})

test('modelSeries: equal totals are ordered by name', () => {
  const tie = [day('2026-10-06', { zeta: { tokens: 5, costUsd: 1 }, alpha: { tokens: 5, costUsd: 1 } })]
  assert.deepEqual(modelSeries(tie, 'costUsd').models, ['alpha', 'zeta'])
})

test('heatPct: empty cell gets 0, any activity starts at 15% and grows monotonically to 100% at max', () => {
  assert.equal(heatPct(0, 10), 0)
  assert.equal(heatPct(0, 0), 0)
  assert.equal(heatPct(1, 100), 15.85)
  assert.equal(heatPct(5, 10), 57.5)
  assert.equal(heatPct(10, 10), 100)
  assert.ok(heatPct(1, 1000) > heatPct(0, 1000))
})

test('sparkPoints scales to the box, max at the top', () => {
  assert.equal(sparkPoints([0, 5, 10], 100, 20), '0.0,20.0 50.0,10.0 100.0,0.0')
  assert.equal(sparkPoints([3], 100, 20), '0.0,0.0')
  assert.equal(sparkPoints([], 100, 20), '')
})

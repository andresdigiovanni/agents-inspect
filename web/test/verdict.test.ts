import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countByVerdict, VERDICT_VIEW, VERDICTS } from '../verdict.ts'

test('labels match the spec and every verdict has one', () => {
  assert.deepEqual(VERDICTS.map(v => VERDICT_VIEW[v].label), ['🟠 Problematic', '🟢 Useful', '🟡 Occasional', '🔴 Unused', '⚪ No data'])
})

test('countByVerdict counts every verdict, zero included', () => {
  assert.deepEqual(countByVerdict([{ verdict: 'useful' }, { verdict: 'useful' }, { verdict: 'unused' }]),
    { problematic: 0, useful: 2, occasional: 0, unused: 1, insufficient: 0 })
})

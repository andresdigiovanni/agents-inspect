import { test } from 'node:test'
import assert from 'node:assert/strict'
import { breakdownView, shortPath, timeSplit } from '../overviewData.ts'

test('timeSplit: model excludes retries, other is floored at 0', () => {
  assert.deepEqual(timeSplit({ activeMs: 100, apiMs: 50, retryMs: 5, toolMs: 20 }).map((s) => [s.key, s.ms]), [['model', 45], ['retries', 5], ['tools', 20], ['other', 30]])
  assert.equal(timeSplit({ activeMs: 10, apiMs: 50, retryMs: 0, toolMs: 20 })[3].ms, 0)
})

test('breakdownView: null key → —, project shortened, bar relative to max cost', () => {
  const row = (key: string | null, costUsd: number) => ({ key, sessions: 1, costUsd, medianCostPerSession: null, toolErrorPct: null, interruptionsPerSession: null, commits: 0 })
  const v = breakdownView([row('/Users/a/Code/proj', 4), row(null, 1)], 'project')
  assert.deepEqual(v.map((r) => [r.label, r.title, r.barPct]), [['Code/proj', '/Users/a/Code/proj', 100], ['—', 'Not recorded', 25]])
  assert.equal(breakdownView([row('feat/x', 0)], 'branch')[0].label, 'feat/x')
  assert.equal(breakdownView([row('feat/x', 0)], 'branch')[0].barPct, 0)
  assert.equal(shortPath('/'), '/')
})

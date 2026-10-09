import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, priceOf } from '../pricing.ts'

test('priceOf matches model families in order; unknown is null', () => {
  assert.deepEqual(priceOf('claude-sonnet-5'), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })
  assert.deepEqual(priceOf('claude-opus-4.8'), { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
  assert.deepEqual(priceOf('claude-haiku-4.5'), { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 })
  assert.deepEqual(priceOf('gpt-5.4-mini'), { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 })
  assert.deepEqual(priceOf('gpt-5.6-terra'), { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 })
  assert.deepEqual(priceOf('gpt-6-luna'), { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 })
  assert.deepEqual(priceOf('gpt-4o-mini'), { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 })
  assert.deepEqual(priceOf('gemini-3.7-flash'), { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0.3 })
  assert.equal(priceOf('mystery-1'), null)
})

test('costOf applies the four token prices per million', () => {
  const t = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000, total: 4_000_000 }
  assert.equal(costOf('claude-sonnet-5', t), 3 + 15 + 0.3 + 3.75)
  assert.equal(costOf('mystery-1', t), null)
})

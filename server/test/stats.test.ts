import { test } from 'node:test'
import assert from 'node:assert/strict'
import { median, quantile } from '../stats.ts'

test('quantile: empty, single, linear interpolation, unsorted input untouched', () => {
  assert.equal(quantile([], 0.5), null)
  assert.equal(quantile([7], 0.9), 7)
  const xs = [4, 1, 3, 2]
  assert.equal(median(xs), 2.5)
  assert.equal(quantile(xs, 0.9), 3.7)
  assert.deepEqual(xs, [4, 1, 3, 2])
  assert.equal(quantile([1, 2, 3, 4, 5], 0), 1)
  assert.equal(quantile([1, 2, 3, 4, 5], 1), 5)
})

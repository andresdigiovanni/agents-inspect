import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRange } from '../range.ts'

const now = new Date(2026, 9, 7, 15, 30)   // local time
test('preset ranges end at now', () => {
  const r = resolveRange({ kind: '7d' }, now)!
  assert.equal(r.to.getTime(), now.getTime()); assert.equal(now.getTime() - r.from.getTime(), 7 * 86_400_000)
  assert.equal(now.getTime() - resolveRange({ kind: '30d' }, now)!.from.getTime(), 30 * 86_400_000)
})
test('custom range covers the whole "to" day in local time', () => {
  const r = resolveRange({ kind: 'custom', from: '2026-09-01', to: '2026-09-03' }, now)!
  assert.deepEqual(r.from, new Date(2026, 8, 1)); assert.deepEqual(r.to, new Date(2026, 8, 4))
})
test('custom range invalid → null', () => {
  assert.equal(resolveRange({ kind: 'custom', from: '', to: '2026-09-03' }, now), null)
  assert.equal(resolveRange({ kind: 'custom', from: '2026-09-05', to: '2026-09-03' }, now), null)
})
test('custom single-day range covers that day', () => {
  const r = resolveRange({ kind: 'custom', from: '2026-09-03', to: '2026-09-03' }, now)!
  assert.deepEqual(r.from, new Date(2026, 8, 3)); assert.deepEqual(r.to, new Date(2026, 8, 4))
})
test('custom range with a non-existent date → null', () => {
  assert.equal(resolveRange({ kind: 'custom', from: '2026-02-30', to: '2026-03-03' }, now), null)
})

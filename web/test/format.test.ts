import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatInt, formatCompact, formatUsd, formatRatio, trendView, formatPct, formatHours, formatDuration, formatLines } from '../format.ts'

test('number formatting', () => {
  assert.equal(formatInt(1234567), '1,234,567')
  assert.equal(formatCompact(1234567), '1.2M')
  assert.equal(formatUsd(null), '—'); assert.equal(formatUsd(12.345), '$12.35')
  assert.equal(formatRatio(null), '—'); assert.equal(formatRatio(2.5), '2.5'); assert.equal(formatRatio(3), '3.0')
})

test('trendView', () => {
  assert.deepEqual(trendView(null), { label: '—', tone: 'flat' })
  assert.deepEqual(trendView(50), { label: '+50%', tone: 'up' })
  assert.deepEqual(trendView(-12.34), { label: '-12%', tone: 'down' })
  assert.deepEqual(trendView(0), { label: '0%', tone: 'flat' })
  assert.deepEqual(trendView(12.6), { label: '+13%', tone: 'up' })
  assert.deepEqual(trendView(-12.6), { label: '-13%', tone: 'down' })
  assert.deepEqual(trendView(0.4), { label: '0%', tone: 'flat' })
  assert.deepEqual(trendView(-0.4), { label: '0%', tone: 'flat' })
})

test('formatPct and formatHours', () => {
  assert.equal(formatPct(null), '—'); assert.equal(formatPct(57.14), '57%'); assert.equal(formatPct(57.6), '58%'); assert.equal(formatPct(0), '0%')
  assert.equal(formatHours(0), '0.0 h'); assert.equal(formatHours(5_400_000), '1.5 h')
})

test('formatDuration and formatLines', () => {
  assert.equal(formatDuration(null), '—'); assert.equal(formatDuration(0), '0m 00s'); assert.equal(formatDuration(245_000), '4m 05s')
  assert.equal(formatDuration(3_599_999), '59m 59s'); assert.equal(formatDuration(3_725_000), '1h 02m')
  assert.equal(formatLines(null, 2), '—'); assert.equal(formatLines(1200, 3), '+1,200 −3')
})

test('formatDuration switches to hours at exactly 3600 s', () => {
  assert.equal(formatDuration(3_600_000), '1h 00m')
})

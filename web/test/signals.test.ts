import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signals, signalWeight } from '../signals.ts'

test('signals: fixed order, zeros hidden', () => {
  assert.deepEqual(signals({ toolErrors: 3, interruptions: 0, rejections: 1, questions: 2 }), [
    { kind: 'toolErrors', count: 3 }, { kind: 'rejections', count: 1 }, { kind: 'questions', count: 2 },
  ])
  assert.deepEqual(signals({ toolErrors: 0, interruptions: 0, rejections: 0, questions: 0 }), [])
  assert.equal(signalWeight({ toolErrors: 3, interruptions: 1, rejections: 1, questions: 2 }), 7)
})

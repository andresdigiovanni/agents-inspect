import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModel } from '../modelName.ts'

test('normalizeModel unifies Claude Code and Copilot spellings', () => {
  const cases: [string, string][] = [
    ['claude-opus-5-5', 'claude-opus-5.5'],
    ['claude-opus-5.5', 'claude-opus-5.5'],
    ['claude-sonnet-5-5', 'claude-sonnet-5.5'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4.5'],
    ['claude-sonnet-5', 'claude-sonnet-5'],
    ['claude-opus-4-8', 'claude-opus-4.8'],
    ['gpt-5.4-nano-2026-03-17', 'gpt-5.4-nano'],
    ['gpt-4o-mini-2024-07-18', 'gpt-4o-mini'],
    ['gpt-5.4', 'gpt-5.4'],
    ['gpt-5.6-luna-utility', 'gpt-5.6-luna-utility'],
    ['haiku', 'haiku'],
    ['unknown', 'unknown'],
  ]
  for (const [raw, want] of cases) assert.equal(normalizeModel(raw), want, raw)
})

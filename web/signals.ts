import type { SessionSummary } from '../shared/types.ts'

export type SignalKind = 'toolErrors' | 'interruptions' | 'rejections' | 'questions'

export const SIGNAL_VIEW: Record<SignalKind, { icon: string; label: string }> = {
  toolErrors: { icon: '⚠', label: 'tool errors (includes rejections)' },
  interruptions: { icon: '✋', label: 'interruptions (Esc)' },
  rejections: { icon: '⛔', label: 'permission rejections' },
  questions: { icon: '?', label: 'questions asked to you' },
}

const ORDER: SignalKind[] = ['toolErrors', 'interruptions', 'rejections', 'questions']

export function signals(s: Pick<SessionSummary, SignalKind>): { kind: SignalKind; count: number }[] {
  return ORDER.map((kind) => ({ kind, count: s[kind] })).filter((x) => x.count > 0)
}

export const signalWeight = (s: Pick<SessionSummary, SignalKind>): number => ORDER.reduce((n, k) => n + s[k], 0)

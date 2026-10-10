import type { SessionSummary } from '../../shared/types.ts'
import type { SessionRecord } from '../record.ts'

export const summaryExtras = (): Pick<SessionSummary, 'agent' | 'entrypoint' | 'gitBranch' | 'version' | 'effort' | 'permissionMode' | 'commits' | 'interruptions' | 'questions' | 'rejections' | 'toolErrors' | 'peakContext' | 'turnMs' | 'apiMs' | 'toolMs' | 'retryMs' | 'edits' | 'filesEdited' | 'reworkEdits' | 'providers'> => ({
  agent: 'claude-code', entrypoint: null, gitBranch: null, version: null, effort: null, permissionMode: null,
  commits: 0, interruptions: 0, questions: 0, rejections: 0, toolErrors: 0, peakContext: null, turnMs: [],
  apiMs: null, toolMs: null, retryMs: null, edits: 0, filesEdited: 0, reworkEdits: 0, providers: [],
})
export const recordExtras = (): Pick<SessionRecord, 'toolStats' | 'hooks' | 'fileEdits' | 'phaseFlow'> => ({ toolStats: {}, hooks: [], fileEdits: {}, phaseFlow: [] })

import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { Phase, SessionDetail } from '../shared/types.ts'
import { getDetail } from './api.ts'
import { sparkPoints } from './chartData.ts'
import { formatCompact, formatDuration, formatInt, formatUsd } from './format.ts'
import { PHASE_COLOR, PHASE_LABEL } from './workflowData.ts'

const PHASES = Object.keys(PHASE_LABEL) as Phase[]

function Fact(props: { label: string; value: string | null; help?: string }): JSX.Element | null {
  if (props.value === null) return null
  return (
    <span className="rounded-md bg-white px-2 py-1 text-xs ring-1 ring-gray-200" title={props.help}>
      <span className="text-gray-500">{props.label}</span> <span className="font-medium text-gray-900 tabular-nums">{props.value}</span>
    </span>
  )
}

function Block(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="min-w-0 space-y-1">
      <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{props.title}</h4>
      {props.children}
    </div>
  )
}

const ms = (n: number | null): string | null => (n === null ? null : formatDuration(n))

function Facts(props: { d: SessionDetail }): JSX.Element {
  const s = props.d.summary
  const fresh = s.tokens.input + s.tokens.cacheCreation + s.tokens.output
  return (
    <div className="flex flex-wrap gap-1.5">
      <Fact label="Cost" value={formatUsd(s.costUsd)} />
      <Fact label="Fresh tokens" value={formatCompact(fresh)} help="Input + cache writes + output" />
      <Fact label="Peak context" value={s.peakContext === null ? null : formatCompact(s.peakContext)} />
      <Fact label="Active" value={ms(s.durationMs)} />
      <Fact label="API" value={ms(s.apiMs)} />
      <Fact label="Tools" value={ms(s.toolMs)} />
      <Fact label="Retries" value={s.retryMs ? ms(s.retryMs) : null} />
      <Fact label="Commits" value={formatInt(s.commits)} />
      <Fact label="Files edited" value={formatInt(s.filesEdited)} />
      <Fact label="Rework edits" value={`${formatInt(s.reworkEdits)} / ${formatInt(s.edits)}`} help="Edits to a file already edited earlier in the session" />
      <Fact label="Tool errors" value={formatInt(s.toolErrors)} />
      <Fact label="Interruptions" value={formatInt(s.interruptions)} />
      <Fact label="Rejections" value={formatInt(s.rejections)} />
      <Fact label="Questions" value={formatInt(s.questions)} />
      <Fact label="Entry" value={s.entrypoint} />
      <Fact label="Version" value={s.version} />
      <Fact label="Effort" value={s.effort} />
      <Fact label="Mode" value={s.permissionMode} />
      <Fact label="Branch" value={s.gitBranch} />
    </div>
  )
}

function PhaseBar(props: { byPhase: Record<Phase, number> }): JSX.Element {
  const total = PHASES.reduce((n, p) => n + props.byPhase[p], 0)
  if (total === 0) return <p className="text-xs text-gray-500">No cost.</p>
  return (
    <>
      <div className="flex h-3 overflow-hidden rounded-sm">
        {PHASES.map((p) => props.byPhase[p] > 0 && (
          <div key={p} title={`${PHASE_LABEL[p]}: ${formatUsd(props.byPhase[p])}`} style={{ width: `${(props.byPhase[p] / total) * 100}%`, backgroundColor: PHASE_COLOR[p] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-gray-700 tabular-nums">
        {PHASES.filter((p) => props.byPhase[p] > 0).map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: PHASE_COLOR[p] }} />
            {PHASE_LABEL[p]} {formatUsd(props.byPhase[p])}
          </span>
        ))}
      </div>
    </>
  )
}

function ContextSpark(props: { points: SessionDetail['context'] }): JSX.Element {
  const values = props.points.map((p) => p.context)
  if (values.length < 2) return <p className="text-xs text-gray-500">Not enough messages.</p>
  return (
    <div>
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label="Context size per message">
        <polyline points={sparkPoints(values, 200, 38)} fill="none" stroke="#2a78d6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" transform="translate(0 1)" />
      </svg>
      <div className="flex justify-between text-xs text-gray-500 tabular-nums">
        <span>{formatCompact(values[0])}</span>
        <span>max {formatCompact(Math.max(...values))}</span>
      </div>
    </div>
  )
}

function List(props: { empty: string; children: ReactNode[] }): JSX.Element {
  if (props.children.length === 0) return <p className="text-xs text-gray-500">{props.empty}</p>
  return <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">{props.children}</ul>
}

export function SessionSummaryPanel(props: { id: string }): JSX.Element {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getDetail(props.id).then(
      (d) => { if (!cancelled) setDetail(d) },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [props.id])

  if (error !== null) return <p role="alert" className="text-sm text-red-600">Could not load summary: {error}</p>
  if (detail === null) return <p role="status" className="text-sm text-gray-500">Loading summary…</p>
  const d = detail
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-100/60 p-3">
      {d.summary.agent === 'copilot' && (
        <p className="text-xs text-amber-700">Copilot logs token totals per model at session end: per-message tokens and costs are estimated from those totals and list prices.</p>
      )}
      {d.summary.agent === 'opencode' && (
        <p className="text-xs text-amber-700">opencode reports USD cost only for per-token providers: sessions on subscription plans show list-price estimates, or no cost when the model has no public price.</p>
      )}
      <Facts d={d} />
      <div className="grid gap-4 md:grid-cols-3">
        <Block title="Cost by model">
          <List empty="No messages.">
            {d.costByModel.map((m) => (
              <li key={m.model} className="flex justify-between gap-2 tabular-nums">
                <span className="truncate">{m.model}{m.provider !== null && <span className="text-gray-400"> · {m.provider}</span>}</span>
                <span>{formatUsd(m.costUsd)} · {formatCompact(m.tokens)}</span>
              </li>
            ))}
          </List>
        </Block>
        <Block title="Cost by phase"><PhaseBar byPhase={d.costByPhase} /></Block>
        <Block title="Context growth"><ContextSpark points={d.context} /></Block>
        <Block title="Subagents">
          <List empty="None.">
            {d.subagents.map((a) => (
              <li key={a.agentId} className="flex justify-between gap-2 tabular-nums" title={a.description}>
                <span className="truncate">{a.agentType} · {a.description}</span>
                <span className="whitespace-nowrap">{formatUsd(a.costUsd)}{a.toolErrors > 0 ? ` · ⚠ ${a.toolErrors}` : ''}</span>
              </li>
            ))}
          </List>
        </Block>
        <Block title="Skill windows">
          <List empty="None.">
            {d.skillWindows.map((w, i) => (
              <li key={`${i}-${w.skill}`} className="flex justify-between gap-2 tabular-nums">
                <span className="truncate">{w.skill}</span>
                <span className="whitespace-nowrap">
                  {formatInt(w.toolCalls)} tools{w.toolErrors > 0 ? ` · ⚠ ${w.toolErrors}` : ''}{w.interrupted ? ' · ✋' : ''}{w.committed ? ' · commit' : ''}
                </span>
              </li>
            ))}
          </List>
        </Block>
        <Block title="Top files">
          <List empty="No edits.">
            {d.topFiles.map((f) => (
              <li key={f.file} className="flex justify-between gap-2 tabular-nums">
                <span className="truncate font-mono" title={f.file}>{f.file}</span>
                <span>{formatInt(f.edits)}</span>
              </li>
            ))}
          </List>
        </Block>
      </div>
    </div>
  )
}

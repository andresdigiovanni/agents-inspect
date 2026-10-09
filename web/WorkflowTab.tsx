import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { HotFile, PhaseSource, SubagentGroup, Workflow } from '../shared/types.ts'
import { getWorkflow } from './api.ts'
import { PhaseChart, PhaseFlowHeatmap, PhaseModelHeatmap } from './Charts.tsx'
import { ModelsTable } from './ModelsTable.tsx'
import { ErrorBanner, errorMessage } from './ErrorBanner.tsx'
import { formatCompact, formatDuration, formatInt, formatPct, formatUsd } from './format.ts'
import { formatHash, NO_FILTERS } from './hash.ts'
import { dominantModel, PHASE_COLOR, PHASE_LABEL, workflowKpis } from './workflowData.ts'
import type { Query } from './api.ts'

type Range = Query

const th = 'px-3 py-2 whitespace-nowrap'
const td = 'px-3 py-2 whitespace-nowrap tabular-nums'

const SOURCES: { key: PhaseSource; label: string; color: string; help: string }[] = [
  { key: 'skill', label: 'Skill', color: '#4a3aa7', help: 'An active skill sets the phase (e.g. a debugging skill → Debug).' },
  { key: 'tool', label: 'Tool', color: '#2a78d6', help: 'No skill; the phase is inferred from the message\'s tools (Edit → Implement, Bash test → Test…).' },
  { key: 'inherited', label: 'Inherited', color: '#9cc3ef', help: 'The message gives no hints; it inherits the phase of the last classified message in the same thread.' },
  { key: 'none', label: 'No phase', color: '#d1d5db', help: 'No classified message before it; counts as “Other”.' },
]

function Card(props: { title: string; value: string; note?: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-500">{props.title}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{props.value}</div>
      {props.note !== undefined && <div className="text-xs text-gray-500">{props.note}</div>}
    </div>
  )
}

function Section(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  )
}

function Coverage(props: { coverage: Workflow['coverage'] }): JSX.Element {
  const [hover, setHover] = useState<PhaseSource | null>(null)
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-600">Where the phase assigned to each assistant message comes from (% of messages).</p>
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100" onMouseLeave={() => setHover(null)}>
        {SOURCES.map((s) => (
          <div
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            style={{ width: `${props.coverage[s.key]}%`, backgroundColor: s.color, opacity: hover === null || hover === s.key ? 1 : 0.35 }}
            title={`${s.label} ${formatPct(props.coverage[s.key])} — ${s.help}`}
          />
        ))}
      </div>
      <ul className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {SOURCES.map((s) => (
          <li
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className={`flex gap-2 rounded-md p-1.5 ${hover === s.key ? 'bg-gray-100' : ''}`}
          >
            <span className="mt-0.5 inline-block size-3 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span>
              <span className="font-medium text-gray-800">{s.label} · <span className="tabular-nums">{formatPct(props.coverage[s.key])}</span></span>
              <span className="block text-gray-500">{s.help}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        “Debug” is only detected when a debugging skill is used.
        Bash commands not recognised as “Test” or “Ship” count as “Explore”, so that phase is an upper bound.
        A subagent's phase is that of the message that delegated to it.
      </p>
    </div>
  )
}

function SubagentsTable(props: { groups: SubagentGroup[] }): JSX.Element {
  if (props.groups.length === 0) return <p className="text-sm text-gray-500">No subagents in this range.</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
          <tr>
            <th className={th}>Type</th><th className={th}>Phase</th><th className={th}>Model</th><th className={th}>Runs</th>
            <th className={th}>Cost</th><th className={th}>Cost/run</th><th className={th}>Tokens</th><th className={th}>% error</th><th className={th}>Avg duration</th><th className={th}>Examples</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {props.groups.map((g) => (
            <tr key={`${g.agentType}\u0000${g.phase}`}>
              <td className={td}>
                <a href={formatHash({ tab: 'sessions', filters: { ...NO_FILTERS, agent: g.agentType } })} className="text-sky-700 hover:underline">{g.agentType}</a>
              </td>
              <td className={td}>
                <span className="mr-1.5 inline-block size-2.5 rounded-sm" style={{ backgroundColor: PHASE_COLOR[g.phase] }} />
                {PHASE_LABEL[g.phase]}
              </td>
              <td className={td}>{dominantModel(g.models) ?? '—'}</td>
              <td className={td}>{formatInt(g.runs)}</td>
              <td className={td}>{formatUsd(g.costUsd)}</td>
              <td className={td}>{formatUsd(g.costPerRun)}</td>
              <td className={td}>{formatCompact(g.tokens)}</td>
              <td className={td}>{formatPct(g.errorRatePct)}</td>
              <td className={td}>{formatDuration(g.avgDurationMs)}</td>
              <td className="max-w-md truncate px-3 py-2 text-gray-600" title={g.examples.join('\n')}>{g.examples.join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HotFilesTable(props: { files: HotFile[] }): JSX.Element {
  if (props.files.length === 0) return <p className="text-sm text-gray-500">No file edits in this range.</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
          <tr><th className={th}>File</th><th className={th}>Project</th><th className={th}>Edits</th><th className={th}>Rework edits</th><th className={th}>Sessions</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {props.files.map((f) => (
            <tr key={`${f.project}\u0000${f.file}`}>
              <td className="max-w-md truncate px-3 py-2 font-mono text-xs" title={f.file}>{f.file}</td>
              <td className="max-w-xs truncate px-3 py-2 text-gray-600" title={f.project}>{f.project.split('/').filter(Boolean).pop() ?? f.project}</td>
              <td className={td}>{formatInt(f.edits)}</td>
              <td className={td}>{formatInt(f.reworkEdits)}</td>
              <td className={td}>{formatInt(f.sessions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WorkflowTab(props: { range: Range | null }): JSX.Element {
  const range = props.range
  const [loaded, setLoaded] = useState<{ range: Range; workflow: Workflow } | null>(null)
  const [failed, setFailed] = useState<{ range: Range; message: string } | null>(null)
  const workflow = loaded !== null && loaded.range === range ? loaded.workflow : null
  const error = failed !== null && failed.range === range ? failed.message : null

  useEffect(() => {
    if (range === null) return
    let cancelled = false
    getWorkflow(range).then(
      (w) => { if (!cancelled) setLoaded({ range, workflow: w }) },
      (e: unknown) => { if (!cancelled) setFailed({ range, message: errorMessage(e) }) },
    )
    return () => { cancelled = true }
  }, [range])

  const kpi = workflow === null ? null : workflowKpis(workflow)
  return (
    <>
      {error !== null && <ErrorBanner message={error} />}
      {range === null ? (
        <p className="text-sm text-gray-500">Select a valid date range.</p>
      ) : workflow === null || kpi === null ? (
        error === null && <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card
              title="Most expensive phase"
              value={kpi.topPhase === null ? '—' : PHASE_LABEL[kpi.topPhase.phase]}
              note={kpi.topPhase === null ? undefined : `${formatUsd(kpi.topPhase.costUsd)} · ${formatPct(kpi.topPhase.costPct)} of cost`}
            />
            <Card title="Subagent cost" value={formatPct(kpi.subagentCostPct)} />
            <Card
              title="Rework"
              value={formatPct(workflow.rework.reworkPct)}
              note={`${formatInt(workflow.rework.reworkEdits)} of ${formatInt(workflow.rework.edits)} edits touch an already edited file`}
            />
            <Card title="Classified messages" value={formatPct(kpi.classifiedPct)} note="by skill or tool" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PhaseModelHeatmap phases={workflow.phases} />
            <PhaseChart daily={workflow.daily} />
          </div>
          <PhaseFlowHeatmap flow={workflow.phaseFlow} />
          <Section title="Models">
            <ModelsTable models={workflow.models} />
            <p className="text-xs text-gray-500"><em>Avg context</em> = input + cache tokens per message (how much the model reads each time). <em>Output %</em> = output share of all tokens.</p>
          </Section>
          <Section title="Subagents"><SubagentsTable groups={workflow.subagents} /></Section>
          <Section title="Hot files"><HotFilesTable files={workflow.rework.hotFiles} /></Section>
          <details>
            <summary className="cursor-pointer text-sm text-gray-700">How are phases assigned? (classification coverage)</summary>
            <div className="mt-2"><Coverage coverage={workflow.coverage} /></div>
          </details>
        </div>
      )}
    </>
  )
}

import { useState } from 'react'
import type { JSX } from 'react'
import type { SkillSequences } from '../shared/types.ts'
import { formatInt } from './format.ts'
import { BACK_PAD, END_NODE, NODE_H, NODE_W, skillGraph } from './skillGraph.ts'
import type { GraphEdge, GraphNode } from './skillGraph.ts'

const DARK = '#1e293b'
const LIGHT = '#cbd5e1'
const MAX_LABEL = 19

function edgeColor(weight: number): string {
  return `color-mix(in srgb, ${DARK} ${Math.round(15 + 85 * weight)}%, ${LIGHT})`
}

function edgePath(e: GraphEdge, a: GraphNode, b: GraphNode, height: number): string {
  if (e.self) {
    const x1 = a.x + NODE_W - 36
    const x2 = a.x + NODE_W - 12
    return `M ${x1} ${a.y} C ${x1} ${a.y - 14}, ${x2} ${a.y - 14}, ${x2} ${a.y}`
  }
  if (e.backward) {
    const sx = a.x + NODE_W / 2
    const tx = b.x + NODE_W / 2 + 10
    const low = height - BACK_PAD / 3
    return `M ${sx} ${a.y + NODE_H} C ${sx} ${low}, ${tx} ${low}, ${tx} ${b.y + NODE_H}`
  }
  const sx = a.x + NODE_W
  const sy = a.y + NODE_H / 2
  const tx = b.x
  const ty = b.y + NODE_H / 2
  const mx = (sx + tx) / 2
  return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
}

function label(node: GraphNode): string {
  return node.label.length > MAX_LABEL ? `${node.label.slice(0, MAX_LABEL - 1)}…` : node.label
}

export function SkillGraphView(props: { transitions: SkillSequences['transitions'] }): JSX.Element {
  const g = skillGraph(props.transitions)
  const [hover, setHover] = useState<{ kind: 'edge'; edge: GraphEdge } | { kind: 'node'; id: string } | null>(null)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const name = (id: string): string => (id === END_NODE ? 'end' : id)
  const edges = [...g.edges].sort((a, b) => a.weight - b.weight)
  // The graph is rebuilt every render, so edges are matched by endpoints rather than identity.
  const isHovered = (e: GraphEdge): boolean => hover?.kind === 'edge' && hover.edge.from === e.from && hover.edge.to === e.to
  const active = (e: GraphEdge): boolean =>
    hover === null || (hover.kind === 'edge' ? isHovered(e) : e.from === hover.id || e.to === hover.id)
  const nodeHighlighted = (id: string): boolean =>
    hover !== null && (hover.kind === 'node' ? hover.id === id : hover.edge.from === id || hover.edge.to === id)
  // Draw the hovered edge last so it sits on top of the others.
  const hoveredIdx = edges.findIndex(isHovered)
  if (hoveredIdx >= 0) edges.push(...edges.splice(hoveredIdx, 1))

  const info = hover === null
    ? 'Hover over a skill or an arrow'
    : hover.kind === 'edge'
      ? `${name(hover.edge.from)} → ${name(hover.edge.to)} · ${formatInt(hover.edge.count)} times`
      : `${name(hover.id)} · ${formatInt(byId.get(hover.id)?.traffic ?? 0)} transitions (in + out)`

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
        <span aria-live="polite" className="tabular-nums">{info}</span>
        <span className="flex items-center gap-2">
          Fewer
          <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(to right, ${edgeColor(0)}, ${edgeColor(1)})` }} />
          More calls
        </span>
      </div>
      <svg viewBox={`0 0 ${g.width} ${g.height}`} width="100%" style={{ maxWidth: g.width }} role="img" aria-label="Skill transition graph" onMouseLeave={() => setHover(null)}>
          <defs>
            {edges.map((e, i) => (
              <marker key={i} id={`arrow-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: isHovered(e) ? DARK : edgeColor(e.weight) }} />
              </marker>
            ))}
          </defs>
          {edges.map((e, i) => {
            const a = byId.get(e.from)!
            const b = byId.get(e.to)!
            const d = edgePath(e, a, b, g.height)
            return (
              <g key={`${e.from}\u0000${e.to}`} opacity={active(e) ? 1 : 0.15} onMouseEnter={() => setHover({ kind: 'edge', edge: e })}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={d}
                  fill="none"
                  strokeWidth={1.25 + 3 * e.weight + (isHovered(e) ? 1.5 : 0)}
                  strokeDasharray={e.backward ? '4 3' : undefined}
                  markerEnd={`url(#arrow-${i})`}
                  style={{ stroke: isHovered(e) ? DARK : edgeColor(e.weight) }}
                >
                  <title>{`${name(e.from)} → ${name(e.to)}: ${formatInt(e.count)}`}</title>
                </path>
              </g>
            )
          })}
          {g.nodes.map((n) => {
            const end = n.id === END_NODE
            return (
              <g key={n.id} onMouseEnter={() => setHover({ kind: 'node', id: n.id })} className="cursor-default">
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={end ? NODE_H / 2 : 6}
                  fill={end ? '#f3f4f6' : '#ede9fe'}
                  stroke={nodeHighlighted(n.id) ? DARK : end ? '#9ca3af' : '#a78bfa'}
                  strokeWidth={nodeHighlighted(n.id) ? 2 : 1}
                />
                <text x={n.x + NODE_W / 2} y={n.y + NODE_H / 2} dominantBaseline="central" textAnchor="middle" fontSize={12} fill={end ? '#4b5563' : '#4c1d95'} fontStyle={end ? 'italic' : undefined}>
                  {label(n)}
                </text>
                <title>{n.label}</title>
              </g>
            )
          })}
      </svg>
      <p className="mt-2 text-xs text-gray-500">Dashed arrows go back to an earlier skill; thickness and darkness grow with the number of transitions.</p>
    </div>
  )
}

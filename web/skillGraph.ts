import type { SkillSequences } from '../shared/types.ts'

export const END_NODE = '\u0000end'
export const NODE_W = 140
export const NODE_H = 28
const COL_GAP = 40
const ROW_GAP = 18
const PAD = 12
// Room below the nodes for arcs of backward edges.
export const BACK_PAD = 40

export interface GraphNode { id: string; label: string; col: number; x: number; y: number; traffic: number }
export interface GraphEdge { from: string; to: string; count: number; weight: number; backward: boolean; self: boolean }
export interface SkillGraph { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }

// Greedy Eades–Lin–Smyth-style ordering: peel sinks and sources, otherwise take the node whose weight is most outgoing
// (out / (in + out)), then improve by moving single nodes while the total weight of backward edges drops.
// Edges that still point backwards form a small feedback arc set, so most transitions flow left to right.
function feedbackOrder(nodes: string[], edges: { from: string; to: string; count: number }[]): string[] {
  const left: string[] = []
  const right: string[] = []
  const alive = new Set(nodes)
  const weight = (s: string, dir: 'in' | 'out'): number =>
    edges.filter((e) => (dir === 'out' ? e.from === s && alive.has(e.to) : e.to === s && alive.has(e.from))).reduce((n, e) => n + e.count, 0)
  const ratio = (s: string): number => weight(s, 'out') / (weight(s, 'out') + weight(s, 'in'))
  while (alive.size > 0) {
    const pending = nodes.filter((s) => alive.has(s))
    const sink = pending.find((s) => weight(s, 'out') === 0 && weight(s, 'in') > 0)
    if (sink !== undefined) { right.unshift(sink); alive.delete(sink); continue }
    const source = pending.find((s) => weight(s, 'in') === 0)
    if (source !== undefined) { left.push(source); alive.delete(source); continue }
    const best = pending.reduce((a, b) => (ratio(b) > ratio(a) ? b : a))
    left.push(best)
    alive.delete(best)
  }
  let order = [...left, ...right]
  const cost = (o: string[]): number => {
    const p = new Map(o.map((s, i) => [s, i]))
    return edges.reduce((n, e) => n + (p.get(e.to)! < p.get(e.from)! ? e.count : 0), 0)
  }
  let current = cost(order)
  for (let improved = true; improved;) {
    improved = false
    for (const s of [...order]) {
      const rest = order.filter((x) => x !== s)
      for (let i = 0; i <= rest.length; i++) {
        const candidate = [...rest.slice(0, i), s, ...rest.slice(i)]
        const c = cost(candidate)
        if (c < current) { order = candidate; current = c; improved = true; break }
      }
    }
  }
  return order
}

export function skillGraph(transitions: SkillSequences['transitions']): SkillGraph {
  if (transitions.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }
  const raw = transitions.map((t) => ({ from: t.from, to: t.to ?? END_NODE, count: t.count }))
  const skills = new Set<string>()
  const traffic = new Map<string, number>()
  for (const e of raw) {
    skills.add(e.from)
    if (e.to !== END_NODE) skills.add(e.to)
    traffic.set(e.from, (traffic.get(e.from) ?? 0) + e.count)
    traffic.set(e.to, (traffic.get(e.to) ?? 0) + e.count)
  }

  const byName = [...skills].sort()
  const order = feedbackOrder(byName, raw.filter((e) => e.from !== e.to && e.to !== END_NODE))
  const pos = new Map(order.map((s, i) => [s, i]))
  const col = new Map<string, number>()
  for (const s of order) {
    const preds = raw.filter((e) => e.to === s && e.from !== s && pos.get(e.from)! < pos.get(s)!)
    col.set(s, preds.length === 0 ? 0 : Math.max(...preds.map((e) => col.get(e.from)! + 1)))
  }
  if (raw.some((e) => e.to === END_NODE)) col.set(END_NODE, Math.max(...col.values()) + 1)

  const columns = new Map<number, string[]>()
  for (const id of [...col.keys()].sort((a, b) => traffic.get(b)! - traffic.get(a)! || a.localeCompare(b))) {
    const c = col.get(id)!
    columns.set(c, [...(columns.get(c) ?? []), id])
  }
  // Barycenter sweep: order each column by the weighted mean row of its forward predecessors to reduce crossings.
  const rowOf = new Map<string, number>()
  const colCount = Math.max(...col.values()) + 1
  for (let c = 0; c < colCount; c++) {
    const ids = columns.get(c) ?? []
    ids.forEach((id, i) => rowOf.set(id, i))
    if (c === 0) continue
    const center = (id: string): number => {
      const ins = raw.filter((e) => e.to === id && col.get(e.from)! < c)
      const w = ins.reduce((n, e) => n + e.count, 0)
      return w === 0 ? rowOf.get(id)! : ins.reduce((n, e) => n + rowOf.get(e.from)! * e.count, 0) / w
    }
    const centers = new Map(ids.map((id) => [id, center(id)]))
    ids.sort((a, b) => centers.get(a)! - centers.get(b)! || traffic.get(b)! - traffic.get(a)! || a.localeCompare(b))
    ids.forEach((id, i) => rowOf.set(id, i))
  }

  const ids = [...col.keys()].sort((a, b) => col.get(a)! - col.get(b)! || rowOf.get(a)! - rowOf.get(b)!)
  const nodes = ids.map((id) => {
    const c = col.get(id)!
    const r = rowOf.get(id)!
    return { id, label: id === END_NODE ? 'end' : id, col: c, x: PAD + c * (NODE_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP), traffic: traffic.get(id)! }
  })
  const max = Math.max(...raw.map((e) => e.count))
  const edges = raw.map((e) => ({
    ...e,
    weight: e.count / max,
    self: e.from === e.to,
    backward: e.from !== e.to && col.get(e.to)! <= col.get(e.from)!,
  }))
  const cols = colCount
  const rows = Math.max(...[...columns.values()].map((c) => c.length))
  return {
    nodes,
    edges,
    width: PAD * 2 + cols * NODE_W + (cols - 1) * COL_GAP,
    height: PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP + (edges.some((e) => e.backward || e.self) ? BACK_PAD : 0),
  }
}

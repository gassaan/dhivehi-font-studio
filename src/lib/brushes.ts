// Brush behaviour that shapes a stroke as it is drawn: tapering for the
// pointed pen, speed-sensitive width for the brush pen, and straight lines.
import type { Stroke, Tool } from './types.ts'

export interface BrushInfo {
  id: Tool
  label: string
  key: string
  hint: string
}

export const BRUSHES: BrushInfo[] = [
  { id: 'brush', label: 'Round', key: 'b', hint: 'Even, round line. Good for clean, modern letters.' },
  { id: 'taper', label: 'Pointed pen', key: 'p', hint: 'Starts and ends with a fine point, like handwriting.' },
  { id: 'speed', label: 'Brush pen', key: 'r', hint: 'Thick when you draw slowly, thin when you flick quickly.' },
  { id: 'marker', label: 'Marker', key: 'm', hint: 'Square tip for blocky, geometric letters.' },
  { id: 'nib', label: 'Nib', key: 'n', hint: 'Flat calligraphy nib held at an angle: thick and thin strokes.' },
  { id: 'eraser', label: 'Eraser', key: 'e', hint: 'Rubs out ink, including traced pictures.' },
]

/** Length in font units over which a pointed-pen stroke narrows, for taper amount 0–1. */
export const taperLength = (size: number, amount: number) => Math.max(20, size * (0.5 + amount * 4))

/** Width factor `dist` units from a stroke end, for a taper running over `len` units. */
export function taperAt(dist: number, len: number): number {
  return 0.06 + 0.94 * Math.sqrt(Math.min(1, Math.max(0, dist) / len))
}

/** Brush-pen width target for a pointer speed in font units per millisecond. */
export function speedTarget(unitsPerMs: number): number {
  return Math.max(0.22, Math.min(1, 1.1 - unitsPerMs * 0.28))
}

/** Splits a two-point straight line into evenly spaced points so tapers can shape it. */
export function resampleLine(s: Stroke, pen: number): Stroke {
  const [x0, y0, , x1, y1] = s.pts
  if (s.pts.length < 6) return s
  const len = Math.hypot(x1 - x0, y1 - y0)
  const n = Math.max(2, Math.ceil(len / 6))
  const pts: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push(Math.round((x0 + (x1 - x0) * t) * 10) / 10, Math.round((y0 + (y1 - y0) * t) * 10) / 10, pen)
  }
  return { ...s, pts }
}

/**
 * Final widths for a finished pointed-pen stroke: both ends come to a point.
 * `pens` holds the raw pen pressure for each point (1 for mouse and touch).
 * Short strokes taper over at most half their length so they never vanish.
 */
export function finishStroke(s: Stroke, taper: number, pens: number[]): Stroke {
  if (s.tool !== 'taper' || taper <= 0) return s
  const p = s.pts.slice()
  const n = p.length / 3
  const dist = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2])
  const total = dist[n - 1]
  const len = Math.max(1, Math.min(taperLength(s.size, taper), total / 2))
  for (let i = 0; i < n; i++) {
    const k = Math.min(taperAt(dist[i], len), taperAt(total - dist[i], len))
    p[i * 3 + 2] = Math.round(k * (pens[i] ?? 1) * 1000) / 1000
  }
  return { ...s, pts: p }
}

/** Snaps a direction to the nearest 15° (for Shift + straight line). */
export function snapAngle(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.PI / 12
  const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / step) * step
  return [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len]
}

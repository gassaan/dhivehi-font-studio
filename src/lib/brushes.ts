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

// ---------- Steadying ----------

export type SteadyMethod = 'follow' | 'string'

export interface Steady {
  method: SteadyMethod
  /** Smooth follow: 0 (off) – 0.97 (very laggy, very smooth). */
  follow: number
  /** Pull string: string length in font units. */
  string: number
  /** Smoothing applied to each stroke when it is finished, 0–1. */
  after: number
}

export const STEADY_PRESETS: { label: string; steady: Steady }[] = [
  { label: 'Off', steady: { method: 'follow', follow: 0, string: 0, after: 0 } },
  { label: 'Light', steady: { method: 'follow', follow: 0.35, string: 0, after: 0.15 } },
  { label: 'Strong', steady: { method: 'follow', follow: 0.75, string: 0, after: 0.4 } },
  { label: 'Extra steady', steady: { method: 'string', follow: 0, string: 70, after: 0.6 } },
]

/**
 * Smooths a finished stroke: re-spaces its points evenly (so slow and fast
 * parts smooth alike), then relaxes them. The two ends stay where they were.
 * Returns new points plus the raw pen pressures re-sampled to match.
 */
export function smoothStroke(pts: number[], pens: number[], strength: number): { pts: number[]; pens: number[] } {
  const n = pts.length / 3
  if (strength <= 0 || n < 4) return { pts, pens }
  // 1. Even spacing.
  const spacing = 3
  const out: number[] = [pts[0], pts[1], pts[2]]
  const outPens: number[] = [pens[0] ?? 1]
  let carry = 0
  for (let i = 1; i < n; i++) {
    const ax = pts[i * 3 - 3], ay = pts[i * 3 - 2], aw = pts[i * 3 - 1], ap = pens[i - 1] ?? 1
    const bx = pts[i * 3], by = pts[i * 3 + 1], bw = pts[i * 3 + 2], bp = pens[i] ?? 1
    const len = Math.hypot(bx - ax, by - ay)
    let d = spacing - carry
    while (d <= len) {
      const t = d / len
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t, aw + (bw - aw) * t)
      outPens.push(ap + (bp - ap) * t)
      d += spacing
    }
    carry = len - (d - spacing)
  }
  out.push(pts[n * 3 - 3], pts[n * 3 - 2], pts[n * 3 - 1])
  outPens.push(pens[n - 1] ?? 1)
  // 2. Relax positions (and widths) with a [1 2 1] filter, ends pinned.
  const m = out.length / 3
  const passes = Math.round(strength * 24)
  let cur = out
  for (let k = 0; k < passes; k++) {
    const nx = cur.slice()
    for (let i = 1; i < m - 1; i++) {
      for (let c = 0; c < 3; c++) nx[i * 3 + c] = (cur[i * 3 - 3 + c] + 2 * cur[i * 3 + c] + cur[i * 3 + 3 + c]) / 4
    }
    cur = nx
  }
  return { pts: cur.map((v, i) => (i % 3 === 2 ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10)), pens: outPens }
}

// ---------- Pen size on a curved slider (fine control for thin pens) ----------

export const SIZE_MIN = 2
export const SIZE_MAX = 240
export const sizeToSlider = (size: number) => (100 * Math.log(size / SIZE_MIN)) / Math.log(SIZE_MAX / SIZE_MIN)
export const sliderToSize = (v: number) => {
  const s = SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 100)
  return s < 20 ? Math.round(s * 2) / 2 : Math.round(s)
}

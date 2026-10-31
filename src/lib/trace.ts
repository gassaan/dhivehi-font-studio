// Turns a bitmap of ink into smooth TrueType outlines.
//
// 1. Walk the boundary between ink and paper pixel edge by pixel edge. Edges
//    are oriented so ink is always on the walker's right, which makes outer
//    contours clockwise and holes counter-clockwise, exactly what TrueType wants.
// 2. Replace the staircase with edge midpoints and relax it a little.
// 3. Simplify with Ramer–Douglas–Peucker.
// 4. Emit the polygon as a quadratic B-spline: sharp turns become on-curve
//    corner points; everything else becomes an off-curve control point, and
//    TrueType's implied midpoints make the curve between them smooth.

export interface Pt {
  x: number
  y: number
  on: boolean
}

export type Contour = Pt[]

const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

/** ink: 1 byte per pixel, non-zero means ink. */
export function traceBitmap(ink: Uint8Array, w: number, h: number, smoothing = 0.5): Contour[] {
  const W1 = w + 1
  const out = new Uint8Array(W1 * (h + 1)) // bitmask of outgoing directions per corner
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] !== 0

  let edges = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue
      // Clockwise on screen around the pixel: ink stays on the right.
      if (!at(x, y - 1)) { out[y * W1 + x] |= 1 << 0; edges++ } // top: (x,y) → (x+1,y)
      if (!at(x + 1, y)) { out[y * W1 + x + 1] |= 1 << 1; edges++ } // right: (x+1,y) → (x+1,y+1)
      if (!at(x, y + 1)) { out[(y + 1) * W1 + x + 1] |= 1 << 2; edges++ } // bottom: (x+1,y+1) → (x,y+1)
      if (!at(x - 1, y)) { out[(y + 1) * W1 + x] |= 1 << 3; edges++ } // left: (x,y+1) → (x,y)
    }
  }
  if (!edges) return []

  const loops: number[][] = []
  for (let start = 0; start < out.length; start++) {
    while (out[start]) {
      let v = start
      let dir = Math.log2(out[start] & -out[start]) // lowest set bit
      const pts: number[] = []
      for (let guard = 0; guard <= edges; guard++) {
        out[v] &= ~(1 << dir)
        pts.push(v % W1, (v / W1) | 0)
        v = v + DX[dir] + DY[dir] * W1
        if (v === start) break
        const m = out[v]
        // Prefer a right turn, then straight, then left: keeps diagonal
        // neighbours as separate shapes and never crosses a contour.
        const r = (dir + 1) & 3, s = dir, l = (dir + 3) & 3
        if (m & (1 << r)) dir = r
        else if (m & (1 << s)) dir = s
        else if (m & (1 << l)) dir = l
        else break
      }
      if (pts.length >= 8) loops.push(pts)
    }
  }

  const contours: Contour[] = []
  for (const loop of loops) {
    const c = smoothLoop(loop, smoothing)
    if (c) contours.push(c)
  }
  return contours
}

function polyArea(xs: number[], ys: number[]): number {
  let a = 0
  for (let i = 0, n = xs.length; i < n; i++) {
    const j = (i + 1) % n
    a += xs[i] * ys[j] - xs[j] * ys[i]
  }
  return a / 2
}

function smoothLoop(loop: number[], smoothing: number): Contour | null {
  const n = loop.length / 2
  let xs = new Array<number>(n), ys = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    xs[i] = (loop[i * 2] + loop[j * 2]) / 2
    ys[i] = (loop[i * 2 + 1] + loop[j * 2 + 1]) / 2
  }
  if (Math.abs(polyArea(xs, ys)) < 6) return null // speck

  const passes = Math.round(1 + smoothing * 4)
  for (let k = 0; k < passes; k++) {
    const nx = new Array<number>(n), ny = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n
      nx[i] = (xs[a] + 2 * xs[i] + xs[b]) / 4
      ny[i] = (ys[a] + 2 * ys[i] + ys[b]) / 4
    }
    xs = nx
    ys = ny
  }

  const keep = simplifyClosed(xs, ys, 0.45 + smoothing * 0.9)
  if (keep.length < 3) return null
  const px = keep.map((i) => xs[i]), py = keep.map((i) => ys[i])
  const m = keep.length
  const cornerCos = Math.cos((50 * Math.PI) / 180)
  const contour: Contour = []
  for (let i = 0; i < m; i++) {
    const a = (i + m - 1) % m, b = (i + 1) % m
    const ax = px[i] - px[a], ay = py[i] - py[a]
    const bx = px[b] - px[i], by = py[b] - py[i]
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    const cos = la && lb ? (ax * bx + ay * by) / (la * lb) : 1
    contour.push({ x: px[i], y: py[i], on: cos < cornerCos })
  }
  return contour
}

/** Ramer–Douglas–Peucker on a closed polygon; returns kept indices in order. */
function simplifyClosed(xs: number[], ys: number[], eps: number): number[] {
  const n = xs.length
  // Split at the point farthest from point 0 so both halves are open chains.
  let far = 0, best = -1
  for (let i = 1; i < n; i++) {
    const d = (xs[i] - xs[0]) ** 2 + (ys[i] - ys[0]) ** 2
    if (d > best) { best = d; far = i }
  }
  const keep = new Uint8Array(n)
  keep[0] = keep[far] = 1
  const stack: [number, number][] = [[0, far], [far, n]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const ex = xs[e % n], ey = ys[e % n]
    const sx = xs[s], sy = ys[s]
    const dx = ex - sx, dy = ey - sy
    const len = Math.hypot(dx, dy) || 1
    let idx = -1, dmax = eps
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((xs[i] - sx) * dy - (ys[i] - sy) * dx) / len
      if (d > dmax) { dmax = d; idx = i }
    }
    if (idx >= 0) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  const res: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) res.push(i)
  return res
}

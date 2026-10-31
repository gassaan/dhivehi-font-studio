import { SHAPED_TOOLS, type GlyphData, type Stroke } from './types.ts'

/** Maps font units to canvas pixels: px = (x - x0) * scale, py = (y0 - y) * scale. */
export interface View {
  x0: number
  y0: number
  scale: number
}

const maskCache = new Map<string, HTMLImageElement>()

export function loadMask(url: string): Promise<HTMLImageElement> {
  const cached = maskCache.get(url)
  if (cached?.complete) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = cached ?? new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    if (!cached) {
      maskCache.set(url, img)
      img.src = url
    }
  })
}

export async function preloadGlyph(g: GlyphData): Promise<void> {
  if (g.image) await loadMask(g.image.mask)
}

const pressureWidth = (size: number, p: number) => size * (0.3 + 0.7 * p)
const widthOf = (s: Stroke, p: number) => (SHAPED_TOOLS.includes(s.tool) ? s.size * Math.max(0.03, p) : pressureWidth(s.size, p))

/** Convex hull (monotone chain) of a few points, used for the square marker. */
function hull(pts: [number, number][]): [number, number][] {
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], hi: [number, number][] = []
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  for (const p of [...P].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
  return lo.slice(0, -1).concat(hi.slice(0, -1))
}

/** Draws segment i of a stroke (the dot at its start when i is 0). */
export function drawSegment(ctx: CanvasRenderingContext2D, s: Stroke, i: number, v: View, color = '#000') {
  const px = (x: number) => (x - v.x0) * v.scale
  const py = (y: number) => (v.y0 - y) * v.scale
  const p = s.pts
  const x1 = px(p[i * 3]), y1 = py(p[i * 3 + 1]), pr1 = p[i * 3 + 2]
  const hasPrev = i > 0
  const x0 = hasPrev ? px(p[(i - 1) * 3]) : x1
  const y0 = hasPrev ? py(p[(i - 1) * 3 + 1]) : y1
  const pr0 = hasPrev ? p[(i - 1) * 3 + 2] : pr1

  ctx.save()
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (s.tool === 'marker') {
    const h0 = (pressureWidth(s.size, pr0) / 2) * v.scale
    const h1 = (pressureWidth(s.size, pr1) / 2) * v.scale
    const corners: [number, number][] = []
    for (const [x, y, h] of [[x0, y0, h0], [x1, y1, h1]]) {
      corners.push([x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h])
    }
    const poly = hull(corners)
    ctx.beginPath()
    poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fill()
  } else if (s.tool === 'nib') {
    const a = (s.angle * Math.PI) / 180
    const half0 = (pressureWidth(s.size, pr0) / 2) * v.scale
    const half1 = (pressureWidth(s.size, pr1) / 2) * v.scale
    // Canvas y points down, so a counter-clockwise nib angle flips its y component.
    const cx = Math.cos(a), cy = -Math.sin(a)
    ctx.lineWidth = Math.max(1, s.size * 0.14 * v.scale)
    ctx.beginPath()
    ctx.moveTo(x0 - cx * half0, y0 - cy * half0)
    ctx.lineTo(x0 + cx * half0, y0 + cy * half0)
    ctx.lineTo(x1 + cx * half1, y1 + cy * half1)
    ctx.lineTo(x1 - cx * half1, y1 - cy * half1)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else {
    // A round tip that can change size along the segment: two circles joined
    // by their tangents, so tapering strokes have smooth edges, not beads.
    const r0 = (widthOf(s, pr0) / 2) * v.scale
    const r1 = (widthOf(s, pr1) / 2) * v.scale
    ctx.beginPath()
    ctx.arc(x1, y1, r1, 0, Math.PI * 2)
    ctx.fill()
    const d = Math.hypot(x1 - x0, y1 - y0)
    if (hasPrev && d > Math.abs(r1 - r0)) {
      ctx.beginPath()
      ctx.arc(x0, y0, r0, 0, Math.PI * 2)
      ctx.fill()
      const ux = (x1 - x0) / d, uy = (y1 - y0) / d
      const sin = (r0 - r1) / d, cos = Math.sqrt(1 - sin * sin)
      // Unit normals of the two outer tangent lines.
      const n1x = ux * sin - uy * cos, n1y = uy * sin + ux * cos
      const n2x = ux * sin + uy * cos, n2y = uy * sin - ux * cos
      ctx.beginPath()
      ctx.moveTo(x0 + n1x * r0, y0 + n1y * r0)
      ctx.lineTo(x1 + n1x * r1, y1 + n1y * r1)
      ctx.lineTo(x1 + n2x * r1, y1 + n2y * r1)
      ctx.lineTo(x0 + n2x * r0, y0 + n2y * r0)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, v: View, color = '#000') {
  const n = s.pts.length / 3
  for (let i = 0; i < n; i++) drawSegment(ctx, s, i, v, color)
}

/**
 * Paints a glyph's ink (traced picture, then strokes and eraser marks) onto a
 * transparent canvas. Masks must already be loaded (see preloadGlyph).
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, g: GlyphData, v: View, color = '#000') {
  if (g.image) {
    const img = maskCache.get(g.image.mask)
    if (img?.complete && img.naturalWidth) {
      const { x, y, w, h } = g.image
      ctx.save()
      // Tint the mask: draw it, then fill over it using its own alpha.
      ctx.drawImage(img, (x - v.x0) * v.scale, (v.y0 - y) * v.scale, w * v.scale, h * v.scale)
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.restore()
    }
  }
  for (const s of g.strokes) drawStroke(ctx, s, v, color)
}

/**
 * Turns an uploaded picture into a black-on-transparent mask PNG: dark pixels
 * become ink. Large images are scaled down so projects stay small.
 */
export async function imageToMask(file: Blob, threshold = 0.5, maxSide = 900): Promise<{ mask: string; aspect: number }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  const d = data.data
  // Otsu-free but robust: compare against the midpoint of the darkest and
  // lightest tones, nudged by the user's threshold.
  let lo = 255, hi = 0
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    if (l < lo) lo = l
    if (l > hi) hi = l
  }
  const cut = lo + (hi - lo) * threshold
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const ink = hi - lo > 20 && l < cut
    d[i] = d[i + 1] = d[i + 2] = 0
    d[i + 3] = ink ? 255 : 0
  }
  ctx.putImageData(data, 0, 0)
  return { mask: c.toDataURL('image/png'), aspect: w / h }
}

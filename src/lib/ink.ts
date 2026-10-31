import type { GlyphData, Stroke } from './types.ts'

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

  if (s.tool === 'nib') {
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
    const w = pressureWidth(s.size, (pr0 + pr1) / 2) * v.scale
    if (!hasPrev || (x0 === x1 && y0 === y1)) {
      ctx.beginPath()
      ctx.arc(x1, y1, w / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
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

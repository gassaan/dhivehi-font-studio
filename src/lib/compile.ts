import { CHARS, GUIDE_BASE_CP, isMark } from './charset.ts'
import { drawGlyph, preloadGlyph } from './ink.ts'
import { traceBitmap, type Contour } from './trace.ts'
import { buildTTF, type Anchor, type MarkClassData, type SfntGlyph } from './sfnt.ts'
import { ASCENDER, DESCENDER, FRAME, UPM, hasInk, type GlyphData, type Project } from './types.ts'

const RASTER_SCALE = 0.8 // pixels per font unit when tracing

interface Traced {
  contours: Contour[]
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const cache = new Map<string, Traced | null>()

function inkBounds(g: GlyphData) {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
  const add = (x: number, y: number, r: number) => {
    xMin = Math.min(xMin, x - r); xMax = Math.max(xMax, x + r)
    yMin = Math.min(yMin, y - r); yMax = Math.max(yMax, y + r)
  }
  for (const s of g.strokes) {
    if (s.tool === 'eraser') continue
    for (let i = 0; i < s.pts.length; i += 3) add(s.pts[i], s.pts[i + 1], s.size / 2 + 4)
  }
  if (g.image) {
    add(g.image.x, g.image.y, 0)
    add(g.image.x + g.image.w, g.image.y - g.image.h, 0)
  }
  // Never trace absurdly far outside the drawing frame.
  const m = 300
  return {
    xMin: Math.max(FRAME.left - m, Math.floor(xMin)), xMax: Math.min(FRAME.right + m, Math.ceil(xMax)),
    yMin: Math.max(FRAME.bottom - m, Math.floor(yMin)), yMax: Math.min(FRAME.top + m, Math.ceil(yMax)),
  }
}

/** Rasterises a glyph's ink and traces it into outlines in font units. */
export async function traceGlyph(g: GlyphData, smoothing: number, key?: string): Promise<Traced | null> {
  const cacheKey = key ? `${key}:${g.updatedAt}:${smoothing}` : ''
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)!
  if (!hasInk(g)) return null
  await preloadGlyph(g)
  const b = inkBounds(g)
  if (b.xMax <= b.xMin || b.yMax <= b.yMin) return null
  const pad = 4 // pixels of paper around the ink so every contour closes
  const w = Math.ceil((b.xMax - b.xMin) * RASTER_SCALE) + pad * 2
  const h = Math.ceil((b.yMax - b.yMin) * RASTER_SCALE) + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const view = { x0: b.xMin - pad / RASTER_SCALE, y0: b.yMax + pad / RASTER_SCALE, scale: RASTER_SCALE }
  drawGlyph(ctx, g, view)
  const rgba = ctx.getImageData(0, 0, w, h).data
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0

  const raw = traceBitmap(ink, w, h, smoothing)
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
  const contours = raw.map((c) => c.map((p) => {
    const x = Math.round(view.x0 + p.x / RASTER_SCALE)
    const y = Math.round(view.y0 - p.y / RASTER_SCALE)
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x)
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y)
    return { x, y, on: p.on }
  }))
  const result = contours.length ? { contours, xMin, xMax, yMin, yMax } : null
  if (cacheKey) cache.set(cacheKey, result)
  return result
}

const shift = (contours: Contour[], dx: number): Contour[] =>
  contours.map((c) => c.map((p) => ({ x: p.x + dx, y: p.y, on: p.on })))

function notdef(): Contour[] {
  const box = (x0: number, y0: number, x1: number, y1: number, cw: boolean) => {
    const pts = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]
    if (!cw) pts.reverse()
    return pts.map(([x, y]) => ({ x, y, on: true }))
  }
  return [box(50, 0, 450, 600, true), box(100, 50, 400, 550, false)]
}

export interface CompileResult {
  ttf: Uint8Array
  glyphCount: number
  drawn: Set<number>
}

export async function compileProject(p: Project): Promise<CompileResult> {
  const s = p.settings
  const glyphs: SfntGlyph[] = [
    { name: '.notdef', unicodes: [], advance: 500, contours: notdef() },
    { name: 'space', unicodes: [0x20, 0xa0], advance: s.spaceWidth, contours: [] },
    { name: 'zwnj', unicodes: [0x200c, 0x200d], advance: 0, contours: [] },
  ]
  const above: MarkClassData = { marks: new Map(), bases: new Map() }
  const below: MarkClassData = { marks: new Map(), bases: new Map() }
  const drawn = new Set<number>()

  // Where fili were drawn relative to: the designer's own baa, if any.
  const guide = p.glyphs[GUIDE_BASE_CP]
  const guideT = guide ? await traceGlyph(guide, s.smoothing, String(GUIDE_BASE_CP)) : null
  const markTopY = Math.max(s.letterHeight, guideT?.yMax ?? s.letterHeight)
  const markBottomY = Math.min(0, guideT?.yMin ?? 0)
  const frameCenter = (FRAME.left + FRAME.right) / 2

  for (const c of CHARS) {
    const g = p.glyphs[c.cp]
    if (!g || !hasInk(g)) continue
    const t = await traceGlyph(g, s.smoothing, String(c.cp))
    if (!t) continue
    drawn.add(c.cp)
    const gid = glyphs.length
    if (isMark(c.kind)) {
      // Fili keep their drawn position; the anchor ties the guide letter's
      // centre to the base letter's centre.
      glyphs.push({ name: c.name, unicodes: [c.cp], advance: 0, contours: t.contours, isMark: true })
      const anchor: Anchor = c.kind === 'markAbove' ? { x: frameCenter, y: markTopY } : { x: frameCenter, y: markBottomY }
      ;(c.kind === 'markAbove' ? above : below).marks.set(gid, anchor)
      continue
    }
    const lsb = s.sideBearing + g.lsbAdjust
    const rsb = s.sideBearing + g.rsbAdjust
    const dx = lsb - t.xMin
    const width = t.xMax - t.xMin
    glyphs.push({ name: c.name, unicodes: [c.cp], advance: Math.max(0, width + lsb + rsb), contours: shift(t.contours, dx) })
    if (c.kind === 'letter') {
      const cx = Math.round(lsb + width / 2)
      above.bases.set(gid, { x: cx, y: Math.max(s.letterHeight, t.yMax) })
      below.bases.set(gid, { x: cx, y: Math.min(0, t.yMin) })
    }
  }

  const ttf = buildTTF({
    family: p.name.trim() || 'My Dhivehi Font',
    style: 'Regular',
    version: p.version || '1.000',
    designer: p.designer,
    license: p.license,
    unitsPerEm: UPM,
    ascender: ASCENDER,
    descender: DESCENDER,
    xHeight: s.letterHeight,
    glyphs,
    markClasses: [above, below],
  })
  return { ttf, glyphCount: glyphs.length, drawn }
}

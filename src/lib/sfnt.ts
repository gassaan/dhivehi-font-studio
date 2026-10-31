// A small TrueType writer: glyf outlines, cmap, metrics, names, plus GDEF and a
// GPOS mark-to-base lookup so fili sit over (or under) every letter in any
// modern shaping engine (HarfBuzz, CoreText, DirectWrite).

import type { Pt } from './trace.ts'

export interface SfntGlyph {
  name: string
  unicodes: number[]
  advance: number
  contours: Pt[][] // integer font units, on/off-curve flags
  isMark?: boolean
}

export interface Anchor {
  x: number
  y: number
}

export interface MarkClassData {
  /** glyph index -> anchor on the mark */
  marks: Map<number, Anchor>
  /** glyph index -> anchor on the base */
  bases: Map<number, Anchor>
}

export interface SfntInput {
  family: string
  style: string
  version: string // e.g. "1.000"
  designer: string
  license: string
  unitsPerEm: number
  ascender: number
  descender: number
  xHeight: number
  glyphs: SfntGlyph[] // glyph 0 must be .notdef
  /** One entry per mark class (e.g. above, below). */
  markClasses: MarkClassData[]
}

class Buf {
  private bytes: number[] = []
  get length() { return this.bytes.length }
  u8(v: number) { this.bytes.push(v & 0xff); return this }
  u16(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); return this }
  i16(v: number) { return this.u16(v < 0 ? v + 0x10000 : v) }
  u32(v: number) { this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this }
  tag(t: string) { for (let i = 0; i < 4; i++) this.u8(t.charCodeAt(i)); return this }
  raw(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.bytes.push(b[i]); return this }
  pad4() { while (this.bytes.length % 4) this.bytes.push(0); return this }
  /** Overwrite a uint16 at an earlier offset. */
  setU16(off: number, v: number) { this.bytes[off] = (v >> 8) & 0xff; this.bytes[off + 1] = v & 0xff }
  toArray() { return Uint8Array.from(this.bytes) }
}

function checksum(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0
    sum = (sum + v) >>> 0
  }
  return sum
}

const clampI16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)))

interface Bounds { xMin: number; yMin: number; xMax: number; yMax: number }

function boundsOf(contours: Pt[][]): Bounds | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const c of contours) for (const p of c) {
    if (p.x < xMin) xMin = p.x
    if (p.y < yMin) yMin = p.y
    if (p.x > xMax) xMax = p.x
    if (p.y > yMax) yMax = p.y
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax }
}

function encodeGlyph(contours: Pt[][]): { data: Uint8Array; bounds: Bounds | null; points: number } {
  const cs = contours.filter((c) => c.length >= 2)
  const b = boundsOf(cs)
  if (!b) return { data: new Uint8Array(0), bounds: null, points: 0 }
  const g = new Buf()
  g.i16(cs.length).i16(b.xMin).i16(b.yMin).i16(b.xMax).i16(b.yMax)
  let end = -1
  for (const c of cs) { end += c.length; g.u16(end) }
  g.u16(0) // no instructions
  const flags: number[] = [], xs = new Buf(), ys = new Buf()
  let px = 0, py = 0
  for (const c of cs) for (const p of c) {
    const dx = p.x - px, dy = p.y - py
    px = p.x
    py = p.y
    let f = p.on ? 1 : 0
    if (dx === 0) f |= 0x10
    else if (Math.abs(dx) < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)) }
    else xs.i16(dx)
    if (dy === 0) f |= 0x20
    else if (Math.abs(dy) < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)) }
    else ys.i16(dy)
    flags.push(f)
  }
  g.raw(flags).raw(xs.toArray()).raw(ys.toArray())
  return { data: g.toArray(), bounds: b, points: end + 1 }
}

function coverage(gids: number[]): Buf {
  const b = new Buf().u16(1).u16(gids.length)
  for (const g of gids) b.u16(g)
  return b
}

const anchorTable = (a: Anchor) => new Buf().u16(1).i16(a.x).i16(a.y)

function buildGPOS(markClasses: MarkClassData[]): Uint8Array {
  // Merge classes into one MarkBasePos subtable.
  const markGlyphs = new Map<number, { cls: number; a: Anchor }>()
  markClasses.forEach((mc, cls) => mc.marks.forEach((a, gid) => markGlyphs.set(gid, { cls, a })))
  const baseSet = new Set<number>()
  markClasses.forEach((mc) => mc.bases.forEach((_a, gid) => baseSet.add(gid)))
  const marks = [...markGlyphs.keys()].sort((a, b) => a - b)
  const bases = [...baseSet].sort((a, b) => a - b)
  const classCount = markClasses.length

  // --- MarkBasePos format 1 subtable ---
  const markCov = coverage(marks).toArray()
  const baseCov = coverage(bases).toArray()
  // MarkArray
  const markArr = new Buf().u16(marks.length)
  const markAnchors: Uint8Array[] = []
  let off = 2 + marks.length * 4
  for (const g of marks) {
    const m = markGlyphs.get(g)!
    const at = anchorTable(m.a).toArray()
    markArr.u16(m.cls).u16(off)
    markAnchors.push(at)
    off += at.length
  }
  for (const a of markAnchors) markArr.raw(a)
  // BaseArray
  const baseArr = new Buf().u16(bases.length)
  const baseAnchors: Uint8Array[] = []
  off = 2 + bases.length * classCount * 2
  for (const g of bases) {
    for (let c = 0; c < classCount; c++) {
      const a = markClasses[c].bases.get(g)
      if (!a) { baseArr.u16(0); continue }
      const at = anchorTable(a).toArray()
      baseArr.u16(off)
      baseAnchors.push(at)
      off += at.length
    }
  }
  for (const a of baseAnchors) baseArr.raw(a)

  const subHeader = 12
  const sub = new Buf().u16(1)
  let o = subHeader
  sub.u16(o); o += markCov.length
  sub.u16(o); o += baseCov.length
  sub.u16(classCount)
  sub.u16(o); o += markArr.length
  sub.u16(o)
  sub.raw(markCov).raw(baseCov).raw(markArr.toArray()).raw(baseArr.toArray())
  const subtable = sub.toArray()

  // Lookup (type 4, one subtable)
  const lookup = new Buf().u16(4).u16(0).u16(1).u16(8).raw(subtable).toArray()
  const lookupList = new Buf().u16(1).u16(4).raw(lookup).toArray()
  // Feature 'mark' -> lookup 0
  const feature = new Buf().u16(0).u16(1).u16(0).toArray()
  const featureList = new Buf().u16(1).tag('mark').u16(8).raw(feature).toArray()
  // Scripts DFLT and thaa, each with a default LangSys using feature 0
  const langSys = new Buf().u16(0).u16(0xffff).u16(1).u16(0).toArray()
  const script = new Buf().u16(4).u16(0).raw(langSys).toArray()
  const scriptList = new Buf().u16(2)
  const scriptListHeader = 2 + 2 * 6
  scriptList.tag('DFLT').u16(scriptListHeader)
  scriptList.tag('thaa').u16(scriptListHeader + script.length)
  scriptList.raw(script).raw(script)
  const sl = scriptList.toArray()

  const header = 10
  return new Buf()
    .u32(0x00010000)
    .u16(header).u16(header + sl.length).u16(header + sl.length + featureList.length)
    .raw(sl).raw(featureList).raw(lookupList)
    .toArray()
}

function buildGDEF(classes: Map<number, number>): Uint8Array {
  // GlyphClassDef format 2: one range per glyph run with the same class.
  const gids = [...classes.keys()].sort((a, b) => a - b)
  const ranges: [number, number, number][] = []
  for (const g of gids) {
    const c = classes.get(g)!
    const last = ranges[ranges.length - 1]
    if (last && last[1] === g - 1 && last[2] === c) last[1] = g
    else ranges.push([g, g, c])
  }
  const cd = new Buf().u16(2).u16(ranges.length)
  for (const [s, e, c] of ranges) cd.u16(s).u16(e).u16(c)
  // Header v1.0: version, glyphClassDef, attachList, ligCaretList, markAttachClassDef
  return new Buf().u32(0x00010000).u16(12).u16(0).u16(0).u16(0).raw(cd.toArray()).toArray()
}

function buildCmap(map: [number, number][]): Uint8Array {
  map.sort((a, b) => a[0] - b[0])
  // Segments: runs of consecutive code points whose glyph ids are also consecutive.
  const segs: { start: number; end: number; delta: number }[] = []
  for (const [cp, gid] of map) {
    const last = segs[segs.length - 1]
    if (last && last.end === cp - 1 && last.delta === gid - cp) last.end = cp
    else segs.push({ start: cp, end: cp, delta: gid - cp })
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 })
  const segX2 = segs.length * 2
  let sr = 1, es = 0
  while (sr * 2 <= segs.length) { sr *= 2; es++ }
  const sub = new Buf().u16(4).u16(0).u16(0) // length patched later
  sub.u16(segX2).u16(sr * 2).u16(es).u16(segX2 - sr * 2)
  for (const s of segs) sub.u16(s.end)
  sub.u16(0)
  for (const s of segs) sub.u16(s.start)
  for (const s of segs) sub.u16((s.delta + 0x10000) & 0xffff)
  for (let i = 0; i < segs.length; i++) sub.u16(0)
  sub.setU16(2, sub.length)
  const subtable = sub.toArray()
  return new Buf().u16(0).u16(2)
    .u16(0).u16(3).u32(20) // Unicode BMP
    .u16(3).u16(1).u32(20) // Windows Unicode BMP
    .raw(subtable).toArray()
}

function buildName(records: [number, string][]): Uint8Array {
  const strings = new Buf()
  const rec = new Buf()
  for (const [id, text] of records) {
    if (!text) continue
    const start = strings.length
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      if (cp > 0xffff) {
        const v = cp - 0x10000
        strings.u16(0xd800 + (v >> 10)).u16(0xdc00 + (v & 0x3ff))
      } else strings.u16(cp)
    }
    rec.u16(3).u16(1).u16(0x0409).u16(id).u16(strings.length - start).u16(start)
  }
  const count = rec.length / 12
  return new Buf().u16(0).u16(count).u16(6 + count * 12).raw(rec.toArray()).raw(strings.toArray()).toArray()
}

export function postscriptName(family: string, style: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, '')
  const fam = clean(family) || 'DhivehiFont'
  return `${fam}-${clean(style) || 'Regular'}`.slice(0, 63)
}

/** Builds a complete .ttf file. */
export function buildTTF(input: SfntInput): Uint8Array {
  const { glyphs, unitsPerEm } = input
  const numGlyphs = glyphs.length

  // glyf + loca
  const glyf = new Buf()
  const loca: number[] = []
  const metrics: { adv: number; lsb: number; b: Bounds | null }[] = []
  let maxPoints = 0, maxContours = 0
  const all: Bounds = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  let anyBounds = false
  for (const g of glyphs) {
    loca.push(glyf.length)
    const enc = encodeGlyph(g.contours.map((c) => c.map((p) => ({ x: clampI16(p.x), y: clampI16(p.y), on: p.on }))))
    glyf.raw(enc.data).pad4()
    maxPoints = Math.max(maxPoints, enc.points)
    maxContours = Math.max(maxContours, g.contours.length)
    if (enc.bounds) {
      if (!anyBounds) { Object.assign(all, enc.bounds); anyBounds = true }
      all.xMin = Math.min(all.xMin, enc.bounds.xMin); all.yMin = Math.min(all.yMin, enc.bounds.yMin)
      all.xMax = Math.max(all.xMax, enc.bounds.xMax); all.yMax = Math.max(all.yMax, enc.bounds.yMax)
    }
    metrics.push({ adv: Math.max(0, Math.round(g.advance)), lsb: enc.bounds ? enc.bounds.xMin : 0, b: enc.bounds })
  }
  loca.push(glyf.length)
  const locaBuf = new Buf()
  for (const o of loca) locaBuf.u32(o)

  // hmtx / hhea
  const hmtx = new Buf()
  let advMax = 0, minLsb = 32767, minRsb = 32767, maxExtent = -32768
  for (const m of metrics) {
    hmtx.u16(m.adv).i16(m.lsb)
    advMax = Math.max(advMax, m.adv)
    if (m.b) {
      minLsb = Math.min(minLsb, m.b.xMin)
      minRsb = Math.min(minRsb, m.adv - m.b.xMax)
      maxExtent = Math.max(maxExtent, m.b.xMax)
    }
  }
  if (minLsb === 32767) { minLsb = 0; minRsb = 0; maxExtent = 0 }

  const winAscent = Math.max(input.ascender, all.yMax)
  const winDescent = Math.max(-input.descender, -all.yMin)
  const lineGap = 0

  const hhea = new Buf().u32(0x00010000)
    .i16(winAscent).i16(-winDescent).i16(lineGap)
    .u16(advMax).i16(minLsb).i16(minRsb).i16(maxExtent)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0)
    .u16(numGlyphs)

  const maxp = new Buf().u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours)
    .u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0)

  // head (checkSumAdjustment patched at the end)
  const now = Math.floor(Date.now() / 1000) + 2082844800 // seconds since 1904
  const hi = Math.floor(now / 0x100000000), lo = now >>> 0
  const [major, minor] = input.version.split('.').map((n) => parseInt(n, 10) || 0)
  const head = new Buf().u32(0x00010000).u16(major || 1).u16(Math.round(((minor || 0) / 1000) * 65536) & 0xffff)
    .u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(unitsPerEm)
    .u32(hi).u32(lo).u32(hi).u32(lo)
    .i16(all.xMin).i16(all.yMin).i16(all.xMax).i16(all.yMax)
    .u16(0).u16(8).i16(2).i16(1).i16(0)

  // cmap
  const cmapPairs: [number, number][] = []
  glyphs.forEach((g, gid) => g.unicodes.forEach((u) => cmapPairs.push([u, gid])))
  const cps = cmapPairs.map((p) => p[0])

  // OS/2 v4
  const advs = metrics.filter((m) => m.adv > 0)
  const avg = advs.length ? Math.round(advs.reduce((s, m) => s + m.adv, 0) / advs.length) : 0
  const hasLatin = cps.some((c) => c >= 0x20 && c < 0x7f)
  const hasThaana = cps.some((c) => c >= 0x0780 && c <= 0x07bf)
  const hasArabicPunct = cps.some((c) => c >= 0x0600 && c <= 0x06ff)
  let ur1 = 0
  if (hasLatin) ur1 |= 1 << 0
  if (hasArabicPunct) ur1 |= 1 << 13
  const ur3 = hasThaana ? 1 << 8 : 0 // bit 72: Thaana
  const os2 = new Buf().u16(4).i16(avg).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350)
    .i16(50).i16(Math.round(input.xHeight / 2))
    .i16(0)
    .raw([2, 0, 5, 3, 0, 0, 0, 0, 0, 0])
    .u32(ur1).u32(0).u32(ur3).u32(0)
    .tag('DVFS')
    .u16(0x00c0) // REGULAR | USE_TYPO_METRICS
    .u16(Math.min(0xffff, Math.min(...cps)))
    .u16(Math.min(0xffff, Math.max(...cps)))
    .i16(input.ascender).i16(input.descender).i16(lineGap)
    .u16(winAscent).u16(winDescent)
    .u32(hasLatin ? 1 : 0).u32(0)
    .i16(input.xHeight).i16(input.ascender - 100)
    .u16(0).u16(32).u16(2)

  const ps = postscriptName(input.family, input.style)
  const name = buildName([
    [0, `Made with Dhivehi Font Studio${input.designer ? ' by ' + input.designer : ''}`],
    [1, input.family],
    [2, input.style],
    [3, `${input.version};DVFS;${ps}`],
    [4, `${input.family} ${input.style}`],
    [5, `Version ${input.version}`],
    [6, ps],
    [9, input.designer],
    [13, input.license],
  ])

  const post = new Buf().u32(0x00030000).u32(0).i16(-120).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0)

  // GDEF / GPOS
  const classes = new Map<number, number>()
  glyphs.forEach((g, gid) => { if (gid > 0) classes.set(gid, g.isMark ? 3 : 1) })
  const hasMarks = input.markClasses.some((m) => m.marks.size && m.bases.size)

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2.toArray()],
    ['cmap', buildCmap(cmapPairs)],
    ['glyf', glyf.toArray()],
    ['head', head.toArray()],
    ['hhea', hhea.toArray()],
    ['hmtx', hmtx.toArray()],
    ['loca', locaBuf.toArray()],
    ['maxp', maxp.toArray()],
    ['name', name],
    ['post', post.toArray()],
  ]
  if (classes.size) tables.push(['GDEF', buildGDEF(classes)])
  if (hasMarks) tables.push(['GPOS', buildGPOS(input.markClasses.filter((m) => m.marks.size && m.bases.size))])
  tables.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  return assemble(tables)
}

function assemble(tables: [string, Uint8Array][]): Uint8Array {
  const n = tables.length
  let sr = 1, es = 0
  while (sr * 2 <= n) { sr *= 2; es++ }
  const dirLen = 12 + n * 16
  const font = new Buf().u32(0x00010000).u16(n).u16(sr * 16).u16(es).u16(n * 16 - sr * 16)
  let off = dirLen
  let headOffset = 0
  for (const [tag, data] of tables) {
    if (tag === 'head') headOffset = off
    font.tag(tag).u32(checksum(data)).u32(off).u32(data.length)
    off += (data.length + 3) & ~3
  }
  for (const [, data] of tables) font.raw(data).pad4()
  const out = font.toArray()
  const adj = (0xb1b0afba - checksum(out)) >>> 0
  new DataView(out.buffer).setUint32(headOffset + 8, adj)
  return out
}

/** Wraps a TTF into WOFF 1.0 using the browser's zlib (CompressionStream 'deflate'). */
export async function ttfToWoff(ttf: Uint8Array): Promise<Uint8Array> {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
  const n = dv.getUint16(4)
  const entries: { tag: number; checksum: number; orig: Uint8Array; comp: Uint8Array }[] = []
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    const off = dv.getUint32(r + 8), len = dv.getUint32(r + 12)
    const orig = ttf.subarray(off, off + len)
    const comp = await deflate(orig)
    entries.push({ tag: dv.getUint32(r), checksum: dv.getUint32(r + 4), orig, comp: comp.length < orig.length ? comp : orig })
  }
  const headerLen = 44 + n * 20
  let total = headerLen
  for (const e of entries) total += (e.comp.length + 3) & ~3
  const sfntSize = 12 + n * 16 + entries.reduce((s, e) => s + ((e.orig.length + 3) & ~3), 0)
  const w = new Buf().tag('wOFF').u32(0x00010000).u32(total).u16(n).u16(0).u32(sfntSize)
    .u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0)
  let off = headerLen
  for (const e of entries) {
    w.u32(e.tag).u32(off).u32(e.comp.length).u32(e.orig.length).u32(e.checksum)
    off += (e.comp.length + 3) & ~3
  }
  for (const e of entries) w.raw(e.comp).pad4()
  return w.toArray()
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

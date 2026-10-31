// Builds a small synthetic font with the TTF writer and checks it with
// fontTools, the OpenType Sanitizer (what browsers run) and HarfBuzz.
// Run: npm test   (needs: pip install fonttools uharfbuzz opentype-sanitizer)
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildTTF, ttfToWoff, type SfntGlyph } from '../src/lib/sfnt.ts'

const rect = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0, y0], [x0, y1], [x1, y1], [x1, y0]].map(([x, y]) => ({ x, y, on: true }))
// A rounded blob built from off-curve points only (implied on-curve midpoints).
const blob = (cx: number, cy: number, r: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = -(i / 8) * Math.PI * 2 // clockwise
    return { x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r), on: false }
  })

const glyphs: SfntGlyph[] = [
  { name: '.notdef', unicodes: [], advance: 500, contours: [rect(50, 0, 450, 600)] },
  { name: 'space', unicodes: [0x20], advance: 250, contours: [] },
  { name: 'baa', unicodes: [0x0784], advance: 500, contours: [rect(40, 0, 460, 400)] },
  { name: 'haa', unicodes: [0x0780], advance: 700, contours: [rect(40, 0, 660, 500)] },
  { name: 'abafili', unicodes: [0x07a6], advance: 0, contours: [blob(500, 560, 60)], isMark: true },
  { name: 'ibifili', unicodes: [0x07a8], advance: 0, contours: [rect(450, -200, 550, -100)], isMark: true },
]
const ttf = buildTTF({
  family: 'Test ތާނަ', style: 'Regular', version: '1.000', designer: 'Tester', license: 'OFL',
  unitsPerEm: 1000, ascender: 800, descender: -300, xHeight: 450, glyphs,
  markClasses: [
    { marks: new Map([[4, { x: 500, y: 450 }]]), bases: new Map([[2, { x: 250, y: 450 }], [3, { x: 350, y: 500 }]]) },
    { marks: new Map([[5, { x: 500, y: 0 }]]), bases: new Map([[2, { x: 250, y: 0 }], [3, { x: 350, y: 0 }]]) },
  ],
})
const dir = mkdtempSync(join(tmpdir(), 'dvfs-'))
const path = join(dir, 'test.ttf')
writeFileSync(path, ttf)
writeFileSync(join(dir, 'test.woff'), await ttfToWoff(ttf))

const py = String.raw`
import sys, uharfbuzz as hb, ots
from fontTools.ttLib import TTFont
from fontTools.pens.areaPen import AreaPen
path = sys.argv[1]
for p in (path, path.replace('.ttf', '.woff')):
    r = ots.sanitize(p, '/dev/null', capture_output=True)
    assert r.returncode == 0, ('OTS rejected', p, r.stderr)
f = TTFont(path)
gs = f.getGlyphSet()
for name in f.getGlyphOrder():
    pen = AreaPen(gs); gs[name].draw(pen)
    # fontTools AreaPen: clockwise (TrueType outer) contours give negative area.
    assert pen.value <= 0, ('wrong winding', name, pen.value)
assert f['name'].getDebugName(1) == 'Test ތާނަ'
blob = hb.Blob.from_file_path(path); font = hb.Font(hb.Face(blob))
def shape(text):
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf)
    return [(font.glyph_to_string(i.codepoint), p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]
out = shape('ބަ')
print('baa+abafili', out)
marks = {g: (xa, xo, yo) for g, xa, xo, yo in out}
assert marks['gid4'][0] == 0, 'mark should have zero advance'
# baa anchor x=250 relative to its own origin; mark anchor x=500: offset = 250-500 = -250
# (RTL: mark is emitted before its base, pen at the base origin).
assert marks['gid4'][1] == -250 and marks['gid4'][2] == 0, marks
out = shape('ހިބަ')
print('haa+ibifili baa+abafili', out)
d = {g: (xa, xo, yo) for g, xa, xo, yo in out}
assert d['gid5'][2] == 0 and d['gid5'][1] == 350 - 500, d
print('OK: OTS clean, winding correct, fili attach to bases')
`
console.log(execFileSync('python3', ['-c', py, path], { encoding: 'utf8' }))

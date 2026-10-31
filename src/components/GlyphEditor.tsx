import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CHARS, CHAR_BY_CP, GUIDE_BASE_CP, displayChar, isMark } from '../lib/charset.ts'
import { traceGlyph } from '../lib/compile.ts'
import { drawGlyph, drawSegment, imageToMask, preloadGlyph, type View } from '../lib/ink.ts'
import { FRAME, FRAME_H, FRAME_W, emptyGlyph, hasInk, type GlyphData, type Project, type Stroke, type Tool } from '../lib/types.ts'
import { Icons, cssVar } from './ui.tsx'
import type { Compiled, Update } from './Workspace.tsx'

type Mode = Tool | 'move'

interface Props {
  project: Project
  cp: number
  update: Update
  compiled: Compiled | null
  onNavigate: (cp: number) => void
  onClose: () => void
}

const REF_FONT = '"Noto Sans Thaana", "MV Boli", sans-serif'
const prefKey = 'dvfs-pen'

function loadPrefs() {
  try {
    return { size: 60, angle: 35, stabilizer: 0.35, mode: 'brush' as Mode, ...JSON.parse(localStorage.getItem(prefKey) || '{}') }
  } catch {
    return { size: 60, angle: 35, stabilizer: 0.35, mode: 'brush' as Mode }
  }
}

export default function GlyphEditor({ project, cp, update, compiled, onNavigate, onClose }: Props) {
  const info = CHAR_BY_CP.get(cp) ?? CHARS[0]
  const mark = isMark(info.kind)
  const settings = project.settings
  const glyph = project.glyphs[cp] ?? emptyGlyph()

  const prefs = useRef(loadPrefs())
  const [mode, setMode] = useState<Mode>(prefs.current.mode === 'move' ? 'brush' : prefs.current.mode)
  const [size, setSize] = useState<number>(prefs.current.size)
  const [angle, setAngle] = useState<number>(prefs.current.angle)
  const [stabilizer, setStabilizer] = useState<number>(prefs.current.stabilizer)
  const [showRef, setShowRef] = useState(true)
  const [history, setHistory] = useState<{ past: GlyphData[]; future: GlyphData[] }>({ past: [], future: [] })
  const [threshold, setThreshold] = useState(0.5)
  const sourceFile = useRef<File | null>(null)

  useEffect(() => {
    try { localStorage.setItem(prefKey, JSON.stringify({ size, angle, stabilizer, mode })) } catch { /* private mode */ }
  }, [size, angle, stabilizer, mode])

  const stageRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 400, h: 480 })
  const dpr = Math.min(2, window.devicePixelRatio || 1)

  // Fit the drawing frame into the stage.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      const availW = r.width - 28, availH = r.height - 28
      const k = Math.max(0.1, Math.min(availW / FRAME_W, availH / FRAME_H))
      setBox({ w: Math.floor(FRAME_W * k), h: Math.floor(FRAME_H * k) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view: View = { x0: FRAME.left, y0: FRAME.top, scale: (box.h * dpr) / FRAME_H }
  const toUnits = (e: { clientX: number; clientY: number }) => {
    const r = inkRef.current!.getBoundingClientRect()
    return {
      x: FRAME.left + ((e.clientX - r.left) / r.width) * FRAME_W,
      y: FRAME.top - ((e.clientY - r.top) / r.height) * FRAME_H,
    }
  }

  // ---------- Commit changes (with undo) ----------
  const commit = useCallback((next: GlyphData) => {
    setHistory((h) => ({ past: [...h.past.slice(-60), glyph], future: [] }))
    update((p) => ({ ...p, glyphs: { ...p.glyphs, [cp]: { ...next, updatedAt: Date.now() } } }))
  }, [glyph, cp, update])

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length) return h
      const prev = h.past[h.past.length - 1]
      update((p) => ({ ...p, glyphs: { ...p.glyphs, [cp]: { ...prev, updatedAt: Date.now() } } }))
      return { past: h.past.slice(0, -1), future: [glyph, ...h.future] }
    })
  }, [glyph, cp, update])

  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length) return h
      const next = h.future[0]
      update((p) => ({ ...p, glyphs: { ...p.glyphs, [cp]: { ...next, updatedAt: Date.now() } } }))
      return { past: [...h.past, glyph], future: h.future.slice(1) }
    })
  }, [glyph, cp, update])

  // ---------- Background: guides, reference letter, guide base for fili ----------
  const guide = project.glyphs[GUIDE_BASE_CP]
  const [guideCenter, setGuideCenter] = useState<number | null>(null)
  useEffect(() => {
    if (!mark || !hasInk(guide)) { setGuideCenter(null); return }
    traceGlyph(guide!, settings.smoothing, String(GUIDE_BASE_CP)).then((t) => setGuideCenter(t ? (t.xMin + t.xMax) / 2 : null))
  }, [mark, guide, settings.smoothing])

  useEffect(() => {
    let live = true
    const draw = async () => {
      const c = bgRef.current
      if (!c) return
      await document.fonts.load(`100px ${REF_FONT}`, 'ބ').catch(() => {})
      if (guide) await preloadGlyph(guide).catch(() => {})
      if (!live) return
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      const Y = (y: number) => (view.y0 - y) * view.scale
      const W = c.width
      const lh = settings.letterHeight

      // Fili zones
      ctx.fillStyle = cssVar('--zone')
      ctx.fillRect(0, Y(FRAME.top), W, Y(lh + 40) - Y(FRAME.top))
      ctx.fillRect(0, Y(-40), W, Y(FRAME.bottom) - Y(-40))

      const ghost = cssVar('--ghost')
      const center = (FRAME.left + FRAME.right) / 2
      // Reference letter from a standard Thaana font, scaled to the letter height.
      ctx.font = `100px ${REF_FONT}`
      const m = ctx.measureText('ބ')
      const k = m.actualBoundingBoxAscent > 0 ? lh / m.actualBoundingBoxAscent : 4
      const fontPx = 100 * k * view.scale
      ctx.font = `${fontPx}px ${REF_FONT}`
      ctx.textBaseline = 'alphabetic'
      ctx.direction = 'rtl'

      const baseDrawn = mark && hasInk(guide) && guideCenter !== null
      if (baseDrawn) {
        // The designer's own baa, centred, so fili are drawn in context.
        const tmp = document.createElement('canvas')
        tmp.width = c.width
        tmp.height = c.height
        const shiftX = center - guideCenter!
        // Paint opaque, then fade the whole layer, so overlapping strokes stay even.
        drawGlyph(tmp.getContext('2d')!, guide!, { ...view, x0: view.x0 - shiftX }, cssVar('--ink'))
        ctx.globalAlpha = 0.14
        ctx.drawImage(tmp, 0, 0)
        ctx.globalAlpha = 1
      }
      if (showRef || (mark && !baseDrawn)) {
        // Centre the reference on the frame (for fili: centre the base letter).
        ctx.direction = 'ltr'
        ctx.textAlign = 'left'
        const mm = ctx.measureText(mark ? 'ބ' : info.char)
        const x = center * view.scale - (mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2
        if (mark && baseDrawn) {
          // Only the reference fili, faint: draw base+fili, then knock the base out.
          const t2 = document.createElement('canvas')
          t2.width = c.width
          t2.height = c.height
          const c2 = t2.getContext('2d')!
          c2.font = ctx.font
          c2.fillStyle = cssVar('--muted')
          c2.fillText('ބ' + info.char, x, Y(0))
          c2.globalCompositeOperation = 'destination-out'
          c2.fillText('ބ', x, Y(0))
          c2.lineWidth = 3 * dpr // also remove the anti-aliased fringe
          c2.strokeText('ބ', x, Y(0))
          ctx.globalAlpha = 0.3
          ctx.drawImage(t2, 0, 0)
          ctx.globalAlpha = 1
        } else {
          ctx.fillStyle = ghost
          ctx.fillText(mark ? 'ބ' + info.char : info.char, x, Y(0))
        }
      }

      // Guide lines
      const line = (y: number, label: string, strong = false) => {
        ctx.strokeStyle = cssVar('--guide')
        ctx.globalAlpha = strong ? 0.7 : 0.35
        ctx.lineWidth = strong ? 2 * dpr : 1 * dpr
        ctx.setLineDash(strong ? [] : [6 * dpr, 6 * dpr])
        ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 0.8
        ctx.fillStyle = cssVar('--guide')
        ctx.font = `${11 * dpr}px system-ui, sans-serif`
        ctx.direction = 'ltr'
        ctx.textAlign = 'left'
        ctx.fillText(label, 8 * dpr, Y(y) - 5 * dpr)
        ctx.globalAlpha = 1
      }
      line(0, 'Baseline', true)
      line(lh, 'Letter height')
      ctx.fillStyle = cssVar('--guide')
      ctx.globalAlpha = 0.55
      ctx.font = `${11 * dpr}px system-ui, sans-serif`
      ctx.fillText('Fili above', 8 * dpr, Y(FRAME.top) + 16 * dpr)
      ctx.fillText('Fili below', 8 * dpr, Y(FRAME.bottom) - 8 * dpr)
      ctx.globalAlpha = 1
    }
    draw()
    return () => { live = false }
  }, [box, dpr, showRef, mark, info.char, guide, guideCenter, settings.letterHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Ink layer ----------
  const redrawInk = useCallback(async (g: GlyphData) => {
    await preloadGlyph(g).catch(() => {})
    const c = inkRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    drawGlyph(ctx, g, { x0: FRAME.left, y0: FRAME.top, scale: c.height / FRAME_H }, cssVar('--ink'))
  }, [])

  useEffect(() => { redrawInk(glyph) }, [glyph, box, redrawInk])

  // ---------- Pointer drawing ----------
  const live = useRef<{ stroke: Stroke; sx: number; sy: number } | null>(null)
  const dragImg = useRef<{ x: number; y: number; ix: number; iy: number } | null>(null)

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toUnits(e)
    if (mode === 'move') {
      if (glyph.image) dragImg.current = { x: p.x, y: p.y, ix: glyph.image.x, iy: glyph.image.y }
      return
    }
    const pr = e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 1
    const stroke: Stroke = { tool: mode, size, angle, pts: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, pr] }
    live.current = { stroke, sx: p.x, sy: p.y }
    const ctx = inkRef.current!.getContext('2d')!
    drawSegment(ctx, stroke, 0, { x0: FRAME.left, y0: FRAME.top, scale: inkRef.current!.height / FRAME_H }, cssVar('--ink'))
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragImg.current && glyph.image) {
      const p = toUnits(e)
      const d = dragImg.current
      const img = { ...glyph.image, x: Math.round(d.ix + p.x - d.x), y: Math.round(d.iy + p.y - d.y) }
      redrawInk({ ...glyph, image: img })
      return
    }
    const l = live.current
    if (!l) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const ctx = inkRef.current!.getContext('2d')!
    const v = { x0: FRAME.left, y0: FRAME.top, scale: inkRef.current!.height / FRAME_H }
    for (const ev of events) {
      const p = toUnits(ev)
      // Stabilizer: the pen trails the pointer a little, smoothing out jitter.
      const k = 1 - stabilizer * 0.85
      l.sx += (p.x - l.sx) * k
      l.sy += (p.y - l.sy) * k
      const pts = l.stroke.pts
      const lx = pts[pts.length - 3], ly = pts[pts.length - 2]
      if (Math.hypot(l.sx - lx, l.sy - ly) < 2) continue
      const pr = ev.pointerType === 'pen' ? Math.max(0.05, ev.pressure) : 1
      pts.push(Math.round(l.sx * 10) / 10, Math.round(l.sy * 10) / 10, pr)
      drawSegment(ctx, l.stroke, pts.length / 3 - 1, v, cssVar('--ink'))
    }
  }

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragImg.current && glyph.image) {
      const p = toUnits(e)
      const d = dragImg.current
      dragImg.current = null
      commit({ ...glyph, image: { ...glyph.image, x: Math.round(d.ix + p.x - d.x), y: Math.round(d.iy + p.y - d.y) } })
      return
    }
    const l = live.current
    live.current = null
    if (!l) return
    commit({ ...glyph, strokes: [...glyph.strokes, l.stroke] })
  }

  // ---------- Picture tracing ----------
  const fileRef = useRef<HTMLInputElement>(null)
  const placeImage = async (file: File, th: number, keepPlacement: boolean) => {
    const { mask, aspect } = await imageToMask(file, th)
    let { x, y, w, h } = glyph.image ?? { x: 0, y: 0, w: 0, h: 0 }
    if (!keepPlacement || !glyph.image) {
      // Fit the picture around the letter zone, centred.
      h = mark ? 500 : settings.letterHeight * 1.6
      w = h * aspect
      if (w > 900) { w = 900; h = w / aspect }
      x = (FRAME.left + FRAME.right) / 2 - w / 2
      y = mark ? (info.kind === 'markAbove' ? 820 : 0) : settings.letterHeight + (h - settings.letterHeight) / 2
    } else {
      h = w / aspect
    }
    commit({ ...glyph, image: { mask, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } })
  }
  const scaleImage = (factor: number) => {
    if (!glyph.image) return
    const im = glyph.image
    const cx = im.x + im.w / 2, cy = im.y - im.h / 2
    const w = im.w * factor, h = im.h * factor
    commit({ ...glyph, image: { ...im, w: Math.round(w), h: Math.round(h), x: Math.round(cx - w / 2), y: Math.round(cy + h / 2) } })
  }

  // ---------- Navigation & shortcuts ----------
  const idx = CHARS.findIndex((c) => c.cp === cp)
  const prev = CHARS[(idx - 1 + CHARS.length) % CHARS.length]
  const next = CHARS[(idx + 1) % CHARS.length]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onNavigate(next.cp)
      else if (e.key === 'ArrowLeft') onNavigate(prev.cp)
      else if (e.key === 'b') setMode('brush')
      else if (e.key === 'n') setMode('nib')
      else if (e.key === 'e') setMode('eraser')
      else if (e.key === '[') setSize((s) => Math.max(8, s - 6))
      else if (e.key === ']') setSize((s) => Math.min(200, s + 6))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, onClose, onNavigate, next.cp, prev.cp])

  // Live test strip using the compiled font.
  const sample = mark
    ? ['ބ', 'ހ', 'ނ', 'ކ', 'ލ', 'ތ'].map((b) => b + info.char).join(' ')
    : info.group === 'core' || info.group === 'extended'
      ? `ބ${info.char}ބ ${info.char}${info.char}${info.char} ހ${info.char}ނ ${info.char}ަ${info.char}ި`
      : `${info.char}${info.char} ބ${info.char}ހ 12${info.char}`
  const inFont = compiled?.drawn.has(cp)

  return (
    <div className="editor" role="dialog" aria-label={`Draw ${info.name}`}>
      <div className="ed-top">
        <button className="btn ghost small" onClick={onClose}>{Icons.close} Done</button>
        <div className="ed-title">
          <span className="big">{displayChar(info)}</span>
          <div><b>{info.name}</b><small>U+{cp.toString(16).toUpperCase().padStart(4, '0')} · {mark ? (info.kind === 'markAbove' ? 'fili above' : 'fili below') : info.group === 'core' ? 'letter' : info.group}</small></div>
        </div>
        <span className="spacer" />
        <button className="btn small" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)">{Icons.undo}</button>
        <button className="btn small" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)">{Icons.redo}</button>
        <button className="btn small" onClick={() => onNavigate(prev.cp)} title="Previous (←)">{Icons.left}<span className="thaana">{displayChar(prev)}</span></button>
        <button className="btn small" onClick={() => onNavigate(next.cp)} title="Next (→)"><span className="thaana">{displayChar(next)}</span>{Icons.right}</button>
      </div>

      <div className="ed-main">
        <aside className="ed-side">
          <div>
            <h4>Tool</h4>
            <div className="tools">
              <button className={`btn ${mode === 'brush' ? 'on' : ''}`} onClick={() => setMode('brush')} title="Round brush (B)">{Icons.brush}Brush</button>
              <button className={`btn ${mode === 'nib' ? 'on' : ''}`} onClick={() => setMode('nib')} title="Calligraphy nib (N)">{Icons.nib}Nib</button>
              <button className={`btn ${mode === 'eraser' ? 'on' : ''}`} onClick={() => setMode('eraser')} title="Eraser (E)">{Icons.eraser}Eraser</button>
              <button className={`btn ${mode === 'move' ? 'on' : ''}`} onClick={() => setMode('move')} disabled={!glyph.image} title="Move the picture">{Icons.move}Move pic</button>
            </div>
          </div>
          <div>
            <div className="slider-row"><span>Size</span><b>{size}</b></div>
            <input type="range" min={8} max={200} value={size} onChange={(e) => setSize(+e.target.value)} aria-label="Pen size" />
          </div>
          {mode === 'nib' && (
            <div>
              <div className="slider-row"><span>Nib angle</span><b>{angle}°</b></div>
              <input type="range" min={0} max={180} value={angle} onChange={(e) => setAngle(+e.target.value)} aria-label="Nib angle" />
            </div>
          )}
          <div>
            <div className="slider-row"><span>Steady hand</span><b>{Math.round(stabilizer * 100)}%</b></div>
            <input type="range" min={0} max={0.9} step={0.05} value={stabilizer} onChange={(e) => setStabilizer(+e.target.value)} aria-label="Stabilizer" />
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <label className="check"><input type="checkbox" checked={showRef} onChange={(e) => setShowRef(e.target.checked)} />Show reference letter</label>
            <button className="btn small danger" disabled={!hasInk(glyph)} onClick={() => commit({ ...emptyGlyph(), lsbAdjust: glyph.lsbAdjust, rsbAdjust: glyph.rsbAdjust })}>{Icons.trash} Clear</button>
          </div>
          <div>
            <h4>Trace a picture</h4>
            <p className="muted small" style={{ margin: '0 0 8px' }}>Write the letter on paper with a dark pen, take a photo, and it becomes ink you can tidy with the eraser.</p>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) { sourceFile.current = f; placeImage(f, threshold, false) }
              e.target.value = ''
            }} />
            <button className="btn small" onClick={() => fileRef.current?.click()}>{Icons.image} {glyph.image ? 'Replace picture' : 'Add picture'}</button>
            {glyph.image && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={() => scaleImage(1 / 1.1)}>Smaller</button>
                  <button className="btn small" onClick={() => scaleImage(1.1)}>Bigger</button>
                  <button className="btn small danger" onClick={() => commit({ ...glyph, image: undefined })}>Remove</button>
                </div>
                {sourceFile.current && (
                  <div>
                    <div className="slider-row"><span>Ink darkness</span><b>{Math.round(threshold * 100)}%</b></div>
                    <input type="range" min={0.15} max={0.85} step={0.05} value={threshold} aria-label="Ink threshold"
                      onChange={(e) => setThreshold(+e.target.value)}
                      onPointerUp={() => sourceFile.current && placeImage(sourceFile.current, threshold, true)}
                      onKeyUp={() => sourceFile.current && placeImage(sourceFile.current, threshold, true)} />
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <div className="stage" ref={stageRef}>
          <div className="paper" style={{ width: box.w, height: box.h }}>
            <canvas ref={bgRef} width={box.w * dpr} height={box.h * dpr} />
            <canvas ref={inkRef} className="ink" width={box.w * dpr} height={box.h * dpr}
              style={{ cursor: mode === 'move' ? 'move' : 'crosshair' }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              aria-label="Drawing area" />
          </div>
        </div>

        <aside className="ed-side right">
          <div>
            <h4>In your font</h4>
            {inFont && compiled
              ? <div className="strip" style={{ fontFamily: `"${compiled.family}", ${REF_FONT}` }}>{sample}</div>
              : <div className="strip wait">{hasInk(glyph) ? 'Updating…' : 'Draw something and it appears here, set in your font.'}</div>}
            <p className="muted small" style={{ margin: '6px 0 0' }}>Letters you haven’t drawn yet show in a standard font.</p>
          </div>
          {!mark && (
            <div>
              <h4>Spacing</h4>
              <div className="slider-row"><span>Space on the right</span><b>{settings.sideBearing + glyph.rsbAdjust}</b></div>
              <input type="range" min={-120} max={250} value={glyph.rsbAdjust} aria-label="Right side bearing"
                onChange={(e) => update((p) => ({ ...p, glyphs: { ...p.glyphs, [cp]: { ...glyph, rsbAdjust: +e.target.value, updatedAt: Date.now() } } }))} />
              <div className="slider-row"><span>Space on the left</span><b>{settings.sideBearing + glyph.lsbAdjust}</b></div>
              <input type="range" min={-120} max={250} value={glyph.lsbAdjust} aria-label="Left side bearing"
                onChange={(e) => update((p) => ({ ...p, glyphs: { ...p.glyphs, [cp]: { ...glyph, lsbAdjust: +e.target.value, updatedAt: Date.now() } } }))} />
            </div>
          )}
          <div>
            <h4>Tips</h4>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
              {mark
                ? <><li>Draw the fili where it should sit on the faint <span className="thaana">ބ</span>. It will sit the same way on every letter.</li><li>Draw your own <span className="thaana">ބ</span> first for the best fit.</li></>
                : <><li>Sit the letter on the baseline and keep its body near the letter-height line.</li><li>Where you draw left or right doesn’t matter; spacing is automatic.</li></>}
              <li>Shortcuts: <span className="kbd">B</span> <span className="kbd">N</span> <span className="kbd">E</span> tools, <span className="kbd">[</span> <span className="kbd">]</span> size, <span className="kbd">←</span> <span className="kbd">→</span> letters.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

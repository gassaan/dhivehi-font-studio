import { useEffect, useRef, useState, type ReactNode } from 'react'
import { drawGlyph, preloadGlyph } from '../lib/ink.ts'
import { FRAME, FRAME_H, FRAME_W, type GlyphData } from '../lib/types.ts'

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Small canvas preview of a glyph's ink, fitted into a square. */
export function GlyphThumb({ glyph, px = 160, faint }: { glyph: GlyphData; px?: number; faint?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    preloadGlyph(glyph).then(() => {
      const c = ref.current
      if (!c || !live) return
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      const scale = (px * 0.92) / Math.max(FRAME_W, FRAME_H)
      const x0 = FRAME.left - (px / scale - FRAME_W) / 2
      const y0 = FRAME.top + (px / scale - FRAME_H) / 2
      drawGlyph(ctx, glyph, { x0, y0, scale }, faint ? cssVar('--muted') : cssVar('--ink'))
    }).catch(() => {})
    return () => { live = false }
  }, [glyph, px, faint])
  return <canvas ref={ref} width={px} height={px} />
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState('')
  const timer = useRef<number>(0)
  const show = (m: string) => {
    setMsg(m)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(''), 2600)
  }
  return [msg ? <div className="toast" role="status">{msg}</div> : null, show]
}

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)

export const Icons = {
  brush: icon(<><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 114.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 00-3-3.02z" /></>),
  nib: icon(<><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.59 7.59" /><circle cx="11" cy="11" r="2" /></>),
  eraser: icon(<><path d="M20 20H7L3 16a1.5 1.5 0 010-2.1L13.9 3a1.5 1.5 0 012.1 0l5 5a1.5 1.5 0 010 2.1L11 20" /><path d="M6 11l7 7" /></>),
  move: icon(<><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></>),
  undo: icon(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></>),
  redo: icon(<><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></>),
  trash: icon(<><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>),
  image: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>),
  left: icon(<path d="M15 18l-6-6 6-6" />),
  right: icon(<path d="M9 18l6-6-6-6" />),
  close: icon(<path d="M18 6L6 18M6 6l12 12" />),
  download: icon(<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>),
  upload: icon(<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>),
  back: icon(<path d="M19 12H5M12 19l-7-7 7-7" />),
}

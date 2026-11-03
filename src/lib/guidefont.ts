// The guide font: the font the faint reference letters are drawn in while
// designing. Defaults to Noto Sans Thaana; a designer can upload any .ttf /
// .otf / .woff to trace over or follow instead. It stays in this browser only
// (it is left out of backups, since most fonts may not be shared).
import { useEffect, useState } from 'react'
import type { Project } from './types.ts'

export const DEFAULT_GUIDE = '"Noto Sans Thaana", "MV Boli", sans-serif'

const faces = new Map<string, Promise<string>>()

function keyOf(p: Project) {
  const g = p.guideFont
  return g ? `${p.id}:${g.name}:${g.data.byteLength}:${g.addedAt}` : ''
}

/** Loads a font file's bytes as a FontFace and returns its family name. */
export async function loadGuideFace(data: ArrayBuffer, tag: string): Promise<string> {
  const family = `dvfs-guide-${tag.replace(/[^a-z0-9]/gi, '').slice(-24)}`
  const face = new FontFace(family, data.slice(0))
  await face.load()
  document.fonts.add(face)
  return family
}

/** CSS font stack for the project's guide font (falls back to the default while loading or on error). */
export function useGuideFont(p: Project): string {
  const key = keyOf(p)
  const [stack, setStack] = useState(DEFAULT_GUIDE)
  useEffect(() => {
    if (!key || !p.guideFont) { setStack(DEFAULT_GUIDE); return }
    let live = true
    let pending = faces.get(key)
    if (!pending) {
      pending = loadGuideFace(p.guideFont.data, key)
      faces.set(key, pending)
      pending.catch(() => faces.delete(key))
    }
    pending.then((fam) => live && setStack(`"${fam}", ${DEFAULT_GUIDE}`)).catch(() => live && setStack(DEFAULT_GUIDE))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  // Grid cells and other HTML read it through CSS variables. --guide-k scales
  // the guide font so its baa is as tall as the standard font's.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--guide-font', stack)
    root.setProperty('--guide-k', String(relativeScale(stack)))
    return () => { root.removeProperty('--guide-font'); root.removeProperty('--guide-k') }
  }, [stack])
  return stack
}

/** Reads the font's own name from its 'name' table (family + style), if it is a plain TTF/OTF. */
export function fontDisplayName(data: ArrayBuffer, fallback: string): string {
  try {
    const dv = new DataView(data)
    const tag = dv.getUint32(0)
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return fallback // not sfnt (e.g. WOFF)
    const n = dv.getUint16(4)
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16
      if (dv.getUint32(r) !== 0x6e616d65) continue // 'name'
      const off = dv.getUint32(r + 8)
      const count = dv.getUint16(off + 2), strOff = off + dv.getUint16(off + 4)
      let best = ''
      for (let k = 0; k < count; k++) {
        const rec = off + 6 + k * 12
        const platform = dv.getUint16(rec), nameId = dv.getUint16(rec + 6)
        const len = dv.getUint16(rec + 8), so = dv.getUint16(rec + 10)
        if (platform !== 3 || (nameId !== 4 && nameId !== 1)) continue
        let s = ''
        for (let j = 0; j < len; j += 2) s += String.fromCharCode(dv.getUint16(strOff + so + j))
        if (nameId === 4) return s.trim() || fallback
        best ||= s.trim()
      }
      return best || fallback
    }
  } catch { /* fall through */ }
  return fallback
}

/**
 * True if the font has Thaana letters. If it doesn't, the browser falls back
 * to the same system font for both measurements, so the widths match.
 */
export async function coversThaana(family: string): Promise<boolean> {
  await document.fonts.load(`40px "${family}"`, 'ބ').catch(() => {})
  const ctx = document.createElement('canvas').getContext('2d')!
  const sample = 'ހބނރކވމ'
  ctx.font = '40px monospace'
  const plain = ctx.measureText(sample).width
  ctx.font = `40px "${family}", monospace`
  return Math.abs(ctx.measureText(sample).width - plain) > 0.5
}

/** How much to scale `stack` so its baa matches the default guide font's height (clamped). */
export function relativeScale(stack: string): number {
  if (stack === DEFAULT_GUIDE) return 1
  const ctx = document.createElement('canvas').getContext('2d')!
  const h = (font: string) => {
    ctx.font = `100px ${font}`
    const m = ctx.measureText('ބ')
    return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  }
  const a = h(DEFAULT_GUIDE), b = h(stack)
  return a > 0 && b > 0 ? Math.max(0.5, Math.min(3, a / b)) : 1
}

// All coordinates are font units: 1000 units per em, y pointing up, baseline at 0.

export const UPM = 1000
export const ASCENDER = 800
export const DESCENDER = -300

/** The drawing frame shown in the editor (font units). */
export const FRAME = { left: 0, right: 1000, top: 850, bottom: -350 }
export const FRAME_W = FRAME.right - FRAME.left
export const FRAME_H = FRAME.top - FRAME.bottom

export type Tool = 'brush' | 'nib' | 'eraser'

export interface Stroke {
  tool: Tool
  /** Pen size in font units. */
  size: number
  /** Nib angle in degrees, for the calligraphy nib. */
  angle: number
  /** Points as flat [x, y, pressure, x, y, pressure, ...]. */
  pts: number[]
}

export interface TraceImage {
  /** A black-on-transparent PNG produced from the uploaded picture. */
  mask: string
  /** Placement of the image in font units (top-left corner, size). */
  x: number
  y: number
  w: number
  h: number
}

export interface GlyphData {
  strokes: Stroke[]
  image?: TraceImage
  /** Extra space on the left / right, added to the font's side bearing. */
  lsbAdjust: number
  rsbAdjust: number
  updatedAt: number
}

export interface FontSettings {
  /** Height of the main body of Thaana letters, used for guides and fili placement. */
  letterHeight: number
  /** Default space either side of each drawn letter. */
  sideBearing: number
  /** Width of the space character. */
  spaceWidth: number
  /** How smoothly outlines are traced: 0 crisp ... 1 very smooth. */
  smoothing: number
}

export interface Project {
  id: string
  name: string
  designer: string
  version: string
  license: string
  createdAt: number
  updatedAt: number
  settings: FontSettings
  glyphs: Record<number, GlyphData>
}

export const DEFAULT_SETTINGS: FontSettings = {
  letterHeight: 450,
  sideBearing: 40,
  spaceWidth: 260,
  smoothing: 0.5,
}

export function emptyGlyph(): GlyphData {
  return { strokes: [], lsbAdjust: 0, rsbAdjust: 0, updatedAt: Date.now() }
}

export function hasInk(g: GlyphData | undefined): boolean {
  return !!g && (g.strokes.some((s) => s.tool !== 'eraser') || !!g.image)
}

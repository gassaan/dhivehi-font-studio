import { useRef, useState } from 'react'
import { go } from '../App.tsx'
import { CHAR_BY_CP } from '../lib/charset.ts'
import { KEY_ROWS, PHONETIC } from '../lib/keyboard.ts'
import type { Project } from '../lib/types.ts'
import type { Compiled } from './Workspace.tsx'

const SAMPLES = [
  'ދިވެހިރާއްޖެ',
  'މަރުޙަބާ',
  'ޝުކުރިއްޔާ',
  'ދިވެހި ބަސް',
  'ހ ށ ނ ރ ބ ޅ ކ އ ވ މ ފ ދ ތ ލ ގ ޏ ސ ޑ ޒ ޓ ޔ ޕ ޖ ޗ',
  'ބަ ބާ ބި ބީ ބު ބޫ ބެ ބޭ ބޮ ބޯ ބް',
]

export default function Preview({ project, compiled }: { project: Project; compiled: Compiled | null }) {
  const [text, setText] = useState(SAMPLES[0] + '\n' + SAMPLES[3])
  const [size, setSize] = useState(64)
  const [phonetic, setPhonetic] = useState(true)
  const [shift, setShift] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)

  const family = compiled ? `"${compiled.family}", "Noto Sans Thaana", sans-serif` : '"Noto Sans Thaana", sans-serif'

  const insert = (s: string) => {
    const el = ta.current
    if (!el) { setText((t) => t + s); return }
    const a = el.selectionStart, b = el.selectionEnd
    const next = text.slice(0, a) + s + text.slice(b)
    setText(next)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + s.length })
  }

  const backspace = () => {
    const el = ta.current
    if (!el) return
    const a = el.selectionStart, b = el.selectionEnd
    const from = a === b ? Math.max(0, a - 1) : a
    setText(text.slice(0, from) + text.slice(b))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = from })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!phonetic || e.ctrlKey || e.metaKey || e.altKey) return
    const t = PHONETIC[e.key]
    if (t) { e.preventDefault(); insert(t) }
  }

  const missing = [...new Set([...text].map((ch) => ch.codePointAt(0)!))]
    .filter((cp) => CHAR_BY_CP.has(cp) && !compiled?.drawn.has(cp))

  return (
    <div className="preview-grid">
      <div className="stack">
        <div className="card">
          <div className="toolbar">
            <label className="check"><input type="checkbox" checked={phonetic} onChange={(e) => setPhonetic(e.target.checked)} />Phonetic Thaana keyboard</label>
            <span className="spacer" />
            <span className="muted small">Size</span>
            <input type="range" min={16} max={160} value={size} onChange={(e) => setSize(+e.target.value)} style={{ width: 140 }} aria-label="Preview size" />
            <span className="small" style={{ width: 34 }}>{size}px</span>
          </div>
          <textarea ref={ta} className="typer" dir="rtl" value={text} spellCheck={false}
            style={{ fontFamily: family, fontSize: size }} onKeyDown={onKey} onChange={(e) => setText(e.target.value)}
            aria-label="Type to test your font" />
          <div className="vkb" style={{ borderTop: '1px solid var(--line)' }}>
            {KEY_ROWS.map((row) => (
              <div className="r" key={row}>
                {[...row].map((k) => {
                  const key = shift ? k.toUpperCase() : k
                  return (
                    <button key={k} onClick={() => insert(PHONETIC[key] ?? key)} style={{ fontFamily: family }}>
                      <small>{key}</small>{PHONETIC[key] ?? key}
                    </button>
                  )
                })}
              </div>
            ))}
            <div className="r">
              <button className={`wide ${shift ? 'btn on' : ''}`} onClick={() => setShift((s) => !s)}>Shift</button>
              <button className="wide" style={{ width: 160 }} onClick={() => insert(' ')}>Space</button>
              <button className="wide" onClick={() => insert('\n')}>Enter</button>
              <button className="wide" onClick={backspace}>⌫</button>
            </div>
          </div>
        </div>

        <div className="card panel waterfall">
          <h3 style={{ marginBottom: 10 }}>Waterfall</h3>
          {[14, 18, 24, 32, 48, 72].map((s) => (
            <div key={s} style={{ fontFamily: family, fontSize: s, lineHeight: 1.8 }}>
              <small>{s}px</small>{text.split('\n')[0] || SAMPLES[0]}
            </div>
          ))}
        </div>
      </div>

      <aside className="stack">
        <div className="card panel stack" style={{ gap: 10 }}>
          <h3>Try a sample</h3>
          <div className="samples">
            {SAMPLES.map((s) => <button key={s} className="btn small" onClick={() => setText(s)}>{s.length > 14 ? s.slice(0, 13) + '…' : s}</button>)}
          </div>
        </div>
        <div className="card panel stack" style={{ gap: 10 }}>
          <h3>Not drawn yet</h3>
          {missing.length === 0
            ? <p className="muted small" style={{ margin: 0 }}>Every letter in your text is from your font.</p>
            : <>
                <p className="muted small" style={{ margin: 0 }}>These appear in a standard font for now. Tap one to draw it.</p>
                <div className="missing">
                  {missing.map((cp) => (
                    <button key={cp} title={CHAR_BY_CP.get(cp)?.name} onClick={() => go(`/font/${project.id}/glyph/${cp.toString(16)}`)}>
                      {CHAR_BY_CP.get(cp)!.kind.startsWith('mark') ? '◌' : ''}{String.fromCodePoint(cp)}
                    </button>
                  ))}
                </div>
              </>}
        </div>
        {!compiled && <div className="notice">Building your font…</div>}
      </aside>
    </div>
  )
}

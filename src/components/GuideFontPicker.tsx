import { useRef, useState } from 'react'
import { coversThaana, fontDisplayName, loadGuideFace } from '../lib/guidefont.ts'
import type { Project } from '../lib/types.ts'
import { Icons } from './ui.tsx'
import type { Update } from './Workspace.tsx'

/** Upload, show and remove the font used for the faint reference letters. */
export default function GuideFontPicker({ project, update, compact }: { project: Project; update: Update; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const g = project.guideFont

  const pick = async (file: File) => {
    setBusy(true)
    setMsg(null)
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('too big')
      const data = await file.arrayBuffer()
      const family = await loadGuideFace(data, `check${Date.now()}`)
      const name = fontDisplayName(data, file.name.replace(/\.[^.]+$/, ''))
      const thaana = await coversThaana(family)
      update((p) => ({ ...p, guideFont: { name, data, addedAt: Date.now() } }))
      setMsg(thaana
        ? { text: `Guide letters now use ${name}.` }
        : { text: `${name} doesn’t seem to have Thaana letters, so most guides will still show in the standard font.`, warn: true })
    } catch {
      setMsg({ text: 'That file couldn’t be read as a font. Use a .ttf, .otf, .woff or .woff2 file.', warn: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="guide-font-row">
        <span className="guide-sample" aria-hidden="true">ބ</span>
        <div style={{ minWidth: 0 }}>
          <b className="guide-name">{g ? g.name : 'Noto Sans Thaana'}</b>
          <div className="muted small">{g ? 'Your guide font' : 'Standard guide font'}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input ref={input} type="file" hidden accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
        <button className="btn small" disabled={busy} onClick={() => input.current?.click()}>
          {Icons.upload} {busy ? 'Loading…' : g ? 'Change font' : 'Use my own font'}
        </button>
        {g && <button className="btn small danger" onClick={() => { update((p) => ({ ...p, guideFont: undefined })); setMsg(null) }}>Use standard</button>}
      </div>
      {msg && <div className={`notice small ${msg.warn ? 'warn' : ''}`} role="status">{msg.text}</div>}
      {!compact && (
        <p className="muted small" style={{ margin: 0 }}>
          The guide font is only a drawing aid: it shows faintly behind your pen and fills in letters you haven’t drawn yet while testing.
          It is never copied into the font you download, and it stays in this browser (it isn’t included in backups).
        </p>
      )}
    </div>
  )
}

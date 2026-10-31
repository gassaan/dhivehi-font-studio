import { useState } from 'react'
import { go } from '../App.tsx'
import { CHARS } from '../lib/charset.ts'
import { download, fileSlug } from '../lib/fontface.ts'
import { ttfToWoff } from '../lib/sfnt.ts'
import { hasInk, type Project } from '../lib/types.ts'
import { REQUIRED } from './Home.tsx'
import { Icons } from './ui.tsx'
import type { Compiled, Update } from './Workspace.tsx'

interface Props {
  project: Project
  update: Update
  compiled: Compiled | null
  toast: (m: string) => void
}

export default function ExportPanel({ project, update, compiled, toast }: Props) {
  const [busy, setBusy] = useState(false)
  const slug = fileSlug(project.name)
  const missing = REQUIRED.filter((c) => !hasInk(project.glyphs[c.cp]))
  const drawnCount = CHARS.filter((c) => hasInk(project.glyphs[c.cp])).length
  const set = (k: 'name' | 'designer' | 'version' | 'license', v: string) => update((p) => ({ ...p, [k]: v }))

  const getTTF = () => {
    if (!compiled) { toast('Still building your font, try again in a second.'); return null }
    return compiled.ttf
  }

  const css = `@font-face {
  font-family: "${project.name}";
  src: url("${slug}.woff") format("woff"),
       url("${slug}.ttf") format("truetype");
}

.dhivehi {
  font-family: "${project.name}", "Noto Sans Thaana", sans-serif;
  direction: rtl;
}`

  return (
    <div className="two">
      <div className="stack">
        <div className="card panel stack">
          <div>
            <h3>Download your font</h3>
            <p className="muted small" style={{ margin: 0 }}>{drawnCount} characters drawn. Fili are positioned automatically on every letter.</p>
          </div>
          {missing.length > 0 && (
            <div className="notice warn stack" style={{ gap: 8 }}>
              <span>{missing.length} essential {missing.length === 1 ? 'character is' : 'characters are'} not drawn yet. You can still download; they’ll fall back to another font.</span>
              <div className="missing">
                {missing.map((c) => (
                  <button key={c.cp} title={c.name} onClick={() => go(`/font/${project.id}/glyph/${c.cp.toString(16)}`)}>
                    {c.kind.startsWith('mark') ? '◌' : ''}{c.char}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="row">
            <button className="btn primary" disabled={!compiled || !drawnCount} onClick={() => { const t = getTTF(); if (t) download(t, `${slug}.ttf`, 'font/ttf') }}>
              {Icons.download} Download .ttf
            </button>
            <button className="btn" disabled={!compiled || !drawnCount || busy} onClick={async () => {
              const t = getTTF()
              if (!t) return
              setBusy(true)
              try { download(await ttfToWoff(t), `${slug}.woff`, 'font/woff') } finally { setBusy(false) }
            }}>
              {Icons.download} Download .woff (web)
            </button>
          </div>
          <div className="muted small">
            <b>Install:</b> on Windows, right-click the .ttf and choose <i>Install</i>. On a Mac, double-click it and press <i>Install Font</i>.
            On a phone, apps like Canva and most design tools let you upload a .ttf.
          </div>
        </div>

        <div className="card panel stack">
          <h3>Use it on a website</h3>
          <pre className="code">{css}</pre>
          <button className="btn small" style={{ alignSelf: 'start' }} onClick={() => navigator.clipboard?.writeText(css).then(() => toast('CSS copied'))}>Copy CSS</button>
        </div>
      </div>

      <div className="stack">
        <div className="card panel stack">
          <h3>Font details</h3>
          <label className="field"><span>Font name</span>
            <input className="input" value={project.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field"><span>Designer</span>
            <input className="input" value={project.designer} placeholder="Your name" maxLength={80} onChange={(e) => set('designer', e.target.value)} /></label>
          <label className="field"><span>Version</span>
            <input className="input" value={project.version} maxLength={10} onChange={(e) => set('version', e.target.value.replace(/[^0-9.]/g, ''))} /></label>
          <label className="field"><span>License</span>
            <textarea className="input" rows={3} value={project.license} onChange={(e) => set('license', e.target.value)} /></label>
          <p className="muted small" style={{ margin: 0 }}>The default is the SIL Open Font License, which lets anyone use and share your font freely. Change it if you want to keep rights.</p>
        </div>
        <div className="card panel stack">
          <h3>Backup</h3>
          <p className="muted small" style={{ margin: 0 }}>Fonts are saved in this browser. Download a backup file to keep your drawings safe or continue on another device (import it from the home page).</p>
          <button className="btn small" style={{ alignSelf: 'start' }} onClick={() => download(JSON.stringify(project), `${slug}.dhivehi-font.json`, 'application/json')}>
            {Icons.download} Download backup
          </button>
        </div>
      </div>
    </div>
  )
}

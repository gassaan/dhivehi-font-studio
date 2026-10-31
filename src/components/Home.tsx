import { useEffect, useRef, useState } from 'react'
import { go } from '../App.tsx'
import { CHARS } from '../lib/charset.ts'
import { createProject, deleteProject, isProject, listProjects, newId, normalize, saveProject } from '../lib/db.ts'
import { hasInk, type Project } from '../lib/types.ts'
import { GlyphThumb, Icons, useToast } from './ui.tsx'

export const REQUIRED = CHARS.filter((c) => c.group === 'core' || c.group === 'fili')

export function progress(p: Project) {
  const done = REQUIRED.filter((c) => hasInk(p.glyphs[c.cp])).length
  return { done, total: REQUIRED.length }
}

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [name, setName] = useState('')
  const [toast, showToast] = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => listProjects().then(setProjects)
  useEffect(() => { refresh() }, [])

  const create = async () => {
    const p = createProject(name.trim() || 'My Dhivehi Font')
    await saveProject(p)
    go(`/font/${p.id}`)
  }

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      if (!isProject(data)) throw new Error('not a project')
      const p = normalize({ ...data, id: newId(), updatedAt: Date.now() })
      await saveProject(p)
      showToast(`Imported “${p.name}”`)
      refresh()
    } catch {
      showToast('That file is not a Dhivehi Font Studio project.')
    }
  }

  const remove = async (p: Project) => {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return
    await deleteProject(p.id)
    refresh()
  }

  return (
    <div className="home">
      <div className="row">
        <div className="brand"><div className="brand-mark">ފ</div>Dhivehi Font Studio</div>
      </div>

      <section className="hero">
        <div>
          <p className="dv" dir="rtl">ތިބާގެ އަމިއްލަ ދިވެހި ފޮންޓު ހަދާ</p>
          <h1>Make your own Dhivehi font.</h1>
          <p className="lead">
            Draw each Thaana letter and fili with your mouse, finger or stylus, or trace a photo of your handwriting.
            Test it as you go, then download a real font file you can install anywhere.
          </p>
          <div className="create">
            <input
              className="input" placeholder="Name your font, e.g. Raajje Hand" value={name} maxLength={60}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()}
              aria-label="Font name"
            />
            <button className="btn primary" onClick={create}>Start a new font</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true"><span>ދިވެހި</span></div>
      </section>

      <div className="steps">
        <div className="card step"><span className="num">1</span><b>Draw</b><span className="muted small">24 letters and 11 fili. Guides show where the baseline and the fili go.</span></div>
        <div className="card step"><span className="num">2</span><b>Test</b><span className="muted small">Type Dhivehi with the built-in phonetic keyboard and see your font live.</span></div>
        <div className="card step"><span className="num">3</span><b>Download</b><span className="muted small">Get TTF and WOFF files for Windows, Mac, phones and websites.</span></div>
      </div>

      <div className="section-title">
        <h2>Your fonts</h2>
        <span className="muted small">Saved in this browser only. Export a backup to move between devices.</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => fileRef.current?.click()}>{Icons.upload} Import backup</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
      </div>

      {projects && projects.length === 0 && (
        <div className="card panel muted">No fonts yet. Give yours a name above and start drawing.</div>
      )}
      <div className="projects">
        {projects?.map((p) => {
          const { done, total } = progress(p)
          const drawn = CHARS.filter((c) => hasInk(p.glyphs[c.cp])).slice(0, 5)
          return (
            <div key={p.id} className="card project" role="link" tabIndex={0}
              onClick={() => go(`/font/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`/font/${p.id}`)}>
              <div className="row" style={{ gap: 2, minHeight: 56, direction: 'rtl' }}>
                {drawn.length ? drawn.map((c) => (
                  <div key={c.cp} style={{ width: 52, height: 52 }}><GlyphThumb glyph={p.glyphs[c.cp]} px={104} /></div>
                )) : <span className="muted small" style={{ direction: 'ltr' }}>Nothing drawn yet</span>}
              </div>
              <h3>{p.name}</h3>
              <div className="bar"><i style={{ width: `${(done / total) * 100}%` }} /></div>
              <div className="row small muted">
                <span>{done} of {total} essentials</span>
                <span className="spacer" />
                <button className="btn ghost small danger" onClick={(e) => { e.stopPropagation(); remove(p) }}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>
      {toast}
    </div>
  )
}

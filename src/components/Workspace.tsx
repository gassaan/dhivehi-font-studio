import { useCallback, useEffect, useRef, useState } from 'react'
import { go, type Route } from '../App.tsx'
import { compileProject } from '../lib/compile.ts'
import { getProject, saveProject } from '../lib/db.ts'
import { loadFont } from '../lib/fontface.ts'
import type { Project } from '../lib/types.ts'
import ExportPanel from './ExportPanel.tsx'
import GlyphEditor from './GlyphEditor.tsx'
import GlyphGrid from './GlyphGrid.tsx'
import { progress } from './Home.tsx'
import Preview from './Preview.tsx'
import SettingsPanel from './SettingsPanel.tsx'
import { Icons, useToast } from './ui.tsx'

export interface Compiled {
  family: string
  ttf: Uint8Array
  drawn: Set<number>
}

export type Update = (fn: (p: Project) => Project) => void

/** Recompiles the font shortly after each change and loads it into the page. */
function useCompiled(project: Project | null): Compiled | null {
  const [compiled, setCompiled] = useState<Compiled | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    if (!project) return
    const id = ++seq.current
    const t = setTimeout(async () => {
      try {
        const r = await compileProject(project)
        if (id !== seq.current) return
        const family = await loadFont('ws', r.ttf)
        if (id === seq.current) setCompiled({ family, ttf: r.ttf, drawn: r.drawn })
      } catch (e) {
        console.error('compile failed', e)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [project])
  return compiled
}

const TABS = [
  { id: 'draw', label: 'Draw' },
  { id: 'test', label: 'Test' },
  { id: 'download', label: 'Download' },
  { id: 'settings', label: 'Settings' },
]

export default function Workspace({ route }: { route: Extract<Route, { page: 'font' }> }) {
  const [project, setProject] = useState<Project | null>(null)
  const [missing, setMissing] = useState(false)
  const [toast, showToast] = useToast()
  const pending = useRef<Project | null>(null)
  const timer = useRef(0)

  useEffect(() => {
    getProject(route.id).then((p) => (p ? setProject(p) : setMissing(true)))
  }, [route.id])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    if (pending.current) {
      saveProject(pending.current)
      pending.current = null
    }
  }, [])

  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [flush])

  const update: Update = useCallback((fn) => {
    setProject((prev) => {
      if (!prev) return prev
      const next = { ...fn(prev), updatedAt: Date.now() }
      pending.current = next
      clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 500)
      return next
    })
  }, [flush])

  const compiled = useCompiled(project)

  if (missing) {
    return (
      <div className="home"><div className="card panel">
        <h3>Font not found</h3>
        <p className="muted">It may have been deleted, or it was made in a different browser.</p>
        <button className="btn" onClick={() => go('/')}>Back to your fonts</button>
      </div></div>
    )
  }
  if (!project) return <div className="home muted">Loading…</div>

  const { done, total } = progress(project)
  const base = `/font/${project.id}`

  return (
    <>
      <header className="ws-top">
        <div className="ws-top-inner">
          <button className="btn ghost small" onClick={() => go('/')} aria-label="All fonts">{Icons.back}</button>
          <span className="ws-name">{project.name}</span>
          <span className="progress-pill"><span className="bar"><i style={{ width: `${(done / total) * 100}%` }} /></span>{done}/{total}</span>
          <span className="spacer" />
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${route.tab === t.id ? 'active' : ''}`} onClick={() => go(`${base}/${t.id}`)}>{t.label}</button>
            ))}
          </nav>
        </div>
      </header>
      <main className="ws-body">
        {route.tab === 'draw' && <GlyphGrid project={project} onOpen={(cp) => go(`${base}/glyph/${cp.toString(16)}`)} />}
        {route.tab === 'test' && <Preview project={project} compiled={compiled} />}
        {route.tab === 'download' && <ExportPanel project={project} update={update} compiled={compiled} toast={showToast} />}
        {route.tab === 'settings' && <SettingsPanel project={project} update={update} />}
      </main>
      {route.glyph !== undefined && (
        <GlyphEditor
          key={route.glyph}
          project={project}
          cp={route.glyph}
          update={update}
          compiled={compiled}
          onNavigate={(cp) => go(`${base}/glyph/${cp.toString(16)}`)}
          onClose={() => go(`${base}/draw`)}
        />
      )}
      {toast}
    </>
  )
}

import { CHARS, GROUPS, displayChar } from '../lib/charset.ts'
import { hasInk, type Project } from '../lib/types.ts'
import { GlyphThumb } from './ui.tsx'

export default function GlyphGrid({ project, onOpen }: { project: Project; onOpen: (cp: number) => void }) {
  return (
    <>
      {GROUPS.map((g) => {
        const chars = CHARS.filter((c) => c.group === g.id)
        const done = chars.filter((c) => hasInk(project.glyphs[c.cp])).length
        return (
          <section key={g.id} className="group">
            <div className="group-head">
              <h2>{g.title}</h2>
              <span className="dv">{g.dhivehi}</span>
              <span className="muted small">{done}/{chars.length}{g.required ? '' : ' · optional'}</span>
            </div>
            <p className="group-hint">{g.hint}</p>
            <div className="grid">
              {chars.map((c) => {
                const glyph = project.glyphs[c.cp]
                const drawn = hasInk(glyph)
                return (
                  <button key={c.cp} className={`cell ${drawn ? 'done' : ''}`} onClick={() => onOpen(c.cp)}
                    aria-label={`${c.name}${drawn ? ' (drawn)' : ''}`} title={c.name}>
                    <div className="art">
                      {drawn ? <GlyphThumb glyph={glyph} /> : <span className="ref">{displayChar(c)}</span>}
                    </div>
                    <div className="meta"><span>{c.name}</span><span className="dot" /></div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}

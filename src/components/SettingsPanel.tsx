import { go } from '../App.tsx'
import { deleteProject } from '../lib/db.ts'
import type { FontSettings, Project } from '../lib/types.ts'
import type { Update } from './Workspace.tsx'

const SLIDERS: { key: keyof FontSettings; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: 'letterHeight', label: 'Letter height', hint: 'Where the letter-height guide sits. Fili are placed above this line (or above taller letters).', min: 250, max: 650, step: 5 },
  { key: 'sideBearing', label: 'Letter spacing', hint: 'Space added either side of every letter.', min: 0, max: 200, step: 1 },
  { key: 'spaceWidth', label: 'Word spacing', hint: 'Width of the space between words.', min: 80, max: 600, step: 5 },
  { key: 'smoothing', label: 'Outline smoothing', hint: 'Higher values give smoother curves; lower keeps more detail and sharp corners.', min: 0, max: 1, step: 0.05 },
]

export default function SettingsPanel({ project, update }: { project: Project; update: Update }) {
  const s = project.settings
  return (
    <div className="two">
      <div className="card panel stack">
        <h3>Font settings</h3>
        {SLIDERS.map((f) => (
          <div key={f.key}>
            <div className="slider-row"><span>{f.label}</span><b>{f.key === 'smoothing' ? Math.round(s[f.key] * 100) + '%' : s[f.key]}</b></div>
            <input type="range" min={f.min} max={f.max} step={f.step} value={s[f.key]} aria-label={f.label}
              onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, [f.key]: +e.target.value } }))} />
            <div className="muted small">{f.hint}</div>
          </div>
        ))}
      </div>
      <div className="card panel stack">
        <h3>Danger zone</h3>
        <p className="muted small" style={{ margin: 0 }}>Deleting removes this font and all its drawings from this browser. Download a backup first if you might want it back.</p>
        <button className="btn danger" style={{ alignSelf: 'start' }} onClick={async () => {
          if (!confirm(`Delete “${project.name}” permanently?`)) return
          await deleteProject(project.id)
          go('/')
        }}>Delete this font</button>
      </div>
    </div>
  )
}

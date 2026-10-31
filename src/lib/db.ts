// Projects live in the browser's IndexedDB, so nothing leaves the designer's
// device until they export. Falls back to memory if IndexedDB is unavailable.
import { DEFAULT_SETTINGS, type Project } from './types.ts'

const DB = 'dhivehi-font-studio'
const STORE = 'projects'
const memory = new Map<string, Project>()
let dbp: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return dbp
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    if (!db) return reject(new Error('no db'))
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }))
}

export async function listProjects(): Promise<Project[]> {
  let list: Project[]
  try { list = await tx<Project[]>('readonly', (s) => s.getAll()) } catch { list = [...memory.values()] }
  return list.map(normalize).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const p = await tx<Project | undefined>('readonly', (s) => s.get(id))
    return p ? normalize(p) : null
  } catch {
    return memory.get(id) ?? null
  }
}

export async function saveProject(p: Project): Promise<void> {
  try { await tx('readwrite', (s) => s.put(p)) } catch { memory.set(p.id, p) }
}

export async function deleteProject(id: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(id)) } catch { memory.delete(id) }
}

export function newId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function createProject(name: string, designer = ''): Project {
  const now = Date.now()
  return {
    id: newId(), name, designer, version: '1.000',
    license: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    createdAt: now, updatedAt: now, settings: { ...DEFAULT_SETTINGS }, glyphs: {},
  }
}

/** Fills in fields older saves (or imported files) may lack. */
export function normalize(p: Project): Project {
  return { ...p, version: p.version || '1.000', license: p.license ?? '', designer: p.designer ?? '', settings: { ...DEFAULT_SETTINGS, ...p.settings }, glyphs: p.glyphs ?? {} }
}

export function isProject(x: unknown): x is Project {
  const p = x as Project
  return !!p && typeof p === 'object' && typeof p.name === 'string' && typeof p.glyphs === 'object'
}

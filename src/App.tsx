import { useEffect, useState } from 'react'
import Home from './components/Home.tsx'
import Workspace from './components/Workspace.tsx'

export type Route =
  | { page: 'home' }
  | { page: 'font'; id: string; tab: string; glyph?: number }

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'font' && parts[1]) {
    if (parts[2] === 'glyph' && parts[3]) return { page: 'font', id: parts[1], tab: 'draw', glyph: parseInt(parts[3], 16) }
    return { page: 'font', id: parts[1], tab: parts[2] || 'draw' }
  }
  return { page: 'home' }
}

export function go(path: string) {
  location.hash = path
}

export default function App() {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (route.page === 'font') return <Workspace key={route.id} route={route} />
  return <Home />
}

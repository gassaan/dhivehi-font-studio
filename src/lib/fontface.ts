// Loads compiled font bytes into the page so previews use the real font.
let counter = 0
const loaded = new Map<string, FontFace>()

/** Registers the font under a fresh family name and returns that name. */
export async function loadFont(slot: string, bytes: Uint8Array): Promise<string> {
  const family = `dvfs-${slot}-${++counter}`
  const face = new FontFace(family, bytes.slice().buffer)
  await face.load()
  document.fonts.add(face)
  const old = loaded.get(slot)
  if (old) document.fonts.delete(old)
  loaded.set(slot, face)
  return family
}

export function download(bytes: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function fileSlug(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dhivehi-font'
}

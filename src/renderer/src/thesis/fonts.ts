import type { ThesisFontFiles } from '@shared/api'
import carlito400 from '@fontsource/carlito/files/carlito-latin-400-normal.woff2?url'
import carlito700 from '@fontsource/carlito/files/carlito-latin-700-normal.woff2?url'
import carlito400i from '@fontsource/carlito/files/carlito-latin-400-italic.woff2?url'
import carlito700i from '@fontsource/carlito/files/carlito-latin-700-italic.woff2?url'

// UCEMA asks for Calibri 11. On macOS it only exists inside Office, so it is
// loaded from the local install; Carlito (same metrics, open license) is the
// bundled fallback so line breaks and page counts match either way.

const FACES = [
  { key: 'regular', weight: '400', style: 'normal', carlito: carlito400, mime: 'font/ttf' },
  { key: 'bold', weight: '700', style: 'normal', carlito: carlito700, mime: 'font/ttf' },
  { key: 'italic', weight: '400', style: 'italic', carlito: carlito400i, mime: 'font/ttf' },
  { key: 'boldItalic', weight: '700', style: 'italic', carlito: carlito700i, mime: 'font/ttf' }
] as const

let calibri: Promise<ThesisFontFiles | null> | null = null
const localCalibri = () => (calibri ??= window.api.thesis.calibri().catch(() => null))

let registered: Promise<'Calibri' | 'Carlito'> | null = null

/** Makes "Calibri" (or the Carlito fallback) available to the editor. */
export function loadThesisFonts(): Promise<'Calibri' | 'Carlito'> {
  return (registered ??= (async () => {
    const files = await localCalibri()
    await Promise.all(
      FACES.map(async (f) => {
        const face = files
          ? new FontFace('Calibri', files[f.key] as unknown as ArrayBuffer, { weight: f.weight, style: f.style })
          : new FontFace('Carlito', `url(${f.carlito})`, { weight: f.weight, style: f.style })
        document.fonts.add(await face.load())
      })
    )
    return files ? 'Calibri' : 'Carlito'
  })())
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** @font-face rules with the fonts inlined, for the standalone print document. */
export async function thesisFontCss(): Promise<string> {
  const files = await localCalibri()
  const rules = await Promise.all(
    FACES.map(async (f) => {
      const src = files
        ? `url(data:${f.mime};base64,${base64(files[f.key])}) format('truetype')`
        : `url(data:font/woff2;base64,${base64(new Uint8Array(await (await fetch(f.carlito)).arrayBuffer()))}) format('woff2')`
      return `@font-face { font-family: ${files ? 'Calibri' : 'Carlito'}; font-weight: ${f.weight}; font-style: ${f.style}; src: ${src}; }`
    })
  )
  return rules.join('\n')
}

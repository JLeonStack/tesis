// Copies pdf.js runtime assets (CMaps, fonts, wasm decoders, ICC profiles)
// into the renderer's public dir so they are served locally, never from a CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/pdfjs-dist')
const dest = join(root, 'src/renderer/public/pdfjs')
mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true })
}

import DOMPurify from 'dompurify'

// APA 7 tables and figures in the thesis: "Tabla N" in bold, the title in
// italics on the next line, horizontal rules only (above and below the header,
// at the bottom), and a "Nota." under it. Numbers follow document order.
// Toward the 18.000 words count the title and the note, not the cells: the
// Pautas count the body, abstract, references and footnotes, and a results
// table is data rather than prose (the checklist says so).

export interface ApaTable {
  title: string
  headers: string[]
  rows: string[][]
  note: string
}

export interface ApaFigure {
  title: string
  /** The chart, as SVG markup made by the analysis view. */
  svg: string
  note: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** *italic* spans in captions and cells (statistical symbols: *M*, *DE*, *r*, *p*). */
/** *Italic* spans: never starting or ending on a space or a star, so "* *p* < .05" keeps its significance stars. */
const ITALIC = /\*([^*\s](?:[^*]*[^*\s])?)\*/g

export function apaInline(s: string): string {
  return esc(s).replace(ITALIC, '<i>$1</i>')
}

/** "*r*(248) = .31" → runs for Word. */
export function apaRuns(s: string): { text: string; italic: boolean }[] {
  const out: { text: string; italic: boolean }[] = []
  let last = 0
  for (const m of s.matchAll(ITALIC)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), italic: false })
    out.push({ text: m[1], italic: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), italic: false })
  return out
}

/** Numbers right-aligned, text left: decides per column from its cells. */
export function numericColumns(t: ApaTable): boolean[] {
  return t.headers.map((_, j) => {
    const cells = t.rows.map((r) => (r[j] ?? '').trim()).filter((c) => c && c !== '—' && c !== '-')
    return cells.length > 0 && cells.every((c) => /^[−\-–]?[\d.,]+\**$|^[<>=]\s?[\d.,]+$/.test(c.replace(/\s/g, '')))
  })
}

export function tableHtml(n: number, t: ApaTable): string {
  const num = numericColumns(t)
  const cell = (c: string, j: number, tag: 'td' | 'th') => `<${tag} class="${num[j] && tag === 'td' ? 'num' : ''}">${apaInline(c)}</${tag}>`
  return `<div class="apa-table">
<p class="apa-label"><b>Tabla ${n}</b></p>
<p class="apa-title"><i>${apaInline(t.title).replace(/<\/?i>/g, '')}</i></p>
<table><thead><tr>${t.headers.map((h, j) => cell(h, j, 'th')).join('')}</tr></thead>
<tbody>${t.rows.map((r) => `<tr>${t.headers.map((_, j) => cell(r[j] ?? '', j, 'td')).join('')}</tr>`).join('')}</tbody></table>
${t.note.trim() ? `<p class="apa-note"><i>Nota.</i> ${apaInline(t.note)}</p>` : ''}
</div>`
}

/** SVG markup that's safe to put in the page (it's ours, but it's stored in a file anyone could edit). */
export const cleanSvg = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: false } })

export function figureHtml(n: number, f: ApaFigure): string {
  return `<div class="apa-figure">
<p class="apa-label"><b>Figura ${n}</b></p>
<p class="apa-title"><i>${apaInline(f.title).replace(/<\/?i>/g, '')}</i></p>
<div class="apa-svg">${cleanSvg(f.svg)}</div>
${f.note.trim() ? `<p class="apa-note"><i>Nota.</i> ${apaInline(f.note)}</p>` : ''}
</div>`
}

/** The SVG's intrinsic size from its viewBox. */
export function svgSize(svg: string): { width: number; height: number } {
  const m = svg.match(/viewBox="[\d.\s-]*?\s([\d.]+)\s([\d.]+)"/)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 600, height: 400 }
}

/** Rasterizes a figure for Word (which needs a PNG), at print resolution. */
export async function svgToPng(svg: string, scale = 3): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const { width, height } = svgSize(svg)
  const markup = cleanSvg(svg).replace('<svg', `<svg width="${width}" height="${height}"`)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo convertir la figura.'))), 'image/png'))
    return { data: await blob.arrayBuffer(), width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Plain text of a table, for the assistant and the word counter. */
export const tableCaptionText = (t: { title: string; note: string }) => `${t.title} ${t.note}`.replace(/\*/g, '')

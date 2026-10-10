import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Author, PageText, Paper } from '@shared/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ASSETS = new URL('./pdfjs/', window.location.href).href
const DOC_OPTS = {
  cMapUrl: `${ASSETS}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ASSETS}standard_fonts/`,
  wasmUrl: `${ASSETS}wasm/`,
  iccUrl: `${ASSETS}iccs/`,
  isEvalSupported: false,
  enableXfa: false
}

// ---------- document cache with ref-counting ----------

interface Entry {
  doc: Promise<PDFDocumentProxy>
  refs: number
  used: number
}
const MAX_IDLE = 4
const cache = new Map<string, Entry>()

function evict(): void {
  const idle = [...cache.entries()].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].used - b[1].used)
  while (idle.length > MAX_IDLE) {
    const [id, e] = idle.shift()!
    cache.delete(id)
    void e.doc.then((d) => d.loadingTask.destroy()).catch(() => {})
  }
}

export function acquirePdf(paper: Pick<Paper, 'id' | 'fileName'>): Promise<PDFDocumentProxy> {
  let e = cache.get(paper.id)
  if (!e) {
    const doc = window.api.papers
      .read(paper.fileName)
      .then((data) => pdfjs.getDocument({ ...DOC_OPTS, data }).promise)
    e = { doc, refs: 0, used: 0 }
    cache.set(paper.id, e)
    doc.catch(() => cache.delete(paper.id))
  }
  e.refs++
  e.used = performance.now()
  return e.doc
}

export function releasePdf(id: string): void {
  const e = cache.get(id)
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
  e.used = performance.now()
  evict()
}

// ---------- text extraction ----------

const isText = (i: unknown): i is TextItem => typeof (i as TextItem).str === 'string'

export function itemsToText(items: unknown[]): string {
  let out = ''
  for (const it of items) {
    if (!isText(it)) continue
    out += it.str
    out += it.hasEOL ? '\n' : ''
  }
  // De-hyphenate line breaks and collapse whitespace while keeping paragraphs.
  return out
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface ExtractedMeta {
  title?: string
  authors: Author[]
  year?: string
  doi?: string
  abstract?: string
}

export interface Extraction {
  pages: PageText[]
  pageCount: number
  meta: ExtractedMeta
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i

function parseAuthors(raw?: string): Author[] {
  if (!raw || raw.length > 300) return []
  return raw
    .split(/\s*(?:;|,(?=\s*[A-Z][a-z]+\s+[A-Z])|\band\b|&)\s*/)
    .map((s) => s.trim())
    .filter((s) => s && s.length < 60 && !/@|\d/.test(s))
    .map((s) => {
      if (s.includes(',')) {
        const [family, given] = s.split(',').map((x) => x.trim())
        return { family, given: given ?? '' }
      }
      const parts = s.split(/\s+/)
      return { family: parts.pop() ?? '', given: parts.join(' ') }
    })
}

const NAME_LINE = /^[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]*){1,3}(?:\s*(?:,|;|·|•|\band\b|&)\s*[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]*){1,3})*$/u

/**
 * Largest text near the top of page 1 is almost always the title; the line
 * right below it is often the author list.
 */
function guessHeader(items: unknown[], pageHeight: number): { title?: string; authors: Author[] } {
  const texts = items.filter(isText).filter((i) => i.str.trim().length > 0)
  const size = (i: TextItem) => Math.hypot(i.transform[2], i.transform[3])
  const top = texts.filter((i) => i.transform[5] > pageHeight * 0.35 && i.str.trim().length > 1)
  if (!top.length) return { authors: [] }
  const max = Math.max(...top.map(size))
  const big = top.filter((i) => size(i) >= max * 0.92)
  const title = big
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  // First line below the title block.
  const titleBottom = Math.min(...big.map((i) => i.transform[5]))
  const below = texts.filter((i) => i.transform[5] < titleBottom - 1).sort((a, b) => b.transform[5] - a.transform[5])
  let authors: Author[] = []
  if (below.length) {
    const y = below[0].transform[5]
    const line = below
      .filter((i) => Math.abs(i.transform[5] - y) < 2)
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((i) => i.str)
      .join(' ')
      .replace(/[\d*†‡§¹²³⁴]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (line.length < 200 && NAME_LINE.test(line)) authors = parseAuthors(line.replace(/\s*[·•]\s*/g, '; '))
  }
  return { title: title.length >= 8 && title.length <= 300 ? title : undefined, authors }
}

/** Publication year: first plausible year in the header of page 1. */
function guessYear(head: string): string | undefined {
  const now = new Date().getFullYear()
  for (const m of head.slice(0, 1500).matchAll(/\b(19[5-9]\d|20\d\d)\b/g)) {
    const y = Number(m[1])
    if (y <= now) return m[1]
  }
  return undefined
}

function guessAbstract(text: string): string | undefined {
  const m = text.match(/\babstract\b[\s.:—–-]*([\s\S]{120,2500}?)(?:\n\s*(?:keywords?|key words|jel|1\.?\s+introduction|introduction)\b)/i)
  return m?.[1]?.replace(/\s+/g, ' ').trim()
}

export async function extractPaper(paper: Pick<Paper, 'id' | 'fileName'>): Promise<Extraction> {
  const doc = await acquirePdf(paper)
  try {
    const pages: PageText[] = []
    let firstItems: unknown[] = []
    let firstHeight = 0
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const tc = await page.getTextContent()
      if (n === 1) {
        firstItems = tc.items
        firstHeight = page.view[3]
      }
      pages.push({ page: n, text: itemsToText(tc.items) })
      page.cleanup()
      // Yield so the UI stays responsive while extracting long books.
      if (n % 8 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as Record<string, string>
    const head = pages.slice(0, 2).map((p) => p.text).join('\n')
    const doi = (info.doi || head.match(DOI_RE)?.[1] || '').replace(/[.,;)\]]+$/, '') || undefined
    const infoTitle = info.Title && info.Title.length > 8 && !/^(untitled|microsoft word|\S+\.(docx?|pdf|tex))/i.test(info.Title) ? info.Title : undefined
    const header = guessHeader(firstItems, firstHeight)
    const infoAuthors = parseAuthors(info.Author)
    return {
      pages,
      pageCount: doc.numPages,
      meta: {
        title: infoTitle ?? header.title,
        authors: infoAuthors.length ? infoAuthors : header.authors,
        year: guessYear(pages[0]?.text ?? ''),
        doi,
        abstract: guessAbstract(head)
      }
    }
  } finally {
    releasePdf(paper.id)
  }
}

export { pdfjs }
export type { PDFDocumentProxy }

import type { Rect } from '@shared/types'
import { Util } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import { mergeLines } from '../reader/selection'

// Finds passages quoted by the model on the PDF page, as normalized rects, so
// they can be drawn like highlights. Matching runs on letters and digits only,
// which absorbs line-break hyphens, ligatures, curly quotes and spacing.

interface Box {
  left: number // normalized 0..1
  top: number
  width: number
  height: number
  len: number // code points in the item
  str: string
  font: string // CSS font family pdf.js lays the text layer out in
  /** Cumulative glyph advance before each code point, 0..1 of the width (measured lazily). */
  adv?: Float32Array
}

export interface PageIndex {
  page: number
  norm: string
  /** For each char of `norm`: the text item and code point it came from. */
  item: Int32Array
  ch: Int32Array
  boxes: Box[]
  /** The page's text as read (items joined, line-break hyphens rejoined), for pattern searches. */
  raw: string
  /** For each UTF-16 unit of `raw`: its text item and code point (-1 for inserted line breaks). */
  rawItem: Int32Array
  rawCh: Int32Array
}

const MARKS = /[̀-ͯ]/g
const ALNUM = /[\p{L}\p{N}]/u

function foldChar(c: string): string {
  let out = ''
  for (const x of c.normalize('NFKD').replace(MARKS, '').toLowerCase()) if (ALNUM.test(x)) out += x
  return out
}

export function normalize(s: string): string {
  let out = ''
  for (const c of s) out += foldChar(c)
  return out
}

const isText = (i: unknown): i is TextItem => typeof (i as TextItem).str === 'string'

export async function indexPage(page: PDFPageProxy): Promise<PageIndex> {
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const boxes: Box[] = []
  const items: number[] = []
  const chars: number[] = []
  let norm = ''
  let raw = ''
  const rawItems: number[] = []
  const rawChars: number[] = []
  for (const it of tc.items) {
    if (!isText(it)) continue
    if (!it.str) {
      if (it.hasEOL) pushBreak()
      continue
    }
    // Same geometry as pdf.js's TextLayer, at scale 1.
    const tx = Util.transform(vp.transform, it.transform)
    const fontHeight = Math.hypot(tx[2], tx[3])
    const style = tc.styles[it.fontName]
    const ascent = style?.ascent ? style.ascent : 0.8
    const descent = style?.descent ? Math.abs(style.descent) : 0.2
    const width = (style?.vertical ? it.height : it.width) * vp.scale
    const cps = [...it.str]
    const b = boxes.push({
      left: tx[4] / vp.width,
      top: (tx[5] - fontHeight * ascent) / vp.height,
      width: width / vp.width,
      height: (fontHeight * Math.min(1.3, Math.max(0.9, ascent + descent))) / vp.height,
      len: cps.length,
      str: it.str,
      font: style?.fontFamily || 'sans-serif'
    }) - 1
    cps.forEach((c, k) => {
      const f = foldChar(c)
      for (let j = 0; j < f.length; j++) {
        items.push(b)
        chars.push(k)
      }
      norm += f
      raw += c
      for (let j = 0; j < c.length; j++) {
        rawItems.push(b)
        rawChars.push(k)
      }
    })
    if (it.hasEOL) pushBreak()
  }
  // A line break separates words, except after a hyphen splitting one ("epis-|temic").
  function pushBreak() {
    if (/\p{L}-$/u.test(raw)) {
      raw = raw.slice(0, -1)
      rawItems.pop()
      rawChars.pop()
    } else if (raw && !raw.endsWith(' ')) {
      raw += ' '
      rawItems.push(-1)
      rawChars.push(-1)
    }
  }
  return {
    page: page.pageNumber,
    norm,
    item: Int32Array.from(items),
    ch: Int32Array.from(chars),
    boxes,
    raw,
    rawItem: Int32Array.from(rawItems),
    rawCh: Int32Array.from(rawChars)
  }
}

/** Rects covering `raw[start, end)` of a page index. */
export function rawRects(index: PageIndex, start: number, end: number): Rect[] {
  return spanRects(index.boxes, index.rawItem, index.rawCh, start, end)
}

function spanRects(boxes: Box[], item: Int32Array, ch: Int32Array, start: number, end: number): Rect[] {
  const spans = new Map<number, [number, number]>()
  for (let i = start; i < end; i++) {
    const b = item[i]
    if (b < 0) continue
    const c = ch[i]
    const s = spans.get(b)
    if (!s) spans.set(b, [c, c])
    else s[1] = Math.max(s[1], c)
  }
  const rects: Rect[] = []
  for (const [b, [c0, c1]] of spans) {
    const box = boxes[b]
    const adv = advances(box)
    const x0 = adv ? adv[c0] : c0 / box.len
    const x1 = adv ? adv[c1 + 1] : (c1 + 1) / box.len
    rects.push({ x: box.left + box.width * x0, y: box.top, w: box.width * (x1 - x0), h: box.height })
  }
  return mergeLines(rects)
}

// Where each character sits inside a text item. pdf.js stretches the browser's
// rendering of the item to the PDF's width, so measuring glyphs in the same
// font family gives the text layer's positions; without a canvas (tests),
// characters are taken as equally wide.
let measurer: OffscreenCanvasRenderingContext2D | null | undefined
const glyphWidths = new Map<string, number>()

function advances(box: Box): Float32Array | null {
  if (box.adv) return box.adv
  if (measurer === undefined) measurer = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  if (!measurer || box.len < 2) return null
  measurer.font = `100px ${box.font}`
  const adv = new Float32Array(box.len + 1)
  let k = 0
  for (const c of box.str) {
    const key = box.font + c
    let w = glyphWidths.get(key)
    if (w === undefined) glyphWidths.set(key, (w = measurer.measureText(c).width))
    adv[k + 1] = adv[k] + w
    k++
  }
  const total = adv[box.len]
  if (!total) return null
  for (let i = 1; i <= box.len; i++) adv[i] /= total
  return (box.adv = adv)
}

/**
 * Where `q` sits in `norm` when the model's copy drifted slightly (a dropped
 * word, a missing footnote marker): several chunks of the quote must agree on
 * one position, then each edge snaps to the quote's first and last letters.
 */
function fuzzy(norm: string, q: string): [number, number] | null {
  if (q.length < 40) return null
  const k = Math.min(32, Math.floor(q.length / 4))
  const tol = Math.max(20, q.length * 0.15)
  const hits: { o: number; pos: number }[] = []
  for (const o of [0, (q.length - k) / 3, ((q.length - k) * 2) / 3, q.length - k].map(Math.floor)) {
    const pos = norm.indexOf(q.slice(o, o + k))
    if (pos >= 0) hits.push({ o, pos })
  }
  // The largest group of chunks that agree on where the quote starts.
  let best: typeof hits = []
  for (const h of hits) {
    const group = hits.filter((x) => Math.abs(x.pos - x.o - (h.pos - h.o)) <= tol)
    if (group.length > best.length) best = group
  }
  if (best.length < 2) return null
  const first = best[0]
  const last = best[best.length - 1]
  // Closest occurrence of the quote's first (or last) letters to where we expect them.
  const snap = (edge: 'start' | 'end', near: number) => {
    for (const n of [10, 6]) {
      const needle = edge === 'start' ? q.slice(0, n) : q.slice(-n)
      const target = edge === 'start' ? near : near - n
      let found = -1
      for (let i = norm.indexOf(needle, Math.max(0, target - tol)); i >= 0 && i <= target + tol; i = norm.indexOf(needle, i + 1))
        if (found < 0 || Math.abs(i - target) < Math.abs(found - target)) found = i
      if (found >= 0) return edge === 'start' ? found : found + n
    }
    return near
  }
  const start = first.o === 0 ? first.pos : snap('start', first.pos - first.o)
  const end = last.o === q.length - k ? last.pos + k : snap('end', last.pos + q.length - last.o)
  return end > start ? [Math.max(0, start), Math.min(norm.length, end)] : null
}

/** Range of `index.norm` covered by `query`, or null when it isn't on this page. */
export function findSpan(index: PageIndex, query: string): [number, number] | null {
  const q = normalize(query)
  if (q.length < 12) return null
  const exact = index.norm.indexOf(q)
  return exact >= 0 ? [exact, exact + q.length] : fuzzy(index.norm, q)
}

/** Rects covering `query` on this page, or null when it isn't there. */
export function locate(index: PageIndex, query: string): Rect[] | null {
  const span = findSpan(index, query)
  if (!span) return null
  const [start, end] = span
  return spanRects(index.boxes, index.item, index.ch, start, end)
}

/**
 * Locates many passages in one document. Each is looked for on its stated
 * page first, then the neighbours, then everywhere (models miscount pages).
 */
export async function locateAll(doc: PDFDocumentProxy, wanted: { page: number; text: string }[]): Promise<({ page: number; rects: Rect[] } | null)[]> {
  const cache = new Map<number, Promise<PageIndex>>()
  const index = (n: number) => {
    let p = cache.get(n)
    if (!p) cache.set(n, (p = doc.getPage(n).then(indexPage)))
    return p
  }
  const out: ({ page: number; rects: Rect[] } | null)[] = []
  for (const w of wanted) {
    const first = Math.min(Math.max(1, Math.round(w.page) || 1), doc.numPages)
    const order = [first, first + 1, first - 1]
    for (let n = 1; n <= doc.numPages; n++) if (!order.includes(n)) order.push(n)
    let found: { page: number; rects: Rect[] } | null = null
    for (const n of order) {
      if (n < 1 || n > doc.numPages) continue
      const rects = locate(await index(n), w.text)
      if (rects?.length) {
        found = { page: n, rects }
        break
      }
    }
    out.push(found)
  }
  return out
}

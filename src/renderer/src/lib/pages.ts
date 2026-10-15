import type { PageText, Paper } from '@shared/types'

// Printed page numbers. A journal article's PDF starts at page 1, but APA asks
// for the page printed on the article (pp. 615–625 → PDF page 3 is p. 617).
// Citations keep storing the PDF page, which is what the reader jumps to, and
// show `PDF page + offset` once the offset is known.

/** Where the page number usually sits: the running head or the footer. */
const EDGE = 90
const YEAR = /^(19|20)\d\d$/

/** "615–625", "615-25", "pp. 1-12" → { start: 615, end: 625 }. Article numbers (e1234) and single pages give null. */
export function parsePageRange(pages?: string): { start: number; end: number } | null {
  const m = pages?.match(/(\d+)\s*[-–—]+\s*(\d+)/)
  if (!m) return null
  const start = Number(m[1])
  let end = Number(m[2])
  // Abbreviated end: 615–25 → 625.
  if (end < start && m[2].length < m[1].length) end = Number(m[1].slice(0, m[1].length - m[2].length) + m[2])
  return end >= start ? { start, end } : null
}

/** Standalone numbers at the top and bottom of a page's text. */
function edgeNumbers(text: string): number[] {
  const t = text.trim()
  const edges = t.length <= EDGE * 2 ? [t] : [t.slice(0, EDGE), t.slice(-EDGE)]
  const out = new Set<number>()
  for (const e of edges)
    for (const m of e.matchAll(/(?<![\d.,:/–-])(\d{1,4})(?![\d.,:/%–-]\d|\d)/g)) {
      if (YEAR.test(m[1])) continue
      const n = Number(m[1])
      if (n > 0) out.add(n)
    }
  return [...out]
}

/**
 * The offset between PDF pages and printed pages (printed = PDF + offset), or
 * null when it can't be told. Page numbers printed in the running heads vote;
 * the metadata's page range settles it when the text doesn't (scanned PDFs,
 * numbers drawn as images) or breaks a weak tie.
 */
export function detectPageOffset(pages: PageText[], pagesField?: string, pageCount?: number): number | null {
  const withText = pages.filter((p) => p.text.trim().length > 40)
  const votes = new Map<number, number>()
  for (const p of withText) for (const n of edgeNumbers(p.text)) votes.set(n - p.page, (votes.get(n - p.page) ?? 0) + 1)

  const range = parsePageRange(pagesField)
  const count = pageCount ?? pages.length
  // A range as long as the PDF lines up page by page; one or two pages fewer
  // means a cover sheet (JSTOR, repositories) sits before the article.
  const expected = range ? [0, 1, 2].filter((extra) => range.end - range.start + 1 + extra === count).map((extra) => range.start - 1 - extra) : []

  const ranked = [...votes].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))
  const [best, bestVotes] = ranked[0] ?? [null, 0]
  const runnerUp = ranked[1]?.[1] ?? 0
  const needed = Math.max(2, Math.ceil(withText.length * 0.3))
  if (best !== null && bestVotes >= needed && bestVotes > runnerUp) return best
  // Weak evidence from the text that agrees with the metadata.
  const agreed = ranked.find(([offset, n]) => n >= 1 && expected.includes(offset))
  if (agreed) return agreed[0]
  return range && expected.includes(range.start - 1) ? range.start - 1 : null
}

/** The page to print in a citation for a PDF page. Pages before the article's first printed page keep the PDF number. */
export function printedPage(paper: Pick<Paper, 'printedPages'> | undefined, page: number): number {
  const offset = paper?.printedPages?.offset
  if (offset == null) return page
  const printed = page + offset
  return printed >= 1 ? printed : page
}

/** True when the citation will show a page different from the PDF page. */
export const hasPrintedPages = (paper: Pick<Paper, 'printedPages'> | undefined) => !!paper?.printedPages?.offset

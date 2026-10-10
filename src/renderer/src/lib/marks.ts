import type { Rect } from '@shared/types'
import { rawRects, type PageIndex } from './locate'

// What the reader marks on a page besides highlights: key terms from the
// reading guide (definition on hover, after ScholarPhi) and in-text citations
// of papers already in the library (after CiteSee).

export interface TermMark {
  kind: 'term'
  id: string
  rects: Rect[]
  /** Index into the guide's terms. */
  term: number
}

export interface CiteMark {
  kind: 'cite'
  id: string
  rects: Rect[]
  paperId: string
  /** The cited paper is marked read (green) rather than just in the library (blue). */
  read: boolean
}

export type PageMark = TermMark | CiteMark

export interface CitableWork {
  id: string
  family: string // first author's family name
  year: string
  /** Other authors' family names, to tell apart two library papers by the same first author and year. */
  others: string[]
  read: boolean
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The first occurrence of each term on the page (one mark per term keeps the
 * page readable; the definition is the same everywhere). Matches whole words,
 * any case, across line breaks, with an optional plural.
 */
export function findTerms(index: PageIndex, terms: { original?: string }[]): TermMark[] {
  const out: TermMark[] = []
  terms.forEach((t, i) => {
    const words = t.original?.trim().split(/\s+/).filter(Boolean)
    if (!words?.length || words.join('').length < 3) return
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escape).join('[\\s-]+')}(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu')
    const m = re.exec(index.raw)
    if (!m) return
    const rects = rawRects(index, m.index, m.index + m[0].length)
    if (rects.length) out.push({ kind: 'term', id: `t${index.page}-${i}`, rects, term: i })
  })
  return out
}

/**
 * Author–year citations of library papers: "Popper, 2012", "Popper (2012)",
 * "Popper et al., 2012", "Popper & Mayseless, 2003". Nothing between the name
 * and the year may be a digit, semicolon or parenthesis, so "(Popper, 2010;
 * Shamir, 2012)" doesn't count as Popper 2012.
 */
export function findCitations(index: PageIndex, works: CitableWork[]): CiteMark[] {
  const best = new Map<number, { w: CitableWork; end: number; score: number }>()
  for (const w of works) {
    if (w.family.length < 2 || !/^\d{4}$/.test(w.year)) continue
    const name = w.family.trim().split(/\s+/).map(escape).join('\\s+')
    const re = new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])[^();\\d]{0,60}?[,(]\\s*${w.year}[a-z]?(?![\\d])`, 'gu')
    for (const m of index.raw.matchAll(re)) {
      const said = m[0].toLowerCase()
      const score = w.others.filter((o) => o.length > 1 && said.includes(o.toLowerCase())).length
      const prev = best.get(m.index!)
      if (!prev || score > prev.score) best.set(m.index!, { w, end: m.index! + m[0].length, score })
    }
  }
  const out: CiteMark[] = []
  for (const [start, { w, end }] of best) {
    const rects = rawRects(index, start, end)
    if (rects.length) out.push({ kind: 'cite', id: `c${index.page}-${start}`, rects, paperId: w.id, read: w.read })
  }
  return out
}

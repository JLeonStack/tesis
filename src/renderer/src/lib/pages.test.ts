import { describe, expect, it } from 'vitest'
import type { PageText, Paper } from '@shared/types'
import { detectPageOffset, parsePageRange, printedPage } from './pages'
import { inText, inTextGroup } from './citation'

const body = 'Attachment theory proposes that leaders can act as security providers for their followers, much like parents do for their children. '.repeat(6)

/** An article whose PDF page i carries `head(i)` as its running head. */
const article = (count: number, head: (page: number) => string): PageText[] =>
  Array.from({ length: count }, (_, i) => ({ page: i + 1, text: `${head(i + 1)}\n${body}` }))

describe('parsePageRange', () => {
  it('reads full and abbreviated ranges', () => {
    expect(parsePageRange('615–625')).toEqual({ start: 615, end: 625 })
    expect(parsePageRange('615-25')).toEqual({ start: 615, end: 625 })
    expect(parsePageRange('pp. 1-12')).toEqual({ start: 1, end: 12 })
    expect(parsePageRange('e1234')).toBeNull()
    expect(parsePageRange(undefined)).toBeNull()
  })
})

describe('detectPageOffset', () => {
  it('reads the page numbers printed in the running heads', () => {
    const pages = article(11, (p) => (p % 2 ? `Journal of Leadership 14(3) ${614 + p}` : `${614 + p} POPPER AND MAYSELESS`))
    expect(detectPageOffset(pages)).toBe(614)
  })

  it('ignores years, volume numbers and the page range in the header', () => {
    const pages = article(8, (p) => `Leadership Quarterly 2003, Vol. 14, 41–70 · ${40 + p}`)
    expect(detectPageOffset(pages)).toBe(40)
  })

  it('handles a cover sheet before the article', () => {
    const pages = [{ page: 1, text: `Downloaded from JSTOR on 12 March 2021. ${body}` }, ...article(10, (p) => `${200 + p}`).map((p) => ({ ...p, page: p.page + 1 }))]
    expect(detectPageOffset(pages, '201-210', 11)).toBe(199)
  })

  it('falls back to the metadata range when the text has no page numbers', () => {
    const pages = article(11, () => 'POPPER AND MAYSELESS')
    expect(detectPageOffset(pages, '615–25', 11)).toBe(614)
    // A range that doesn't match the PDF's length can't be trusted.
    expect(detectPageOffset(pages, '615–30', 11)).toBeNull()
    expect(detectPageOffset(pages)).toBeNull()
  })

  it('keeps PDF numbering when the printed numbers match it', () => {
    expect(detectPageOffset(article(6, (p) => `Working paper · ${p}`))).toBe(0)
  })
})

describe('citing the printed page', () => {
  const paper: Paper = {
    id: 'popper',
    fileName: '',
    title: 'Back to basics',
    authors: [{ family: 'Popper', given: 'M.' }, { family: 'Mayseless', given: 'O.' }],
    year: '2003',
    type: 'article',
    tags: [],
    status: 'read',
    textStatus: 'ready',
    printedPages: { offset: 614, source: 'auto' },
    addedAt: 0,
    updatedAt: 0
  }

  it('maps PDF pages, keeping front matter on the PDF number', () => {
    expect(printedPage(paper, 3)).toBe(617)
    expect(printedPage({ printedPages: { offset: -1, source: 'manual' } }, 1)).toBe(1)
    expect(printedPage({ printedPages: { offset: null, source: 'auto' } }, 3)).toBe(3)
    expect(printedPage(undefined, 3)).toBe(3)
  })

  it('prints the article page in APA citations', () => {
    expect(inText(paper, 'apa', 3, 'es')).toBe('(Popper y Mayseless, 2003, p. 617)')
    expect(inTextGroup([{ paper, page: 3 }], 'apa', 'es')).toBe('(Popper y Mayseless, 2003, p. 617)')
    expect(inText({ ...paper, printedPages: undefined }, 'apa', 3, 'es')).toBe('(Popper y Mayseless, 2003, p. 3)')
    expect(inText(paper, 'apa', undefined, 'es')).toBe('(Popper y Mayseless, 2003)')
  })
})

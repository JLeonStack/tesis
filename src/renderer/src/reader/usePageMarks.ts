import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import type { PDFDocumentProxy } from '../lib/pdf'
import { indexPage, type PageIndex } from '../lib/locate'
import { findCitations, findTerms, type CitableWork, type PageMark } from '../lib/marks'

// Term and citation marks for the pages in view. Each page's text is indexed
// once per document; marks are recomputed when the guide's terms or the
// library (who wrote what, and what's been read) change.

const indexes = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageIndex>>>()

function pageIndex(doc: PDFDocumentProxy, n: number): Promise<PageIndex> {
  let pages = indexes.get(doc)
  if (!pages) indexes.set(doc, (pages = new Map()))
  let p = pages.get(n)
  if (!p) pages.set(n, (p = doc.getPage(n).then((page) => indexPage(page as Parameters<typeof indexPage>[0]))))
  return p
}

const SEP = '\u0001'
const ROW = '\u0002'

export function usePageMarks(doc: PDFDocumentProxy | null, paperId: string, visible: Set<number>): Map<number, PageMark[]> {
  const on = useStore((s) => s.marks)
  const terms = useStore((s) => s.guides[paperId]?.terms)
  // A string, so unrelated paper edits (last page, tags) don't recompute anything.
  const libraryKey = useStore((s) =>
    Object.values(s.papers)
      .filter((p) => p.id !== paperId && p.year && p.authors[0]?.family)
      .map((p) => [p.id, p.year!.slice(0, 4), p.status === 'read' ? 1 : 0, ...p.authors.map((a) => a.family)].join(SEP))
      .sort()
      .join(ROW)
  )
  const works = useMemo<CitableWork[]>(
    () =>
      libraryKey
        ? libraryKey.split(ROW).map((row) => {
            const [id, year, read, family, ...others] = row.split(SEP)
            return { id, year, read: read === '1', family, others }
          })
        : [],
    [libraryKey]
  )

  const [marks, setMarks] = useState<{ key: object; pages: Map<number, PageMark[]> }>({ key: {}, pages: new Map() })
  const key = useMemo(() => ({}), [doc, terms, works, on]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc || !on) return
    const pages = marks.key === key ? marks.pages : new Map<number, PageMark[]>()
    const todo = [...visible].filter((n) => n <= doc.numPages && !pages.has(n))
    if (!todo.length) {
      if (marks.key !== key) setMarks({ key, pages })
      return
    }
    let alive = true
    void Promise.all(
      todo.map(async (n) => {
        const index = await pageIndex(doc, n)
        return [n, [...findTerms(index, terms ?? []), ...findCitations(index, works)]] as [number, PageMark[]]
      })
    ).then((found) => {
      if (!alive) return
      setMarks((m) => {
        const next = new Map(m.key === key ? m.pages : undefined)
        for (const [n, list] of found) next.set(n, list)
        return { key, pages: next }
      })
    })
    return () => {
      alive = false
    }
  }, [doc, on, key, visible, terms, works, marks])

  return on && marks.key === key ? marks.pages : EMPTY
}

const EMPTY = new Map<number, PageMark[]>()

import type { CrossrefWork, PageText, Paper } from '@shared/types'
import { aiModel, openTab, patchPaper, toast, useStore } from '../store'
import { extractPaper } from './pdf'
import { detectPageOffset } from './pages'
import { cleanText, missingReferenceData } from './citation'

// Background pipeline: text extraction → metadata (DOI → Crossref → heuristics).
// Runs one paper at a time so reading stays smooth while a batch imports.

const textCache = new Map<string, Promise<PageText[] | null>>()

export function getPaperText(id: string): Promise<PageText[] | null> {
  let p = textCache.get(id)
  if (!p) {
    p = window.api.text.get(id)
    textCache.set(id, p)
    p.then((v) => v ?? textCache.delete(id))
  }
  return p
}

let running = false
const queue: string[] = []

export function enqueue(ids: string[]): void {
  for (const id of ids) if (!queue.includes(id)) queue.push(id)
  void pump()
}

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const id = queue.shift()!
      const paper = useStore.getState().papers[id]
      if (paper && paper.textStatus === 'pending') await ingest(paper)
    }
  } finally {
    running = false
  }
}

function applyWork(p: Paper, w: CrossrefWork): Partial<Paper> {
  return {
    title: w.title || p.title,
    authors: w.authors.length ? w.authors : p.authors,
    year: w.year || p.year,
    type: w.type || p.type,
    venue: w.venue || p.venue,
    volume: w.volume || p.volume,
    issue: w.issue || p.issue,
    pages: w.pages || p.pages,
    articleNumber: w.articleNumber || p.articleNumber,
    editors: w.editors?.length ? w.editors : p.editors,
    publisher: w.publisher || p.publisher,
    doi: w.doi || p.doi,
    url: w.url || p.url,
    abstract: w.abstract || p.abstract,
    metaSource: 'crossref'
  }
}

async function ingest(paper: Paper): Promise<void> {
  try {
    const ex = await extractPaper(paper)
    await window.api.text.save(paper.id, ex.pages)
    textCache.set(paper.id, Promise.resolve(ex.pages))
    const base: Partial<Paper> = {
      textStatus: 'ready',
      pageCount: ex.pageCount,
      printedPages: paper.printedPages?.source === 'manual' ? paper.printedPages : { offset: detectPageOffset(ex.pages, paper.pages, ex.pageCount), source: 'auto' }
    }
    if (paper.metaSource === 'manual' || paper.metaSource === 'crossref') return patchPaper(paper.id, base)

    const m = ex.meta
    const heuristic: Partial<Paper> = {
      ...base,
      title: m.title || paper.title,
      authors: m.authors.length ? m.authors : paper.authors,
      year: m.year,
      doi: m.doi,
      abstract: m.abstract,
      metaSource: 'pdf'
    }
    patchPaper(paper.id, heuristic)

    const work = (m.doi && (await window.api.meta.byDoi(m.doi))) || (m.title && (await window.api.meta.byTitle(m.title)))
    const latest = useStore.getState().papers[paper.id]
    if (work && latest && latest.metaSource !== 'manual') patchPaper(paper.id, applyWork(latest, work))
    // No Crossref record (working papers, books, reports): let the model read
    // the first pages. Runs in the background so the queue keeps moving.
    else if (!work && useStore.getState().account?.connected) void autofillWithAi(paper.id).catch(() => {})
  } catch (e) {
    console.error('ingest failed', e)
    patchPaper(paper.id, { textStatus: 'error' })
  }
}

export async function importPapers(paths?: string[]): Promise<void> {
  const added = await window.api.papers.import(paths)
  if (!added.length) return
  const state = useStore.getState()
  const fresh = added.filter((p) => !state.papers[p.id])
  useStore.setState((s) => ({ papers: { ...s.papers, ...Object.fromEntries(added.map((p) => [p.id, s.papers[p.id] ?? p])) } }))
  enqueue(fresh.map((p) => p.id))
  if (added.length === 1) openTab({ kind: 'paper', id: added[0].id })
  if (fresh.length) toast(fresh.length === 1 ? 'Paper agregado a tu biblioteca' : `${fresh.length} papers agregados a tu biblioteca`)
  else toast('Ya está en tu biblioteca')
}

/** Resume any extraction interrupted by a previous quit. */
export function resumePending(): void {
  enqueue(Object.values(useStore.getState().papers).filter((p) => p.textStatus === 'pending').map((p) => p.id))
  watchPrintedPages()
  void completeReferences()
}

// ---------- complete references ----------

let completing = false

/**
 * Fills what the references lack from Crossref, only in empty fields (what the
 * student typed stays), and clears HTML entities left by older imports.
 */
async function completeReferences(): Promise<void> {
  if (completing) return
  completing = true
  for (const p of Object.values(useStore.getState().papers)) {
    const fix: Partial<Paper> = {}
    for (const k of ['title', 'venue', 'publisher'] as const) {
      const v = p[k]
      if (v && cleanText(v) !== v) fix[k] = cleanText(v)
    }
    if (Object.keys(fix).length) patchPaper(p.id, fix)
  }
  for (const p of Object.values(useStore.getState().papers)) {
    if (!p.doi || (p.type === 'article' && p.issue && p.volume && (p.pages || p.articleNumber))) continue
    if (p.type !== 'article' && !missingReferenceData(p).length && (p.type !== 'chapter' || p.editors?.length)) continue
    const work = await window.api.meta.byDoi(p.doi).catch(() => null)
    const latest = useStore.getState().papers[p.id]
    if (!work || !latest) continue
    const fill: Partial<Paper> = {}
    for (const k of ['venue', 'volume', 'issue', 'pages', 'articleNumber', 'publisher'] as const) if (!latest[k] && work[k]) fill[k] = work[k]
    if (!latest.editors?.length && work.editors?.length) fill.editors = work.editors
    if (Object.keys(fill).length) patchPaper(p.id, fill)
  }
}

// ---------- printed page numbers ----------

/** Works out (again) which printed page each PDF page is, unless the student set it by hand. */
export async function detectPrintedPages(id: string, cache = true): Promise<void> {
  const p = useStore.getState().papers[id]
  if (!p || p.textStatus !== 'ready' || p.printedPages?.source === 'manual') return
  // The boot backfill reads every paper once: no need to keep all that text in memory.
  const pages = await (cache || textCache.has(id) ? getPaperText(id) : window.api.text.get(id))
  const latest = useStore.getState().papers[id]
  if (!pages || !latest || latest.printedPages?.source === 'manual') return
  const offset = detectPageOffset(pages, latest.pages, latest.pageCount)
  if (latest.printedPages?.offset !== offset) patchPaper(id, { printedPages: { offset, source: 'auto' } })
}

let watching = false

/** Papers read before this existed get their numbering in the background; a new page range (Crossref, IA, by hand) re-derives it. */
function watchPrintedPages(): void {
  if (watching) return
  watching = true
  const todo = Object.values(useStore.getState().papers).filter((p) => p.textStatus === 'ready' && !p.printedPages)
  void (async () => {
    for (const p of todo) await detectPrintedPages(p.id, false).catch(() => {})
  })()
  useStore.subscribe((s, prev) => {
    if (s.papers === prev.papers) return
    for (const p of Object.values(s.papers)) {
      const before = prev.papers[p.id]
      if (before && before.textStatus === 'ready' && p.pages !== before.pages) void detectPrintedPages(p.id).catch(() => {})
    }
  })
}

export async function refreshFromDoi(id: string, doi: string): Promise<boolean> {
  const work = await window.api.meta.byDoi(doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, ''))
  const p = useStore.getState().papers[id]
  if (!work || !p) return false
  patchPaper(id, applyWork(p, work))
  return true
}

const META_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'authors', 'year', 'type', 'venue', 'volume', 'issue', 'pages', 'publisher', 'doi', 'abstract'],
  properties: {
    title: { type: 'string' },
    authors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['given', 'family'],
        properties: { given: { type: 'string' }, family: { type: 'string' } }
      }
    },
    year: { type: 'string' },
    type: { type: 'string', enum: ['article', 'book', 'chapter', 'report', 'thesis', 'conference', 'web'] },
    venue: { type: 'string' },
    volume: { type: 'string' },
    issue: { type: 'string' },
    pages: { type: 'string' },
    publisher: { type: 'string' },
    doi: { type: 'string' },
    abstract: { type: 'string' }
  }
}

export async function autofillWithAi(id: string): Promise<void> {
  const pages = await getPaperText(id)
  if (!pages) throw new Error('El texto del paper todavía no está listo.')
  const head = pages.slice(0, 3).map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n').slice(0, 14000)
  const r = (await window.api.ai.extract(
    `Extraé los metadatos bibliográficos de este documento académico a partir de sus primeras páginas. Usá el año de publicación del propio documento, no los años que aparecen en las citas. Conservá el resumen textual si está presente.\n\n${head}`,
    META_SCHEMA,
    { model: aiModel().id }
  )) as Omit<CrossrefWork, 'url'>
  const p = useStore.getState().papers[id]
  if (!p || p.metaSource === 'manual') return
  const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined)
  patchPaper(id, {
    title: clean(r.title) ?? p.title,
    authors: r.authors?.filter((a) => a.family || a.given).length ? r.authors : p.authors,
    year: clean(r.year) ?? p.year,
    type: r.type ?? p.type,
    venue: clean(r.venue) ?? p.venue,
    volume: clean(r.volume) ?? p.volume,
    issue: clean(r.issue) ?? p.issue,
    pages: clean(r.pages) ?? p.pages,
    publisher: clean(r.publisher) ?? p.publisher,
    doi: clean(r.doi) ?? p.doi,
    abstract: clean(r.abstract) ?? p.abstract,
    metaSource: 'ai'
  })
  // A DOI found by the model lets Crossref fill in authoritative details.
  if (clean(r.doi) && !p.doi) await refreshFromDoi(id, r.doi!)
}

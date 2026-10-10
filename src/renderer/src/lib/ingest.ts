import type { CrossrefWork, PageText, Paper } from '@shared/types'
import { aiModel, openTab, patchPaper, toast, useStore } from '../store'
import { extractPaper } from './pdf'

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
    const base: Partial<Paper> = { textStatus: 'ready', pageCount: ex.pageCount }
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
  if (fresh.length) toast(fresh.length === 1 ? 'Paper added to your library' : `${fresh.length} papers added to your library`)
  else toast('Already in your library')
}

/** Resume any extraction interrupted by a previous quit. */
export function resumePending(): void {
  enqueue(Object.values(useStore.getState().papers).filter((p) => p.textStatus === 'pending').map((p) => p.id))
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
  if (!pages) throw new Error('The paper text is not ready yet.')
  const head = pages.slice(0, 3).map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n').slice(0, 14000)
  const r = (await window.api.ai.extract(
    `Extract the bibliographic metadata of this academic document from its first pages. Use the document's own publication year, not citation years. Keep the abstract verbatim if present.\n\n${head}`,
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

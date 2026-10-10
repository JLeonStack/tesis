import { net } from 'electron'
import type { Author, CrossrefWork, PaperType } from '../shared/types'

const UA = 'ThesisStudio/0.1 (desktop research reader)'

const TYPE_MAP: Record<string, PaperType> = {
  'journal-article': 'article',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'book-chapter': 'chapter',
  'proceedings-article': 'conference',
  report: 'report',
  dissertation: 'thesis',
  'posted-content': 'article'
}

interface CrossrefItem {
  title?: string[]
  author?: { given?: string; family?: string; name?: string }[]
  issued?: { 'date-parts'?: number[][] }
  type?: string
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  publisher?: string
  DOI?: string
  URL?: string
  abstract?: string
  score?: number
}

function stripJats(s?: string): string | undefined {
  if (!s) return undefined
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^Abstract\s*/i, '')
    .trim()
}

function toWork(it: CrossrefItem): CrossrefWork {
  const authors: Author[] = (it.author ?? []).map((a) => ({
    given: a.given ?? '',
    family: a.family ?? a.name ?? ''
  }))
  const year = it.issued?.['date-parts']?.[0]?.[0]
  return {
    title: it.title?.[0],
    authors,
    year: year ? String(year) : undefined,
    type: TYPE_MAP[it.type ?? ''] ?? 'article',
    venue: it['container-title']?.[0],
    volume: it.volume,
    issue: it.issue,
    pages: it.page,
    publisher: it.publisher,
    doi: it.DOI,
    url: it.DOI ? `https://doi.org/${it.DOI}` : it.URL,
    abstract: stripJats(it.abstract)
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await net.fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  return res.json()
}

export async function lookupDoi(doi: string): Promise<CrossrefWork | null> {
  try {
    const json = (await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)) as {
      message?: CrossrefItem
    } | null
    return json?.message ? toWork(json.message) : null
  } catch {
    return null
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Bibliographic search; only accepts a hit whose title closely matches. */
export async function lookupTitle(title: string): Promise<CrossrefWork | null> {
  try {
    const q = encodeURIComponent(title.slice(0, 300))
    const json = (await getJson(`https://api.crossref.org/works?query.bibliographic=${q}&rows=3`)) as {
      message?: { items?: CrossrefItem[] }
    } | null
    const want = norm(title)
    for (const it of json?.message?.items ?? []) {
      const got = norm(it.title?.[0] ?? '')
      if (!got) continue
      if (got === want || (got.length > 20 && (want.includes(got) || got.includes(want)))) return toWork(it)
    }
    return null
  } catch {
    return null
  }
}

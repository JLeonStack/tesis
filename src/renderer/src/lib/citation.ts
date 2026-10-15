import type { Author, CitationStyle, Paper } from '@shared/types'
import { printedPage } from './pages'

// Reference formatting for the four styles most used in MBA programs.
// Output is plain text with *asterisks* marking italics (rendered by callers).

/** «Robert Chris» → «R. C.», «Jean-Paul» → «J.-P.» (APA 9.8). */
const initials = (given: string) =>
  given
    .split(/\s+/)
    .filter(Boolean)
    .map((g) =>
      g
        .split('-')
        .filter(Boolean)
        .map((x) => `${x[0].toUpperCase()}.`)
        .join('-')
    )
    .join(' ')

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** Crossref and PDFs leave «&amp;», «&#8211;» and tags like <i> in titles and journal names. */
export const cleanText = (s?: string): string =>
  (s ?? '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)
    )
    .replace(/\s+/g, ' ')
    .trim()

// APA 7 (6.17): article and chapter titles go in sentence case: only the
// first word, the first after a colon and proper nouns are capitalized.
const WORD = /([:?!.—]\s*)|(\p{L}[\p{L}'’]*)/gu
const capitalized = (w: string) => /^\p{Lu}\p{Ll}/u.test(w)

/** True when a title is in Title Case («The Role of Leader Support in…»), which APA reserves for journal names. */
export function looksTitleCase(title: string): boolean {
  let first = true
  let caps = 0
  let words = 0
  for (const m of cleanText(title).matchAll(WORD)) {
    if (m[1]) {
      first = true
      continue
    }
    const w = m[2]
    if (!first && w.length >= 4) {
      words++
      if (capitalized(w)) caps++
    }
    first = false
  }
  return caps >= 2 && caps / Math.max(1, words) >= 0.5
}

/** Title Case → sentence case, keeping acronyms (LSPS, ECR-RS) and the word after a colon. Proper nouns need a look afterwards. */
export function toSentenceCase(title: string): string {
  let first = true
  return cleanText(title).replace(WORD, (all, stop: string | undefined, w: string | undefined) => {
    if (stop) {
      first = true
      return all
    }
    const word = w!
    const out = first ? word[0].toUpperCase() + word.slice(1) : capitalized(word) ? word.toLowerCase() : word
    first = false
    return out
  })
}

/** Page ranges with an en dash and full numbers: «615-25» → «615–625» (APA 9.27). */
export function pageRange(pages?: string): string {
  const t = cleanText(pages)
  const m = t.match(/^(?:pp?\.\s*)?([A-Za-z]?\d+)\s*[-‐‑–—]+\s*([A-Za-z]?\d+)$/)
  if (!m) return t.replace(/^pp?\.\s*/, '')
  let [a, b] = [m[1], m[2]]
  if (/^\d+$/.test(a) && /^\d+$/.test(b) && b.length < a.length && Number(b) < Number(a)) b = a.slice(0, a.length - b.length) + b
  return `${a}–${b}`
}

/** 'es' renders APA the way Spanish-language programs expect: "y" and "s. f.". */
export type CiteLocale = 'en' | 'es'

const fullName = (a: Author) => [a.given, a.family].filter(Boolean).join(' ')
const year = (p: Paper, locale: CiteLocale = 'en') => p.year || (locale === 'es' ? 's. f.' : 'n.d.')
const end = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`)

function listJoin(parts: string[], amp: string): string {
  if (parts.length <= 1) return parts.join('')
  if (amp === 'y') return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
  if (parts.length === 2) return `${parts[0]}${amp === '&' ? ', & ' : ` ${amp} `}${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, ${amp} ${parts[parts.length - 1]}`
}

function apaAuthors(authors: Author[], locale: CiteLocale): string {
  const names = authors.map((a) => [cleanText(a.family), initials(cleanText(a.given))].filter(Boolean).join(', '))
  if (names.length > 20) return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`
  return listJoin(names, locale === 'es' ? 'y' : '&')
}

function doiOrUrl(p: Paper): string {
  if (p.doi) return ` https://doi.org/${p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`
  if (p.url) return ` ${p.url}`
  return ''
}

/** Editors of the book a chapter is in, as APA writes them: «En A. B. Editor y C. Otro (Eds.), ». */
function apaEditors(p: Paper, locale: CiteLocale): string {
  const eds = (p.editors ?? []).filter((a) => a.family)
  if (!eds.length) return ''
  const names = eds.map((a) => [initials(cleanText(a.given)), cleanText(a.family)].filter(Boolean).join(' '))
  return `${listJoin(names, locale === 'es' ? 'y' : '&').replace(', &', ' &')} (${eds.length > 1 ? 'Eds.' : 'Ed.'}), `
}

/** «, Artículo e1234» for journals that number articles instead of pages (APA 10.1). */
function apaLocator(p: Paper, locale: CiteLocale): string {
  if (p.pages) return `, ${pageRange(p.pages)}`
  if (p.articleNumber) return `, ${locale === 'es' ? 'Artículo' : 'Article'} ${cleanText(p.articleNumber)}`
  return ''
}

function volIssue(p: Paper, style: CitationStyle): string {
  if (!p.volume) return ''
  if (style === 'apa') return `, *${p.volume}*${p.issue ? `(${p.issue})` : ''}`
  if (style === 'mla') return `, vol. ${p.volume}${p.issue ? `, no. ${p.issue}` : ''}`
  return `, ${p.volume}${p.issue ? `(${p.issue})` : ''}`
}

export function formatReference(p: Paper, style: CitationStyle, locale: CiteLocale = 'en'): string {
  const title = p.title.trim()
  const hasAuthors = p.authors.length > 0
  switch (style) {
    case 'apa': {
      // APA 7 (chapters 9–10): who, when, what, where.
      const t = cleanText(title)
      const venueName = cleanText(p.venue)
      const publisher = cleanText(p.publisher)
      const standalone = p.type === 'book' || p.type === 'report' || p.type === 'thesis' || p.type === 'web'
      // The closing period stays outside the italics, unless the title ends in ? or !.
      const italicEnd = (x: string) => (/[?!]$/.test(x) ? `*${x}*` : `*${x}*.`)
      const head = hasAuthors ? `${end(apaAuthors(p.authors, locale))} (${year(p, locale)}).` : `${standalone ? italicEnd(t) : end(t)} (${year(p, locale)}).`
      // Without authors the title moves to the author position.
      const what = hasAuthors ? (standalone ? ` ${italicEnd(t)}` : ` ${end(t)}`) : ''
      // A group author that is also the publisher is not repeated (APA 9.25).
      const pub = publisher && !(hasAuthors && p.authors.length === 1 && !p.authors[0].given && cleanText(p.authors[0].family) === publisher) ? ` ${end(publisher)}` : ''
      if (p.type === 'book' || p.type === 'report') return `${head}${what}${pub}${doiOrUrl(p)}`.trim()
      if (p.type === 'thesis') {
        // *Título* [Tesis de maestría, Universidad]. The degree goes in the publisher field when known.
        const kind = /tesis|thesis|disserta/i.test(publisher) ? publisher : `${locale === 'es' ? 'Tesis' : 'Thesis'}${publisher ? `, ${publisher}` : ''}`
        return `${head}${hasAuthors ? ` *${t}*` : ''} [${kind}].${doiOrUrl(p)}`.trim()
      }
      if (p.type === 'web') return `${head}${what}${venueName ? ` ${end(venueName)}` : ''}${doiOrUrl(p)}`.trim()
      if ((p.type === 'chapter' || p.type === 'conference') && venueName) {
        const range = p.pages ? ` (pp. ${pageRange(p.pages)})` : ''
        return `${head}${what} ${locale === 'es' ? 'En' : 'In'} ${apaEditors(p, locale)}*${venueName}*${range}.${pub}${doiOrUrl(p)}`.trim()
      }
      const venue = venueName ? ` *${venueName}*${volIssue(p, style)}${apaLocator(p, locale)}.` : ''
      return `${head}${what}${venue}${doiOrUrl(p)}`.trim()
    }
    case 'harvard': {
      const names = p.authors.map((a) => [a.family, initials(a.given).replace(/ /g, '')].filter(Boolean).join(', '))
      const who = hasAuthors ? listJoin(names, 'and') : title
      const head = `${who} (${year(p)})`
      if (p.type === 'book') return `${head} *${title}*. ${p.publisher ? end(p.publisher) : ''}`.trim()
      const venue = p.venue ? ` *${p.venue}*${volIssue(p, style)}${p.pages ? `, pp. ${p.pages}` : ''}.` : ''
      const avail = p.doi ? ` doi:${p.doi}.` : p.url ? ` Available at: ${p.url}.` : ''
      return `${head} '${title}',${venue}${avail}`.replace(/,\s*$/, '.').trim()
    }
    case 'mla': {
      let who = ''
      if (p.authors.length === 1) who = `${p.authors[0].family}, ${p.authors[0].given}. `
      else if (p.authors.length === 2)
        who = `${p.authors[0].family}, ${p.authors[0].given}, and ${fullName(p.authors[1])}. `
      else if (p.authors.length > 2) who = `${p.authors[0].family}, ${p.authors[0].given}, et al. `
      if (p.type === 'book') return `${who}*${end(title)}* ${p.publisher ? `${p.publisher}, ` : ''}${year(p)}.`
      const venue = p.venue ? ` *${p.venue}*${volIssue(p, style)}, ${year(p)}${p.pages ? `, pp. ${p.pages}` : ''}.` : ` ${year(p)}.`
      return `${who}“${end(title)}”${venue}${p.doi ? ` https://doi.org/${p.doi}.` : ''}`
    }
    case 'chicago': {
      let who = ''
      if (p.authors.length) {
        const [first, ...rest] = p.authors
        const names = [`${first.family}, ${first.given}`.replace(/, $/, ''), ...rest.map(fullName)]
        who = `${end(p.authors.length > 10 ? `${names.slice(0, 7).join(', ')}, et al` : listJoin(names, 'and'))} `
      }
      if (p.type === 'book') return `${who}${year(p)}. *${end(title)}* ${p.publisher ? end(p.publisher) : ''}`.trim()
      const venue = p.venue ? ` *${p.venue}* ${p.volume ?? ''}${p.issue ? ` (${p.issue})` : ''}${p.pages ? `: ${p.pages}` : ''}.` : ''
      return `${who}${year(p)}. “${end(title)}”${venue.replace(/\s+\./, '.')}${doiOrUrl(p)}`.trim()
    }
  }
}

/** In-text citation, e.g. (Porter, 1985, p. 12). The page is a PDF page: it prints as the article's page when known. */
export function inText(p: Paper, style: CitationStyle, pdfPage?: number | string, locale: CiteLocale = 'en'): string {
  // Callers pass the PDF page (what the reader jumps to); the citation shows the printed one.
  const page = pdfPage && (typeof pdfPage === 'number' || /^\d+$/.test(pdfPage)) ? printedPage(p, Number(pdfPage)) : pdfPage
  const fam = p.authors.map((a) => cleanText(a.family)).filter(Boolean)
  let who: string
  if (!fam.length) who = shortTitle(p.title)
  else if (fam.length === 1) who = fam[0]
  else if (fam.length === 2) who = locale === 'es' ? `${fam[0]} y ${fam[1]}` : style === 'apa' ? `${fam[0]} & ${fam[1]}` : `${fam[0]} and ${fam[1]}`
  else who = `${fam[0]} et al.`
  if (style === 'mla') return `(${who}${page ? ` ${page}` : ''})`
  if (style === 'chicago') return `(${who} ${year(p)}${page ? `, ${page}` : ''})`
  // «p. 12» for one page, «pp. 12–13» for a range (APA 8.13).
  const loc = page ? (/\d\s*[-–—]\s*\d/.test(String(page)) ? `pp. ${pageRange(String(page))}` : `p. ${page}`) : ''
  return `(${who}, ${year(p, locale)}${loc ? `, ${loc}` : ''})`
}

/** Several sources in one parenthesis, in alphabetical order: (Bass, 1985; Popper y Mayseless, 2003, p. 45). */
export function inTextGroup(items: { paper: Paper; page?: number | string | null }[], style: CitationStyle, locale: CiteLocale = 'en'): string {
  const parts = items.map(({ paper, page }) => inText(paper, style, page ?? undefined, locale).slice(1, -1))
  if (parts.length <= 1) return parts.length ? `(${parts[0]})` : ''
  return `(${parts.sort((a, b) => a.localeCompare(b, locale)).join('; ')})`
}

export const shortTitle = (t: string) => {
  const words = t.split(/\s+/)
  return words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : t
}

/** Compact label for UI chips: "Porter 1985". */
/** «Popper y Mayseless 2003», «Molero et al. 2019»: the way APA names them in the text (two authors are both named). */
export function shortLabel(p: Paper): string {
  const fam = cleanText(p.authors[0]?.family)
  if (!fam) return shortTitle(p.title)
  const who = p.authors.length === 2 ? `${fam} y ${cleanText(p.authors[1].family)}` : p.authors.length > 2 ? `${fam} et al.` : fam
  return `${who}${p.year ? ` ${p.year}` : ''}`
}

export function authorLine(p: Paper, max = 3): string {
  if (!p.authors.length) return ''
  const names = p.authors.slice(0, max).map((a) => a.family || a.given)
  return names.join(', ') + (p.authors.length > max ? ' et al.' : '')
}

export function toBibtex(p: Paper): string {
  const key = `${(p.authors[0]?.family || 'anon').replace(/[^A-Za-z]/g, '').toLowerCase()}${p.year ?? ''}${
    p.title.split(/\s+/).find((w) => w.length > 3)?.replace(/[^A-Za-z]/g, '').toLowerCase() ?? ''
  }`
  const type = p.type === 'book' ? 'book' : p.type === 'conference' ? 'inproceedings' : p.type === 'thesis' ? 'phdthesis' : p.type === 'report' ? 'techreport' : p.type === 'chapter' ? 'incollection' : 'article'
  const fields: [string, string | undefined][] = [
    ['title', p.title],
    ['author', p.authors.map((a) => `${a.family}, ${a.given}`).join(' and ') || undefined],
    ['year', p.year],
    [type === 'article' ? 'journal' : 'booktitle', p.venue],
    ['volume', p.volume],
    ['number', p.issue],
    ['pages', p.pages?.replace(/[–-]/, '--')],
    ['publisher', p.publisher],
    ['doi', p.doi],
    ['url', p.url]
  ]
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(',\n')
  return `@${type}{${key},\n${body}\n}`
}

/** Strip the *italic* markers for plain-text contexts (clipboard). */
export const plainRef = (s: string) => s.replace(/\*/g, '')

export const STYLE_LABELS: Record<CitationStyle, string> = {
  apa: 'APA 7',
  harvard: 'Harvard',
  mla: 'MLA 9',
  chicago: 'Chicago'
}

/** What an APA reference of this paper still lacks (journal articles: journal, volume, pages or article number). */
export function missingReferenceData(p: Paper): string[] {
  const miss: string[] = []
  if (!p.authors.length) miss.push('autores')
  if (!p.year) miss.push('año')
  if (p.type === 'article') {
    if (!p.venue) miss.push('revista')
    if (!p.volume) miss.push('volumen')
    if (!p.pages && !p.articleNumber) miss.push('páginas o número de artículo')
  }
  if ((p.type === 'chapter' || p.type === 'conference') && !p.venue) miss.push(p.type === 'chapter' ? 'libro' : 'actas')
  if ((p.type === 'chapter' || p.type === 'conference') && !p.pages) miss.push('páginas')
  if ((p.type === 'book' || p.type === 'report') && !p.publisher) miss.push('editorial')
  return miss
}

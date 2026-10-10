import type { Author, CitationStyle, Paper } from '@shared/types'

// Reference formatting for the four styles most used in MBA programs.
// Output is plain text with *asterisks* marking italics (rendered by callers).

const initials = (given: string) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0].toUpperCase()}.`)
    .join(' ')

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
  const names = authors.map((a) => [a.family, initials(a.given)].filter(Boolean).join(', '))
  if (names.length > 20) return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`
  return listJoin(names, locale === 'es' ? 'y' : '&')
}

function doiOrUrl(p: Paper): string {
  if (p.doi) return ` https://doi.org/${p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`
  if (p.url) return ` ${p.url}`
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
      const who = hasAuthors ? apaAuthors(p.authors, locale) : title
      const head = `${end(who)} (${year(p, locale)}).`
      if (p.type === 'book') return `${head} *${end(title)}* ${p.publisher ? end(p.publisher) : ''}${doiOrUrl(p)}`.trim()
      const body = hasAuthors ? ` ${end(title)}` : ''
      const venue = p.venue ? ` *${p.venue}*${volIssue(p, style)}${p.pages ? `, ${p.pages}` : ''}.` : ''
      return `${head}${body}${venue}${doiOrUrl(p)}`.trim()
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

/** In-text citation, e.g. (Porter, 1985, p. 12). */
export function inText(p: Paper, style: CitationStyle, page?: number | string, locale: CiteLocale = 'en'): string {
  const fam = p.authors.map((a) => a.family).filter(Boolean)
  let who: string
  if (!fam.length) who = shortTitle(p.title)
  else if (fam.length === 1) who = fam[0]
  else if (fam.length === 2) who = locale === 'es' ? `${fam[0]} y ${fam[1]}` : style === 'apa' ? `${fam[0]} & ${fam[1]}` : `${fam[0]} and ${fam[1]}`
  else who = `${fam[0]} et al.`
  if (style === 'mla') return `(${who}${page ? ` ${page}` : ''})`
  if (style === 'chicago') return `(${who} ${year(p)}${page ? `, ${page}` : ''})`
  return `(${who}, ${year(p, locale)}${page ? `, p. ${page}` : ''})`
}

export const shortTitle = (t: string) => {
  const words = t.split(/\s+/)
  return words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : t
}

/** Compact label for UI chips: "Porter 1985". */
export function shortLabel(p: Paper): string {
  const fam = p.authors[0]?.family
  if (!fam) return shortTitle(p.title)
  return `${fam}${p.authors.length > 1 ? ' et al.' : ''}${p.year ? ` ${p.year}` : ''}`
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

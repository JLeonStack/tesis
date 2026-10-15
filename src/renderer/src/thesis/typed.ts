import type { Paper } from '@shared/types'

// Citations typed by hand in APA form, «(Underwood et al., 2016)» or «Wu y
// Parker (2016)», count like the live ones: the reference list must carry
// every work cited in the text (APA 7, 8.4), however it was written.

export interface TypedCite {
  /** As written, e.g. «Underwood et al., 2016». */
  raw: string
  /** Family names as written; one plus `etAl` for «et al.». */
  families: string[]
  etAl: boolean
  /** «2016», «2016a», «s. f.». */
  year: string
  /** Offset in the text it was read from. */
  index: number
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .trim()

const YEAR = String.raw`(?:\d{4}[a-z]?|s\.\s?f\.|n\.\s?d\.|en prensa|in press)`
const NAME = String.raw`\p{Lu}[\p{L}'’.-]*(?:\s+(?:de|del|de la|van|von|da|di|der|le|la)\s+\p{Lu}?[\p{L}'’-]+)*`
/** «Underwood et al.», «Popper y Mayseless», «Fraley, Waller y Brennan», «The Workforce Institute». */
const AUTHORS = String.raw`${NAME}(?:\s+${NAME})*(?:(?:,\s*|\s+(?:y|&|and|e)\s+)${NAME}(?:\s+${NAME})*)*(?:,?\s+et\s+al\.?)?`
const PART = new RegExp(String.raw`^(?:(?:véase|vease|ver|cf\.|e\.\s?g\.,?|por ejemplo,?|p\.\s?ej\.,?)\s+)?(${AUTHORS}),?\s+(${YEAR}(?:\s*,\s*${YEAR})*)(?=$|[,\s])`, 'u')
const NARRATIVE = new RegExp(String.raw`(${AUTHORS})\s+\((${YEAR}(?:\s*,\s*${YEAR})*)(?:,\s*(?:pp?\.|párr\.)\s*[\d–-]+)?\)`, 'gu')
const PAREN = /\(([^()]*?\d{4}[^()]*?|[^()]*?s\.\s?f\.[^()]*?)\)/g
const SECONDARY = /\b(?:citad[oa]s?\s+en|as cited in|cit\.\s+en)\s+/i
/** Words that start a sentence or a phrase, not an author: «En (2019)…», «Desde 2010». */
const NOT_AUTHOR = /^(?:en|desde|hasta|entre|para|durante|hacia|tabla|figura|table|figure|apéndice|anexo|artículo|ley|decreto|cap[ií]tulo|n|nro|vol|p|pp)\.?$/i

/** Capitalized words that open a sentence before a narrative citation: «Según Molero et al. (2019)». */
const LEAD = /^(?:(?:según|como|para|en|desde|tanto|también|aunque|mientras|así|pero|sin|con|por|de|del|la|el|los|las|este|esta|estos|estas|ya|luego|además|asimismo|incluso|in|as|for|according to)\s+)+/i

function authorsOf(s: string): { families: string[]; etAl: boolean } | null {
  const etAl = /\bet\s+al\.?$/.test(s.trim())
  const names = s
    .replace(LEAD, '')
    .replace(/,?\s+et\s+al\.?$/, '')
    .split(/\s*,\s*|\s+(?:y|&|and|e)\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (!names.length || NOT_AUTHOR.test(names[0])) return null
  return { families: names, etAl }
}

function years(s: string): string[] {
  return s.split(/\s*,\s*/).map((y) => y.replace(/\s+/g, ' ').trim())
}

/** Every APA citation typed in a text: parenthetical (several per parenthesis) and narrative. For «X, 2023, citado en Y, 2025» only Y goes to the references. */
export function typedCitations(text: string): TypedCite[] {
  const out: TypedCite[] = []
  const taken: [number, number][] = []
  for (const m of text.matchAll(PAREN)) {
    const start = m.index! + 1
    let offset = 0
    for (const raw of m[1].split(';')) {
      const at = start + offset
      offset += raw.length + 1
      // Only the source actually read goes to the references.
      const secondary = raw.split(SECONDARY)
      const part = (secondary.length > 1 ? secondary[secondary.length - 1] : raw).trim()
      const pm = part.match(PART)
      if (!pm) continue
      const who = authorsOf(pm[1])
      if (!who) continue
      for (const year of years(pm[2])) out.push({ raw: part.replace(/,?\s*(?:pp?\.|párr\.).*$/, '').trim(), ...who, year, index: at })
    }
    taken.push([m.index!, m.index! + m[0].length])
  }
  for (const m of text.matchAll(NARRATIVE)) {
    if (taken.some(([a, b]) => m.index! >= a && m.index! < b)) continue
    // «… de Warnock et al. (2024)»: the match may start on a capitalized word before the author.
    const who = authorsOf(m[1])
    if (!who) continue
    for (const year of years(m[2])) out.push({ raw: `${m[1]} (${year})`, ...who, year, index: m.index! })
  }
  return out.sort((a, b) => a.index - b.index)
}

const yearOf = (y: string) => y.match(/\d{4}/)?.[0] ?? (/s\.\s?f|n\.\s?d/.test(y) ? '' : y)

/** How complete a record is: among duplicates of one work, the reference uses the most complete. */
export function completeness(p: Paper): number {
  return [p.doi, p.venue, p.volume, p.issue, p.pages, p.publisher, p.year].filter(Boolean).length + (p.metaSource === 'manual' ? 0.5 : 0) + (p.metaSource === 'crossref' ? 0.3 : 0)
}

const doiKey = (p: Paper) => (p.doi ? fold(p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')) : '')
const titleKey = (p: Paper) =>
  `${fold(p.authors[0]?.family ?? '')}:${p.year ?? ''}:${fold(p.title).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 8).join(' ')}`

/**
 * One id per work: copies of a paper in the library (same DOI, or same first
 * author, year and title) map to the most complete one, so they make one reference.
 */
export function canonicalIds(papers: Paper[]): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const p = parent.get(id) ?? id
    return p === id ? id : find(p)
  }
  const byKey = new Map<string, string>()
  for (const p of papers) {
    parent.set(p.id, p.id)
    for (const k of [doiKey(p) && `doi:${doiKey(p)}`, `t:${titleKey(p)}`]) {
      if (!k) continue
      const other = byKey.get(k)
      if (other) parent.set(find(p.id), find(other))
      else byKey.set(k, p.id)
    }
  }
  const best = new Map<string, Paper>()
  for (const p of papers) {
    const root = find(p.id)
    const cur = best.get(root)
    if (!cur || completeness(p) > completeness(cur)) best.set(root, p)
  }
  return new Map(papers.map((p) => [p.id, best.get(find(p.id))!.id]))
}

const familyMatches = (written: string, paper?: string) => {
  if (!paper) return false
  const a = fold(written).replace(/[^a-z-]+/g, ' ').trim()
  const b = fold(paper).replace(/[^a-z-]+/g, ' ').trim()
  return !!a && (a === b || b.split(/[\s-]+/).includes(a) || a.split(/[\s-]+/).includes(b) || b.startsWith(`${a} `) || b.endsWith(` ${a}`))
}

export interface Resolution {
  /** The paper the reference is made from (the most complete of its duplicates). */
  paperId: string | null
  /** Different works match the same author and year: APA asks for 2019a / 2019b. */
  ambiguous: boolean
}

function matching(c: TypedCite, families: string[], papers: Paper[]): Paper[] {
  const y = yearOf(c.year)
  return papers.filter((p) => {
    if ((p.year ?? '') !== y || !familyMatches(families[0], p.authors[0]?.family)) return false
    if (c.etAl) return p.authors.length >= 3
    if (families.length !== p.authors.length) return false
    return families.every((f, i) => familyMatches(f, p.authors[i]?.family))
  })
}

/** Finds the library paper a typed citation refers to. */
export function resolveCite(c: TypedCite, papers: Paper[], canon: Map<string, string> = canonicalIds(papers)): Resolution {
  // «En la Argentina, Paolicchi et al. (2014)»: words before the authors are dropped one at a time.
  let matches: Paper[] = []
  for (let k = 0; k < c.families.length && !matches.length; k++) matches = matching(c, c.families.slice(k), papers)
  if (!matches.length) return { paperId: null, ambiguous: false }
  const byId = new Map(papers.map((p) => [p.id, p]))
  const works = [...new Set(matches.map((p) => canon.get(p.id) ?? p.id))].map((id) => byId.get(id)!)
  if (works.length === 1) return { paperId: works[0].id, ambiguous: false }
  // «2019a» picks by order of title, the way APA assigns the letters.
  const suffix = c.year.match(/\d{4}([a-z])$/)?.[1]
  if (suffix) {
    const pick = works.sort((a, b) => fold(a.title).localeCompare(fold(b.title)))[suffix.charCodeAt(0) - 97]
    if (pick) return { paperId: pick.id, ambiguous: false }
  }
  return { paperId: works[0].id, ambiguous: true }
}

/** The papers to list in the references: live citations and typed ones, one per work, the most complete record of each. */
export function referenceIds(liveIds: string[], typed: TypedCite[], papers: Record<string, Paper>): string[] {
  const all = Object.values(papers)
  const canon = canonicalIds(all)
  const out = new Set<string>()
  for (const id of liveIds) if (papers[id]) out.add(canon.get(id) ?? id)
  for (const c of typed) {
    const id = resolveCite(c, all, canon).paperId
    if (id) out.add(id)
  }
  return [...out]
}

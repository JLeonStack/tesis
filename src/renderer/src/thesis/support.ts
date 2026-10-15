import type { ConstructId, PageText, Paper } from '@shared/types'
import { CONSTRUCTS, CONSTRUCT_ORDER } from '../research/framework'

// Citation support for the thesis, the offline part: split a paragraph into
// sentences, tell which ones carry a citation and which are claims that need
// one, and search the full text of the library for passages that may back a
// claim. The model only judges the passages this finds (see ./evidence).
// Pure: no store, no DOM, so it's unit-tested.

/** Inline atoms in a block's text, one char each so offsets match document positions. */
export const CITE_CHAR = ''
export const NOTE_CHAR = ''
export const ATOM_CHAR = '￼'

export const foldText = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface Span {
  start: number
  end: number
  text: string
}

// ---------- sentences ----------

/** Words that take a period without ending the sentence (folded, without the period). */
const ABBREV = new Set(
  'al p pp ed eds comp coord vol vols n no num cap caps fig figs dr dra lic mgr mg sr sra sres ing prof vs cf ej e.g i.e aprox approx op cit ibid ca trad rev esp univ inc ltd jr st'.split(' ')
)
/** What a new sentence starts with: a capital, opening punctuation or quotes. */
const STARTER = /[\p{Lu}¿¡«“"']/u
const CLOSERS = `»"”’')\\]${NOTE_CHAR}`
const END = new RegExp(`[.!?…]+[${CLOSERS}]*(?=\\s|$|\\p{Lu}\\p{Ll})`, 'gu')

/**
 * Sentences of a paragraph. A period only ends one when a capital (or ¿, «…)
 * follows, and never after an abbreviation or an initial: «Fraley et al.
 * (2011)», «R. C. Fraley», «p. 4» and «s. f.» stay inside their sentence.
 */
export function splitSentences(text: string): Span[] {
  const out: Span[] = []
  let start = 0
  const push = (s: number, e: number) => {
    const raw = text.slice(s, e)
    const lead = raw.length - raw.trimStart().length
    const body = raw.trim()
    if (body) out.push({ start: s + lead, end: s + lead + body.length, text: body })
  }
  for (const m of text.matchAll(END)) {
    const end = m.index! + m[0].length
    const rest = text.slice(end)
    // «…empresa (Underwood, 2016).Desde…»: a missing space still ends the sentence after a citation.
    const glued = /^\p{Lu}/u.test(rest)
    if (glued && !/[)\]\uE000]$/u.test(text.slice(0, m.index!))) continue
    if (rest.trim() && !glued) {
      const next = rest.match(/^\s+(\S)/u)?.[1]
      if (!next || !STARTER.test(next)) continue
    }
    if (m[0][0] === '.' && !/^\.{2,}/.test(m[0])) {
      const prev = text.slice(Math.max(start, m.index! - 14), m.index!).match(/([\p{L}.]+)$/u)?.[1]
      if (prev && (ABBREV.has(foldText(prev)) || /^\p{Lu}$/u.test(prev))) continue
    }
    push(start, end)
    start = end
  }
  push(start, text.length)
  return out
}

/** The sentence around an offset of the text (a caret at its very end still counts). */
export function sentenceAt(text: string, offset: number): Span | null {
  const all = splitSentences(text)
  return all.find((s) => offset >= s.start && offset <= s.end) ?? all.find((s) => s.start >= offset) ?? all.at(-1) ?? null
}

// ---------- cited or not ----------

/** «(Bass, 1985)», «(véase Bass y Riggio, 2006, p. 4)», «(Fraley et al., s. f.)». */
const PAREN_CITE = /\([^()]*\p{Lu}[^()]*,\s*(?:\d{4}[a-z]?|s\.\s?f\.|en prensa)[^()]*\)/u
/** «Bass (1985)», «Popper y Mayseless (2003, p. 45)». */
const NARRATIVE_CITE = /\p{Lu}[\p{L}'’-]+(?:\s+(?:y|&|et al\.)(?:\s+\p{Lu}[\p{L}'’-]+)?)?\s+\((?:\d{4}[a-z]?|s\.\s?f\.)(?:,\s*pp?\.\s*[\d–-]+)?\)/u

/** Whether a sentence already cites a source: a live citation, or one typed by hand in APA form. */
export const isCited = (s: string): boolean => s.includes(CITE_CHAR) || PAREN_CITE.test(s) || NARRATIVE_CITE.test(s)

/** The student's own framing: this work, its hypotheses, method and sample (folded text). */
const OWN =
  /\b(este|el presente) (trabajo|estudio|capitulo|apartado|analisis)\b|\besta (tesis|investigacion|seccion)\b|\bla presente (tesis|investigacion)\b|\bse (propone|proponen|plantea|plantean|espera|esperan|busca|buscara|analiza|analizara|analizaran|presenta|presentan|describe|describen|utilizo|utilizara|uso|aplico|midio|midieron|encuesto|recolecto|recolectaron)\b|\bh\d\b|\bhipotesis\b|\bobjetivo (general|especifico)|\bpregunta de investigacion\b|\bparticipantes\b|\bencuestad/
/** Results with their statistics, tables and figures: the student's data, not a source's (folded text). */
const STATS = /(?<![\p{L}\p{N}])(r|rs|rho|β|b|t|f|m|de|ds|sd|p|α|n|r²|r2|z|χ²|gl|df)\s*[=<>≤≥]|\b(tabla|figura)\s+\d/u

const wordsIn = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/**
 * Whether a sentence states something that a source should back. Leaves out
 * questions, very short sentences, and the student's own framing and results.
 */
export function needsSupport(sentence: string): boolean {
  const t = sentence.trim()
  if (wordsIn(t) < 6) return false
  if (/\?[»"”’)]*$/.test(t)) return false
  const f = foldText(t)
  return !OWN.test(f) && !STATS.test(f)
}

/** Claims in a paragraph that carry no citation. */
export const uncitedIn = (text: string): Span[] => splitSentences(text).filter((s) => needsSupport(s.text) && !isCited(s.text))

/** Stable key of a sentence, to remember the ones the student marked as their own. */
export const sentenceKey = (s: string): string =>
  foldText(s.replace(new RegExp(`[${CITE_CHAR}${NOTE_CHAR}${ATOM_CHAR}]`, 'g'), ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120)

/**
 * Where a citation goes in a sentence: before its final period (APA:
 * «… seguridad (Popper y Mayseless, 2003).»). `existing` is the offset of a
 * citation that already sits right there, to add the new source to it.
 */
export function citeInsertOffset(sentence: string): { at: number; existing: number | null; typed: { start: number; end: number } | null } {
  const body = sentence.trimEnd()
  const tail = body.match(/[.!?…]+[»"”’'\uE001]*$/u)
  const at = tail ? body.length - tail[0].length : body.length
  const before = body.slice(0, at).trimEnd()
  const existing = before.endsWith(CITE_CHAR) ? before.length - 1 : null
  // A citation typed by hand right before the period: a new source joins that parenthesis.
  const open = before.endsWith(')') ? before.lastIndexOf('(') : -1
  const group = open >= 0 ? before.slice(open) : ''
  const typed = existing == null && group && PAREN_CITE.test(group) && !/[\uE000\uE001\uFFFC]/u.test(group) ? { start: open, end: before.length } : null
  return { at, existing, typed }
}

/** «(Mayseless, 2010; Popper y Mayseless, 2003)» plus a source: all of them in one parenthesis, in alphabetical order (APA 8.12). */
export function joinTyped(group: string, part: string): string {
  const parts = group
    .slice(1, -1)
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
  const key = (x: string) => foldText(x.replace(/^(?:véase|vease|ver|cf\.|p\.\s?ej\.,?|e\.\s?g\.,?)\s+/i, ''))
  return `(${[...parts, part].sort((a, b) => key(a).localeCompare(key(b), 'es')).join('; ')})`
}

// ---------- search ----------

const STOP = new Set(
  (
    // Spanish
    'a al algo algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquellos aqui asi aun aunque bien cada como con contra cual cuales cuando de del desde donde dos durante e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron gran ha haber habia han hasta hay la las le les lo los mas me mediante menos mi mientras mismo muy nada ni no nos nuestra nuestro o otra otras otro otros para pero poco por porque pueden puede que quien se segun ser si sido siempre sin sino sobre son su sus tal tambien tanto te tiene tienen todo todos tras tu un una unas uno unos y ya ' +
    // English
    'about after also among an and are as at be been being between both but by can could did do does each either for from had has have he her here his how however if in into is it its may more most must not of on one only or other our over same she should since so some such than that the their them then there these they this those through to under upon very was we were what when where whether which while who whom why will with within would you'
  ).split(/\s+/)
)
/** Short tokens that still mean something here. */
const KEEP = new Set(['eq', 'tf'])

const stem = (w: string) => {
  const base = w.length > 4 ? w.replace(/(es|s)$/, '') : w
  return base.length > 6 ? base.slice(0, 6) : base
}

/** Folded, stemmed content words. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const w of foldText(text).match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(w) || (w.length < 3 && !KEEP.has(w)) || /^\d+$/.test(w)) continue
    out.push(stem(w))
  }
  return out
}

export interface Passage {
  paperId: string
  /** PDF page, 1-based. */
  page: number
  text: string
  /** Multiplies its score: passages the student highlighted, or the reading guide marked as key. */
  boost?: number
}

/** A reference list or bibliography: several years in parentheses, DOIs. */
const looksLikeReferences = (s: string) => (s.match(/\(\d{4}[a-z]?\)|\b(19|20)\d{2}[a-z]?\)\./g)?.length ?? 0) >= 3 || (s.match(/doi\.org|doi:/gi)?.length ?? 0) >= 2

/** Overlapping windows of up to three sentences per page, skipping reference lists. */
export function passagesOf(paperId: string, pages: PageText[], maxChars = 700): Passage[] {
  const out: Passage[] = []
  for (const pg of pages) {
    const text = pg.text
      .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    const sents = splitSentences(text)
    for (let i = 0; i < sents.length; i += 2) {
      let chunk = sents[i].text
      for (let j = i + 1; j < Math.min(sents.length, i + 3) && chunk.length + sents[j].text.length < maxChars; j++) chunk += ` ${sents[j].text}`
      if (chunk.length > maxChars * 1.6) chunk = chunk.slice(0, maxChars * 1.6)
      if (chunk.length < 60 || looksLikeReferences(chunk)) continue
      out.push({ paperId, page: pg.page, text: chunk })
    }
  }
  return out
}

export interface Hit {
  passage: Passage
  score: number
}

/** BM25 over passages of the whole library. Papers are added once; the index grows as their text arrives. */
export class PassageIndex {
  private docs: { p: Passage; tf: Map<string, number>; len: number }[] = []
  private df = new Map<string, number>()
  private totalLen = 0
  private indexed = new Set<string>()

  has(paperId: string): boolean {
    return this.indexed.has(paperId)
  }

  get size(): number {
    return this.docs.length
  }

  add(paperId: string, passages: Passage[]): void {
    if (this.indexed.has(paperId)) return
    this.indexed.add(paperId)
    for (const p of passages) {
      const toks = tokenize(p.text)
      if (!toks.length) continue
      const tf = new Map<string, number>()
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      this.docs.push({ p, tf, len: toks.length })
      this.totalLen += toks.length
    }
  }

  /**
   * Best passages for weighted query terms, with at most `perPaper` from one
   * paper. `paperBoost` lets the student's topics weigh in.
   */
  search(query: Map<string, number>, opts: { limit?: number; perPaper?: number; paperBoost?: (paperId: string) => number; only?: (paperId: string) => boolean } = {}): Hit[] {
    const { limit = 8, perPaper = 2, paperBoost, only } = opts
    const N = this.docs.length
    if (!N || !query.size) return []
    const avg = this.totalLen / N
    const k1 = 1.2
    const b = 0.75
    const idf = new Map<string, number>()
    for (const t of query.keys()) {
      const df = this.df.get(t) ?? 0
      if (df) idf.set(t, Math.log(1 + (N - df + 0.5) / (df + 0.5)))
    }
    if (!idf.size) return []
    const scored: Hit[] = []
    for (const d of this.docs) {
      if (only && !only(d.p.paperId)) continue
      let score = 0
      let matched = 0
      for (const [t, w] of query) {
        const f = d.tf.get(t)
        if (!f) continue
        matched++
        score += w * idf.get(t)! * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)))
      }
      // One shared word is noise, not support.
      if (matched < Math.min(2, idf.size)) continue
      score *= (d.p.boost ?? 1) * (paperBoost?.(d.p.paperId) ?? 1)
      scored.push({ passage: d.p, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const per = new Map<string, number>()
    const out: Hit[] = []
    for (const h of scored) {
      const n = per.get(h.passage.paperId) ?? 0
      if (n >= perPaper) continue
      per.set(h.passage.paperId, n + 1)
      out.push(h)
      if (out.length >= limit) break
    }
    return out
  }
}

/** Weighted query terms from several texts (the claim weighs more than its paragraph or the expansions). */
export function queryTerms(parts: { text: string; weight: number }[]): Map<string, number> {
  const q = new Map<string, number>()
  for (const { text, weight } of parts) for (const t of tokenize(text)) q.set(t, Math.max(q.get(t) ?? 0, weight))
  return q
}

/** Spanish terms of the course's field, with how the (mostly English) literature says them. Folded keys. */
const GLOSSARY: [string, string][] = [
  ['liderazgo', 'leadership'],
  ['lider', 'leader'],
  ['transformacional', 'transformational leadership'],
  ['transformador', 'transformational leadership'],
  ['seguidor', 'follower'],
  ['colaborador', 'follower employee subordinate'],
  ['liderado', 'follower'],
  ['subordinado', 'subordinate'],
  ['empleado', 'employee'],
  ['jefe', 'supervisor manager'],
  ['apego', 'attachment'],
  ['ansiedad', 'anxiety'],
  ['evitacion', 'avoidance'],
  ['empatia', 'empathy'],
  ['seguridad', 'security'],
  ['base segura', 'secure base'],
  ['proveedor de seguridad', 'security provider secure base'],
  ['confianza', 'trust'],
  ['desempeno', 'performance'],
  ['ciudadania organizacional', 'organizational citizenship behavior'],
  ['ciudadano organizacional', 'organizational citizenship behavior'],
  ['compromiso', 'commitment engagement'],
  ['bienestar', 'well-being'],
  ['satisfaccion', 'satisfaction'],
  ['motivacion', 'motivation'],
  ['inspiracion', 'inspirational motivation'],
  ['carisma', 'charisma idealized influence'],
  ['consideracion individualizada', 'individualized consideration'],
  ['estimulacion intelectual', 'intellectual stimulation'],
  ['influencia idealizada', 'idealized influence'],
  ['vinculo', 'bond relationship'],
  ['relacion', 'relationship'],
  ['emocion', 'emotion'],
  ['regulacion emocional', 'emotion regulation'],
  ['cognicion social', 'social cognition'],
  ['autoestima', 'self-esteem'],
  ['percepcion', 'perception'],
  ['cuidado', 'caregiving care'],
  ['figura de apego', 'attachment figure'],
  ['organizacion', 'organization'],
  ['equipo', 'team'],
  ['crecimiento', 'growth development'],
  ['autonomia', 'autonomy'],
  ['estres', 'stress'],
  ['agotamiento', 'burnout'],
  ['rotacion', 'turnover']
]

/** English equivalents of the field's terms that appear in a Spanish text, plus any extra pairs (from reading guides). */
export function glossaryTerms(text: string, extra: [string, string][] = []): string {
  const f = foldText(text)
  const out: string[] = []
  for (const [es, en] of [...GLOSSARY, ...extra]) if (es.length >= 4 && f.includes(es)) out.push(en)
  return out.join(' ')
}

// ---------- instruments ----------

export interface InstrumentRef {
  construct: ConstructId
  instrument: string
  /** As the course lists it (APA). */
  reference: string
  /** The matching paper in the library, when it's there. */
  paperId?: string
}

/** Acronyms and names that point at an instrument by themselves (folded text). */
const ACRONYM: Partial<Record<ConstructId, RegExp>> = {
  attachment: /\becr-?rs\b|experiencias en relaciones cercanas|experiences in close relationships/,
  empathy: /\beq(-?29)?\b|cociente de empat|coeficiente de empat|empathy quotient/,
  tfl: /\bhsa-?tfl/,
  security: /\blsps\b|security provider scale|escala del lider como proveedor/
}
/** Words about measuring: with a topic, they point at its instrument. */
const MEASURE = /\b(escala|subescala|cuestionario|instrumento|items?|confiabilidad|cronbach|validez|validacion|validad|adaptacion|version|puntua|puntaje|mide|miden|medir|medid|medicion|evalua|autoinforme)/

/** First author's family name, year and title of a reference written in APA. */
export function parseReference(ref: string): { family: string; year: string; title: string } {
  const family = ref.split(',')[0].trim()
  const m = ref.match(/\((\d{4})[a-z]?\)\.\s*([^.?]+)/)
  return { family, year: m?.[1] ?? '', title: m?.[2]?.trim() ?? '' }
}

/** The library paper a reference points at: same first author and year, or the same title. */
export function findReference(ref: string, papers: Paper[]): Paper | undefined {
  const { family, year, title } = parseReference(ref)
  const fam = foldText(family)
  const head = foldText(title).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)
  return papers.find((p) => {
    if (year && p.year === year && foldText(p.authors[0]?.family ?? '') === fam) return true
    return head.length >= 20 && foldText(p.title).replace(/[^a-z0-9]+/g, ' ').trim().startsWith(head)
  })
}

/** The course instruments a claim talks about, with their references and whether the library has them. */
export function instrumentRefs(claim: string, papers: Paper[]): InstrumentRef[] {
  const f = foldText(claim)
  const out: InstrumentRef[] = []
  for (const id of CONSTRUCT_ORDER) {
    const c = CONSTRUCTS[id]
    const named = ACRONYM[id]?.test(f) || (c.pattern.test(f) && MEASURE.test(f))
    if (!named) continue
    for (const reference of c.references) out.push({ construct: id, instrument: c.instrument, reference, paperId: findReference(reference, papers)?.id })
  }
  return out
}

// ---------- quotes ----------

const flat = (s: string) => foldText(s).replace(/[^a-z0-9]+/g, ' ').trim()

/** The model's quote if it is verbatim in the passage; otherwise the passage's own sentence closest to it. */
export function quoteIn(passage: string, quote: string): { quote: string; exact: boolean } {
  const q = flat(quote)
  if (q.length >= 12 && flat(passage).includes(q)) return { quote: quote.trim(), exact: true }
  const want = new Set(tokenize(quote))
  const sents = splitSentences(passage)
  let best = { text: sents[0]?.text ?? passage, n: -1 }
  for (const s of sents) {
    const n = tokenize(s.text).filter((t) => want.has(t)).length
    if (n > best.n) best = { text: s.text, n }
  }
  return { quote: best.text, exact: false }
}

/**
 * Where a quote really is in a paper: on the page the model said, or on any
 * other page (models misread page marks). Null when the words aren't in the
 * paper at all; the caller then shows the closest real sentence.
 */
export function locateQuote(pages: PageText[], quote: string, page: number): { page: number; context: string } | null {
  const q = flat(quote)
  if (q.length < 12) return null
  const order = [...pages].sort((a, b) => Math.abs(a.page - page) - Math.abs(b.page - page))
  for (const p of order) {
    const text = p.text.replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ')
    if (!flat(text).includes(q)) continue
    // A window of the page around the quote: what the checker read.
    const words = quote.trim().split(/\s+/).slice(0, 4).join(' ')
    const at = Math.max(0, foldText(text).indexOf(foldText(words)))
    return { page: p.page, context: text.slice(Math.max(0, at - 300), at + quote.length + 300).trim() }
  }
  return null
}

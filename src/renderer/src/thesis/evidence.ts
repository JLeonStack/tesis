import { create } from 'zustand'
import type { Editor } from '@tiptap/react'
import type { Paper, Settings } from '@shared/types'
import { CANDIDATES_LIST, aiEffort, aiModel, listByName, providerLabel, toast, useStore } from '../store'
import { getPaperText } from '../lib/ingest'
import { errorText } from '../lib/guide'
import { authorLine, inText, shortLabel } from '../lib/citation'
import { researchBrief, topicsIn } from '../research/framework'
import {
  PassageIndex,
  foldText,
  glossaryTerms,
  instrumentRefs,
  locateQuote,
  passagesOf,
  queryTerms,
  quoteIn,
  splitSentences,
  type Hit,
  type InstrumentRef,
  type Passage
} from './support'
import { claimAt, insertSupport, supportTarget } from './uncited'
import { THESIS_CITE } from './references'
import { canonicalIds, resolveCite, typedCitations } from './typed'

// Backing a sentence of the thesis with the library: the offline search in
// ./support finds candidate passages in the papers' full text; the model
// (through the same ChatGPT / Claude connection as the writing helpers) only
// says whether each passage supports, qualifies or contradicts the claim, and
// which words of the passage show it. Quotes are checked against the paper's
// text, so what the panel shows is always the paper's own wording.
// UCEMA Pautas 8.e: it finds and checks sources; it never writes the thesis.

export type Verdict = 'apoya' | 'matiza' | 'contradice' | 'no_respalda' | 'sin_verificar'

export const VERDICT_LABELS: Record<Verdict, string> = {
  apoya: 'Lo apoya',
  matiza: 'Lo matiza',
  contradice: 'Lo contradice',
  no_respalda: 'No alcanza',
  sin_verificar: 'Sin verificar'
}

const VERDICT_ORDER: Verdict[] = ['apoya', 'matiza', 'contradice', 'sin_verificar', 'no_respalda']

export interface Claim {
  thesisId: string
  /** What is being backed (the selection, or the sentence). */
  text: string
  context: string
  /** Where the citation goes. */
  sentence: { from: number; to: number }
  citedIds: string[]
}

export interface Evidence {
  id: string
  paperId: string
  /** PDF page of the passage. */
  page: number
  passage: string
  /** The passage's own words that show it (verbatim). */
  quote: string
  /** False when the model's quote wasn't in the passage and the closest sentence stands in. */
  exact: boolean
  translation: string
  why: string
  verdict: Verdict
  /** Found by reading the whole paper (not among the search's passages). */
  deep?: boolean
}

interface EvidenceState {
  claim: Claim | null
  /** searching → checking the passages → (reading whole papers when none backs it) → done. */
  status: 'idle' | 'searching' | 'checking' | 'reading' | 'done'
  /** Shown above the results (no connection, the model failed…); results may still be there, unverified. */
  notice?: string
  results: Evidence[]
  instruments: InstrumentRef[]
  /** Papers whose full text was searched / that have no text yet. */
  searched: number
  withoutText: number
  /** Papers the model picked from the catalog as the likeliest to back the claim, best first. */
  picked: string[]
  /** Papers already read in full for this claim. */
  read: string[]
  /** Papers being read in full right now. */
  reading: string[]
}

export const useEvidence = create<EvidenceState>(() => ({ claim: null, status: 'idle', results: [], instruments: [], searched: 0, withoutText: 0, picked: [], read: [], reading: [] }))

export function clearEvidence(): void {
  seq++
  useEvidence.setState({ claim: null, status: 'idle', notice: undefined, results: [], instruments: [], picked: [], read: [], reading: [] })
}

// ---------- instructions ----------

const INSTRUCTIONS = `Sos un verificador de fuentes para el trabajo final de MBA de un estudiante (Universidad del CEMA, Argentina). El estudiante escribió una afirmación en su tesis y quiere saber si los papers de su biblioteca la respaldan, para citarlos en APA 7.
Política de uso de IA de la UCEMA (Pautas 8.e): podés buscar y verificar fuentes y citas; no escribís el análisis, la argumentación ni el texto de la tesis por el estudiante.
Reglas:
- Juzgá solo con los pasajes que te pasan. Nunca uses lo que sepas de esos papers por fuera del pasaje ni inventes citas, páginas o datos.
- Sé exigente: un estudio correlacional no respalda una afirmación causal, un resultado en otra población o con otra medida no respalda una afirmación general sin aclararlo, y un efecto débil o mixto no respalda una afirmación tajante: en esos casos el pasaje "matiza". Un pasaje que solo comparte los términos, o que cita a otro autor de pasada, no alcanza ("no_respalda").
- Nunca reescribas la oración del estudiante ni propongas texto para la tesis: explicá qué dice el pasaje respecto de la afirmación.
- Escribí en español; las citas textuales van en el idioma original, copiadas exactamente del pasaje.
- Respondé únicamente con el JSON pedido.`

/** The checker's instructions, with the course framework (so constructs are read precisely). */
export const evidenceInstructions = (s: Pick<Settings, 'research' | 'researchQuestion'>) => [INSTRUCTIONS, researchBrief(s)].join('\n\n')

const str = { type: 'string' }
const arr = (items: object) => ({ type: 'array', items })
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const TRIAGE_SCHEMA = obj({ papers: arr(str), english: arr(str), spanish: arr(str) })
const CHECK_SCHEMA = obj({
  results: arr(
    obj({
      id: str,
      verdict: { type: 'string', enum: ['apoya', 'matiza', 'contradice', 'no_respalda'] },
      quote: str,
      translation: str,
      why: str
    })
  )
})

const DEEP_SCHEMA = obj({
  results: arr(
    obj({
      source: str,
      page: { type: 'integer' },
      verdict: { type: 'string', enum: ['apoya', 'matiza', 'contradice'] },
      quote: str,
      translation: str,
      why: str
    })
  )
})

// ---------- the library index ----------

const index = new PassageIndex()

const norm = (s: string) => foldText(s).replace(/[^a-z0-9]+/g, ' ').trim()

/** Highlights and key sentences of the reading guide count a little more: the student (or the guide) already found them important. */
function boosted(paperId: string, passages: Passage[]): Passage[] {
  const s = useStore.getState()
  const marks = new Map<number, { text: string; boost: number }[]>()
  const add = (page: number, text: string, boost: number) => marks.set(page, [...(marks.get(page) ?? []), { text: norm(text).slice(0, 60), boost }])
  for (const a of Object.values(s.annotations)) if (a.paperId === paperId) add(a.page, a.text, 1.3)
  for (const g of s.guides[paperId]?.sentences ?? []) if (g.facet === 'finding' || g.facet === 'definition') add(g.page, g.text, 1.15)
  return passages.map((p) => {
    const here = marks.get(p.page)
    if (!here) return p
    const t = norm(p.text)
    const boost = Math.max(1, ...here.filter((m) => m.text.length >= 20 && t.includes(m.text)).map((m) => m.boost))
    return boost > 1 ? { ...p, boost } : p
  })
}

async function ensureIndex(papers: Paper[]): Promise<{ searched: number; withoutText: number }> {
  let searched = 0
  let withoutText = 0
  await Promise.all(
    papers.map(async (p) => {
      if (index.has(p.id)) return void searched++
      const pages = p.textStatus === 'ready' ? await getPaperText(p.id) : null
      if (!pages?.length) return void withoutText++
      index.add(p.id, boosted(p.id, passagesOf(p.id, pages)))
      searched++
    })
  )
  return { searched, withoutText }
}

/** Spanish ↔ English pairs from the reading guides' key terms. */
function guidePairs(): [string, string][] {
  const out: [string, string][] = []
  for (const g of Object.values(useStore.getState().guides))
    for (const t of g.terms) if (t.original && foldText(t.original) !== foldText(t.term)) out.push([foldText(t.term), t.original])
  return out
}

// ---------- the search ----------

let seq = 0
interface Triage {
  papers: string[]
  english: string[]
  spanish: string[]
}
const triageCache = new Map<string, Triage>()
const checkCache = new Map<string, Evidence[]>()

/**
 * The library's catalog as the model reads it: per paper, its title and what
 * its reading guide says it finds (in Spanish, like the thesis). All the
 * papers are about the same topics, so the words alone can't tell which one
 * backs a claim; the model can.
 */
function catalog(all: Paper[]): { text: string; ids: string[] } {
  const guides = useStore.getState().guides
  const canon = canonicalIds(all)
  const papers = all.filter((p) => canon.get(p.id) === p.id)
  const ids: string[] = []
  const lines = papers.map((p, i) => {
    ids.push(p.id)
    const g = guides[p.id]
    const about = g ? [g.tldr, g.matrix?.findings && `Hallazgos: ${g.matrix.findings}`, g.matrix?.method && `Método: ${g.matrix.method}`].filter(Boolean).join(' ') : (p.abstract ?? '')
    return `[L${i + 1}] ${authorLine(p, 3) || 'Sin autor'} (${p.year ?? 's. f.'}). «${p.title}». ${about.replace(/\s+/g, ' ').slice(0, 520)}`
  })
  return { text: lines.join('\n'), ids }
}

/** The model picks the papers likeliest to back the claim, and gives the literature's terms to find the passages. */
async function triage(claim: Claim, papers: Paper[]): Promise<Triage> {
  const key = `${claim.text}\n${papers.length}`
  const hit = triageCache.get(key)
  if (hit) return hit
  const { text, ids } = catalog(papers)
  // One-shot: the catalog is long, and a warm channel would carry every past one in its context.
  const r = (await window.api.ai.extract(
    `Afirmación de la tesis: «${claim.text}»\nPárrafo: «${claim.context.slice(0, 800)}»\n\nCatálogo de la biblioteca del estudiante (id, autores, año, título y lo que el paper estudia y encuentra según su guía de lectura):\n${text}\n\nEn "papers", los ids (L1, L2…) de hasta 8 papers de este catálogo que con más probabilidad contienen pasajes que respaldan, matizan o contradicen esta afirmación, del más al menos probable. Pensá en lo que la afirmación sostiene (la relación, la población, el instrumento), no solo en el tema: todos los papers tratan temas parecidos. Si cita un instrumento, incluí el paper que lo desarrolló o validó. En "english", de 4 a 8 términos o frases cortas como los usa la literatura en inglés para encontrar el pasaje dentro de esos papers; en "spanish", de 2 a 5 sinónimos en español. Solo ids que estén en el catálogo.`,
    TRIAGE_SCHEMA,
    { instructions: evidenceInstructions(useStore.getState().settings), model: aiModel().id, effort: aiEffort() }
  )) as Triage
  const picked = [...new Set((r.papers ?? []).map((k) => ids[Number(String(k).replace(/\D/g, '')) - 1]).filter(Boolean))]
  const out = { papers: picked, english: r.english ?? [], spanish: r.spanish ?? [] }
  triageCache.set(key, out)
  return out
}

async function checkPassages(claim: Claim, hits: Hit[]): Promise<Evidence[]> {
  const key = `${claim.text}\n${hits.map((h) => `${h.passage.paperId}:${h.passage.page}:${h.passage.text.length}`).join('|')}`
  const cached = checkCache.get(key)
  if (cached) return cached
  const papers = useStore.getState().papers
  const list = hits
    .map((h, i) => {
      const p = papers[h.passage.paperId]
      return `[P${i + 1}] ${p ? `${shortLabel(p)}, «${p.title}»` : 'Paper'}, p. ${h.passage.page}:\n"""${h.passage.text}"""`
    })
    .join('\n\n')
  const r = (await window.api.ai.assist({
    instructions: evidenceInstructions(useStore.getState().settings),
    prompt: `Afirmación del estudiante (de su tesis): «${claim.text}»\nPárrafo donde aparece: «${claim.context.slice(0, 800)}»\n\nPasajes candidatos de su biblioteca:\n\n${list}\n\nPara cada pasaje decidí si respalda la afirmación tal como está escrita:\n- "apoya": la sostiene.\n- "matiza": la sostiene en parte o con condiciones; decí cuáles.\n- "contradice": dice lo contrario.\n- "no_respalda": trata otra cosa o no alcanza para citarlo.\nEn "quote" copiá textualmente la frase o las frases del pasaje que lo muestran (hasta 60 palabras); vacío si no_respalda. En "translation", su traducción al español si está en otro idioma, o vacío. En "why", una oración en español sobre qué dice el pasaje respecto de la afirmación (sin reescribir la afirmación). Un resultado por pasaje, con su id (P1, P2…).`,
    schema: CHECK_SCHEMA,
    model: aiModel().id,
    effort: aiEffort(),
    channel: 'evidence-check'
  })) as { results: { id: string; verdict: Verdict; quote: string; translation: string; why: string }[] }
  const out = hits.map((h, i): Evidence => {
    const r2 = r.results.find((x) => x.id.replace(/\W/g, '').toUpperCase() === `P${i + 1}`)
    const q = quoteIn(h.passage.text, r2?.quote ?? '')
    return {
      id: `${h.passage.paperId}:${h.passage.page}:${i}`,
      paperId: h.passage.paperId,
      page: h.passage.page,
      passage: h.passage.text,
      quote: q.quote,
      exact: q.exact,
      translation: q.exact ? (r2?.translation ?? '') : '',
      why: r2?.why ?? '',
      verdict: r2?.verdict ?? 'no_respalda'
    }
  })
  checkCache.set(key, out)
  if (checkCache.size > 60) checkCache.delete(checkCache.keys().next().value!)
  return out
}

const unverified = (hits: Hit[]): Evidence[] =>
  hits.map((h, i) => ({
    id: `${h.passage.paperId}:${h.passage.page}:${i}`,
    paperId: h.passage.paperId,
    page: h.passage.page,
    passage: h.passage.text,
    quote: splitSentences(h.passage.text)[0]?.text ?? h.passage.text,
    exact: true,
    translation: '',
    why: '',
    verdict: 'sin_verificar'
  }))

const MAX_PASSAGES = 24
const DEEP_PAPERS = 3
/** Characters of full text read per in-depth pass (~60k tokens), split among the papers. */
const DEEP_BUDGET = 240_000

const order = (e: Evidence) => VERDICT_ORDER.indexOf(e.verdict)
/** Best verdict first; one card per passage (overlapping passages and copies of a paper in the library say the same). */
function sorted(xs: Evidence[]): Evidence[] {
  const canon = canonicalIds(Object.values(useStore.getState().papers))
  const kept: { k: string; words: Set<string> }[] = []
  return xs
    .map((e, i) => ({ e, i }))
    .sort((a, b) => order(a.e) - order(b.e) || a.i - b.i)
    .map((x) => x.e)
    .filter((e) => {
      const k = `${canon.get(e.paperId) ?? e.paperId}:${e.page}`
      const words = new Set(norm(e.quote).split(' '))
      // Same page and mostly the same words: overlapping passages quoting the same lines.
      const same = kept.some((x) => x.k === k && [...words].filter((w) => x.words.has(w)).length >= 0.6 * Math.min(words.size, x.words.size))
      if (same) return false
      kept.push({ k, words })
      return true
    })
}
const backs = (xs: Evidence[]) => xs.some((e) => e.verdict === 'apoya' || e.verdict === 'matiza')

/**
 * Candidate passages: the best ones inside each paper the model picked, then
 * the best of the whole library (which also covers working without an account).
 */
function gather(query: Map<string, number>, picked: string[], boost: (pid: string) => number): Hit[] {
  const out: Hit[] = []
  const seen = new Set<string>()
  const push = (h: Hit) => {
    const k = `${h.passage.paperId}:${h.passage.page}:${h.passage.text.slice(0, 40)}`
    if (seen.has(k) || out.length >= MAX_PASSAGES) return
    seen.add(k)
    out.push(h)
  }
  const within = picked.map((pid) => index.search(query, { limit: 3, perPaper: 3, only: (x) => x === pid }))
  // Interleaved: the first passage of every picked paper before the second of any.
  for (let r = 0; r < 3; r++) for (const hs of within) if (hs[r]) push(hs[r])
  for (const h of index.search(query, { limit: 8, perPaper: 2, paperBoost: boost })) push(h)
  return out.filter((h) => useStore.getState().papers[h.passage.paperId])
}

/** Finds passages of the library that may back the claim, and has the model check each one. Results land in `useEvidence`. */
export async function findSupport(claim: Claim): Promise<void> {
  const id = ++seq
  const live = () => id === seq
  const set = (patch: Partial<EvidenceState>) => live() && useEvidence.setState(patch)
  const s = useStore.getState()
  const papers = Object.values(s.papers)
  set({ claim, status: 'searching', notice: undefined, results: [], instruments: instrumentRefs(claim.text, papers), picked: [], read: [], reading: [] })
  useStore.setState({ rightOpen: true, rightTab: 'support' })

  const connected = !!s.account?.connected
  const failed: { notice?: string } = {}
  const [counts, tri] = await Promise.all([
    ensureIndex(papers),
    connected
      ? triage(
          claim,
          papers.filter((p) => p.textStatus === 'ready')
        ).catch((e) => {
          if (errorText(e) !== 'CANCELLED') failed.notice = errorText(e)
          return null
        })
      : null
  ])
  if (!live()) return
  set({ searched: counts.searched, withoutText: counts.withoutText, picked: tri?.papers ?? [] })

  const topics = topicsIn(claim.text)
  const candidates = new Set(listByName(CANDIDATES_LIST)?.paperIds ?? [])
  const query = queryTerms([
    { text: claim.text, weight: 1 },
    { text: claim.context, weight: 0.25 },
    { text: glossaryTerms(claim.text, guidePairs()), weight: 0.8 },
    { text: tri?.english.join(' ') ?? '', weight: 1 },
    { text: tri?.spanish.join(' ') ?? '', weight: 0.6 }
  ])
  const hits = gather(query, tri?.papers ?? [], (pid) => {
    const p = useStore.getState().papers[pid]
    if (!p) return 0
    return (topics.some((t) => p.constructs?.includes(t)) ? 1.15 : 1) * (candidates.has(pid) ? 1.1 : 1)
  })
  const notice = failed.notice
  if (!hits.length && !tri?.papers.length) return void set({ status: 'done', results: [], notice })

  if (!connected) {
    return void set({
      status: 'done',
      results: unverified(hits),
      notice: `Conectá tu cuenta de ${providerLabel()} en Ajustes para que el modelo elija los papers, lea los pasajes y diga si apoyan, matizan o contradicen la oración.`
    })
  }
  set({ status: 'checking', results: unverified(hits) })
  let checked: Evidence[] = []
  try {
    checked = hits.length ? await checkPassages(claim, hits) : []
    set({ status: 'done', results: sorted(checked), notice })
  } catch (e) {
    if (errorText(e) === 'CANCELLED') return
    return void set({ status: 'done', results: unverified(hits), notice: errorText(e) })
  }
  // Nothing among the passages backs it: read the likeliest papers whole, as the assistant would.
  if (live() && !backs(checked)) await readInDepth()
}

/** Pages of the paper with their marks, up to `budget` characters. */
async function fullText(paper: Paper, budget: number): Promise<string> {
  const pages = (await getPaperText(paper.id)) ?? []
  let body = ''
  for (const p of pages) {
    const chunk = `\n[Página ${p.page}]\n${p.text}\n`
    if (body.length + chunk.length > budget) {
      body += `\n[… sigue desde la página ${p.page}]`
      break
    }
    body += chunk
  }
  return body
}

/**
 * Reads whole papers against the claim (the likeliest ones not read yet) and
 * adds what it finds. Every quote is checked against the paper's text: it is
 * shown on the page where it really is, or replaced by the closest real
 * sentence when the model paraphrased.
 */
/** Papers an in-depth read would take next (the model's picks first, then those with passages shown). */
export function nextToRead(st: Pick<EvidenceState, 'picked' | 'results' | 'read'> = useEvidence.getState()): string[] {
  const papers = useStore.getState().papers
  return [...new Set([...st.picked, ...st.results.map((r) => r.paperId)])].filter((pid) => papers[pid]?.textStatus === 'ready' && !st.read.includes(pid)).slice(0, DEEP_PAPERS)
}

export async function readInDepth(): Promise<void> {
  const st = useEvidence.getState()
  const claim = st.claim
  if (!claim || !useStore.getState().account?.connected) return
  const id = seq
  const live = () => id === seq
  const papers = useStore.getState().papers
  const todo = nextToRead(st)
  if (!todo.length) return
  useEvidence.setState({ status: 'reading', read: [...st.read, ...todo], reading: todo })
  try {
    const per = Math.floor(DEEP_BUDGET / todo.length)
    const blocks = await Promise.all(
      todo.map(async (pid, i) => {
        const p = papers[pid]
        return `<fuente id="S${i + 1}" autores="${authorLine(p, 6)}" año="${p.year ?? ''}" título="${p.title.replace(/"/g, "'")}">${await fullText(p, per)}</fuente>`
      })
    )
    const r = (await window.api.ai.extract(
      `Afirmación del estudiante (de su tesis): «${claim.text}»\nPárrafo donde aparece: «${claim.context.slice(0, 800)}»\n\nLeé estas fuentes completas de su biblioteca y encontrá los pasajes que respaldan, matizan o contradicen la afirmación tal como está escrita (con la misma exigencia: correlacional no respalda causal, otra población matiza, etc.).\n\n${blocks.join('\n\n')}\n\nHasta 6 resultados, los más fuertes primero; ninguno si ninguna fuente trata lo que la oración afirma. Para cada uno: "source" (S1, S2…), "page" (el número de la marca [Página N] bajo la que está el pasaje), "quote" (la frase o las frases copiadas textualmente, hasta 60 palabras), "verdict", "translation" (al español si está en otro idioma, o vacío) y "why" (una oración en español sobre qué dice respecto de la afirmación, sin reescribirla). Preferí los resultados y conclusiones del propio estudio antes que lo que el paper cita de otros autores.`,
      DEEP_SCHEMA,
      { instructions: evidenceInstructions(useStore.getState().settings), model: aiModel().id, effort: aiEffort() }
    )) as { results: { source: string; page: number; verdict: Verdict; quote: string; translation: string; why: string }[] }
    if (!live()) return
    const found: Evidence[] = []
    for (const [i, x] of (r.results ?? []).entries()) {
      const pid = todo[Number(String(x.source).replace(/\D/g, '')) - 1]
      const pages = pid ? await getPaperText(pid) : null
      if (!pid || !pages?.length) continue
      const at = locateQuote(pages, x.quote, x.page)
      const page = at?.page ?? (pages.some((p) => p.page === x.page) ? x.page : null)
      if (page == null) continue
      const pageText = pages.find((p) => p.page === page)!.text
      const q = at ? { quote: x.quote.trim(), exact: true } : quoteIn(pageText, x.quote)
      found.push({
        id: `deep:${pid}:${page}:${i}`,
        paperId: pid,
        page,
        passage: at?.context ?? pageText.slice(0, 900),
        quote: q.quote,
        exact: q.exact,
        translation: q.exact ? x.translation : '',
        why: x.why,
        verdict: x.verdict,
        deep: true
      })
    }
    const now = useEvidence.getState().results
    // A passage already shown (same paper and page) keeps its card.
    const fresh = found.filter((f) => !now.some((e) => e.paperId === f.paperId && e.page === f.page && e.verdict !== 'no_respalda'))
    useEvidence.setState({ status: 'done', reading: [], results: sorted([...fresh, ...now.filter((e) => !fresh.some((f) => f.paperId === e.paperId && f.page === e.page))]) })
  } catch (e) {
    if (!live() || errorText(e) === 'CANCELLED') return
    useEvidence.setState({ status: 'done', reading: [], notice: errorText(e) })
  }
}

/** The claim's sentence moved or was cited: keep the panel in step. */
export function patchClaim(patch: Partial<Claim>): void {
  const c = useEvidence.getState().claim
  if (c) useEvidence.setState({ claim: { ...c, ...patch } })
}

// ---------- from the editor ----------

/** Papers a text cites by hand («(Mayseless, 2010)»), with every copy of each in the library. */
function typedIn(text: string): string[] {
  const all = Object.values(useStore.getState().papers)
  const canon = canonicalIds(all)
  const ids = typedCitations(text).flatMap((c) => resolveCite(c, all, canon).paperId ?? [])
  return all.filter((p) => ids.includes(canon.get(p.id) ?? p.id)).map((p) => p.id)
}

/** Backs the selection, or the sentence at the caret (or at `from`). False when there's no sentence there. */
export function backSentence(editor: Editor, thesisId: string, from?: number, to?: number): boolean {
  const c = claimAt(editor.state, from, to)
  if (!c) {
    toast('Posicionate en una oración del texto (no en un título) o seleccioná lo que querés respaldar.')
    return false
  }
  editor.commands.setSupportTarget(c.sentence)
  void findSupport({ thesisId, text: c.text, context: c.context, sentence: c.sentence, citedIds: [...new Set([...c.citedIds, ...typedIn(c.text)])] })
  return true
}

/** Inserts the APA citation at the end of the claim's sentence; the reference list picks it up by itself. */
export function citeEvidence(editor: Editor, paperId: string, page?: number): boolean {
  const claim = useEvidence.getState().claim
  const paper = useStore.getState().papers[paperId]
  if (!claim || !paper) return false
  // Without the tracked sentence (the editor was reopened), only cite where the claim still reads the same.
  const tracked = supportTarget(editor.state)
  const range = tracked ?? claim.sentence
  const raw = range.to <= editor.state.doc.content.size ? editor.state.doc.textBetween(range.from, range.to, ' ', '') : ''
  const here = foldText(raw)
  if (!tracked && !here.includes(foldText(claim.text.slice(0, 40)).trim())) {
    toast('La oración cambió de lugar. Volvé a buscar respaldo desde ella.')
    return false
  }
  if (typedIn(raw || claim.text).includes(paperId)) {
    toast('La oración ya cita este paper.')
    return false
  }
  // Joins a citation typed by hand at the end of the sentence, in its own words.
  const r = insertSupport(editor, range, { paperId, page: page ?? null }, inText(paper, THESIS_CITE.style, page, THESIS_CITE.locale).slice(1, -1))
  if (r === 'already') {
    toast('La oración ya cita este paper.')
    return false
  }
  if (!r) {
    toast('No encontré la oración en el texto. Volvé a buscar desde ella.')
    return false
  }
  patchClaim({ citedIds: [...claim.citedIds, paperId] })
  toast(
    `Cita insertada: ${inText(paper, THESIS_CITE.style, page, THESIS_CITE.locale)}. La referencia ya está en Referencias bibliográficas.`,
    { label: 'Deshacer', run: () => editor.commands.undo() },
    { status: 'success' }
  )
  return true
}

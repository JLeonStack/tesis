import { GUIDE_VERSION, type GuideSection, type GuideTerm, type MatrixFields, type PageText, type PaperGuide, type SkimFacet, type SkimSentence } from '@shared/types'
import { aiModel, providerLabel, saveAnnotation, saveGuide, toast, useStore } from '../store'
import { uid } from './util'
import { getPaperText } from './ingest'
import { acquirePdf, releasePdf } from './pdf'
import { locateAll } from './locate'
import { langShort } from './translate'

// A reading guide maps a paper before you read it (Keshav's first pass, done
// for you): the gist, which sections matter for *your* thesis, and the key
// sentences, located on the page so skim mode can mark them.

/** Like the assistant, the guide always answers in Spanish (quotes stay verbatim). */
const GUIDE_LANGUAGE = 'Spanish'

const BUDGET = 300_000 // characters of paper text sent to the model

/** Silent reading of academic text runs slower than the ~238 wpm average for non-fiction. */
const WPM = 200

export const FACETS: { id: SkimFacet; label: string; hint: string }[] = [
  { id: 'goal', label: 'Goal', hint: 'Research question, aim or hypothesis' },
  { id: 'method', label: 'Method', hint: 'Design, data, sample and analysis' },
  { id: 'finding', label: 'Finding', hint: 'Results and contributions' },
  { id: 'limitation', label: 'Limitation', hint: 'Limits and future research' },
  { id: 'definition', label: 'Definition', hint: 'Where the paper defines its key terms' }
]

export const ADVICE_LABEL = { read: 'Read', skim: 'Skim', skip: 'Skip' } as const

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WPM))
}

/** Time to read the guide's key sentences plus a glance at each section start. */
export function skimMinutes(g: PaperGuide): number {
  const words = g.sentences.reduce((n, s) => n + wordCount(s.text), 0) + wordCount(g.tldr)
  return Math.max(1, Math.round(words / WPM + g.sections.length * 0.2))
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tldr', 'relevance', 'relevanceLevel', 'sections', 'sentences', 'terms', 'questions', 'recall', 'matrix'],
  properties: {
    tldr: { type: 'string' },
    relevance: { type: 'string' },
    relevanceLevel: { type: 'string', enum: ['high', 'medium', 'low'] },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'page', 'gist', 'advice', 'why'],
        properties: {
          title: { type: 'string' },
          page: { type: 'integer' },
          gist: { type: 'string' },
          advice: { type: 'string', enum: ['read', 'skim', 'skip'] },
          why: { type: 'string' }
        }
      }
    },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['facet', 'page', 'text'],
        properties: {
          facet: { type: 'string', enum: ['goal', 'method', 'finding', 'limitation'] },
          page: { type: 'integer' },
          text: { type: 'string' }
        }
      }
    },
    terms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'original', 'definition', 'page', 'quote'],
        properties: {
          term: { type: 'string' },
          original: { type: 'string' },
          definition: { type: 'string' },
          page: { type: 'integer' },
          quote: { type: 'string' }
        }
      }
    },
    questions: { type: 'array', items: { type: 'string' } },
    recall: { type: 'array', items: { type: 'string' } },
    matrix: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'theory', 'method', 'context', 'findings', 'limitations'],
      properties: {
        question: { type: 'string' },
        theory: { type: 'string' },
        method: { type: 'string' },
        context: { type: 'string' },
        findings: { type: 'string' },
        limitations: { type: 'string' }
      }
    }
  }
}

type Raw = Omit<PaperGuide, 'id' | 'language' | 'words' | 'createdAt' | 'sentences' | 'terms' | 'recall' | 'matrix' | 'version'> & {
  sentences: { facet: Exclude<SkimFacet, 'definition'>; page: number; text: string }[]
  terms: { term: string; original: string; definition: string; page: number; quote: string }[]
  recall: string[]
  matrix: MatrixFields
}

function instructions(lang: string, thesisTitle: string, question: string): string {
  const thesis = [thesisTitle.trim() && `Thesis working title: "${thesisTitle.trim()}"`, question.trim() && `Research question: ${question.trim()}`]
    .filter(Boolean)
    .join('\n')
  return `You are the reading coach inside Thesis Studio, an app where an MBA student reads academic papers for their thesis. You prepare a reading guide so the student understands a paper fast and spends attention where it pays off for their thesis.

${thesis || 'The student has not described their thesis yet: judge relevance for a typical MBA thesis in management and say so.'}

Write every prose field (tldr, relevance, gist, why, term, definition, questions, recall, matrix) in ${langShort(lang)}, plainly and concretely. Copy quoted sentences in the paper's original language.

Fields:
- tldr: 2–3 sentences: the question, how it was studied, and the main answer. No filler such as "This paper explores".
- relevance and relevanceLevel: how this paper bears on the student's thesis specifically: what it could support, challenge or supply (a theory, a measure, evidence). One short paragraph.
- sections: the paper's real top-level sections in order, with the heading as printed (e.g. "2. Literature review"), the page where each starts, a one-sentence gist, and advice for a first reading: "read" (central to the argument or directly useful for the thesis), "skim" (context worth a glance), "skip" (safe to skip on a first pass, such as robustness checks, appendices, or literature unrelated to the thesis). The introduction and the discussion or conclusion are never "skip". "why" is one short clause. Between 3 and 12 sections.
- sentences: the key sentences a skimmer should read to get the argument, each copied EXACTLY, character for character, from the text: one whole sentence, no paraphrase, no ellipsis, no joined sentences, no added quotation marks. "page" is the [Page N] tag the sentence appears under. Facets: "goal" (research question, aim, hypotheses), "method" (design, data, sample, measures, analysis), "finding" (results and contributions), "limitation" (limitations, boundary conditions, future research). Pick 12 to 28 depending on length, spread across the whole paper, mostly from the body (at most 2 from the abstract). Avoid sentences that are mostly citations or bare numbers. Order them as they appear.
- terms: 3 to 10 constructs or technical terms the reader must know, defined as this paper uses them, with the page where they are defined or first used. Include every key construct the paper explicitly defines (definitions are what a thesis cites), then other essential terms. "term" is the name in the prose language; "original" is the term exactly as printed in the paper, in its language and usual singular form (e.g. "epistemic trust"), so it can be found in the text; "definition" is your plain explanation. "quote": when the paper itself defines the term (e.g. "X refers to…", "We define X as…", "X is…", or a definition it adopts from another author), the defining sentence copied EXACTLY like the key sentences (one whole sentence, verbatim, from the [Page N] given in "page"); otherwise an empty string. Never invent or paraphrase a quote.
- questions: 3 to 5 questions to keep in mind while reading, linking the paper to the thesis and inviting critical reading.
- recall: 3 or 4 short questions about the paper's core that a reader should be able to answer from memory afterwards: its question or aim, how it was studied, the main findings, and a key limitation or condition. Answerable from the paper alone, one idea each.
- matrix: one row of a literature-review matrix, each field at most 30 words, telegraphic, no full sentences needed: "question" (research question or aim), "theory" (theoretical lens or framework; "No explícita" if none), "method" (design, data and analysis), "context" (sample, setting, country, period), "findings" (main results), "limitations" (as stated or evident).

Never invent content that is not in the paper.`
}

/**
 * Builds (or rebuilds) the reading guide for a paper. Safe to call twice: the second call is ignored.
 * `quiet` skips the success toast (bulk builds report progress themselves). Resolves true on success.
 */
export async function buildGuide(paperId: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const state = useStore.getState()
  const paper = state.papers[paperId]
  if (!paper || state.guiding[paperId]) return false
  if (!state.account?.connected) {
    toast(`Connect your ${providerLabel()} account to build reading guides`, { label: 'Settings', run: () => useStore.setState({ settingsOpen: true }) })
    return false
  }
  useStore.setState((s) => ({ guiding: { ...s.guiding, [paperId]: Date.now() } }))
  try {
    const { pages, body } = await paperBody(paperId)
    const { settings } = useStore.getState()
    const raw = (await window.api.ai.extract(
      `Build the reading guide for this paper: "${paper.title}".\n\n<paper>${body}</paper>`,
      SCHEMA,
      { instructions: instructions(GUIDE_LANGUAGE, settings.thesisTitle, settings.researchQuestion), model: aiModel().id, effort: 'medium' }
    )) as Raw

    const doc = await acquirePdf(paper)
    let located: Awaited<ReturnType<typeof locateAll>>
    let headings: Awaited<ReturnType<typeof locateAll>>
    try {
      located = await locateAll(doc, [...raw.sentences, ...raw.terms.map((t) => ({ page: t.page, text: t.quote }))])
      // Headings anchor the roadmap; a found heading also corrects its page.
      headings = await locateAll(doc, raw.sections.map((s) => ({ page: s.page, text: s.title.replace(/^[\dIVX.\s]+/, '') || s.title })))
    } finally {
      releasePdf(paper.id)
    }

    const seen = new Set<string>()
    const sentences: SkimSentence[] = []
    raw.sentences.forEach((s, i) => {
      const text = s.text.trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      const at = located[i]
      sentences.push({ id: `s${i}`, facet: s.facet, page: at?.page ?? s.page, text, rects: at?.rects ?? [] })
    })
    // The paper's own definitions become key sentences too, linked from their terms.
    const terms = raw.terms.map((t, i) => {
      const { quote, ...term } = t
      const page = clampPage(t.page, pages.length)
      const text = quote.trim()
      if (!text) return { ...term, page }
      // Already picked as a key sentence: it's a definition first.
      const same = sentences.find((s) => s.text === text)
      if (same) {
        same.facet = 'definition'
        return { ...term, page: same.page, sentenceId: same.id }
      }
      const at = located[raw.sentences.length + i]
      const id = `d${i}`
      sentences.push({ id, facet: 'definition', page: at?.page ?? page, text, rects: at?.rects ?? [] })
      return { ...term, page: at?.page ?? page, sentenceId: id }
    })
    // Reading order, so "next key sentence" walks the paper top to bottom.
    sentences.sort((a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0))

    const sections: GuideSection[] = raw.sections.map((s, i) => ({ ...s, page: headings[i]?.page ?? clampPage(s.page, pages.length) }))
    const guide: PaperGuide = {
      version: GUIDE_VERSION,
      recall: raw.recall.filter((q) => q.trim()),
      matrix: raw.matrix,
      id: paperId,
      tldr: raw.tldr.trim(),
      relevance: raw.relevance.trim(),
      relevanceLevel: raw.relevanceLevel,
      sections,
      sentences,
      terms,
      questions: raw.questions.filter((q) => q.trim()),
      language: GUIDE_LANGUAGE,
      words: pages.reduce((n, p) => n + wordCount(p.text), 0),
      createdAt: Date.now()
    }
    saveGuide(guide)
    if (opts.quiet) return true
    const missed = sentences.filter((s) => !s.rects.length).length
    toast('Reading guide ready', undefined, {
      status: 'success',
      description: `${sentences.length - missed} key sentences marked${missed ? ` (${missed} listed only)` : ''} · skim in ~${skimMinutes(guide)} min`
    })
    return true
  } catch (e) {
    const msg = errorText(e)
    if (!opts.quiet) toast('Could not build the reading guide', { label: 'Try again', run: () => void buildGuide(paperId) }, { status: 'error', description: msg })
    return false
  } finally {
    useStore.setState((s) => {
      const guiding = { ...s.guiding }
      delete guiding[paperId]
      return { guiding }
    })
  }
}

/** The paper's own definitions, with their terms. */
export function guideDefinitions(g: PaperGuide): { term: GuideTerm; sentence: SkimSentence }[] {
  return g.terms.flatMap((term) => {
    const sentence = term.sentenceId ? g.sentences.find((s) => s.id === term.sentenceId) : undefined
    return sentence ? [{ term, sentence }] : []
  })
}

/** Definitions are highlighted purple, apart from the reader's own yellow. */
export const DEFINITION_COLOR = 'purple' as const

/**
 * Turns the paper's definitions into real highlights (purple, the term as the
 * comment), so they stay in the Highlights panel and exports. Skips ones
 * already highlighted. Returns how many were added.
 */
export function highlightDefinitions(paperId: string): number {
  const { guides, annotations } = useStore.getState()
  const g = guides[paperId]
  if (!g) return 0
  const have = new Set(Object.values(annotations).filter((a) => a.paperId === paperId).map((a) => `${a.page}|${a.text}`))
  let added = 0
  for (const { term, sentence: s } of guideDefinitions(g)) {
    if (!s.rects.length || have.has(`${s.page}|${s.text}`)) continue
    const now = Date.now()
    saveAnnotation({ id: uid(), paperId, page: s.page, rects: s.rects, text: s.text, color: DEFINITION_COLOR, comment: `Definición: ${term.term}`, createdAt: now, updatedAt: now })
    have.add(`${s.page}|${s.text}`)
    added++
  }
  return added
}

/** The paper's text with [Page N] tags, cut to what the model can take. */
export async function paperBody(paperId: string): Promise<{ pages: PageText[]; body: string }> {
  const pages = await getPaperText(paperId)
  if (!pages?.length) throw new Error('The text of this paper is not ready yet.')
  let body = ''
  for (const p of pages) {
    const chunk = `\n[Page ${p.page}]\n${p.text}\n`
    if (body.length + chunk.length > BUDGET) {
      body += `\n[… truncated after page ${p.page - 1} of ${pages.length}]`
      break
    }
    body += chunk
  }
  return { pages, body }
}

export const errorText = (e: unknown) =>
  (e as Error)?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Something went wrong.'

/** Guides for many papers, one at a time (each is a long request); progress lives in `bulk`. */
export async function buildGuides(ids: string[]): Promise<void> {
  if (bulk.running) return
  bulk = { running: true, stopping: false, done: 0, total: ids.length, failed: 0 }
  notify()
  for (const id of ids) {
    if (bulk.stopping) break
    const ok = await buildGuide(id, { quiet: true })
    bulk = { ...bulk, done: bulk.done + 1, failed: bulk.failed + (ok ? 0 : 1) }
    notify()
  }
  const { done, failed } = bulk
  bulk = IDLE
  notify()
  toast(`Guides built for ${done - failed} of ${done} papers`, undefined, { status: failed ? 'error' : 'success' })
}

/** Stops after the paper in progress (a request can't be taken back). */
export function stopBuildingGuides(): void {
  if (!bulk.running) return
  bulk = { ...bulk, stopping: true }
  notify()
}

export interface BulkProgress {
  running: boolean
  stopping: boolean
  done: number
  total: number
  failed: number
}
const IDLE: BulkProgress = { running: false, stopping: false, done: 0, total: 0, failed: 0 }
let bulk = IDLE
const listeners = new Set<(b: BulkProgress) => void>()
const notify = () => listeners.forEach((l) => l(bulk))
export function onBulkProgress(l: (b: BulkProgress) => void): () => void {
  listeners.add(l)
  l(bulk)
  return () => void listeners.delete(l)
}

const clampPage = (n: number, total: number) => Math.min(Math.max(1, Math.round(n) || 1), Math.max(1, total))

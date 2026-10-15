import { GUIDE_VERSION, type ConstructId, type Settings, type GuideSection, type GuideTerm, type MatrixFields, type PageText, type PaperGuide, type SkimFacet, type SkimSentence } from '@shared/types'
import { aiModel, providerLabel, saveAnnotation, saveGuide, toast, useStore } from '../store'
import { uid } from './util'
import { getPaperText } from './ingest'
import { acquirePdf, releasePdf } from './pdf'
import { locateAll } from './locate'
import { langShort } from './translate'
import { CONSTRUCT_ORDER, researchBlock } from '../research/framework'

// A reading guide maps a paper before you read it (Keshav's first pass, done
// for you): the gist, which sections matter for *your* thesis, and the key
// sentences, located on the page so skim mode can mark them.

/** Like the assistant, the guide always answers in Spanish (quotes stay verbatim). */
const GUIDE_LANGUAGE = 'Spanish'

const BUDGET = 300_000 // characters of paper text sent to the model

/** Silent reading of academic text runs slower than the ~238 wpm average for non-fiction. */
const WPM = 200

export const FACETS: { id: SkimFacet; label: string; hint: string }[] = [
  { id: 'goal', label: 'Objetivo', hint: 'Pregunta de investigación, objetivo o hipótesis' },
  { id: 'method', label: 'Método', hint: 'Diseño, datos, muestra y análisis' },
  { id: 'finding', label: 'Hallazgo', hint: 'Resultados y aportes' },
  { id: 'limitation', label: 'Limitación', hint: 'Límites e investigación futura' },
  { id: 'definition', label: 'Definición', hint: 'Dónde el paper define sus términos clave' }
]

export const ADVICE_LABEL = { read: 'Leer', skim: 'Hojear', skip: 'Saltar' } as const

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
  required: ['tldr', 'relevance', 'relevanceLevel', 'constructs', 'sections', 'sentences', 'terms', 'questions', 'recall', 'matrix'],
  properties: {
    constructs: { type: 'array', items: { type: 'string', enum: CONSTRUCT_ORDER } },
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

type Raw = Omit<PaperGuide, 'id' | 'language' | 'words' | 'createdAt' | 'sentences' | 'terms' | 'recall' | 'matrix' | 'version' | 'constructs'> & {
  constructs: ConstructId[]
  sentences: { facet: Exclude<SkimFacet, 'definition'>; page: number; text: string }[]
  terms: { term: string; original: string; definition: string; page: number; quote: string }[]
  recall: string[]
  matrix: MatrixFields
}

/** The reading guide's instructions (exported so the Marco de investigación tab can check them). */
export function guideInstructions(settings: Settings, lang = GUIDE_LANGUAGE): string {
  const thesis = [settings.thesisTitle.trim() && `Título provisorio de la tesis: "${settings.thesisTitle.trim()}"`, settings.researchQuestion.trim() && `Pregunta de investigación: ${settings.researchQuestion.trim()}`]
    .filter(Boolean)
    .join('\n')
  return `Sos el coach de lectura de Thesis Studio, una app donde un estudiante de MBA lee papers académicos para su tesis. Preparás una guía de lectura para que el estudiante entienda un paper rápido y ponga la atención donde le rinde para su tesis.

${thesis || 'El estudiante todavía no describió su tesis: evaluá la relevancia frente al marco de la cátedra de abajo y aclaralo.'}

${researchBlock(settings)}

Escribí todos los campos de prosa (tldr, relevance, gist, why, term, definition, questions, recall, matrix) en ${langShort(lang)}, de manera llana y concreta. Copiá las oraciones citadas en el idioma original del paper.

Campos:
- tldr: 2 o 3 oraciones: la pregunta, cómo se estudió y la respuesta principal. Sin relleno del tipo "Este paper explora".
- relevance y relevanceLevel: cómo incide este paper en la tesis del estudiante en particular, dentro del marco de la cátedra: qué podría sostener, cuestionar o aportar (una teoría, una medición, evidencia) a su combinación de temas. "high" solo si trata alguno de sus 2 temas (o los 5 de la cátedra si todavía no eligió); un paper ajeno a los 5 temas es "low". Si usa alguno de los instrumentos de la cátedra (ECR-RS, EQ, HSA-TFL, LSPS, CCO/OCB), decilo. Un párrafo corto.
- constructs: cuáles de los 5 temas de la cátedra estudia el paper como variable o constructo central (no los que solo menciona de pasada): "attachment" (apego), "empathy" (empatía / EQ), "tfl" (liderazgo transformacional), "security" (líder como proveedor de seguridad / base segura), "ocb" (comportamiento de ciudadanía organizacional, CCO). Lista vacía si no estudia ninguno.
- sections: las secciones reales de primer nivel del paper, en orden, con el título tal como está impreso (por ejemplo "2. Literature review"), la página donde empieza cada una, una oración con la idea central y una recomendación para una primera lectura: "read" (central para el argumento o directamente útil para la tesis), "skim" (contexto que vale una mirada), "skip" (se puede saltear en una primera pasada: chequeos de robustez, apéndices o literatura ajena a la tesis). La introducción y la discusión o conclusión nunca son "skip". "why" es una cláusula corta. Entre 3 y 12 secciones.
- sentences: las oraciones clave que alguien que hojea el paper debería leer para captar el argumento, cada una copiada EXACTAMENTE, carácter por carácter, del texto: una oración completa, sin parafrasear, sin puntos suspensivos, sin unir oraciones, sin agregar comillas. "page" es la etiqueta [Page N] bajo la cual aparece la oración. Facetas: "goal" (pregunta de investigación, objetivo, hipótesis), "method" (diseño, datos, muestra, mediciones, análisis), "finding" (resultados y aportes), "limitation" (limitaciones, condiciones de borde, investigación futura). Elegí entre 12 y 28 según la extensión, repartidas por todo el paper y sobre todo del cuerpo (como máximo 2 del resumen). Evitá las oraciones que son casi todo citas o números sueltos. Ordenalas como aparecen.
- terms: de 3 a 10 constructos o términos técnicos que el lector tiene que conocer, definidos como los usa este paper, con la página donde se definen o se usan por primera vez. Incluí todos los constructos clave que el paper define explícitamente (las definiciones son lo que cita una tesis) y después los demás términos esenciales. "term" es el nombre en el idioma de la prosa; "original" es el término exactamente como está impreso en el paper, en su idioma y en su forma singular habitual (por ejemplo "epistemic trust"), para poder encontrarlo en el texto; "definition" es tu explicación llana. "quote": cuando el paper define el término él mismo (por ejemplo "X refers to…", "We define X as…", "X is…", o una definición que toma de otro autor), la oración que lo define copiada EXACTAMENTE como las oraciones clave (una oración completa, textual, de la [Page N] indicada en "page"); si no, una cadena vacía. Nunca inventes ni parafrasees una cita textual.
- questions: de 3 a 5 preguntas para tener en mente mientras lee, que vinculen el paper con la tesis e inviten a una lectura crítica.
- recall: 3 o 4 preguntas cortas sobre el núcleo del paper que un lector debería poder responder de memoria después: su pregunta u objetivo, cómo se estudió, los hallazgos principales y una limitación o condición clave. Respondibles solo con el paper, una idea cada una.
- matrix: una fila de una matriz de literatura, cada campo de 30 palabras como máximo, telegráfico, sin necesidad de oraciones completas: "question" (pregunta de investigación u objetivo), "theory" (lente o marco teórico; "No explícita" si no hay), "method" (diseño, datos y análisis), "context" (muestra, ámbito, país, período), "findings" (resultados principales), "limitations" (las declaradas o evidentes).

Nunca inventes contenido que no esté en el paper.`
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
    toast(`Conectá tu cuenta de ${providerLabel()} para armar guías de lectura`, { label: 'Ajustes', run: () => useStore.setState({ settingsOpen: true }) })
    return false
  }
  useStore.setState((s) => ({ guiding: { ...s.guiding, [paperId]: Date.now() } }))
  try {
    const { pages, body } = await paperBody(paperId)
    const { settings } = useStore.getState()
    const raw = (await window.api.ai.extract(
      `Armá la guía de lectura de este paper: "${paper.title}".\n\n<paper>${body}</paper>`,
      SCHEMA,
      { instructions: guideInstructions(settings), model: aiModel().id, effort: 'medium' }
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
      constructs: CONSTRUCT_ORDER.filter((id) => raw.constructs?.includes(id)),
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
    toast('Guía de lectura lista', undefined, {
      status: 'success',
      description: `${sentences.length - missed} oraciones clave marcadas${missed ? ` (${missed} solo en la lista)` : ''} · lectura rápida en ~${skimMinutes(guide)} min`
    })
    return true
  } catch (e) {
    const msg = errorText(e)
    if (!opts.quiet) toast('No se pudo armar la guía de lectura', { label: 'Reintentar', run: () => void buildGuide(paperId) }, { status: 'error', description: msg })
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
  if (!pages?.length) throw new Error('El texto de este paper todavía no está listo.')
  let body = ''
  for (const p of pages) {
    const chunk = `\n[Page ${p.page}]\n${p.text}\n`
    if (body.length + chunk.length > BUDGET) {
      body += `\n[… truncado después de la página ${p.page - 1} de ${pages.length}]`
      break
    }
    body += chunk
  }
  return { pages, body }
}

export const errorText = (e: unknown) =>
  (e as Error)?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Algo salió mal.'

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
  toast(`Guías armadas para ${done - failed} de ${done} papers`, undefined, { status: failed ? 'error' : 'success' })
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

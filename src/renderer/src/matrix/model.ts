import { GUIDE_VERSION, type ConstructId, type MatrixFields, type Paper, type PaperGuide, type Settings } from '@shared/types'
import type { MatrixView, State } from '../store'
import { authorLine, STYLE_LABELS } from '../lib/citation'
import { RULES, thesisBlock, type QuickAction } from '../lib/prompts'
import { matches } from '../wiki/knowledge'
import { CONSTRUCTS } from '../research/framework'
import { paperConstructs } from '../research/coverage'

// The matrix's rows, as the table shows them and as the assistant reads them:
// one place, so "the papers I'm looking at" means the same to both.

export const COLUMNS: { key: keyof MatrixFields; label: string }[] = [
  { key: 'question', label: 'Pregunta' },
  { key: 'theory', label: 'Teoría' },
  { key: 'method', label: 'Método' },
  { key: 'context', label: 'Contexto y muestra' },
  { key: 'findings', label: 'Hallazgos' },
  { key: 'limitations', label: 'Limitaciones' }
]

export const LEVEL = {
  high: { dot: 'bg-status-read', label: 'Alta', rank: 0 },
  medium: { dot: 'bg-status-reading', label: 'Media', rank: 1 },
  low: { dot: 'bg-faint/60', label: 'Baja', rank: 2 }
} as const

/** In the matrix once its guide has the matrix fields (version 2 on). */
export const isCurrent = (g: PaperGuide | undefined): g is PaperGuide & { matrix: MatrixFields } => !!g?.matrix

/** In the matrix, but from a guide older than the current one (no definitions, say). */
export const isOutdated = (g: PaperGuide | undefined): boolean => isCurrent(g) && (g.version ?? 1) < GUIDE_VERSION

export interface Row {
  paper: Paper
  guide?: PaperGuide
}

type Sources = Pick<State, 'papers' | 'guides'>

export const allRows = (s: Sources): Row[] => Object.values(s.papers).map((paper) => ({ paper, guide: s.guides[paper.id] }))

/** The course topics a row covers. */
export const rowTopics = ({ paper, guide }: Row): ConstructId[] => paperConstructs(paper, guide)

/** Whether a row passes the topic filter; "pair" means both chosen topics. */
export function inTopic(r: Row, topic: MatrixView['topic'], pair: ConstructId[]): boolean {
  if (topic === 'all') return true
  const ids = rowTopics(r)
  return topic === 'pair' ? pair.length === 2 && pair.every((id) => ids.includes(id)) : ids.includes(topic)
}

/** The rows on screen: the assistant's pick (in its order) narrowed by the search, the topic and the level, then sorted. */
export function visibleRows(all: Row[], view: MatrixView, pair: ConstructId[] = []): Row[] {
  const { query, level, sort, filter, topic } = view
  const rank = filter ? new Map(filter.ids.map((id, i) => [id, i])) : null
  const list = all.filter(({ paper, guide }) => {
    if (rank && !rank.has(paper.id)) return false
    if (!inTopic({ paper, guide }, topic, pair)) return false
    if (level !== 'all') {
      const l = isCurrent(guide) ? guide.relevanceLevel : null
      if (!l || (level === 'high' ? l !== 'high' : l === 'low')) return false
    }
    return !query.trim() || matches(searchText({ paper, guide }), query)
  })
  const relevance = (r: Row) => (isCurrent(r.guide) ? LEVEL[r.guide.relevanceLevel].rank : 3)
  const year = (r: Row) => Number(r.paper.year) || 0
  const author = (r: Row) => r.paper.authors[0]?.family ?? r.paper.title
  return list.sort((a, b) =>
    sort === 'rank' && rank
      ? rank.get(a.paper.id)! - rank.get(b.paper.id)!
      : sort === 'year'
        ? year(b) - year(a) || author(a).localeCompare(author(b))
        : sort === 'author'
          ? author(a).localeCompare(author(b)) || year(a) - year(b)
          : relevance(a) - relevance(b) || year(b) - year(a)
  )
}

function searchText({ paper, guide }: Row): string {
  return [paper.title, authorLine(paper, 20), paper.year, paper.tags.join(' '), guide?.tldr, guide?.relevance, ...(guide?.matrix ? Object.values(guide.matrix) : [])]
    .filter(Boolean)
    .join(' ')
}

// ---------- copy & export ----------

export const HEAD = ['Autores', 'Año', 'Título', ...COLUMNS.map((c) => c.label), 'Relevancia', 'Nivel', 'Temas de la cátedra']

/** A row's cells, in HEAD order; rows without a matrix row yet keep only who and what. */
export function cells({ paper, guide }: Row): string[] {
  const m = guide?.matrix
  const g = isCurrent(guide) ? guide : undefined
  const topics = rowTopics({ paper, guide }).map((id) => CONSTRUCTS[id].short).join(', ')
  return [authorLine(paper, 20), paper.year ?? '', paper.title, ...COLUMNS.map((c) => m?.[c.key] ?? ''), g?.relevance ?? '', g ? LEVEL[g.relevanceLevel].label : '', topics]
}

const flat = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()

/** Tab-separated, the way spreadsheets paste: one row per line, cells side by side. */
export function toTsv(rows: Row[], head = true): string {
  const cell = (s: string) => flat(s).replace(/\t/g, ' ')
  return [...(head ? [HEAD] : []), ...rows.map(cells)].map((r) => r.map(cell).join('\t')).join('\n')
}

export function toMarkdown(rows: Row[]): string {
  const cell = (s: string) => flat(s).replace(/\|/g, '\\|')
  return [`| ${HEAD.join(' | ')} |`, `| ${HEAD.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${cells(r).map(cell).join(' | ')} |`)].join('\n')
}

export function toCsv(rows: Row[]): string {
  const cell = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  // BOM so Excel reads the accents as UTF-8.
  return '﻿' + [HEAD, ...rows.map(cells)].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** One column across rows, each line led by who wrote it: "Autor (año): …". */
export function columnText(rows: Row[], key: keyof MatrixFields | 'relevance'): string {
  return rows
    .filter((r) => isCurrent(r.guide))
    .map((r) => `${byline(r.paper)}: ${flat(key === 'relevance' ? r.guide!.relevance : r.guide!.matrix![key])}`)
    .join('\n')
}

/** A row as readable text, for pasting into a note. */
export function rowText(r: Row): string {
  const g = isCurrent(r.guide) ? r.guide : undefined
  const lines = [`${r.paper.title} — ${byline(r.paper)}`]
  if (g) {
    for (const c of COLUMNS) lines.push(`${c.label}: ${flat(g.matrix[c.key])}`)
    lines.push(`Relevancia (${LEVEL[g.relevanceLevel].label}): ${flat(g.relevance)}`)
  }
  return lines.join('\n')
}

export const byline = (p: Paper) =>
  `${p.authors[0]?.family ?? (p.title.length > 40 ? `${p.title.slice(0, 40)}…` : p.title)}${p.authors.length > 2 ? ' et al.' : p.authors.length === 2 ? ` y ${p.authors[1].family}` : ''}${p.year ? ` (${p.year})` : ''}`

// ---------- assistant ----------

const BUDGET = 300_000
const attr = (t: string) => t.replace(/"/g, "'")

/** The matrix chat's system prompt: every paper as a matrix row (or its abstract, until it has one). */
export function matrixInstructions(s: Sources & { settings: Settings }, sources: Paper[], protocol: string): string {
  const per = Math.floor(BUDGET / Math.max(1, sources.length))
  const rows = sources.map((p, i) => {
    const g = s.guides[p.id]
    const lines: string[] = []
    if (isCurrent(g)) {
      lines.push(`En breve: ${g.tldr}`)
      for (const c of COLUMNS) lines.push(`${c.label}: ${g.matrix[c.key]}`)
      lines.push(`Relevancia para la tesis (${g.relevanceLevel}): ${g.relevance}`)
      if (g.terms.length) lines.push(`Términos clave: ${g.terms.map((t) => t.term).join(', ')}`)
    } else lines.push(p.abstract ? `(Todavía sin fila en la matriz. Resumen:) ${p.abstract}` : '(Todavía sin fila en la matriz ni resumen.)')
    let body = lines.join('\n')
    if (body.length > per) body = `${body.slice(0, per)}…`
    const meta = [
      `key="S${i + 1}"`,
      `id="${p.id}"`,
      `title="${attr(p.title)}"`,
      `authors="${attr(authorLine(p, 6))}"`,
      `year="${p.year ?? ''}"`,
      `status="${p.status}"`,
      p.tags.length ? `tags="${attr(p.tags.join(', '))}"` : '',
      `topics="${rowTopics({ paper: p, guide: g }).join(', ')}"`,
      isCurrent(g) ? '' : 'in_matrix="false"'
    ]
    return `<paper ${meta.filter(Boolean).join(' ')}>\n${body}\n</paper>`
  })
  return `Sos el asistente de investigación de Thesis Studio, una app de escritorio donde un estudiante de MBA lee papers y escribe su tesis. Ahora mismo el estudiante está en su matriz de literatura (el método de matriz de Garrard): cada paper de su biblioteca en los mismos campos comparables (pregunta, teoría, método, contexto y muestra, hallazgos, limitaciones, relevancia para su tesis). Ayudalo a leer la matriz de manera transversal: encontrar los papers sobre un tema, compararlos, ver patrones, contradicciones y huecos, y decidir qué usar en la tesis.

${thesisBlock(s.settings)}

${RULES(STYLE_LABELS[s.settings.citationStyle])}
- La matriz resume cada paper; no es el texto completo. Citá los papers por autor y año, y con su clave cuando nombres uno: [S3]. Solo citá páginas, así [S3, p. 12], después de leer el paper (ver "read" más abajo). Si algo no está en la matriz, decilo.
- Cada <paper> trae "topics": los temas de la cátedra que cubre (attachment, empathy, tfl, security, ocb), según su guía, las etiquetas del estudiante o el título. Usalos para ver qué tan cubierto está el cruce de sus 2 temas.
- Con cada mensaje llega <matrix_view>: lo que el estudiante está viendo (búsqueda, filtros, orden, las filas en pantalla y las que seleccionó). «Estos papers» / «los que estoy viendo» son las filas en pantalla; «los seleccionados», los que marcó.
- Cuando pida encontrar, filtrar, agrupar o rankear papers por un tema o un criterio ("¿cuáles hablan de…?", "mostrame los de…", "ordenalos por…"), además de responder mostralos en la matriz con "matrix.show", del más al menos pertinente, con una razón corta para cada uno. Incluí solo los que de verdad encajan; si ninguno encaja, decilo y no filtres.

${protocol}

La matriz (${sources.length} papers):
${rows.join('\n') || '(vacía: todavía no importó papers)'}`
}

/** The live view, with each message (both the matrix chat and the general assistant while the matrix is open). */
export function matrixViewContext(s: State, sources: Paper[]): string {
  const key = new Map(sources.map((p, i) => [p.id, `S${i + 1}`]))
  const v = s.matrix
  const all = allRows(s)
  const rows = visibleRows(all, v, s.settings.research.constructs)
  const keys = (ids: string[]) =>
    ids
      .map((id) => key.get(id))
      .filter(Boolean)
      .join(', ')
  const lines = [
    `Filas en pantalla (${rows.length} de ${all.length}, en orden): ${keys(rows.map((r) => r.paper.id)) || 'ninguna'}`,
    v.query.trim() && `Búsqueda: "${attr(v.query.trim())}"`,
    v.topic !== 'all' && `Filtro de tema: ${v.topic === 'pair' ? 'cruce de sus 2 temas' : CONSTRUCTS[v.topic].label}`,
    v.level !== 'all' && `Filtro de relevancia: ${v.level === 'high' ? 'solo alta' : 'alta o media'}`,
    `Orden: ${{ rank: 'tu ranking', relevance: 'relevancia', year: 'año', author: 'autor' }[v.sort]}`,
    v.filter && `Filtro que pusiste vos: "${attr(v.filter.label)}" (${keys(v.filter.ids)})`,
    v.selected.length && `Seleccionados: ${keys(v.selected)}`,
    `Sin fila todavía (sin guía de lectura): ${keys(all.filter((r) => !isCurrent(r.guide)).map((r) => r.paper.id)) || 'ninguno'}`
  ]
  return `\n\n<matrix_view>\n${lines.filter(Boolean).join('\n')}\n</matrix_view>`
}

export const MATRIX_ACTIONS: QuickAction[] = [
  {
    label: 'Filtrar por tema',
    hint: 'Los papers sobre un tema, del más al menos útil',
    prompt: 'Mostrame en la matriz los papers sobre: ',
    prefill: true
  },
  {
    label: 'Patrones y huecos',
    hint: 'Qué se repite, qué choca y qué falta',
    prompt:
      'Leé la matriz de manera transversal: ¿qué patrones y coincidencias ves en las teorías, métodos, contextos y hallazgos? ¿Dónde se contradicen los papers? ¿Qué huecos quedan, sobre todo para mi tesis?'
  },
  {
    label: 'Rankear para mi tesis',
    hint: 'Del más al menos útil, con el porqué',
    prompt: 'Ordená los papers de la matriz según lo útiles que son para mi tesis y mostralos así en la matriz, con el porqué de cada uno.'
  },
  {
    label: 'Comparar métodos',
    hint: 'Diseños, datos y muestras lado a lado',
    prompt:
      'Compará los métodos y las muestras de los papers que estoy viendo: qué diseños predominan, qué tan comparables son sus resultados y qué implica eso para el método de mi tesis.'
  }
]

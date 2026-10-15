import type { Annotation, GuideTerm, Note, Paper, RecallAnswer, Settings } from '@shared/types'
import type { State } from '../store'
import { authorLine, STYLE_LABELS } from '../lib/citation'
import { RULES, thesisBlock, type QuickAction } from '../lib/prompts'
import { fold } from '../lib/util'

// The knowledge wiki: everything the student has saved while reading (highlights,
// comments, notes, the glossary from reading guides, recall answers), gathered
// in one place, searchable, and readable by the assistant.

export type Entry =
  | { kind: 'highlight'; id: string; paperId: string; at: number; a: Annotation }
  | { kind: 'note'; id: string; at: number; note: Note }
  | { kind: 'term'; id: string; paperId: string; at: number; term: GuideTerm }
  | { kind: 'recall'; id: string; paperId: string; at: number; answer: RecallAnswer }

type Sources = Pick<State, 'annotations' | 'notes' | 'guides' | 'recalls' | 'papers'>

export function collectEntries(s: Sources): Entry[] {
  const out: Entry[] = []
  for (const a of Object.values(s.annotations)) if (s.papers[a.paperId]) out.push({ kind: 'highlight', id: a.id, paperId: a.paperId, at: a.updatedAt, a })
  for (const note of Object.values(s.notes)) if (note.title || note.plain.trim()) out.push({ kind: 'note', id: note.id, at: note.updatedAt, note })
  for (const g of Object.values(s.guides)) {
    if (!s.papers[g.id]) continue
    g.terms.forEach((term, i) => out.push({ kind: 'term', id: `${g.id}:${i}`, paperId: g.id, at: g.createdAt, term }))
  }
  for (const r of Object.values(s.recalls)) {
    const last = r.attempts.at(-1)
    if (!last || !s.papers[r.id]) continue
    last.answers.forEach((answer, i) => answer.answer.trim() && out.push({ kind: 'recall', id: `${r.id}:${i}`, paperId: r.id, at: last.at, answer }))
  }
  return out.sort((a, b) => b.at - a.at)
}

/** The text an entry is found by. */
export function entryText(e: Entry, papers: Record<string, Paper>): string {
  const paper = 'paperId' in e ? papers[e.paperId] : undefined
  const src = paper ? `${paper.title} ${authorLine(paper, 6)} ${paper.year ?? ''} ${paper.tags.join(' ')}` : ''
  switch (e.kind) {
    case 'highlight':
      return `${e.a.text} ${e.a.translation ?? ''} ${e.a.comment ?? ''} ${src}`
    case 'note':
      return `${e.note.title} ${e.note.plain}`
    case 'term':
      return `${e.term.term} ${e.term.original ?? ''} ${e.term.definition} ${src}`
    case 'recall':
      return `${e.answer.question} ${e.answer.answer} ${e.answer.feedback} ${src}`
  }
}

/** Every word of the query, anywhere in the entry (case and accent insensitive). */
export function matches(hay: string, query: string): boolean {
  const h = fold(hay)
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => h.includes(w))
}

/** Papers the student has saved something from, most material first. */
export function papersWithKnowledge(entries: Entry[], papers: Record<string, Paper>): { paper: Paper; count: number }[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    if (e.kind === 'note') for (const id of e.note.paperIds) counts.set(id, (counts.get(id) ?? 0) + 1)
    else counts.set(e.paperId, (counts.get(e.paperId) ?? 0) + 1)
  }
  return [...counts]
    .filter(([id]) => papers[id])
    .map(([id, count]) => ({ paper: papers[id], count }))
    .sort((a, b) => b.count - a.count || a.paper.title.localeCompare(b.paper.title))
}

// ---------- assistant ----------

const BUDGET = 320_000

/** Papers the wiki assistant cites as S1, S2…: a stable order, so citation chips resolve. */
export function wikiSources(s: Sources): Paper[] {
  return papersWithKnowledge(collectEntries(s), s.papers)
    .map((x) => x.paper)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function wikiInstructions(s: Sources, sources: Paper[], settings: Settings): string {
  const entries = collectEntries(s)
  const key = new Map(sources.map((p, i) => [p.id, `S${i + 1}`]))
  const per = Math.floor((BUDGET * 0.65) / Math.max(1, sources.length))
  const blocks = sources.map((p) => {
    const g = s.guides[p.id]
    const lines: string[] = []
    if (g?.tldr) lines.push(`TL;DR (de la guía de lectura): ${g.tldr}`)
    const hl = entries
      .filter((e): e is Extract<Entry, { kind: 'highlight' }> => e.kind === 'highlight' && e.paperId === p.id)
      .sort((a, b) => a.a.page - b.a.page)
    if (hl.length)
      lines.push(
        'Resaltados:',
        ...hl.map(({ a }) => `- p. ${a.page}: "${a.text}"${a.translation ? ` (ES: ${a.translation})` : ''}${a.comment ? ` — comentario del estudiante: ${a.comment}` : ''}`)
      )
    const terms = g?.terms ?? []
    if (terms.length) lines.push('Términos clave:', ...terms.map((t) => `- ${t.term}${t.original && t.original !== t.term ? ` (${t.original})` : ''}, p. ${t.page}: ${t.definition}`))
    const recall = s.recalls[p.id]?.attempts.at(-1)
    if (recall)
      lines.push('En las palabras del estudiante (repaso de memoria):', ...recall.answers.filter((a) => a.answer.trim()).map((a) => `- P: ${a.question}\n  R: ${a.answer}`))
    let body = lines.join('\n')
    if (body.length > per) body = `${body.slice(0, per)}\n[… truncado]`
    return `<source id="${key.get(p.id)}" title="${p.title.replace(/"/g, "'")}" authors="${authorLine(p, 6)}" year="${p.year ?? ''}">\n${body || '(todavía no guardó nada)'}\n</source>`
  })
  const notesBudget = BUDGET * 0.35
  let used = 0
  const notes: string[] = []
  for (const e of entries) {
    if (e.kind !== 'note') continue
    const linked = e.note.paperIds.map((id) => key.get(id)).filter(Boolean)
    const block = `<note title="${(e.note.title || 'Sin título').replace(/"/g, "'")}"${linked.length ? ` sources="${linked.join(', ')}"` : ''}>\n${e.note.plain.slice(0, 8000)}\n</note>`
    if (used + block.length > notesBudget) break
    used += block.length
    notes.push(block)
  }
  return `Sos el asistente de investigación de Thesis Studio, una app de escritorio donde un estudiante de MBA lee papers y escribe su tesis. Ahora mismo el estudiante está recorriendo su base de conocimiento: todo lo que guardó mientras leía (resaltados con sus comentarios, notas, términos clave de las guías de lectura y respuestas de repaso en sus propias palabras). Respondé a partir de ese material, ayudalo a encontrar lo que guardó, conectá ideas entre papers y convertí todo eso en texto para la tesis.

${thesisBlock(settings)}

${RULES(STYLE_LABELS[settings.citationStyle])}
- Las fuentes de abajo contienen lo que el estudiante guardó, no los papers completos. Citá los resaltados con su página, así: [S2, p. 14]. Cuando algo no esté en lo que guardó, decilo con claridad.

Material guardado, por paper:
${blocks.join('\n\n') || '(todavía no guardó nada)'}

Las notas del estudiante:
${notes.join('\n\n') || '(todavía no hay notas)'}`
}

export const WIKI_ACTIONS: QuickAction[] = [
  {
    label: 'Temas principales',
    hint: 'Los temas que atraviesan lo que guardaste',
    prompt: 'Organizá todo lo que resalté y anoté en los grandes temas que aparecen, con los pasajes clave de cada uno. Citá las páginas.'
  },
  {
    label: 'Conexiones',
    hint: 'Dónde coinciden y dónde chocan tus papers',
    prompt: '¿Qué conexiones, coincidencias y contradicciones hay entre mis papers, según lo que resalté y anoté? Citá las páginas.'
  },
  {
    label: 'Huecos',
    hint: 'Lo que falta para sostener tu tesis',
    prompt: 'Comparando lo que guardé con mi tesis, ¿qué temas o preguntas están flojos o sin evidencia? Sugerí qué buscar o releer.'
  },
  {
    label: 'Esqueleto del marco teórico',
    hint: 'Secciones e ideas, con tus citas',
    prompt: 'Con lo que resalté y anoté, armá un esqueleto del marco teórico: secciones, ideas clave y qué cita usar en cada una. Citá las páginas.'
  }
]

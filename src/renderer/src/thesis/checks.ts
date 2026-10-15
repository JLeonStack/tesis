import type { Node as PMNode } from '@tiptap/pm/model'
import type { Paper, ResearchSettings, ThesisMeta } from '@shared/types'
import { analyze, countWords } from './analyze'
import { CONSTRUCTS, chosenPair, topicsIn } from '../research/framework'
import { buildThesisModel, isKeywordsPara, runsText } from './model'
import { sectionNode } from './schema'
import { ABSTRACT_LIMIT, KEYWORDS_LABEL, WORD_LIMIT, normalizeHeading } from './template'
import { titleCaseMiss } from './text'
import { blockText, uncitedOf } from './uncited'
import { thesisReferenceIds } from './references'
import { canonicalIds, resolveCite } from './typed'
import { manualReferenceFor, manualReferences } from './citeFix'
import { looksTitleCase, missingReferenceData, shortLabel } from '../lib/citation'

export interface CheckResult {
  id: string
  ok: boolean
  /** 'error' breaks a UCEMA rule; 'warn' is worth a look. */
  severity: 'error' | 'warn'
  title: string
  detail?: string
  /** Where to jump to fix it. */
  pos?: number
  /** Fix happens on the cover / last page rather than in the text. */
  where?: 'cover' | 'auth'
}

const fmt = (n: number) => n.toLocaleString('es-AR')
const NUMBERED = /^(\d+(\.\d+)*[.)]?|[IVXLC]+[.)])\s/
/** About 25 lines of Calibri 11 on Letter: the most the UCEMA advice allows a paragraph. */
const PARAGRAPH_WORDS = 380

/** The UCEMA "Pautas" and template rules, checked live against the document. */
export function thesisChecks(doc: PMNode, meta: ThesisMeta, papers: Record<string, Paper>, research?: ResearchSettings): CheckResult[] {
  const model = buildThesisModel(doc, meta, papers)
  const { outline, footnotes, citedIds, typed, tables, figures, drafts } = analyze(doc)
  const out: CheckResult[] = []
  const w = model.words

  out.push({
    id: 'words',
    ok: w.total <= WORD_LIMIT,
    severity: 'error',
    title: `Extensión: ${fmt(w.total)} de ${fmt(WORD_LIMIT)} palabras`,
    detail: 'Incluye resumen, referencias y notas al pie.'
  })

  const resumen = model.sections.find((s) => s.kind === 'resumen')
  const paras = resumen?.blocks.filter((b) => b.t === 'para') ?? []
  const abstract = paras.filter((b) => b.t === 'para' && !isKeywordsPara(b.runs))
  out.push({
    id: 'abstract',
    ok: w.resumen > 0 && w.resumen <= ABSTRACT_LIMIT && abstract.length <= 1,
    severity: 'error',
    title: w.resumen ? `Resumen: ${fmt(w.resumen)} de ${ABSTRACT_LIMIT} palabras` : 'Falta el resumen',
    detail: abstract.length > 1 ? 'Debe ser un solo párrafo.' : 'Un solo párrafo, sin sangría.',
    pos: sectionPos(doc, 'resumen')
  })

  const kw = paras.find((b) => b.t === 'para' && isKeywordsPara(b.runs))
  const kwText = kw && kw.t === 'para' ? runsText(kw.runs).slice(KEYWORDS_LABEL.length).replace(/^\s*:\s*/, '').trim() : ''
  out.push({
    id: 'keywords',
    ok: !!kwText && !/\.$/.test(kwText),
    severity: 'warn',
    title: kwText ? 'Palabras clave' : 'Faltan las palabras clave',
    detail: /\.$/.test(kwText) ? 'Van sin punto final.' : 'Separadas por comas, en minúscula y sin punto final.',
    pos: sectionPos(doc, 'resumen')
  })

  const coverMissing = [
    !meta.title.trim() && 'título',
    !meta.author.trim() && 'autor',
    !meta.tutor.trim() && 'tutor',
    !meta.tutorDegree.trim() && 'grado del tutor'
  ].filter(Boolean)
  out.push({
    id: 'cover',
    ok: !coverMissing.length,
    severity: 'error',
    title: coverMissing.length ? `Portada incompleta: ${coverMissing.join(', ')}` : 'Portada completa',
    where: 'cover'
  })

  const bodyHeadings = outline.filter((h) => h.section === 'cuerpo' && h.level === 1).map((h) => normalizeHeading(h.text))
  // UCEMA asks for an introduction, a general objective and a conclusion; the conclusion can sit at any level (the workshop's goes inside Desarrollo del Tema).
  const required = ['Introducción', 'Objetivo General'].filter((t) => !bodyHeadings.includes(normalizeHeading(t)))
  if (!outline.some((h) => h.section === 'cuerpo' && normalizeHeading(h.text).startsWith('conclusi'))) required.push('Conclusión')
  out.push({
    id: 'structure',
    ok: !required.length,
    severity: 'warn',
    title: required.length ? `Faltan títulos: ${required.join(', ')}` : 'Introducción, Objetivo General y Conclusión',
    detail: required.length ? 'Más (⋯) → Completar la estructura de la plantilla agrega los que falten.' : undefined
  })

  const placeholder = outline.find((h) => normalizeHeading(h.text) === normalizeHeading('Título del Primer Capítulo'))
  if (placeholder)
    out.push({ id: 'placeholder', ok: false, severity: 'warn', title: 'Cambiá «Título del Primer Capítulo» por tu título', pos: placeholder.pos })

  const numbered = outline.find((h) => NUMBERED.test(h.text))
  out.push({
    id: 'numbered',
    ok: !numbered,
    severity: 'error',
    title: numbered ? `Título numerado: «${numbered.text}»` : 'Títulos sin numerar',
    detail: 'El nivel se indica con el formato, no con números.',
    pos: numbered?.pos
  })

  const emptyHeading = outline.find((h) => !h.text)
  if (emptyHeading) out.push({ id: 'empty-heading', ok: false, severity: 'warn', title: 'Hay un título vacío', pos: emptyHeading.pos })

  const runInNoDot = outline.find((h) => h.level >= 4 && !/[.?!]$/.test(h.text))
  out.push({
    id: 'runin',
    ok: !runInNoDot,
    severity: 'error',
    title: runInNoDot ? `El título de nivel ${runInNoDot.level} «${runInNoDot.text}» debe terminar en punto` : 'Títulos de nivel 4 y 5 con punto final',
    pos: runInNoDot?.pos
  })

  // Levels 1 to 3 never close with a period (UCEMA writing advice).
  const dotted = outline.find((h) => h.level <= 3 && /\.$/.test(h.text) && !/\b(?:etc|et al|s\. f)\.$/i.test(h.text))
  out.push({
    id: 'heading-dot',
    ok: !dotted,
    severity: 'error',
    title: dotted ? `El título «${dotted.text}» no lleva punto final` : 'Títulos de nivel 1 a 3 sin punto final',
    pos: dotted?.pos
  })

  const lowerHeading = outline.map((h) => ({ h, word: h.text ? titleCaseMiss(h.text.replace(/\.$/, '')) : null })).find((x) => x.word)
  out.push({
    id: 'titlecase',
    ok: !lowerHeading,
    severity: 'warn',
    title: lowerHeading ? `Capitalización de título: «${lowerHeading.word}» en «${lowerHeading.h.text}»` : 'Títulos con capitalización de título',
    detail: 'En todos los niveles, las palabras principales van con mayúscula inicial (Capitalizar como título en la barra flotante).',
    pos: lowerHeading?.h.pos
  })

  // More than one appendix: «Apéndice A», «Apéndice B», …
  const appendices = outline.filter((h) => h.section === 'apendices' && h.level === 1)
  if (appendices.length > 1) {
    const bad = appendices.find((h, i) => !h.text.startsWith(`Apéndice ${String.fromCharCode(65 + i)}`))
    out.push({
      id: 'appendices',
      ok: !bad,
      severity: 'warn',
      title: bad ? `Identificá los apéndices con letras: «${bad.text}»` : 'Apéndices identificados con letras',
      detail: 'Con más de un apéndice: Apéndice A, Apéndice B, etc.',
      pos: bad?.pos
    })
  }

  // APA 7 (8.4): every work cited in the text is in the references, and each reference is complete.
  const refIds = thesisReferenceIds({ citedIds, typed }, papers)
  const library = Object.values(papers)
  const canon = canonicalIds(library)
  const unresolved: { raw: string; pos: number }[] = []
  const ambiguous: { raw: string; pos: number }[] = []
  // A work outside the library counts once its reference is written by hand in Referencias.
  const manual = manualReferences(doc)
  for (const c of typed) {
    const r = resolveCite(c, library, canon)
    if (!r.paperId && !manualReferenceFor(manual, c.families[0], c.year)) unresolved.push(c)
    else if (r.ambiguous) ambiguous.push(c)
  }
  const once = (xs: { raw: string }[]) => [...new Set(xs.map((x) => `«${x.raw}»`))]
  out.push({
    id: 'typed-missing',
    ok: !unresolved.length,
    severity: 'error',
    title: unresolved.length
      ? `${once(unresolved).length} cita${once(unresolved).length > 1 ? 's' : ''} sin su referencia`
      : 'Cada cita del texto tiene su referencia',
    detail: unresolved.length
      ? `${once(unresolved).slice(0, 4).join(' · ')}. No coinciden con ningún paper de tu biblioteca (apellido y año): agregá el paper, corregí el autor o el año, insertá la cita con Citar o escribí su referencia en Referencias bibliográficas.`
      : undefined,
    pos: unresolved[0]?.pos
  })
  if (ambiguous.length)
    out.push({
      id: 'typed-ambiguous',
      ok: false,
      severity: 'error',
      title: `Mismo autor y año en obras distintas: ${once(ambiguous).slice(0, 2).join(' · ')}`,
      detail: 'APA pide distinguirlas con letras (2019a, 2019b), en el texto y en Referencias, por orden alfabético del título.',
      pos: ambiguous[0].pos
    })

  const incomplete = refIds.map((id) => papers[id]).flatMap((p) => (p && missingReferenceData(p).length ? [{ p, miss: missingReferenceData(p) }] : []))
  out.push({
    id: 'sources',
    ok: !incomplete.length,
    severity: 'warn',
    title: incomplete.length ? `${incomplete.length} referencia${incomplete.length > 1 ? 's' : ''} incompleta${incomplete.length > 1 ? 's' : ''}` : 'Referencias con todos sus datos',
    detail: incomplete.length
      ? `${incomplete
          .slice(0, 4)
          .map(({ p, miss }) => `${shortLabel(p)}: falta ${miss.join(', ')}`)
          .join(' · ')}. Completalos en la pestaña Cita del paper (con DOI, el botón de Crossref los trae).`
      : undefined
  })

  const titleCase = refIds.map((id) => papers[id]).filter((p) => p && p.type !== 'book' && p.type !== 'report' && looksTitleCase(p.title))
  out.push({
    id: 'sentence-case',
    ok: !titleCase.length,
    severity: 'warn',
    title: titleCase.length
      ? `${titleCase.length} título${titleCase.length > 1 ? 's' : ''} de artículo en Mayúsculas Iniciales`
      : 'Títulos de artículos en tipo oración',
    detail: titleCase.length
      ? `${titleCase
          .slice(0, 3)
          .map((p) => shortLabel(p))
          .join(' · ')}. APA usa tipo oración: mayúscula solo en la primera palabra, después de dos puntos y en nombres propios. En la pestaña Cita del paper, «Tipo oración» lo convierte.`
      : undefined
  })

  const refs = sectionNode(doc, 'referencias')
  let manualRefs = 0
  refs?.forEach((n) => n.type.name === 'paragraph' && n.textContent.trim() && manualRefs++)
  const totalRefs = refIds.length + manualRefs
  out.push({
    id: 'references',
    ok: totalRefs > 0,
    severity: 'warn',
    title: totalRefs ? `${totalRefs} referencia${totalRefs > 1 ? 's' : ''} en la lista` : 'Todavía no hay referencias',
    detail: 'Se arman solas en APA 7 con todo lo que citás, con Citar o escrito a mano como «(Autor, año)».',
    pos: sectionPos(doc, 'referencias')
  })

  // APA 8.12: several works cited together go in one parenthesis, «(A, 2001; B, 2010)», not «(A, 2001) (B, 2010)».
  let doubled: { pos: number; text: string } | undefined
  let doubledCount = 0
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    const text = blockText(node)
    const m = text.match(/(?:\([^()]*\d{4}[a-z]?[^()]*\)|\uE000)\s*(?:\([^()]*\p{Lu}[^()]*,\s*\d{4}[^()]*\)|\uE000)/u)
    if (m) {
      doubledCount++
      doubled ??= { pos: pos + 1 + m.index!, text: text.slice(Math.max(0, m.index! - 30), m.index! + m[0].length).replace(/\uE000/g, '(cita)') }
    }
    return false
  })
  out.push({
    id: 'one-parenthesis',
    ok: !doubled,
    severity: 'error',
    title: doubled ? `${doubledCount} ${doubledCount > 1 ? 'oraciones' : 'oración'} con dos paréntesis de cita seguidos` : 'Citas agrupadas en un solo paréntesis',
    detail: doubled
      ? `«…${doubled.text}». APA junta las fuentes en un solo paréntesis, por orden alfabético y separadas con punto y coma: (Davidovitz et al., 2007; Mayseless, 2010).`
      : undefined,
    pos: doubled?.pos
  })

  // Every idea taken from someone else is cited (the course's writing advice).
  const uncited = uncitedOf(doc)
  out.push({
    id: 'uncited',
    ok: !uncited.length,
    severity: 'warn',
    title: uncited.length ? `${uncited.length} ${uncited.length > 1 ? 'oraciones' : 'oración'} del cuerpo sin cita` : 'Las afirmaciones del cuerpo tienen cita',
    detail: uncited.length ? 'Revisalas en la pestaña Respaldo: buscales una fuente o marcalas «Es mía» si son tu planteo.' : undefined,
    pos: uncited[0]?.from
  })

  // Paragraphs: one idea each, four or five lines, up to 25 in expository text.
  let longPara: { pos: number; words: number } | undefined
  let longCount = 0
  doc.forEach((section, off) => {
    if (section.attrs.kind !== 'cuerpo' && section.attrs.kind !== 'apendices') return
    section.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return true
      const n = countWords(node.textContent)
      if (n > PARAGRAPH_WORDS) {
        longCount++
        longPara ??= { pos: off + 1 + pos, words: n }
      }
      return false
    })
  })
  out.push({
    id: 'paragraphs',
    ok: !longCount,
    severity: 'warn',
    title: longCount ? `${longCount} párrafo${longCount > 1 ? 's' : ''} de más de 25 líneas` : 'Párrafos de extensión adecuada',
    detail: longCount ? `El primero tiene ${longPara!.words} palabras. Cada párrafo, una unidad de información.` : undefined,
    pos: longPara?.pos
  })

  // The course's framework: the body works the two topics chosen.
  if (research) {
    const pair = chosenPair(research)
    let body = ''
    doc.forEach((section) => {
      if (section.attrs.kind === 'cuerpo') body += ` ${section.textContent}`
    })
    if (pair.length !== 2)
      out.push({ id: 'framework', ok: false, severity: 'warn', title: 'Elegí tus 2 temas en el Marco de investigación', detail: 'La cátedra pide cruzar 2 de los 5 temas.' })
    else if (countWords(body) > 300) {
      const found = topicsIn(body)
      const missing = pair.filter((c) => !found.includes(c.id))
      out.push({
        id: 'framework',
        ok: !missing.length,
        severity: 'warn',
        title: missing.length ? `El cuerpo todavía no trata: ${missing.map((c) => CONSTRUCTS[c.id].label).join(', ')}` : `El cuerpo trata tus 2 temas: ${pair.map((c) => c.label).join(' × ')}`,
        detail: 'Marco de la cátedra.'
      })
    }
  }

  // Tables and figures: each one mentioned in the text (APA), numbered in order (automatic here).
  if (tables.length || figures.length) {
    const text = doc.textBetween(0, doc.content.size, '\n', ' ')
    const unmentioned = [...tables.map((t) => ({ ...t, label: 'Tabla' })), ...figures.map((f) => ({ ...f, label: 'Figura' }))].filter(
      (f) => !new RegExp(`\\b${f.label}s?\\s+(\\d+\\s*(y|,|a)\\s*)*${f.n}\\b`, 'i').test(text)
    )
    out.push({
      id: 'floats',
      ok: !unmentioned.length,
      severity: 'warn',
      title: unmentioned.length ? `Sin mencionar en el texto: ${unmentioned.map((f) => `${f.label} ${f.n}`).join(', ')}` : `${tables.length} tabla${tables.length === 1 ? '' : 's'} y ${figures.length} figura${figures.length === 1 ? '' : 's'}, todas mencionadas`,
      detail: 'APA: cada tabla o figura se menciona en el texto antes de aparecer («como muestra la Tabla 1»). Las palabras de las celdas no cuentan en la extensión; el título y la nota sí.',
      pos: unmentioned[0]?.pos
    })
  }

  // Text the assistant drafted: the student has to make it theirs before it goes out (UCEMA 8.e, Turnitin).
  const draftIds = [...new Set(drafts.map((d) => d.logId))]
  out.push({
    id: 'ai-drafts',
    ok: !draftIds.length,
    severity: 'error',
    title: draftIds.length ? `${draftIds.length} borrador${draftIds.length > 1 ? 'es' : ''} de IA sin revisar (${fmt(countWords(drafts.map((d) => d.text).join(' ')))} palabras)` : 'Sin borradores de IA pendientes',
    detail: 'Reescribilo con tus palabras y marcalo como revisado (Pautas UCEMA 8.e; Turnitin detecta texto generado por IA).',
    pos: drafts[0]?.from
  })

  const emptyFn = footnotes.find((f) => !f.text.trim())
  if (emptyFn) out.push({ id: 'footnote', ok: false, severity: 'warn', title: `La nota al pie ${emptyFn.n} está vacía`, pos: emptyFn.pos })

  const pending = Object.values(meta.auth).filter((v) => v === null).length
  out.push({
    id: 'auth',
    ok: !pending && !!meta.dni.trim(),
    severity: 'error',
    title: pending ? `Autorizaciones: faltan ${pending} de 3` : meta.dni.trim() ? 'Autorizaciones completas' : 'Autorizaciones: falta el DNI',
    detail: 'Última página, firmada por el autor.',
    where: 'auth'
  })

  return out
}

function sectionPos(doc: PMNode, kind: string): number | undefined {
  let pos: number | undefined
  doc.forEach((n, off) => {
    if (pos == null && n.attrs.kind === kind) pos = off
  })
  return pos
}

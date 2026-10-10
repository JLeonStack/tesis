import type { Node as PMNode } from '@tiptap/pm/model'
import type { Paper, ThesisMeta } from '@shared/types'
import { analyze } from './analyze'
import { buildThesisModel, isKeywordsPara, runsText } from './model'
import { sectionNode } from './schema'
import { ABSTRACT_LIMIT, KEYWORDS_LABEL, WORD_LIMIT, normalizeHeading } from './template'
import { titleCaseMiss } from './text'

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

/** The UCEMA "Pautas" and template rules, checked live against the document. */
export function thesisChecks(doc: PMNode, meta: ThesisMeta, papers: Record<string, Paper>): CheckResult[] {
  const model = buildThesisModel(doc, meta, papers)
  const { outline, footnotes, citedIds } = analyze(doc)
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
  const required = ['Introducción', 'Objetivo General', 'Conclusión'].filter((t) => !bodyHeadings.includes(normalizeHeading(t)))
  out.push({
    id: 'structure',
    ok: !required.length,
    severity: 'warn',
    title: required.length ? `Faltan títulos de nivel 1: ${required.join(', ')}` : 'Introducción, Objetivo General y Conclusión'
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

  const incomplete = citedIds.map((id) => papers[id]).filter((p) => p && (!p.authors.length || !p.year))
  out.push({
    id: 'sources',
    ok: !incomplete.length,
    severity: 'warn',
    title: incomplete.length ? `${incomplete.length} fuente${incomplete.length > 1 ? 's' : ''} sin autor o año` : 'Fuentes citadas con autor y año',
    detail: incomplete.length ? incomplete.map((p) => p.title).slice(0, 3).join(' · ') : undefined
  })

  const refs = sectionNode(doc, 'referencias')
  let manualRefs = 0
  refs?.forEach((n) => n.type.name === 'paragraph' && n.textContent.trim() && manualRefs++)
  const totalRefs = citedIds.length + manualRefs
  out.push({
    id: 'references',
    ok: totalRefs > 0,
    severity: 'warn',
    title: totalRefs ? `${totalRefs} referencia${totalRefs > 1 ? 's' : ''} en la lista` : 'Todavía no hay referencias',
    detail: 'Las citadas con Citar se formatean solas en APA 7.',
    pos: sectionPos(doc, 'referencias')
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

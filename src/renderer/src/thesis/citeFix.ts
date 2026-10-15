import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { CitedSource } from '../editor/extensions'
import { citeInsertOffset, joinTyped, splitSentences } from './support'
import { typedCitations } from './typed'
import { blockText, supportTransaction } from './uncited'

// The thesis assistant's citation fixes, applied with one click from its
// «Cambios propuestos» card. The assistant names the passage by its own
// words (as it read them in <current_thesis>) and the citation as written;
// only the citation changes, never the student's text (UCEMA 8.e). Live
// citations put the work in «Referencias bibliográficas» by themselves; a work
// that isn't in the library gets its reference as a paragraph there.

/** How an inline atom reads in the text the assistant gets: a citation as its in-text form. */
export type Leaf = (node: PMNode) => string

export interface CiteFix {
  /** Words of the thesis, copied exactly: they hold the citation or end where it goes. */
  context: string
  /** The citation as written, to replace. Empty: the citation is missing and goes at the end of the sentence. */
  wrong?: string
  /** Works of the library, cited live (they reach the references by themselves). */
  sources?: CitedSource[]
  /** The citation as text, for a narrative one («Mayseless (2010, p. 272)») or a work outside the library. */
  text?: string
  why?: string
}

export type CiteFixPlan =
  | { ok: true; kind: 'replace'; from: number; to: number; written: string }
  | { ok: true; kind: 'insert'; from: number; to: number }
  | { ok: false; reason: string }

// ---------- finding the student's words ----------

interface Flat {
  text: string
  /** Document position where each character starts and ends (an atom spans its whole node). */
  from: number[]
  to: number[]
}

function flatten(block: PMNode, start: number, leaf: Leaf): Flat {
  const flat: Flat = { text: '', from: [], to: [] }
  block.forEach((child, off) => {
    const pos = start + off
    const text = child.isText ? child.text! : leaf(child)
    for (let i = 0; i < text.length; i++) {
      flat.text += text[i]
      flat.from.push(child.isText ? pos + i : pos)
      flat.to.push(child.isText ? pos + i + 1 : pos + child.nodeSize)
    }
  })
  return flat
}

function normChar(c: string): string {
  if (/\s/.test(c)) return ' '
  if (/[«»“”„"]/.test(c)) return '"'
  if (/[‘’`]/.test(c)) return "'"
  if (/[‐-―−]/.test(c)) return '-'
  return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Accents, case, quotes, dashes and runs of spaces aside; `idx` maps back to the original. */
function normalized(text: string): { s: string; idx: number[] } {
  let s = ''
  const idx: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = normChar(text[i])
    if (c === ' ' && (!s || s.endsWith(' '))) continue
    for (const ch of c) {
      s += ch
      idx.push(i)
    }
  }
  return { s, idx }
}

const key = (t: string) => normalized(t).s.trim()

interface Block {
  node: PMNode
  start: number
  flat: Flat
  norm: { s: string; idx: number[] }
}

/** Every paragraph and heading of the thesis, outside the references and the table of contents. */
function blocks(doc: PMNode, leaf: Leaf): Block[] {
  const out: Block[] = []
  doc.forEach((section, secPos) => {
    if (section.attrs.kind === 'referencias' || section.attrs.kind === 'toc') return
    section.descendants((node, pos) => {
      if (!node.isTextblock) return true
      const start = secPos + 1 + pos + 1
      const flat = flatten(node, start, leaf)
      out.push({ node, start, flat, norm: normalized(flat.text) })
      return false
    })
  })
  return out
}

function occurrences(hay: string, needle: string): number[] {
  const out: number[] = []
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i)
  return out
}

const range = (b: Block, i: number, len: number) => ({ from: b.flat.from[b.norm.idx[i]], to: b.flat.to[b.norm.idx[i + len - 1]] })

/** Where the thesis says these words, or null. */
export function findInThesis(doc: PMNode, words: string, leaf: Leaf): { from: number; to: number; block: Block } | null {
  const k = key(words)
  if (k.length < 8) return null
  for (const b of blocks(doc, leaf)) {
    const i = b.norm.s.indexOf(k)
    if (i >= 0) return { ...range(b, i, k.length), block: b }
  }
  return null
}

// ---------- only the citation changes ----------

const CONNECTORS = new Set(['y', 'e', 'and', 'et', 'al', 'en', 'citado', 'citada', 'citados', 'cited', 'in', 'p', 'pp', 'parr', 'vease', 'ver', 'cf'])

/** The ordinary words of a passage, without parentheses or names: what a citation fix must leave as it was. */
export function proseWords(s: string): string[] {
  return s
    .replace(/\([^()]*\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && /^\p{Ll}/u.test(w))
    .map((w) => key(w))
    .filter((w) => !CONNECTORS.has(w))
}

const sameProse = (a: string, b: string) => proseWords(a).join(' ') === proseWords(b).join(' ')
const hasYear = (s: string) => /\b(1[89]|20)\d{2}[a-z]?\b|s\.\s?f\.|en prensa/i.test(s)

/** Where and how a fix applies to the thesis as it is now, or why it can't. */
export function planCiteFix(doc: PMNode, fix: CiteFix, leaf: Leaf): CiteFixPlan {
  if (!fix.sources?.length && !fix.text) return { ok: false, reason: 'Falta la cita correcta' }
  if (fix.text && !typedCitations(fix.text).length) return { ok: false, reason: 'La corrección no es una cita APA' }
  const at = findInThesis(doc, fix.context, leaf)
  if (!at) return { ok: false, reason: 'Ese pasaje no está en la tesis' }
  if (!fix.wrong?.trim()) return { ok: true, kind: 'insert', from: at.from, to: at.to }

  // The citation as written, in the same paragraph: the occurrence nearest the passage.
  const b = at.block
  const k = key(fix.wrong)
  const hits = occurrences(b.norm.s, k).map((i) => range(b, i, k.length))
  if (!hits.length) return { ok: false, reason: 'No encontré esa cita en el párrafo' }
  const dist = (r: { from: number; to: number }) => (r.to < at.from ? at.from - r.to : r.from > at.to ? r.from - at.to : 0)
  const hit = hits.sort((x, y) => dist(x) - dist(y))[0]
  const written = doc.textBetween(hit.from, hit.to, ' ', leaf)
  let live = false
  doc.nodesBetween(hit.from, hit.to, (n) => {
    if (n.type.name === 'citation') live = true
  })
  if (!live && !hasYear(written)) return { ok: false, reason: 'Solo se corrigen citas' }
  if (fix.text) {
    if (!sameProse(written, fix.text)) return { ok: false, reason: 'La corrección cambia tu texto, no solo la cita' }
  } else if (!/^\s*\(.*\)\s*$/s.test(written) || proseWords(written).length) {
    // A live citation is parenthetical: «Según Mayseless (2010)» stays narrative, corrected as text.
    return { ok: false, reason: 'Una cita narrativa se corrige como texto' }
  }
  return { ok: true, kind: 'replace', from: hit.from, to: hit.to, written }
}

/**
 * The transaction for a fix, or null when it no longer applies. `part` gives a
 * work's in-text form without parentheses, to join a citation typed by hand.
 */
export function citeFixTransaction(state: EditorState, fix: CiteFix, leaf: Leaf, part: (c: CitedSource) => string): Transaction | null {
  const plan = planCiteFix(state.doc, fix, leaf)
  if (!plan.ok) return null
  const sources = fix.sources ?? []
  if (plan.kind === 'replace') {
    const tr = state.tr
    if (fix.text) return tr.insertText(fix.text.trim(), plan.from, plan.to)
    const [first, ...rest] = sources
    return tr.replaceWith(plan.from, plan.to, state.schema.nodes.citation.create({ paperId: first.paperId, page: first.page ?? null, extra: rest.map((c) => ({ paperId: c.paperId, page: c.page ?? null })) }))
  }
  // Missing: at the end of the sentence the passage ends in, joining the citation already there.
  const tr = state.tr
  let changed = false
  for (const c of sources) {
    const cur = state.apply(tr)
    const step = supportTransaction(cur, { from: plan.from, to: tr.mapping.map(plan.to) }, c, part(c))
    if (!step || step === 'already') continue
    for (const s of step.steps) tr.step(s)
    changed = true
  }
  if (!sources.length && fix.text) {
    const typed = typedTransaction(state, plan.to, fix.text.trim())
    if (typed) return typed
  }
  return changed ? tr : null
}

/** A citation typed as text at the end of the sentence that ends at `to`, inside the parenthesis already there. */
function typedTransaction(state: EditorState, to: number, text: string): Transaction | null {
  const $to = state.doc.resolve(to)
  if (!$to.parent.isTextblock) return null
  const start = $to.start()
  const block = blockText($to.parent)
  const span = splitSentences(block).find((s) => s.end >= to - start && s.start <= to - start - 1)
  if (!span) return null
  const { at, typed } = citeInsertOffset(span.text)
  const inner = text.replace(/^\(|\)$/g, '')
  if (typed) return state.tr.insertText(joinTyped(span.text.slice(typed.start, typed.end), inner), start + span.start + typed.start, start + span.start + typed.end)
  const before = block[span.start + at - 1]
  return state.tr.insertText(`${before && !/\s/.test(before) ? ' ' : ''}(${inner})`, start + span.start + at)
}

// ---------- references outside the library ----------

function referencesSection(doc: PMNode): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.forEach((node, pos) => {
    if (node.attrs.kind === 'referencias') found = { node, pos }
  })
  return found
}

/** The references the student wrote by hand under the generated list. */
export function manualReferences(doc: PMNode): string[] {
  const sec = referencesSection(doc)
  const out: string[] = []
  sec?.node.forEach((n) => {
    if (n.type.name === 'paragraph' && n.textContent.trim()) out.push(n.textContent.trim())
  })
  return out
}

/** A reference written by hand that matches a citation typed in the text (first author and year). */
export function manualReferenceFor(refs: string[], family: string, year: string): string | undefined {
  const fam = key(family)
  const y = year.match(/\d{4}[a-z]?/)?.[0] ?? key(year)
  return refs.find((r) => key(r).startsWith(fam) && key(r).includes(`(${y}`))
}

export const referenceValid = (apa: string) => /\((\d{4}[a-z]?|s\.\s?f\.|en prensa)[^)]*\)/i.test(apa) && /^\p{Lu}/u.test(apa.trim())

/** Adds a reference (with *italics*) to «Referencias bibliográficas», unless it's there already. */
export function referenceTransaction(state: EditorState, apa: string): Transaction | null {
  const sec = referencesSection(state.doc)
  if (!sec || !referenceValid(apa) || manualReferences(state.doc).some((r) => key(r) === key(apa.replace(/\*/g, '')))) return null
  const { schema } = state
  const italic = schema.marks.italic
  const runs = apa
    .trim()
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .map((r) => (r.startsWith('*') && r.endsWith('*') && r.length > 2 ? schema.text(r.slice(1, -1), italic ? [italic.create()] : []) : schema.text(r)))
  const para = schema.nodes.paragraph.create(null, runs)
  // The template leaves an empty paragraph under the list: it takes the first one.
  const last = sec.node.lastChild
  const end = sec.pos + sec.node.nodeSize - 1
  if (last?.type.name === 'paragraph' && !last.content.size) return state.tr.replaceWith(end - last.nodeSize, end, para)
  return state.tr.insert(end, para)
}

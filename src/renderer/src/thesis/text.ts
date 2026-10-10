import type { EditorState } from '@tiptap/pm/state'
import type { Mark, Node as PMNode, Schema } from '@tiptap/pm/model'

// Plain-text views of editor ranges that keep citations and footnotes safe:
// atoms travel as ⟦n⟧ markers and are put back when a suggestion is applied.

export interface RangeText {
  from: number
  to: number
  /** Text with ⟦1⟧, ⟦2⟧… standing for inline atoms (citations, footnotes). */
  text: string
  atoms: PMNode[]
}

export const marker = (n: number) => `⟦${n}⟧`
const MARKER = /⟦(\d+)⟧/g

export function rangeText(state: EditorState, from: number, to: number): RangeText {
  const atoms: PMNode[] = []
  let text = ''
  state.doc.nodesBetween(from, to, (node, pos, _parent, index) => {
    if (node.isText) {
      text += node.text!.slice(Math.max(0, from - pos), Math.max(0, to - pos))
      return false
    }
    if (node.isInline && node.isAtom) {
      atoms.push(node)
      text += marker(atoms.length)
      return false
    }
    // Separate blocks with a newline when a range spans paragraphs.
    if (node.isTextblock && text && index > 0) text += '\n'
    return true
  })
  return { from, to, text, atoms }
}

/** Text nodes (with the given marks) and the original atoms, in the order the markers appear. */
export function rebuild(schema: Schema, text: string, atoms: PMNode[], marks: readonly Mark[]): PMNode[] {
  const out: PMNode[] = []
  const used = new Set<number>()
  let last = 0
  const push = (s: string) => s && out.push(schema.text(s.replace(/\n+/g, ' '), marks))
  for (const m of text.matchAll(MARKER)) {
    push(text.slice(last, m.index))
    const i = Number(m[1]) - 1
    if (atoms[i] && !used.has(i)) {
      out.push(atoms[i])
      used.add(i)
    }
    last = m.index! + m[0].length
  }
  push(text.slice(last))
  // Never drop a citation or footnote the model forgot.
  atoms.forEach((a, i) => !used.has(i) && out.push(a))
  return out
}

export const stripMarkers = (s: string) => s.replace(MARKER, '').replace(/\s{2,}/g, ' ').trim()

/** The paragraph around a range, as context for the model (trimmed around the selection). */
export function contextOf(state: EditorState, from: number, max = 1400): string {
  const $from = state.doc.resolve(from)
  const block = $from.parent
  const text = block.textBetween(0, block.content.size, ' ', ' ')
  if (text.length <= max) return text
  const at = $from.parentOffset
  const start = Math.max(0, at - max / 2)
  return text.slice(start, start + max)
}

/** Section, nearest heading, previous and current paragraph: context for "what next" help. */
export function writingContext(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos)
  if ($pos.depth < 1) return ''
  const section = $pos.node(1)
  const here = $pos.depth >= 2 ? $pos.before(2) : pos
  let heading = ''
  let previous = ''
  section.forEach((child, off) => {
    if ($pos.start(1) + off >= here) return
    if (child.type.name === 'heading') {
      heading = child.textContent
      previous = ''
    } else if (child.isTextblock) previous = child.textContent
  })
  const current = $pos.parent.isTextblock ? $pos.parent.textBetween(0, $pos.parentOffset, ' ', ' ') : ''
  return [
    `Sección: ${section.attrs.kind}${heading ? ` — título «${heading}»` : ''}`,
    previous && `Párrafo anterior:\n"""${previous.slice(-900)}"""`,
    current.trim() ? `Párrafo actual (hasta el cursor):\n"""${current.slice(-900)}"""` : 'El cursor está al comienzo de un párrafo nuevo.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

const WORD = /[\p{L}\p{N}'’-]/u

/** The word touching `pos`, if any. */
export function wordAt(state: EditorState, pos: number): { from: number; to: number; text: string } | null {
  const $pos = state.doc.resolve(pos)
  const block = $pos.parent
  if (!block.isTextblock) return null
  const text = block.textBetween(0, block.content.size, undefined, '￼')
  let s = $pos.parentOffset
  let e = s
  while (s > 0 && WORD.test(text[s - 1])) s--
  while (e < text.length && WORD.test(text[e])) e++
  if (s === e) return null
  const start = $pos.start()
  return { from: start + s, to: start + e, text: text.slice(s, e) }
}

export function countWordsIn(s: string): number {
  return stripMarkers(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** Keeps the case pattern of the word being replaced ("Mejorar" → "Optimizar"). */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase()
  if (/^\p{Lu}/u.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  return replacement
}

// Words that stay lowercase in Spanish title case (unless they start the title).
const MINOR = new Set(
  'a al ante bajo con contra de del desde durante e el en entre hacia hasta la las lo los mediante ni o para por que se según sin so sobre su sus tras u un una unas unos y'.split(' ')
)

/** APA "capitalización de títulos": capitalize every main word. */
export function titleCase(s: string, first = true): string {
  let isFirst = first
  return s.replace(/[\p{L}][\p{L}'’-]*/gu, (w) => {
    const lower = w.toLowerCase()
    const out = isFirst || !MINOR.has(lower) ? (w === w.toUpperCase() && w.length > 1 ? w : lower.charAt(0).toUpperCase() + lower.slice(1)) : lower
    isFirst = false
    return out
  })
}

/** First main word of a heading that should start with a capital (APA title case), if any. */
export function titleCaseMiss(s: string): string | null {
  let first = true
  for (const m of s.matchAll(/([:.?!]\s*)|([\p{L}][\p{L}'’-]*)/gu)) {
    if (m[1]) {
      first = true // after a colon the subtitle starts again with a capital
      continue
    }
    const w = m[2]
    if ((first || !MINOR.has(w.toLowerCase())) && /^\p{Ll}/u.test(w)) return w
    first = false
  }
  return null
}

export type DiffPart = { kind: 'same' | 'del' | 'ins'; text: string }

/** Word-level diff (LCS), good enough for a paragraph. */
export function diffWords(a: string, b: string): DiffPart[] {
  // Punctuation is its own token, so an added comma doesn't mark the whole word.
  const tokens = (s: string) => s.split(/(\s+|[.,;:!?¡¿()«»"“”])/).filter(Boolean)
  const A = tokens(a)
  const B = tokens(b)
  if (A.length * B.length > 250_000) return [{ kind: 'del', text: a }, { kind: 'ins', text: b }]
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1))
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last?.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      push('same', A[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++])
    else push('ins', B[j++])
  }
  while (i < A.length) push('del', A[i++])
  while (j < B.length) push('ins', B[j++])
  return out
}

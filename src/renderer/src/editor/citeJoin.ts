import type { Node as PMNode } from '@tiptap/pm/model'
import { typedCitations } from '../thesis/typed'

export type Near = { kind: 'live'; pos: number; node: PMNode } | { kind: 'typed'; from: number; to: number; text: string }

/**
 * A citation right next to the caret (spaces aside): the live citation node
 * just before or after it, or a parenthesis typed by hand that ends right
 * before it, «… (Mayseless, 2010)|.». APA puts several works in one parenthesis.
 */
export function adjacentCitation(from: number, to: number, doc: PMNode): Near | null {
  const at = doc.resolve(from)
  if (!at.parent.isTextblock) return null
  const sel = doc.nodeAt(from)
  if (to === from + 1 && sel?.type.name === 'citation') return { kind: 'live', pos: from, node: sel }
  const start = at.start()
  const before = doc.textBetween(start, from, '\n', '\uFFFC')
  const spaces = before.length - before.trimEnd().length
  const back = doc.resolve(from - spaces).nodeBefore
  if (back?.type.name === 'citation') return { kind: 'live', pos: from - spaces - back.nodeSize, node: back }
  const after = doc.textBetween(to, at.end(), '\n', '\uFFFC')
  const ahead = after.length - after.trimStart().length
  const next = doc.resolve(to + ahead).nodeAfter
  if (next?.type.name === 'citation') return { kind: 'live', pos: to + ahead, node: next }
  const m = before.trimEnd().match(/\([^()\uFFFC]*\)$/)
  if (m && typedCitations(m[0]).length) {
    const end = from - spaces
    return { kind: 'typed', from: end - m[0].length, to: end, text: m[0] }
  }
  return null
}

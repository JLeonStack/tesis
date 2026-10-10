import type { Node as PMNode } from '@tiptap/pm/model'
import type { SectionKind } from './template'

export interface OutlineEntry {
  pos: number
  level: number // 1–3 block headings, 4–5 run-in headings
  text: string
  section: SectionKind
}

export interface FootnoteEntry {
  pos: number
  n: number
  text: string
  section: SectionKind
}

export interface DocAnalysis {
  outline: OutlineEntry[]
  footnotes: FootnoteEntry[]
  /** Cited paper ids, in order of first appearance. */
  citedIds: string[]
}

const cache = new WeakMap<PMNode, DocAnalysis>()

/** Leading text of a paragraph that carries the run-in heading mark (levels 4–5). */
export function runInOf(para: PMNode): { level: number; text: string } | null {
  let level = 0
  let text = ''
  for (let i = 0; i < para.childCount; i++) {
    const child = para.child(i)
    const mark = child.marks.find((m) => m.type.name === 'runIn')
    if (!mark) break
    level ||= mark.attrs.level
    text += child.text ?? ''
  }
  return level ? { level, text: text.trim() } : null
}

/**
 * One walk over the document gives everything the live chrome needs (TOC,
 * footnote numbers, reference list). Memoized per immutable doc, so every
 * node view can call it on each update for free.
 */
export function analyze(doc: PMNode): DocAnalysis {
  const hit = cache.get(doc)
  if (hit) return hit
  const out: DocAnalysis = { outline: [], footnotes: [], citedIds: [] }
  const cited = new Set<string>()
  let section: SectionKind = 'cuerpo'
  doc.descendants((node, pos) => {
    switch (node.type.name) {
      case 'section':
        section = node.attrs.kind
        return true
      case 'heading':
        out.outline.push({ pos, level: node.attrs.level, text: node.textContent.trim(), section })
        return true
      case 'paragraph': {
        const r = runInOf(node)
        if (r) out.outline.push({ pos, level: r.level, text: r.text, section })
        return true
      }
      case 'footnote':
        out.footnotes.push({ pos, n: out.footnotes.length + 1, text: node.attrs.text ?? '', section })
        return false
      case 'citation':
        if (node.attrs.paperId && !cited.has(node.attrs.paperId)) {
          cited.add(node.attrs.paperId)
          out.citedIds.push(node.attrs.paperId)
        }
        return false
      case 'blockquote':
        if (node.attrs.paperId && !cited.has(node.attrs.paperId)) {
          cited.add(node.attrs.paperId)
          out.citedIds.push(node.attrs.paperId)
        }
        return true
      default:
        return true
    }
  })
  cache.set(doc, out)
  return out
}

export const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

import type { Node as PMNode } from '@tiptap/pm/model'
import type { SectionKind } from './template'
import { typedCitations, type TypedCite } from './typed'

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

export interface FloatEntry {
  pos: number
  n: number
  title: string
  section: SectionKind
}

/** Text marked as an AI draft, by the AI-log entry that produced it. */
export interface DraftEntry {
  logId: string
  from: number
  to: number
  text: string
}

export interface DocAnalysis {
  outline: OutlineEntry[]
  footnotes: FootnoteEntry[]
  tables: FloatEntry[]
  figures: FloatEntry[]
  drafts: DraftEntry[]
  /** Paper ids cited with a live citation, in order of first appearance. */
  citedIds: string[]
  /** Citations typed by hand in APA form, «(Underwood et al., 2016)»; `pos` is their paragraph's. */
  typed: (TypedCite & { pos: number })[]
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
  const out: DocAnalysis = { outline: [], footnotes: [], tables: [], figures: [], drafts: [], citedIds: [], typed: [] }
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
        if (section !== 'referencias' && section !== 'toc') for (const c of typedCitations(node.textContent)) out.typed.push({ ...c, pos })
        return true
      }
      case 'apaTable':
        out.tables.push({ pos, n: out.tables.length + 1, title: node.attrs.title ?? '', section })
        return false
      case 'apaFigure':
        out.figures.push({ pos, n: out.figures.length + 1, title: node.attrs.title ?? '', section })
        return false
      case 'text': {
        const m = node.marks.find((x) => x.type.name === 'aiDraft')
        if (m) {
          const last = out.drafts.at(-1)
          // Adjacent text nodes of the same draft (split by bold, a citation…) are one span.
          if (last && last.logId === m.attrs.logId && pos - last.to <= 2) {
            last.to = pos + node.nodeSize
            last.text += node.text ?? ''
          } else out.drafts.push({ logId: m.attrs.logId ?? '', from: pos, to: pos + node.nodeSize, text: node.text ?? '' })
        }
        return false
      }
      case 'footnote':
        out.footnotes.push({ pos, n: out.footnotes.length + 1, text: node.attrs.text ?? '', section })
        for (const c of typedCitations(node.attrs.text ?? '')) out.typed.push({ ...c, pos })
        return false
      case 'citation':
        for (const id of [node.attrs.paperId, ...(node.attrs.extra ?? []).map((c: { paperId: string }) => c.paperId)]) {
          if (id && !cited.has(id)) {
            cited.add(id)
            out.citedIds.push(id)
          }
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

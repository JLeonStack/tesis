import { getSchema } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Paper, Thesis, ThesisMeta } from '@shared/types'
import { inText } from '../lib/citation'
import { useStore } from '../store'
import { analyze, countWords, runInOf } from './analyze'
import { THESIS_CITE, italicRuns, referenceEntries } from './references'
import { buildThesisExtensions, tocEntries } from './schema'
import { KEYWORDS_LABEL, SECTION_INFO, type SectionKind } from './template'

// A format-neutral view of the thesis. The live word counter, the
// requirements checklist and both exporters (DOCX, PDF) read this, so they
// can never disagree about what the thesis contains.

export type Run =
  | { kind: 'text'; text: string; bold?: boolean; italic?: boolean; underline?: boolean; link?: string }
  | { kind: 'break' }
  | { kind: 'fn'; n: number; text: string }

export type Indent = 'first' | 'none' | 'hanging'

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; runs: Run[]; anchor: string }
  | { t: 'para'; runs: Run[]; indent: Indent; anchor?: string }
  | { t: 'quote'; paras: Run[][] }
  | { t: 'list'; items: ListItem[] }
  | { t: 'pageBreak' }
  | { t: 'toc'; entries: { level: number; text: string; anchor: string }[] }
  | { t: 'refs'; entries: Run[][] }

/** One paragraph of a list; `first` is false for extra paragraphs inside the same item. */
export interface ListItem {
  depth: number
  ordered: boolean
  first: boolean
  marker: string
  runs: Run[]
}

export interface ModelSection {
  kind: SectionKind
  anchor: string
  title?: string
  blocks: Block[]
}

export interface WordCounts {
  total: number
  resumen: number
  footnotes: number
  references: number
  bySection: Partial<Record<SectionKind, number>>
}

export interface ThesisModel {
  meta: ThesisMeta
  sections: ModelSection[]
  footnotes: { n: number; text: string }[]
  words: WordCounts
  /** Paper ids cited in the text. */
  citedIds: string[]
}

let schema: Schema | null = null
export function thesisSchema(): Schema {
  return (schema ??= getSchema(buildThesisExtensions()))
}

export function thesisDoc(t: Thesis): PMNode {
  return thesisSchema().nodeFromJSON(t.content as object)
}

const runsText = (runs: Run[]) => runs.map((r) => (r.kind === 'text' ? r.text : r.kind === 'break' ? '\n' : '')).join('')

export const isKeywordsPara = (runs: Run[]) => runsText(runs).trim().startsWith(KEYWORDS_LABEL)

export function buildThesisModel(doc: PMNode, meta: ThesisMeta, papers: Record<string, Paper> = useStore.getState().papers): ThesisModel {
  const info = analyze(doc)
  const fnByPos = new Map(info.footnotes.map((f) => [f.pos, f]))
  const anchors = new Map<number, string>()
  let headingN = 0
  const anchorFor = (pos: number) => {
    let a = anchors.get(pos)
    if (!a) anchors.set(pos, (a = `h${++headingN}`))
    return a
  }

  const inline = (para: PMNode, base: number): Run[] => {
    const runs: Run[] = []
    para.forEach((child, offset) => {
      const pos = base + 1 + offset
      switch (child.type.name) {
        case 'text': {
          const r: Run = { kind: 'text', text: child.text ?? '' }
          for (const m of child.marks) {
            if (m.type.name === 'bold') r.bold = true
            else if (m.type.name === 'italic') r.italic = true
            else if (m.type.name === 'underline') r.underline = true
            else if (m.type.name === 'link') r.link = m.attrs.href
            else if (m.type.name === 'runIn') {
              r.bold = true
              if (m.attrs.level === 5) r.italic = true
            }
          }
          runs.push(r)
          break
        }
        case 'citation': {
          const p = papers[child.attrs.paperId]
          runs.push({ kind: 'text', text: p ? inText(p, THESIS_CITE.style, child.attrs.page ?? undefined, THESIS_CITE.locale) : '(fuente faltante)' })
          break
        }
        case 'footnote': {
          const f = fnByPos.get(pos)
          runs.push({ kind: 'fn', n: f?.n ?? 0, text: child.attrs.text ?? '' })
          break
        }
        case 'hardBreak':
          runs.push({ kind: 'break' })
          break
      }
    })
    return runs
  }

  const listItems = (list: PMNode, base: number, depth: number, out: ListItem[]) => {
    const ordered = list.type.name === 'orderedList'
    let n = list.attrs.start ?? 1
    list.forEach((item, off) => {
      const itemPos = base + 1 + off
      let first = true
      item.forEach((c, off2) => {
        const cPos = itemPos + 1 + off2
        if (c.type.name === 'bulletList' || c.type.name === 'orderedList') listItems(c, cPos, depth + 1, out)
        else if (c.isTextblock) {
          out.push({ depth, ordered, first, marker: first ? (ordered ? `${n}.` : '•') : '', runs: inline(c, cPos) })
          first = false
        }
      })
      n++
    })
  }

  const sections: ModelSection[] = []
  const bySection: WordCounts['bySection'] = {}
  let resumenWords = 0
  let referenceWords = 0

  doc.forEach((sec, secOffset) => {
    const kind = sec.attrs.kind as SectionKind
    const blocks: Block[] = []
    let words = 0
    let paraIndex = 0
    const indentFor = (): Indent => {
      if (kind === 'dedicatoria' || kind === 'agradecimientos') return 'none'
      if (kind === 'referencias') return 'hanging'
      if (kind === 'resumen' && paraIndex === 0) return 'none'
      return 'first'
    }

    sec.forEach((node, off) => {
      const pos = secOffset + 1 + off
      switch (node.type.name) {
        case 'heading': {
          const runs = inline(node, pos)
          words += countWords(runsText(runs))
          blocks.push({ t: 'heading', level: Math.min(3, node.attrs.level) as 1 | 2 | 3, runs, anchor: anchorFor(pos) })
          break
        }
        case 'paragraph': {
          const runs = inline(node, pos)
          const text = runsText(runs)
          if (!text.trim() && !runs.some((r) => r.kind === 'fn')) return
          const n = countWords(text)
          words += n
          if (kind === 'resumen' && !isKeywordsPara(runs)) resumenWords += n
          if (kind === 'referencias') referenceWords += n
          blocks.push({ t: 'para', runs, indent: indentFor(), anchor: runInOf(node) ? anchorFor(pos) : undefined })
          paraIndex++
          break
        }
        case 'blockquote': {
          const paras: Run[][] = []
          node.forEach((c, off2) => {
            if (c.isTextblock) paras.push(inline(c, pos + 1 + off2))
          })
          words += paras.reduce((a, r) => a + countWords(runsText(r)), 0)
          if (paras.some((r) => runsText(r).trim())) blocks.push({ t: 'quote', paras })
          break
        }
        case 'bulletList':
        case 'orderedList': {
          const items: ListItem[] = []
          listItems(node, pos, 0, items)
          words += items.reduce((a, i) => a + countWords(runsText(i.runs)), 0)
          blocks.push({ t: 'list', items })
          break
        }
        case 'pageBreak':
          blocks.push({ t: 'pageBreak' })
          break
        case 'tocBlock':
          blocks.push({ t: 'toc', entries: [] }) // filled once all anchors exist
          break
        case 'referenceList': {
          const entries = referenceEntries(info.citedIds, papers).map((e) => italicRuns(e.text).map((r) => ({ kind: 'text' as const, ...r })))
          const n = entries.reduce((a, e) => a + countWords(runsText(e)), 0)
          words += n
          referenceWords += n
          blocks.push({ t: 'refs', entries })
          break
        }
      }
    })

    // Optional sections only exist once they have content.
    const hasContent = blocks.some((b) => b.t !== 'pageBreak')
    if (SECTION_INFO[kind].optional && !hasContent) return
    if (kind === 'referencias') mergeManualReferences(blocks)
    bySection[kind] = words
    sections.push({ kind, anchor: `sec-${kind}`, title: SECTION_INFO[kind].title, blocks })
  })

  // Table of contents, now that headings have anchors.
  const secAnchor = new Map<number, string>()
  doc.forEach((sec, off) => secAnchor.set(off, `sec-${sec.attrs.kind}`))
  const toc = tocEntries(doc).map((e) => ({
    level: e.level,
    text: e.text,
    anchor: e.pos == null ? '' : secAnchor.get(e.pos) ?? anchors.get(e.pos) ?? ''
  }))
  for (const s of sections) for (const b of s.blocks) if (b.t === 'toc') b.entries = toc

  const footnotes = info.footnotes.map((f) => ({ n: f.n, text: f.text }))
  const footnoteWords = footnotes.reduce((a, f) => a + countWords(f.text), 0)
  const total = Object.entries(bySection).reduce((a, [k, n]) => a + (k === 'toc' ? 0 : n ?? 0), 0) + footnoteWords

  return {
    meta,
    sections,
    footnotes,
    citedIds: info.citedIds,
    words: { total, resumen: resumenWords, footnotes: footnoteWords, references: referenceWords, bySection }
  }
}

/** Manual reference paragraphs join the generated ones, all in alphabetical order. */
function mergeManualReferences(blocks: Block[]): void {
  const refs = blocks.find((b): b is Extract<Block, { t: 'refs' }> => b.t === 'refs')
  if (!refs) return
  const manual = blocks.filter((b): b is Extract<Block, { t: 'para' }> => b.t === 'para')
  refs.entries = [...refs.entries, ...manual.map((m) => m.runs)].sort((a, b) =>
    runsText(a).localeCompare(runsText(b), 'es', { sensitivity: 'base' })
  )
  for (const m of manual) blocks.splice(blocks.indexOf(m), 1)
}

export { runsText }

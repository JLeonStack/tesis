import type { Paper } from '@shared/types'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useStore } from '../store'
import { formatReference, inTextGroup, plainRef } from '../lib/citation'
import type { CitedSource } from '../editor/extensions'
import type { DocAnalysis } from './analyze'
import { referenceIds } from './typed'

/** The thesis always cites in APA 7, Spanish conventions ("y", "s. f."). */
export const THESIS_CITE = { style: 'apa', locale: 'es' } as const

export interface ReferenceEntry {
  paperId: string
  /** Reference text with *asterisks* marking italics. */
  text: string
}

/** Everything the thesis cites, live or typed by hand: one id per work (duplicates in the library make one reference). */
export const thesisReferenceIds = (info: Pick<DocAnalysis, 'citedIds' | 'typed'>, papers: Record<string, Paper> = useStore.getState().papers) =>
  referenceIds(info.citedIds, info.typed, papers)

/** How the thesis reads as text (for the assistant): live citations as «(Bass, 1985; …)», other atoms as a space. */
export function thesisLeaf(node: PMNode): string {
  if (node.type.name !== 'citation') return ' '
  const papers = useStore.getState().papers
  const items = [{ paperId: node.attrs.paperId as string, page: node.attrs.page as number | null }, ...((node.attrs.extra ?? []) as CitedSource[])].flatMap((c) =>
    papers[c.paperId] ? [{ paper: papers[c.paperId], page: c.page }] : []
  )
  return items.length ? inTextGroup(items, THESIS_CITE.style, THESIS_CITE.locale) : '(fuente faltante)'
}

/** The thesis as plain text, citations included, the way the assistant reads it. */
export const thesisPlainText = (doc: PMNode) => doc.textBetween(0, doc.content.size, '\n', thesisLeaf)

export function referenceEntries(ids: string[], papers: Record<string, Paper> = useStore.getState().papers): ReferenceEntry[] {
  return ids
    .map((id) => papers[id])
    .filter(Boolean)
    .map((p) => ({ paperId: p.id, text: formatReference(p, THESIS_CITE.style, THESIS_CITE.locale) }))
    .sort((a, b) => plainRef(a.text).localeCompare(plainRef(b.text), 'es'))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Escapes text and turns *asterisks* into <i>. */
export const italicHtml = (s: string) => esc(s).replace(/\*([^*]+)\*/g, '<i>$1</i>')

export { esc as escapeHtml }

/** Splits "*italic* text" into runs. */
export function italicRuns(s: string): { text: string; italic?: boolean }[] {
  const out: { text: string; italic?: boolean }[] = []
  const re = /\*([^*]+)\*/g
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) })
    out.push({ text: m[1], italic: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

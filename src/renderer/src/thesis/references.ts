import type { Paper } from '@shared/types'
import { useStore } from '../store'
import { formatReference, plainRef } from '../lib/citation'

/** The thesis always cites in APA 7, Spanish conventions ("y", "s. f."). */
export const THESIS_CITE = { style: 'apa', locale: 'es' } as const

export interface ReferenceEntry {
  paperId: string
  /** Reference text with *asterisks* marking italics. */
  text: string
}

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

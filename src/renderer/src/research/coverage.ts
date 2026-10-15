import type { ConstructId, Paper, PaperGuide, ResearchSettings } from '@shared/types'
import { CONSTRUCT_ORDER, topicsIn } from './framework'

// Which of the five course topics each paper covers, so the matrix can filter
// by topic and the research tab can show how well the chosen pair is backed.

/** The student's tags win; then the reading guide's; then a keyword match on title and abstract. */
export function paperConstructs(paper: Paper, guide?: PaperGuide): ConstructId[] {
  if (paper.constructsManual || paper.constructs?.length) return order(paper.constructs ?? [])
  if (guide?.constructs?.length) return order(guide.constructs)
  return topicsIn(`${paper.title} ${paper.abstract ?? ''} ${guide?.tldr ?? ''}`)
}

const order = (ids: ConstructId[]) => CONSTRUCT_ORDER.filter((id) => ids.includes(id))

/** Below this many papers crossing both topics, the literature review is thin. */
export const MIN_CROSS = 5

export interface Coverage {
  by: Record<ConstructId, number>
  /** Papers that cover both chosen topics. */
  cross: number
  total: number
}

export function coverage(papers: Paper[], guides: Record<string, PaperGuide>, r: ResearchSettings): Coverage {
  const by = Object.fromEntries(CONSTRUCT_ORDER.map((id) => [id, 0])) as Record<ConstructId, number>
  let cross = 0
  for (const p of papers) {
    const ids = paperConstructs(p, guides[p.id])
    for (const id of ids) by[id]++
    if (r.constructs.length === 2 && r.constructs.every((id) => ids.includes(id))) cross++
  }
  return { by, cross, total: papers.length }
}

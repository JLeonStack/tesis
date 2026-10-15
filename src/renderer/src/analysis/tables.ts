import type { ApaTable } from '../thesis/tables'
import { correlationTable, descriptivesTable, groupTable, moderationTable, regressionTable, relationshipsTable, reliabilityTable, sampleTable } from './apa'
import { currentResults } from './use'

// The analysis tables by name, for the assistant's "analysis.insert" action.

export const ANALYSIS_TABLES = ['sample', 'reliability', 'descriptives', 'correlations', 'relationships', 'groups', 'regression', 'moderation'] as const
export type AnalysisTableId = (typeof ANALYSIS_TABLES)[number]

export function analysisTable(id: AnalysisTableId): ApaTable | null {
  const res = currentResults()
  if (!res) return null
  switch (id) {
    case 'sample':
      return res.sample.continuous.length || res.sample.categorical.length ? sampleTable(res.sample, res.n) : null
    case 'reliability':
      return res.reliability.length ? reliabilityTable(res.reliability) : null
    case 'descriptives':
      return res.descriptives.length ? descriptivesTable(res.descriptives, res.n) : null
    case 'correlations':
      return res.correlations ? correlationTable(res.correlations, res.descriptives) : null
    case 'relationships':
      return res.relationships && res.correlations ? relationshipsTable(res.relationships, res.correlations.correction) : null
    case 'groups':
      return res.groups.length ? groupTable(res.groups) : null
    case 'regression':
      return res.regressions[0] ? regressionTable(res.regressions[0], res.regressions.length) : null
    case 'moderation':
      return res.regressions[0] ? moderationTable(res.regressions[0]) : null
  }
}

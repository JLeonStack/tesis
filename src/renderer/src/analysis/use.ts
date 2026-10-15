import { useMemo } from 'react'
import { useStore, type State } from '../store'
import { runAnalysis, type Results } from './results'
import { resultsText } from './apa'

// The analysis is recomputed only when the data or the choices behind it change.

let cache: { deps: unknown[]; res: Results | null } | null = null

export function currentResults(s: Pick<State, 'datasets' | 'settings'> = useStore.getState()): Results | null {
  const { analysis, research } = s.settings
  const data = analysis.datasetId ? s.datasets[analysis.datasetId] : undefined
  const deps = [data, research.constructs.join(), research.demographics.join(), analysis]
  if (cache && cache.deps.every((d, i) => d === deps[i])) return cache.res
  let res: Results | null = null
  try {
    res = data ? runAnalysis(data, research, analysis) : null
  } catch (e) {
    console.error('analysis failed', e)
  }
  cache = { deps, res }
  return res
}

export function useResults(): Results | null {
  const datasets = useStore((s) => s.datasets)
  const settings = useStore((s) => s.settings)
  return useMemo(() => currentResults({ datasets, settings }), [datasets, settings])
}

/** For the assistants: the computed numbers, or what's missing. */
export function analysisContext(s: Pick<State, 'datasets' | 'settings'> = useStore.getState()): string {
  const res = currentResults(s)
  if (!res) return '<analysis>Todavía no importó la base de datos de la cátedra en «Análisis de datos»: no hay resultados calculados. No inventes estadísticos.</analysis>'
  return `<analysis>\nResultados calculados por la app con la base de la cátedra (son los únicos números que podés citar):\n${resultsText(res)}\n</analysis>`
}

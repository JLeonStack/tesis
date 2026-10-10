import { useSyncExternalStore } from 'react'
import type { Annotation } from '@shared/types'
import { saveAnnotation, useStore } from '../store'
import { canTranslate, looksSpanish, translateQuote } from './quoteTranslate'

// Highlights carry their Spanish translation, like quotes in notes: made once
// (batched with any other quotes translating at the same time), stored on the
// highlight, and reused by the Highlights panel, the popover and notes.

const inflight = new Map<string, Promise<string>>()
const failed = new Set<string>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Not Spanish already, and not translated yet. */
export const wantsTranslation = (a: Annotation) => !a.translation && !looksSpanish(a.text)

/** The highlight's Spanish translation, translating and storing it if needed. Null when there's nothing to do. */
export function translateHighlight(id: string): Promise<string> | null {
  const a = useStore.getState().annotations[id]
  if (!a) return null
  if (a.translation) return Promise.resolve(a.translation)
  if (looksSpanish(a.text) || !canTranslate()) return null
  let p = inflight.get(id)
  if (p) return p
  p = translateQuote(a.text).then((t) => {
    const cur = useStore.getState().annotations[id]
    if (cur && !cur.translation && cur.text === a.text) saveAnnotation({ ...cur, translation: t })
    return t
  })
  inflight.set(id, p)
  failed.delete(id)
  notify()
  p.then(
    () => {
      inflight.delete(id)
      notify()
    },
    () => {
      inflight.delete(id)
      failed.add(id)
      notify()
    }
  )
  return p
}

/** Keeps every highlight translated: new ones as they're made, older ones once an account is connected. */
export function startHighlightTranslation(): () => void {
  const run = () => {
    const s = useStore.getState()
    if (!s.account?.connected) return
    for (const a of Object.values(s.annotations))
      if (wantsTranslation(a) && !inflight.has(a.id) && !failed.has(a.id)) translateHighlight(a.id)?.catch(() => {})
  }
  run()
  return useStore.subscribe((s, prev) => {
    if (s.annotations !== prev.annotations || s.account !== prev.account) run()
  })
}

/** Retries highlights whose translation failed (the panel's "Reintentar"). */
export function retryHighlightTranslation(id: string): void {
  failed.delete(id)
  translateHighlight(id)?.catch(() => {})
}

/** Whether a highlight's translation is on its way, failed, or neither. */
export function useTranslationState(id: string): 'pending' | 'failed' | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => (inflight.has(id) ? 'pending' : failed.has(id) ? 'failed' : null)
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Thesis } from '@shared/types'
import { currentThesis, useStore } from '../store'
import { thesisDoc } from './model'

// Lets panels and exporters read the live thesis document, whether or not its
// editor is mounted (unmounted → parse the saved JSON).

const editors = new Map<string, Editor>()
const listeners = new Set<() => void>()

export function registerThesisEditor(id: string, editor: Editor): () => void {
  editors.set(id, editor)
  const notify = () => listeners.forEach((l) => l())
  editor.on('update', notify)
  notify()
  return () => {
    editor.off('update', notify)
    if (editors.get(id) === editor) editors.delete(id)
    notify()
  }
}

export function thesisEditor(id: string): Editor | undefined {
  const ed = editors.get(id)
  return ed && !ed.isDestroyed ? ed : undefined
}

export function liveThesis(id?: string): { thesis: Thesis; doc: PMNode } | null {
  const thesis = id ? useStore.getState().theses[id] : currentThesis()
  if (!thesis) return null
  const ed = thesisEditor(thesis.id)
  return { thesis, doc: ed ? ed.state.doc : thesisDoc(thesis) }
}

/** Live document + meta for a panel, refreshed (throttled) as the user types. */
export function useLiveThesis(id: string): { thesis: Thesis; doc: PMNode } | null {
  const thesis = useStore((s) => s.theses[id])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      clearTimeout(t)
      t = setTimeout(() => setTick((n) => n + 1), 300)
    }
    listeners.add(bump)
    return () => {
      clearTimeout(t)
      listeners.delete(bump)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (thesis ? liveThesis(id) : null), [thesis, tick, id])
}

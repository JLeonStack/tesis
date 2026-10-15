import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Thesis, ThesisMeta } from '@shared/types'
import { currentThesis, openThesis, useStore } from '../store'
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

// The cover's fields live in the open editor's state until saved: restoring a version sets them there.
const metaHandles = new Map<string, { get: () => ThesisMeta; set: (m: ThesisMeta) => void }>()

export function registerThesisMeta(id: string, handle: { get: () => ThesisMeta; set: (m: ThesisMeta) => void }): () => void {
  metaHandles.set(id, handle)
  return () => {
    if (metaHandles.get(id) === handle) metaHandles.delete(id)
  }
}

export function thesisMetaHandle(id: string) {
  return metaHandles.get(id)
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

/**
 * Runs `edit` on the thesis editor, opening the thesis first if needed. Inserts
 * go where the caret was; in an editor that just opened, or when the caret is
 * somewhere the content can't go (the cover, say), at the end of the body.
 * Resolves whether `edit` succeeded (it returns its command's result).
 */
export async function withThesisEditor(edit: (editor: Editor, fresh: boolean) => boolean | void): Promise<boolean> {
  const t = openThesis()
  let ed = thesisEditor(t.id)
  const fresh = !ed
  for (let i = 0; !ed && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50))
    ed = thesisEditor(t.id)
  }
  if (!ed) return false
  const editor = ed
  // End of the body section, where results and discussion go.
  const toBodyEnd = () => {
    let end: number | null = null
    editor.state.doc.forEach((sec, off) => {
      if (sec.attrs.kind === 'cuerpo') end = off + sec.nodeSize - 1
    })
    if (end != null) editor.commands.setTextSelection(end)
  }
  if (fresh) toBodyEnd()
  let ok = edit(editor, fresh) !== false
  if (!ok && !fresh) {
    toBodyEnd()
    ok = edit(editor, true) !== false
  }
  if (ok) editor.commands.scrollIntoView()
  return ok
}

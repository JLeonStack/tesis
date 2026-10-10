import type { Editor, JSONContent } from '@tiptap/react'
import { generateText } from '@tiptap/core'
import { buildExtensions } from './extensions'
import { canTranslate, looksSpanish, translateQuote } from '../lib/quoteTranslate'
import { translateHighlight } from '../lib/highlightTranslate'
import { debounce, uid } from '../lib/util'
import { activeTab, createNote, notesForPaper, openTab, paperNoteInit, saveNote, toast, useStore } from '../store'

// Lets the reader and assistant push content into notes, whether or not the
// note's editor is currently mounted.

const editors = new Map<string, Editor>()
const pending = new Map<string, JSONContent[]>()
let lastFocused: string | null = null

export function registerEditor(noteId: string, editor: Editor): () => void {
  editors.set(noteId, editor)
  const onFocus = () => (lastFocused = noteId)
  editor.on('focus', onFocus)
  const queued = pending.get(noteId)
  if (queued) {
    pending.delete(noteId)
    queueMicrotask(() => appendContent(editor, queued))
  }
  return () => {
    editor.off('focus', onFocus)
    if (editors.get(noteId) === editor) editors.delete(noteId)
  }
}

function appendContent(editor: Editor, content: JSONContent[]): void {
  const end = editor.state.doc.content.size
  // Replace a trailing empty paragraph instead of leaving a gap.
  const last = editor.state.doc.lastChild
  const from = last && last.type.name === 'paragraph' && last.content.size === 0 ? end - last.nodeSize : end
  editor
    .chain()
    .insertContentAt({ from, to: end }, [...content, { type: 'paragraph' }])
    .focus('end')
    .scrollIntoView()
    .run()
}

export function getEditor(noteId: string): Editor | undefined {
  return editors.get(noteId)
}

/** The editor the user most recently typed in, if still mounted. */
export function focusedEditor(): { id: string; editor: Editor } | null {
  if (lastFocused && editors.has(lastFocused)) return { id: lastFocused, editor: editors.get(lastFocused)! }
  return null
}

function linkPaper(noteId: string, paperId?: string): void {
  if (!paperId) return
  const n = useStore.getState().notes[noteId]
  if (n && !n.paperIds.includes(paperId)) saveNote({ ...n, paperIds: [...n.paperIds, paperId], updatedAt: Date.now() })
}

/**
 * Picks the note content should go to: the open side note, the active note
 * tab, the paper's most recent note, or a new note for the paper.
 */
export function targetNote(paperId?: string): string {
  const s = useStore.getState()
  const tab = activeTab()
  if (tab?.kind === 'note') return tab.id
  if (s.sideNoteId && s.notes[s.sideNoteId]) return s.sideNoteId
  if (paperId) {
    const existing = notesForPaper(paperId)[0]
    if (existing) return existing.id
    return createNote(paperNoteInit(paperId), { side: tab?.kind === 'paper' }).id
  }
  return createNote({}, { side: tab?.kind === 'paper' }).id
}

/** The paper's own note: the open one if it's about this paper, else its latest, else a new one. */
export function paperNote(paperId: string): string {
  const s = useStore.getState()
  const tab = activeTab()
  for (const id of [tab?.kind === 'note' ? tab.id : null, s.sideNoteId]) if (id && s.notes[id]?.paperIds.includes(paperId)) return id
  return notesForPaper(paperId)[0]?.id ?? createNote(paperNoteInit(paperId), { side: tab?.kind === 'paper' }).id
}

export function insertIntoNote(noteId: string, content: JSONContent[], paperId?: string): void {
  linkPaper(noteId, paperId)
  const editor = editors.get(noteId)
  if (editor && !editor.isDestroyed) appendContent(editor, content)
  else {
    pending.set(noteId, [...(pending.get(noteId) ?? []), ...content])
    const tab = activeTab()
    if (tab?.kind === 'paper') useStore.setState({ sideNoteId: noteId })
    else openTab({ kind: 'note', id: noteId })
  }
  const s = useStore.getState()
  const visible = s.sideNoteId === noteId || s.active === `note:${noteId}`
  const title = s.notes[noteId]?.title || 'Untitled note'
  toast(
    `Added to “${title.length > 40 ? `${title.slice(0, 40)}…` : title}”`,
    visible ? undefined : { label: 'Open', run: () => openTab({ kind: 'note', id: noteId }) }
  )
}

type QuoteState = { translation: string } | { translating: true } | null

/**
 * A quote from a paper. Translated quotes read in Spanish first (with the
 * citation) and keep the original wording right below.
 */
export function quoteContent(
  paperId: string,
  page: number,
  text: string,
  annotationId?: string,
  translation?: string,
  quoteId?: string
): JSONContent[] {
  return [quoteNode(paperId, page, text, annotationId ?? null, quoteId ?? null, translation ? { translation } : null)]
}

function quoteNode(paperId: string, page: number, text: string, annotationId: string | null, quoteId: string | null, state: QuoteState): JSONContent {
  const cite = { type: 'citation', attrs: { paperId, page } }
  const original = `“${text}”`
  const content: JSONContent[] = !state
    ? [{ type: 'paragraph', content: [{ type: 'text', text: `${original} ` }, cite] }]
    : [
        {
          type: 'paragraph',
          content:
            'translation' in state
              ? [{ type: 'text', text: `«${state.translation}» ` }, cite]
              : [{ type: 'text', text: 'Traduciendo al español… ', marks: [{ type: 'italic' }] }, cite]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Original: ', marks: [{ type: 'bold' }] },
            { type: 'text', text: original, marks: [{ type: 'italic' }] }
          ]
        }
      ]
  return { type: 'blockquote', attrs: { paperId, page, annotationId, quoteId }, content }
}

/**
 * Quote content for a note. A quote that isn't in Spanish goes in right away
 * with a placeholder and starts translating; call `bind` with the note it
 * landed in so the translation can fill it in.
 */
export function autoQuote(paperId: string, page: number, text: string, annotationId?: string): { content: JSONContent[]; bind: (noteId: string) => void } {
  // A highlight already translated (or translating) is reused, never translated twice.
  const known = annotationId ? useStore.getState().annotations[annotationId]?.translation : undefined
  if (known) return { content: quoteContent(paperId, page, text, annotationId, known), bind: () => {} }
  if (looksSpanish(text) || !canTranslate()) return { content: quoteContent(paperId, page, text, annotationId), bind: () => {} }
  const quoteId = uid()
  const translation = (annotationId && translateHighlight(annotationId)) || translateQuote(text)
  return {
    content: [quoteNode(paperId, page, text, annotationId ?? null, quoteId, { translating: true })],
    bind: (noteId) =>
      void translation.then(
        (t) => fillQuote(noteId, quoteId, quoteNode(paperId, page, text, annotationId ?? null, quoteId, { translation: t })),
        () => {
          // Keep the quote usable without its translation.
          fillQuote(noteId, quoteId, quoteNode(paperId, page, text, annotationId ?? null, quoteId, null))
          translationFailed()
        }
      )
  }
}

const translationFailed = debounce(() => toast('Couldn’t translate the quote; the original is in your note', undefined, { status: 'error' }), 500)

/** Swaps a quote for its finished version, wherever the note is: open, about to open, or saved. */
function fillQuote(noteId: string, quoteId: string, next: JSONContent): void {
  const editor = editors.get(noteId)
  if (editor && !editor.isDestroyed) {
    let at = -1
    let size = 0
    editor.state.doc.descendants((node, pos) => {
      if (at >= 0) return false
      if (node.type.name === 'blockquote' && node.attrs.quoteId === quoteId) {
        at = pos
        size = node.nodeSize
        return false
      }
    })
    if (at < 0) return // the quote was deleted meanwhile
    const tr = editor.state.tr.replaceWith(at, at + size, editor.schema.nodeFromJSON(next)).setMeta('addToHistory', false)
    editor.view.dispatch(tr)
    return
  }
  const queued = pending.get(noteId)
  if (queued && replaceQuote(queued, quoteId, next)) return
  const note = useStore.getState().notes[noteId]
  const doc = note?.content as JSONContent | null
  if (!note || !doc?.content || !replaceQuote(doc.content, quoteId, next)) return
  const content = { ...doc, content: [...doc.content] }
  saveNote({ ...note, content, plain: generateText(content, buildExtensions(''), { blockSeparator: '\n' }), updatedAt: Date.now() })
}

function replaceQuote(nodes: JSONContent[], quoteId: string, next: JSONContent): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type === 'blockquote' && nodes[i].attrs?.quoteId === quoteId) {
      nodes[i] = next
      return true
    }
    if (nodes[i].content && replaceQuote(nodes[i].content!, quoteId, next)) return true
  }
  return false
}

export function addQuoteToNote(paperId: string, page: number, text: string, annotationId?: string, translation?: string): void {
  const noteId = targetNote(paperId)
  if (translation) return insertIntoNote(noteId, quoteContent(paperId, page, text, annotationId, translation), paperId)
  const quote = autoQuote(paperId, page, text, annotationId)
  insertIntoNote(noteId, quote.content, paperId)
  quote.bind(noteId)
}

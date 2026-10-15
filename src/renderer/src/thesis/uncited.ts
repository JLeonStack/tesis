import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { CitedSource } from '../editor/extensions'
import { ATOM_CHAR, CITE_CHAR, NOTE_CHAR, citeInsertOffset, joinTyped, sentenceAt, sentenceKey, splitSentences, uncitedIn, type Span } from './support'

// Citation check in the thesis editor: which claims of the body carry no
// citation (underlined on demand, counted in the toolbar, the Respaldo tab and
// Requisitos), the sentence being backed (tinted while its search runs), and
// the one-click insert of a citation at the end of that sentence.

/** A sentence (or selection) of the thesis, in document positions. */
export interface SentenceRange {
  from: number
  to: number
  /** Plain text, without citations or footnote marks. */
  text: string
}

const leaf = (n: PMNode) => (n.type.name === 'citation' ? CITE_CHAR : n.type.name === 'footnote' ? NOTE_CHAR : ATOM_CHAR)
/** A block's text with one char per inline atom, so offsets are positions. */
export const blockText = (block: PMNode): string => block.textBetween(0, block.content.size, undefined, leaf)
export const cleanText = (s: string): string =>
  s
    .replace(new RegExp(`[${CITE_CHAR}${NOTE_CHAR}${ATOM_CHAR}]`, 'g'), '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

// ---------- the student's own sentences ----------

const IGNORE_KEY = 'thesis-uncited-ignore'
const ENABLED_KEY = 'thesis-uncited-enabled'

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
function store(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // ignore
  }
}

const ignored = new Set<string>(typeof localStorage === 'undefined' ? [] : load<string[]>(IGNORE_KEY, []))

// ---------- uncited claims ----------

const perBlock = new WeakMap<PMNode, Span[]>()

function blockUncited(block: PMNode): Span[] {
  let hit = perBlock.get(block)
  if (!hit) perBlock.set(block, (hit = uncitedIn(blockText(block))))
  return hit
}

let ignoredVersion = 0
const perDoc = new WeakMap<PMNode, { v: number; out: SentenceRange[] }>()

/** Claims of the body without a citation, minus the ones marked as the student's own. */
export function uncitedOf(doc: PMNode): SentenceRange[] {
  const hit = perDoc.get(doc)
  if (hit?.v === ignoredVersion) return hit.out
  const out: SentenceRange[] = []
  doc.forEach((section, secPos) => {
    if (section.attrs.kind !== 'cuerpo') return
    section.descendants((node, pos) => {
      if (node.type.name === 'heading') return false
      // A quote taken from a paper is cited by its source.
      if (node.type.name === 'blockquote' && node.attrs.paperId) return false
      if (!node.isTextblock) return true
      const start = secPos + 1 + pos + 1
      for (const s of blockUncited(node)) if (!ignored.has(sentenceKey(s.text))) out.push({ from: start + s.start, to: start + s.end, text: cleanText(s.text) })
      return false
    })
  })
  perDoc.set(doc, { v: ignoredVersion, out })
  return out
}

interface CheckState {
  enabled: boolean
  uncited: SentenceRange[]
  /** The sentence the Respaldo tab is backing (kept mapped through edits even while the tab is hidden). */
  target: { from: number; to: number } | null
  /** Tint it in the text: only while the tab shows it. */
  showTarget: boolean
  decos: DecorationSet
}

export const uncitedKey = new PluginKey<CheckState>('thesisUncited')

function build(doc: PMNode, enabled: boolean, target: CheckState['target'], showTarget: boolean, uncited = uncitedOf(doc)): CheckState {
  const decos: Decoration[] = []
  if (enabled) for (const u of uncited) decos.push(Decoration.inline(u.from, u.to, { class: 'uncited', nodeName: 'span' }, { uncited: u }))
  if (target && showTarget) decos.push(Decoration.inline(target.from, target.to, { class: 'support-target', nodeName: 'span' }))
  return { enabled, uncited, target, showTarget, decos: DecorationSet.create(doc, decos) }
}

export const uncitedSentences = (state: EditorState): SentenceRange[] => uncitedKey.getState(state)?.uncited ?? []
export const uncitedEnabled = (state: EditorState): boolean => uncitedKey.getState(state)?.enabled ?? false
export const supportTarget = (state: EditorState) => uncitedKey.getState(state)?.target ?? null

/** Window event asking the writing toolbar to show the card for an uncited sentence that was clicked. */
export const UNCITED_EVENT = 'thesis:uncited'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citationCheck: {
      toggleUncitedMarks: () => ReturnType
      /** The student says the sentence is their own idea: stop flagging it. */
      markAsOwn: (text: string) => ReturnType
      setSupportTarget: (range: { from: number; to: number } | null) => ReturnType
      /** Tint (or stop tinting) the sentence being backed, keeping track of it. */
      showSupportTarget: (show: boolean) => ReturnType
    }
  }
}

export const CitationCheck = Extension.create({
  name: 'citationCheck',

  addCommands() {
    return {
      toggleUncitedMarks:
        () =>
        ({ state, tr, dispatch }) => {
          const next = !uncitedEnabled(state)
          store(ENABLED_KEY, next)
          dispatch?.(tr.setMeta(uncitedKey, { enabled: next }))
          return true
        },
      markAsOwn:
        (text) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true
          ignored.add(sentenceKey(text))
          ignoredVersion++
          store(IGNORE_KEY, [...ignored])
          dispatch(tr.setMeta(uncitedKey, { refresh: true }))
          return true
        },
      setSupportTarget:
        (range) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(uncitedKey, { target: range, show: true }).setMeta('addToHistory', false))
          return true
        },
      showSupportTarget:
        (show) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(uncitedKey, { show }).setMeta('addToHistory', false))
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<CheckState>({
        key: uncitedKey,
        state: {
          init: (_c, state) => build(state.doc, load(ENABLED_KEY, false), null, false),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(uncitedKey) as { enabled?: boolean; refresh?: boolean; target?: CheckState['target']; show?: boolean } | undefined
            let target = prev.target
            if (tr.docChanged && target) {
              const from = tr.mapping.map(target.from, 1)
              const to = tr.mapping.map(target.to, -1)
              target = to > from ? { from, to } : null
            }
            if (meta && 'target' in meta) target = meta.target ?? null
            const enabled = meta?.enabled ?? prev.enabled
            if (!meta && !tr.docChanged) return prev
            return build(state.doc, enabled, target, meta?.show ?? prev.showTarget, tr.docChanged || meta?.refresh ? undefined : prev.uncited)
          }
        },
        props: {
          decorations: (state) => uncitedKey.getState(state)?.decos,
          handleClick(view, pos, event) {
            if (!uncitedEnabled(view.state)) return false
            const hit = uncitedSentences(view.state).find((u) => pos >= u.from && pos <= u.to)
            if (!hit) return false
            const target = (event.target as HTMLElement).closest('.uncited') ?? (event.target as HTMLElement)
            window.dispatchEvent(new CustomEvent(UNCITED_EVENT, { detail: { range: hit, rect: target.getBoundingClientRect() } }))
            return false
          }
        }
      })
    ]
  }
})

// ---------- the claim at the caret ----------

export interface ClaimRange extends SentenceRange {
  /** Where the citation goes: the whole sentence(s) around the claim. */
  sentence: { from: number; to: number }
  /** The paragraph, for context. */
  context: string
  /** Papers the sentence already cites. */
  citedIds: string[]
}

/**
 * The claim to back: the selection when there is one (inside a paragraph),
 * else the sentence at the caret. Its citation goes at the end of the
 * sentence where the selection ends.
 */
export function claimAt(state: EditorState, from = state.selection.from, to = state.selection.to): ClaimRange | null {
  const $from = state.doc.resolve(from)
  const block = $from.parent
  if (!block.isTextblock || block.type.name === 'heading' || $from.depth < 1) return null
  const kind = $from.node(1).attrs.kind
  if (kind === 'toc' || kind === 'referencias') return null
  const start = $from.start()
  const text = blockText(block)
  const end = Math.min(to, $from.end())
  const first = sentenceAt(text, from - start)
  const last = sentenceAt(text, end - start)
  if (!first || !last) return null
  const sentence = { from: start + first.start, to: start + Math.max(first.end, last.end) }
  const selected = to > from ? cleanText(text.slice(from - start, end - start)) : ''
  const claim = selected.length >= 12 ? selected : cleanText(text.slice(sentence.from - start, sentence.to - start))
  if (claim.split(/\s+/).length < 3) return null
  return {
    from: to > from && selected.length >= 12 ? from : sentence.from,
    to: to > from && selected.length >= 12 ? end : sentence.to,
    text: claim,
    sentence,
    context: cleanText(text).slice(0, 1400),
    citedIds: citedIn(state.doc, sentence.from, sentence.to)
  }
}

/** Paper ids cited between two positions. */
export function citedIn(doc: PMNode, from: number, to: number): string[] {
  const ids: string[] = []
  doc.nodesBetween(from, to, (n) => {
    if (n.type.name !== 'citation') return true
    for (const id of [n.attrs.paperId, ...((n.attrs.extra ?? []) as CitedSource[]).map((c) => c.paperId)]) if (id && !ids.includes(id)) ids.push(id)
    return false
  })
  return ids
}

/**
 * Cites a paper at the end of a sentence, before its final period
 * («… seguridad (Popper y Mayseless, 2003).»), or adds it to the citation
 * already there. One undo step. 'already' when the sentence cites it.
 */
export function insertSupport(editor: Editor, sentence: { from: number; to: number }, cite: CitedSource, typedPart?: string): boolean | 'already' {
  const tr = supportTransaction(editor.state, sentence, cite, typedPart)
  if (!tr || tr === 'already') return tr === 'already' ? 'already' : false
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * The transaction behind `insertSupport`: null when the sentence isn't there
 * anymore. `typedPart` («Davidovitz et al., 2007») joins a citation typed by
 * hand at the end of the sentence, so the sentence keeps one parenthesis.
 */
export function supportTransaction(state: EditorState, sentence: { from: number; to: number }, cite: CitedSource, typedPart?: string): Transaction | 'already' | null {
  if (sentence.to > state.doc.content.size) return null
  const $from = state.doc.resolve(sentence.from)
  if (!$from.parent.isTextblock || sentence.to > $from.end()) return null
  if (citedIn(state.doc, sentence.from, sentence.to).includes(cite.paperId)) return 'already'
  const start = $from.start()
  const text = blockText($from.parent)
  // The range may have shrunk or grown with edits: re-read the sentence that ends there.
  const span = splitSentences(text).find((s) => s.end >= sentence.to - start && s.start <= sentence.to - start - 1)
  const sFrom = span ? start + span.start : sentence.from
  const sText = span ? span.text : text.slice(sentence.from - start, sentence.to - start)
  const { at, existing, typed } = citeInsertOffset(sText)
  const attrs = { paperId: cite.paperId, page: cite.page ?? null }
  const tr = state.tr
  if (typed && typedPart) {
    const group = sText.slice(typed.start, typed.end)
    return tr.insertText(joinTyped(group, typedPart), sFrom + typed.start, sFrom + typed.end)
  }
  if (existing != null) {
    const pos = sFrom + existing
    const node = state.doc.nodeAt(pos)
    if (node?.type.name !== 'citation') return null
    return tr.setNodeMarkup(pos, undefined, { ...node.attrs, extra: [...((node.attrs.extra ?? []) as CitedSource[]), attrs] })
  }
  const pos = sFrom + at
  const before = text[pos - start - 1]
  const nodes = [state.schema.nodes.citation.create(attrs)]
  if (before && !/\s/.test(before)) nodes.unshift(state.schema.text(' '))
  return tr.insert(pos, nodes)
}

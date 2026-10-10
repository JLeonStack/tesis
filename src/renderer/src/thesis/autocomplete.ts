import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { aiModel, useStore } from '../store'
import { KEYWORDS_LABEL, SECTION_INFO, type SectionKind } from './template'
import { stripMarkers } from './text'

// Inline continuation ("ghost text") for when the writing stalls: after a short
// pause at the end of a paragraph, a faint suggestion finishes the sentence the
// student started. Tab accepts it, ⌥→ takes one word, Esc or typing on dismisses.
// It only extends an idea already on the page (UCEMA: AI must not replace the
// student's analysis), so it never starts a paragraph from nothing.

interface Ghost {
  pos: number
  text: string
}
interface AcState {
  enabled: boolean
  ghost: Ghost | null
  /** Waiting for a suggestion at this position. */
  loading: number | null
  /** Counts the user's own edits; accepting a suggestion doesn't trigger another one. */
  edits: number
}
type AcMeta = { enabled?: boolean; ghost?: Ghost | null; loading?: number | null }

export const autocompleteKey = new PluginKey<AcState>('thesisAutocomplete')
export const autocompleteEnabled = (state: EditorState) => autocompleteKey.getState(state)?.enabled ?? false

const ENABLED_KEY = 'thesis-autocomplete'
const PAUSE_MS = 900
const MIN_WORDS = 3
const SKIP_SECTIONS = new Set(['toc', 'referencias'])

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

const INSTRUCTIONS = `Ayudás a un estudiante de la Maestría en Dirección de Empresas (Universidad del CEMA) a destrabarse mientras redacta su trabajo final en español académico.
Tu tarea: sugerir la continuación inmediata del texto, justo donde está el cursor.
Reglas:
- Si la oración está incompleta, terminala (máximo 15 palabras) siguiendo la idea que el estudiante ya empezó.
- Si la oración ya terminó, sugerí solo el comienzo de la siguiente (máximo 6 palabras), por ejemplo un conector y el sujeto, para que el estudiante la complete.
- No agregues datos, cifras, nombres propios, fuentes, citas, ejemplos ni conclusiones que no estén en el texto.
- Mismo registro: formal, impersonal cuando corresponda, sin voseo. Ortografía de la RAE.
- No repitas lo ya escrito. Sin comillas ni marcadores.
- Si no hay una continuación natural y segura, devolvé "text" vacío.
Respondé solo con el JSON pedido.`

const SCHEMA = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }

interface Target {
  pos: number
  prefix: string
  previous: string
  heading: string
  section: SectionKind
}

/** Where a suggestion makes sense: a caret at the end of a body paragraph with some text in it. */
function targetAt(state: EditorState): Target | null {
  const { selection } = state
  if (!selection.empty) return null
  const $pos = selection.$from
  const para = $pos.parent
  if (para.type.name !== 'paragraph' || $pos.depth < 2) return null
  const section = $pos.node(1).attrs.kind as SectionKind
  if (SKIP_SECTIONS.has(section)) return null
  for (let d = $pos.depth - 1; d > 1; d--) if ($pos.node(d).type.name === 'blockquote') return null // quotes are the source's words
  const text = para.textBetween(0, para.content.size, undefined, '⟦·⟧')
  const before = text.slice(0, $pos.parentOffset)
  if (text.slice($pos.parentOffset).trim()) return null // only at the end of the paragraph
  if (before.trim().startsWith(KEYWORDS_LABEL)) return null
  if (stripMarkers(before).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < MIN_WORDS) return null

  // Context: the previous paragraph and the nearest heading above.
  const sectionNode = $pos.node(1)
  const start = $pos.before(2)
  let previous = ''
  let heading = SECTION_INFO[section]?.title ?? SECTION_INFO[section]?.label ?? ''
  sectionNode.forEach((child, off) => {
    const at = $pos.start(1) + off
    if (at >= start) return
    if (child.type.name === 'heading') {
      heading = child.textContent
      previous = ''
    } else if (child.isTextblock) previous = child.textContent
  })
  return { pos: selection.from, prefix: before.slice(-1200), previous: previous.slice(-700), heading, section }
}

function prompt(t: Target): string {
  const prev = t.previous ? `Párrafo anterior:\n"""${t.previous}"""\n\n` : ''
  return `Sección: ${SECTION_INFO[t.section]?.label ?? t.section}${t.heading ? ` — «${t.heading}»` : ''}\n\n${prev}Párrafo actual, hasta el cursor (continuá desde el final):\n"""${t.prefix}"""`
}

/** Joins the suggestion to what's before the caret: exactly one space between words. */
function fitToPrefix(prefix: string, raw: string): string {
  let s = stripMarkers(raw).replace(/^["'«»“”]+|["'«»“”]+$/g, '').replace(/\s+/g, ' ')
  const tail = prefix.trim().split(/\s+/).slice(-6).join(' ')
  // Models sometimes echo the last words; drop the overlap.
  for (let n = Math.min(tail.length, s.length); n > 3; n--) {
    if (s.toLowerCase().startsWith(tail.slice(-n).toLowerCase())) {
      s = s.slice(n)
      break
    }
  }
  s = s.trimStart()
  if (!s) return ''
  const endsWithSpace = /\s$/.test(prefix)
  const startsWithPunct = /^[,.;:!?)…]/.test(s)
  if (!endsWithSpace && !startsWithPunct) s = ` ${s}`
  // A new sentence starts with a capital.
  if (/[.!?…]\s*$/.test(prefix)) s = s.replace(/^(\s*)(\p{Ll})/u, (_, sp: string, c: string) => sp + c.toUpperCase())
  return s
}

async function fetchSuggestion(t: Target): Promise<string> {
  const r = (await window.api.ai.assist({
    instructions: INSTRUCTIONS,
    prompt: prompt(t),
    schema: SCHEMA,
    model: aiModel().id,
    channel: 'complete',
    effort: 'none'
  })) as { text?: string }
  return fitToPrefix(t.prefix, r.text ?? '')
}

function ghostWidget(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'thesis-ghost'
  span.textContent = text
  span.setAttribute('aria-hidden', 'true')
  const key = document.createElement('kbd')
  key.className = 'thesis-ghost-key'
  key.textContent = 'Tab'
  span.appendChild(key)
  return span
}

function loadingWidget(): HTMLElement {
  const span = document.createElement('span')
  span.className = 'thesis-ghost-loading'
  span.setAttribute('aria-hidden', 'true')
  return span
}

const set = (tr: Transaction, meta: AcMeta) => tr.setMeta(autocompleteKey, meta)

function accept(view: EditorView, part: 'all' | 'word'): boolean {
  const ghost = autocompleteKey.getState(view.state)?.ghost
  if (!ghost || view.state.selection.from !== ghost.pos) return false
  const text = part === 'all' ? ghost.text : (ghost.text.match(/^\s*\S+/)?.[0] ?? ghost.text)
  const rest = ghost.text.slice(text.length)
  const tr = view.state.tr.insertText(text, ghost.pos)
  set(tr, { ghost: rest.trim() ? { pos: ghost.pos + text.length, text: rest } : null, loading: null })
  view.dispatch(tr.scrollIntoView())
  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    thesisAutocomplete: {
      toggleAutocomplete: () => ReturnType
      /** Ask for a continuation now instead of waiting for the pause. */
      suggestContinuation: () => ReturnType
    }
  }
}

const SUGGEST_EVENT = 'thesis:suggest-now'

export const Autocomplete = Extension.create({
  name: 'thesisAutocomplete',
  // Before lists (Tab = indent) and the rest, but only while a suggestion is showing.
  priority: 1000,

  addCommands() {
    return {
      toggleAutocomplete:
        () =>
        ({ state, tr, dispatch }) => {
          const next = !autocompleteEnabled(state)
          try {
            localStorage.setItem(ENABLED_KEY, next ? '1' : '0')
          } catch {
            // Private storage: the choice lasts for this session.
          }
          dispatch?.(set(tr, { enabled: next, ghost: null, loading: null }))
          return true
        },
      suggestContinuation: () => () => {
        window.dispatchEvent(new CustomEvent(SUGGEST_EVENT))
        return true
      }
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => accept(editor.view, 'all'),
      'Alt-ArrowRight': ({ editor }) => accept(editor.view, 'word'),
      Escape: ({ editor }) => {
        const st = autocompleteKey.getState(editor.state)
        if (!st?.ghost && st?.loading == null) return false
        editor.view.dispatch(set(editor.state.tr, { ghost: null, loading: null }))
        return true
      },
      'Alt-Enter': ({ editor }) => editor.commands.suggestContinuation()
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<AcState>({
        key: autocompleteKey,
        state: {
          init: () => ({ enabled: readEnabled(), ghost: null, loading: null, edits: 0 }),
          apply(tr, prev) {
            const meta = tr.getMeta(autocompleteKey) as AcMeta | undefined
            let next = prev
            if (tr.docChanged && !meta) next = { ...next, edits: next.edits + 1 }
            if (tr.docChanged || tr.selectionSet) {
              // Anything else the user does makes the suggestion stale.
              if (!meta || !('ghost' in meta)) next = { ...next, ghost: null, loading: null }
            }
            if (meta) next = { ...next, ...meta }
            return next
          }
        },
        props: {
          decorations(state) {
            const st = autocompleteKey.getState(state)
            if (!st?.enabled) return null
            if (st.ghost) return DecorationSet.create(state.doc, [Decoration.widget(st.ghost.pos, () => ghostWidget(st.ghost!.text), { side: 1, key: `g${st.ghost.pos}:${st.ghost.text}` })])
            if (st.loading != null) return DecorationSet.create(state.doc, [Decoration.widget(st.loading, loadingWidget, { side: 1, key: 'loading' })])
            return null
          },
          // Typing the same letters as the suggestion keeps the rest of it.
          handleTextInput(view, from, to, text) {
            const ghost = autocompleteKey.getState(view.state)?.ghost
            if (!ghost || from !== to || from !== ghost.pos || !ghost.text.startsWith(text)) return false
            const rest = ghost.text.slice(text.length)
            const tr = view.state.tr.insertText(text, from)
            view.dispatch(set(tr, { ghost: rest ? { pos: from + text.length, text: rest } : null, loading: null }))
            return true
          }
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined
          let seq = 0

          const request = async (force: boolean) => {
            const st = autocompleteKey.getState(view.state)
            if (!st?.enabled || (!force && !view.hasFocus())) return
            if (!useStore.getState().account?.connected) return
            const target = targetAt(view.state)
            if (!target) return
            const id = ++seq
            const doc = view.state.doc
            view.dispatch(set(view.state.tr, { loading: target.pos }))
            try {
              const text = await fetchSuggestion(target)
              // Only if nothing moved while we waited.
              if (id !== seq || view.isDestroyed || view.state.doc !== doc || view.state.selection.from !== target.pos) return
              view.dispatch(set(view.state.tr, { ghost: text.trim() ? { pos: target.pos, text } : null, loading: null }))
            } catch {
              if (id === seq && !view.isDestroyed && autocompleteKey.getState(view.state)?.loading != null) view.dispatch(set(view.state.tr, { loading: null }))
            }
          }

          const onSuggestNow = () => {
            clearTimeout(timer)
            void request(true)
          }
          window.addEventListener(SUGGEST_EVENT, onSuggestNow)

          return {
            update(v, prevState) {
              const st = autocompleteKey.getState(v.state)
              const typed = st && st.edits !== autocompleteKey.getState(prevState)?.edits
              if (v.state.doc !== prevState.doc) clearTimeout(timer)
              if (!typed || !st.enabled) return
              seq++ // drop answers for the old text
              timer = setTimeout(() => void request(false), PAUSE_MS)
            },
            destroy() {
              clearTimeout(timer)
              window.removeEventListener(SUGGEST_EVENT, onSuggestNow)
            }
          }
        }
      })
    ]
  }
})

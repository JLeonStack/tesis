import { Node, mergeAttributes } from '@tiptap/core'
import Blockquote from '@tiptap/extension-blockquote'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { jumpTo, toast, useStore } from '../store'
import { adjacentCitation } from './citeJoin'
import { joinTyped } from '../thesis/support'
import { inTextGroup, type CiteLocale } from '../lib/citation'
import type { CitationStyle } from '@shared/types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      /** Cites one or more sources; next to a citation (live or typed by hand) it joins that parenthesis. */
      insertCitation: (attrs: { paperId: string; page?: number | null; extra?: CitedSource[] }) => ReturnType
    }
  }
}

export interface CitationOptions {
  /** Fixed style (the thesis is always APA); omitted = follow the user's setting. */
  style: CitationStyle | null
  locale: CiteLocale
}

/** More sources cited in the same parenthesis (APA: «(Bass, 1985; Popper y Mayseless, 2003)»). */
export interface CitedSource {
  paperId: string
  page?: number | null
}

function citationText(paperId: string, page: number | null | undefined, o: CitationOptions, extra: CitedSource[] = []): string {
  const s = useStore.getState()
  const items = [{ paperId, page }, ...extra].flatMap((c) => (s.papers[c.paperId] ? [{ paper: s.papers[c.paperId], page: c.page }] : []))
  return items.length ? inTextGroup(items, o.style ?? s.settings.citationStyle, o.locale) : '(fuente faltante)'
}

const dedupe = (list: CitedSource[]) => list.filter((c, i) => c.paperId && list.findIndex((d) => d.paperId === c.paperId) === i)

/**
 * Inline, atomic citation. Stores only the paper id and page; the visible
 * text is derived live, so it follows metadata edits and style changes.
 */
export const Citation = Node.create<CitationOptions>({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { style: null, locale: 'en' }
  },

  addAttributes() {
    return {
      paperId: { default: null, parseHTML: (el) => el.getAttribute('data-paper-id'), renderHTML: (a) => ({ 'data-paper-id': a.paperId }) },
      page: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-page') ? Number(el.getAttribute('data-page')) : null),
        renderHTML: (a) => (a.page ? { 'data-page': a.page } : {})
      },
      extra: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-extra') || '[]') as CitedSource[]
          } catch {
            return []
          }
        },
        renderHTML: (a) => (a.extra?.length ? { 'data-extra': JSON.stringify(a.extra) } : {})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '' }), citationText(node.attrs.paperId, node.attrs.page, this.options, node.attrs.extra)]
  },

  renderText({ node }) {
    return citationText(node.attrs.paperId, node.attrs.page, this.options, node.attrs.extra)
  },

  addNodeView() {
    const options = this.options
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'cite'
      dom.contentEditable = 'false'
      const { paperId, page } = node.attrs
      const extra: CitedSource[] = node.attrs.extra ?? []
      const ids = [paperId, ...extra.map((c) => c.paperId)]
      const paint = () => {
        dom.textContent = citationText(paperId, page, options, extra)
        const papers = useStore.getState().papers
        const p = papers[paperId]
        const more = extra.map((c) => papers[c.paperId]?.title).filter(Boolean)
        dom.title = p
          ? `${[p.title + (page ? ` — página ${page}` : ''), ...more].join('\n')}\nClic para abrir${more.length ? ' la primera' : ''}`
          : 'La fuente no está en la biblioteca'
      }
      paint()
      const unsub = useStore.subscribe((s, prev) => {
        if (ids.some((id) => s.papers[id] !== prev.papers[id]) || s.settings.citationStyle !== prev.settings.citationStyle) paint()
      })
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        if (useStore.getState().papers[paperId]) jumpTo(paperId, page ?? 1)
      })
      return { dom, destroy: unsub }
    }
  },

  addCommands() {
    return {
      insertCitation:
        ({ paperId, page = null, extra = [] }) =>
        ({ state, tr, dispatch, commands }) => {
          const sources = dedupe([{ paperId, page }, ...extra])
          const near = adjacentCitation(state.selection.from, state.selection.to, state.doc)
          if (near?.kind === 'live') {
            const n = near.node
            const had: CitedSource[] = [{ paperId: n.attrs.paperId, page: n.attrs.page }, ...((n.attrs.extra ?? []) as CitedSource[])]
            const added = sources.filter((c) => !had.some((h) => h.paperId === c.paperId))
            if (!added.length) {
              toast('Esa cita ya incluye esta fuente.')
              return false
            }
            if (dispatch) tr.setNodeMarkup(near.pos, undefined, { ...n.attrs, extra: [...had.slice(1), ...added] })
            return true
          }
          if (near?.kind === 'typed') {
            const parts = sources.map((c) => citationText(c.paperId, c.page, this.options).slice(1, -1)).filter((x) => !near.text.includes(x))
            if (!parts.length) {
              toast('Esa cita ya incluye esta fuente.')
              return false
            }
            if (dispatch) tr.insertText(parts.reduce((group, part) => joinTyped(group, part), near.text), near.from, near.to)
            return true
          }
          const [first, ...rest] = sources
          return commands.insertContent([{ type: this.name, attrs: { paperId: first.paperId, page: first.page, extra: rest } }, { type: 'text', text: ' ' }])
        }
    }
  }
})

/** Blockquote that remembers which paper/page/highlight it came from. */
export const SourceQuote = Blockquote.extend({
  addAttributes() {
    return {
      paperId: { default: null, parseHTML: (el) => el.getAttribute('data-paper-id'), renderHTML: (a) => (a.paperId ? { 'data-paper-id': a.paperId } : {}) },
      page: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-page') ? Number(el.getAttribute('data-page')) : null),
        renderHTML: (a) => (a.page ? { 'data-page': a.page } : {})
      },
      annotationId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-annotation-id'),
        renderHTML: (a) => (a.annotationId ? { 'data-annotation-id': a.annotationId } : {})
      },
      // Lets a translation that arrives later find its quote.
      quoteId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-quote-id'),
        renderHTML: (a) => (a.quoteId ? { 'data-quote-id': a.quoteId } : {})
      }
    }
  }
})

export function buildExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      blockquote: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', target: '_blank' } }
    }),
    SourceQuote,
    Citation,
    Highlight.configure({ multicolor: false }),
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    CharacterCount,
    Placeholder.configure({
      placeholder: ({ node, pos }) =>
        node.type.name === 'heading' ? 'Título' : pos === 0 ? placeholder : ''
    })
  ]
}

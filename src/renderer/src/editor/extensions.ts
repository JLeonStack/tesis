import { Node, mergeAttributes } from '@tiptap/core'
import Blockquote from '@tiptap/extension-blockquote'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { jumpTo, useStore } from '../store'
import { inText, type CiteLocale } from '../lib/citation'
import type { CitationStyle } from '@shared/types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: { paperId: string; page?: number | null }) => ReturnType
    }
  }
}

export interface CitationOptions {
  /** Fixed style (the thesis is always APA); omitted = follow the user's setting. */
  style: CitationStyle | null
  locale: CiteLocale
}

function citationText(paperId: string, page: number | null | undefined, o: CitationOptions): string {
  const s = useStore.getState()
  const p = s.papers[paperId]
  return p ? inText(p, o.style ?? s.settings.citationStyle, page ?? undefined, o.locale) : '(missing source)'
}

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
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '' }), citationText(node.attrs.paperId, node.attrs.page, this.options)]
  },

  renderText({ node }) {
    return citationText(node.attrs.paperId, node.attrs.page, this.options)
  },

  addNodeView() {
    const options = this.options
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'cite'
      dom.contentEditable = 'false'
      const { paperId, page } = node.attrs
      const paint = () => {
        dom.textContent = citationText(paperId, page, options)
        const p = useStore.getState().papers[paperId]
        dom.title = p ? `${p.title}${page ? ` — page ${page}` : ''}\nClick to open` : 'Source not in library'
      }
      paint()
      const unsub = useStore.subscribe((s, prev) => {
        if (s.papers[paperId] !== prev.papers[paperId] || s.settings.citationStyle !== prev.settings.citationStyle) paint()
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
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: 'text', text: ' ' }])
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
        node.type.name === 'heading' ? 'Heading' : pos === 0 ? placeholder : ''
    })
  ]
}

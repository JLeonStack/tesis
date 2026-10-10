import { Document } from '@tiptap/extension-document'
import { Extension, InputRule, Mark, Node, mergeAttributes, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Citation, SourceQuote } from '../editor/extensions'
import { useStore } from '../store'
import { analyze } from './analyze'
import { StyleCheck } from './lint'
import { Autocomplete } from './autocomplete'
import { THESIS_CITE, italicHtml, referenceEntries } from './references'
import {
  DEFAULT_HEADING_GUIDANCE,
  HEADING_GUIDANCE,
  SECTION_GUIDANCE,
  SECTION_INFO,
  SECTION_KINDS,
  defaultSectionContent,
  normalizeHeading,
  type SectionKind
} from './template'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    thesis: {
      /** 0 = normal text, 1–3 = block heading, 4–5 = run-in heading. */
      setThesisStyle: (level: number) => ReturnType
      insertFootnote: () => ReturnType
      insertPageBreak: () => ReturnType
    }
  }
}

/** Window event asking the editor UI to open the footnote editor for the node at `pos`. */
export const FOOTNOTE_EVENT = 'thesis:footnote'
export const openFootnote = (pos: number) => window.dispatchEvent(new CustomEvent(FOOTNOTE_EVENT, { detail: { pos } }))

/** Repaints `paint` after every document change while the node view lives. */
function onDocUpdate(editor: Editor, paint: () => void): () => void {
  editor.on('update', paint)
  return () => editor.off('update', paint)
}

// ---------- document & sections ----------

const ThesisDoc = Document.extend({ content: 'section+' })

/**
 * Each top-level section renders as its own Letter sheet. Sections are
 * isolating, so Backspace/Delete never merge them, and the structure guard
 * restores any section that a big deletion or paste removes.
 */
const Section = Node.create({
  name: 'section',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: 'cuerpo', parseHTML: (el) => el.getAttribute('data-kind'), renderHTML: (a) => ({ 'data-kind': a.kind }) }
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-kind]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { class: 'thesis-sheet' }), 0]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const kind = node.attrs.kind as SectionKind
      const info = SECTION_INFO[kind] ?? SECTION_INFO.cuerpo
      const dom = document.createElement('section')
      dom.className = 'thesis-sheet'
      dom.dataset.kind = kind

      const label = document.createElement('div')
      label.className = 'sheet-label'
      label.contentEditable = 'false'
      label.textContent = info.optional ? `${info.label} · opcional` : info.label
      dom.append(label)

      if (info.title) {
        const title = document.createElement('div')
        title.className = 'sheet-title'
        title.contentEditable = 'false'
        title.textContent = info.title
        dom.append(title)
      }

      const contentDOM = document.createElement('div')
      contentDOM.className = 'sheet-body'
      dom.append(contentDOM)

      const notes = document.createElement('div')
      notes.className = 'sheet-notes'
      notes.contentEditable = 'false'
      dom.append(notes)

      let current = node
      let sig = ''
      const paint = () => {
        const start = typeof getPos === 'function' ? getPos() : undefined
        if (start == null) return
        const end = start + current.nodeSize
        const list = analyze(editor.state.doc).footnotes.filter((f) => f.pos > start && f.pos < end)
        const next = JSON.stringify(list.map((f) => [f.n, f.text, f.pos]))
        if (next === sig) return
        sig = next
        notes.replaceChildren(
          ...list.map((f) => {
            const row = document.createElement('div')
            row.className = 'sheet-note'
            row.innerHTML = `<sup>${f.n}</sup> ${f.text ? italicHtml(f.text) : '<span class="faint">Nota vacía</span>'}`
            row.addEventListener('mousedown', (e) => {
              e.preventDefault()
              openFootnote(f.pos)
            })
            return row
          })
        )
        notes.hidden = !list.length
      }
      notes.hidden = true
      queueMicrotask(paint)
      const off = onDocUpdate(editor, paint)

      return {
        dom,
        contentDOM,
        update: (n) => {
          if (n.type !== current.type || n.attrs.kind !== kind) return false
          current = n
          return true
        },
        ignoreMutation: (m) => m.type !== 'selection' && !contentDOM.contains(m.target),
        stopEvent: (e) => !contentDOM.contains(e.target as globalThis.Node),
        destroy: off
      }
    }
  },

  addProseMirrorPlugins() {
    return [structureGuard()]
  }
})

function sectionShapeOk(doc: PMNode): boolean {
  if (doc.childCount !== SECTION_KINDS.length) return false
  let ok = true
  doc.forEach((sec, _o, i) => {
    if (!ok) return
    const kind = SECTION_KINDS[i]
    if (sec.type.name !== 'section' || sec.attrs.kind !== kind) return (ok = false)
    sec.forEach((child, _o2, j) => {
      const t = child.type.name
      if (kind === 'toc') ok &&= t === 'tocBlock' && sec.childCount === 1
      else if (kind === 'referencias') ok &&= j === 0 ? t === 'referenceList' : t !== 'referenceList' && t !== 'tocBlock'
      else ok &&= t !== 'referenceList' && t !== 'tocBlock'
    })
  })
  return ok
}

function rebuildSections(doc: PMNode, schema: Schema): PMNode[] {
  const byKind = new Map<string, PMNode[]>()
  doc.forEach((sec) => {
    const kind = sec.type.name === 'section' ? sec.attrs.kind : 'cuerpo'
    const kids: PMNode[] = []
    if (sec.type.name === 'section') sec.forEach((c) => c.type.name !== 'tocBlock' && c.type.name !== 'referenceList' && kids.push(c))
    else kids.push(sec)
    byKind.set(kind, [...(byKind.get(kind) ?? []), ...kids])
  })
  const fresh = (kind: SectionKind) => defaultSectionContent(kind).map((j) => schema.nodeFromJSON(j))
  return SECTION_KINDS.map((kind) => {
    const kids = byKind.get(kind) ?? []
    let content: PMNode[]
    if (kind === 'toc') content = [schema.nodes.tocBlock.create()]
    else if (kind === 'referencias') content = [schema.nodes.referenceList.create(), ...kids]
    else content = kids.length ? kids : fresh(kind)
    return schema.nodes.section.create({ kind }, content)
  })
}

/** Keeps the fixed section order intact whatever the user deletes or pastes. */
function structureGuard(): Plugin {
  return new Plugin({
    key: new PluginKey('thesisStructure'),
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged) || sectionShapeOk(state.doc)) return null
      const tr = state.tr.replaceWith(0, state.doc.content.size, rebuildSections(state.doc, state.schema))
      tr.setMeta('addToHistory', true)
      return tr
    }
  })
}

// ---------- table of contents & references ----------

const TocBlock = Node.create({
  name: 'tocBlock',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },
  renderHTML() {
    return ['div', { 'data-toc': '' }]
  },

  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div')
      dom.className = 'toc-block'
      dom.contentEditable = 'false'
      let sig = ''
      const paint = () => {
        const entries = tocEntries(editor.state.doc)
        const next = JSON.stringify(entries)
        if (next === sig) return
        sig = next
        dom.replaceChildren(
          ...entries.map((e) => {
            const row = document.createElement('div')
            row.className = 'toc-entry'
            row.dataset.level = String(e.level)
            row.innerHTML = `<span class="toc-text"></span><span class="toc-dots"></span><span class="toc-page">–</span>`
            row.firstElementChild!.textContent = e.text || 'Sin título'
            row.addEventListener('mousedown', (ev) => {
              ev.preventDefault()
              if (e.pos != null) scrollToPos(editor, e.pos)
            })
            return row
          })
        )
      }
      paint()
      return { dom, destroy: onDocUpdate(editor, paint), ignoreMutation: () => true }
    }
  }
})

export interface TocEntry {
  level: number
  text: string
  pos: number | null
}

/** Resumen first (the TOC never lists itself), then L1–L3 headings, then Referencias and Apéndices. */
export function tocEntries(doc: PMNode): TocEntry[] {
  const { outline } = analyze(doc)
  const out: TocEntry[] = [{ level: 1, text: 'Resumen', pos: sectionPos(doc, 'resumen') }]
  for (const h of outline) if (h.section === 'cuerpo' && h.level <= 3) out.push({ level: h.level, text: h.text, pos: h.pos })
  out.push({ level: 1, text: 'Referencias', pos: sectionPos(doc, 'referencias') })
  const apx = sectionNode(doc, 'apendices')
  if (apx && apx.textContent.trim()) {
    out.push({ level: 1, text: 'Apéndices', pos: sectionPos(doc, 'apendices') })
    for (const h of outline) if (h.section === 'apendices' && h.level <= 3) out.push({ level: h.level, text: h.text, pos: h.pos })
  }
  return out
}

export function sectionNode(doc: PMNode, kind: SectionKind): PMNode | null {
  let found: PMNode | null = null
  doc.forEach((n) => {
    if (!found && n.attrs.kind === kind) found = n
  })
  return found
}

function sectionPos(doc: PMNode, kind: SectionKind): number | null {
  let pos: number | null = null
  doc.forEach((n, offset) => {
    if (pos == null && n.attrs.kind === kind) pos = offset
  })
  return pos
}

export function scrollToPos(editor: Editor, pos: number): void {
  const inside = Math.min(pos + 1, editor.state.doc.content.size)
  editor.chain().focus().setTextSelection(inside).run()
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null
  ;(dom instanceof HTMLElement ? dom : editor.view.domAtPos(inside).node.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

const ReferenceList = Node.create({
  name: 'referenceList',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-reference-list]' }]
  },
  renderHTML() {
    return ['div', { 'data-reference-list': '' }]
  },

  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div')
      dom.className = 'reference-list'
      dom.contentEditable = 'false'
      let sig = ''
      const paint = () => {
        const entries = referenceEntries(analyze(editor.state.doc).citedIds)
        const next = JSON.stringify(entries)
        if (next === sig) return
        sig = next
        dom.innerHTML = entries.length
          ? entries.map((e) => `<p class="ref-entry" data-paper-id="${e.paperId}">${italicHtml(e.text)}</p>`).join('')
          : '<p class="ref-empty">Todavía no citaste ninguna fuente. Usá <b>Citar</b> (⌘⇧C) en el texto y la referencia aparece acá, en formato APA.</p>'
      }
      paint()
      const offDoc = onDocUpdate(editor, paint)
      const offStore = useStore.subscribe((s, prev) => s.papers !== prev.papers && paint())
      return {
        dom,
        ignoreMutation: () => true,
        destroy: () => {
          offDoc()
          offStore()
        }
      }
    }
  }
})

// ---------- run-in headings (levels 4 and 5) ----------

const RunIn = Mark.create({
  name: 'runIn',
  inclusive: true,
  excludes: '',

  addAttributes() {
    return {
      level: {
        default: 4,
        parseHTML: (el) => Number(el.getAttribute('data-run-in')) || 4,
        renderHTML: (a) => ({ 'data-run-in': a.level })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-run-in]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'run-in' }), 0]
  },

  addInputRules() {
    const type = this.type
    return [
      // "#### " / "##### " at the start of a paragraph starts a run-in heading.
      new InputRule({
        find: /^(#{4,5})\s$/,
        handler: ({ state, range, match }) => {
          if (state.selection.$from.parent.type.name !== 'paragraph') return null
          state.tr.delete(range.from, range.to).addStoredMark(type.create({ level: match[1].length }))
        }
      })
    ]
  },

  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: new PluginKey('runInExit'),
        props: {
          // A space typed right after the heading's final period leaves the heading.
          handleTextInput(view, from, to, text) {
            if (text !== ' ') return false
            const { state } = view
            const $from = state.doc.resolve(from)
            const marks = state.storedMarks ?? $from.marks()
            if (!type.isInSet(marks) || $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset) !== '.') return false
            const tr = state.tr.insertText(' ', from, to)
            tr.removeMark(from, from + 1, type).setStoredMarks(type.removeFromSet(marks))
            view.dispatch(tr)
            return true
          }
        }
      })
    ]
  }
})

// ---------- footnotes ----------

const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: { default: '', parseHTML: (el) => el.getAttribute('data-text') ?? '', renderHTML: (a) => ({ 'data-text': a.text }) }
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '' })]
  },
  renderText() {
    return ''
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('sup')
      dom.className = 'fn-ref'
      dom.contentEditable = 'false'
      let current = node
      const paint = () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        const f = pos == null ? undefined : analyze(editor.state.doc).footnotes.find((x) => x.pos === pos)
        dom.textContent = String(f?.n ?? '·')
        dom.title = current.attrs.text || 'Nota al pie vacía — clic para escribirla'
      }
      queueMicrotask(paint)
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos != null) openFootnote(pos)
      })
      const off = onDocUpdate(editor, paint)
      return {
        dom,
        update: (n) => {
          if (n.type !== current.type) return false
          current = n
          paint()
          return true
        },
        destroy: off
      }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-f': () => this.editor.commands.insertFootnote(),
      // Writing helpers at the caret / for the selection (WritingToolbar).
      'Mod-.': () => {
        window.dispatchEvent(new CustomEvent('thesis:helpers'))
        return true
      }
    }
  }
})

// ---------- page breaks ----------

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'page-break', contenteditable: 'false' }]
  }
})

// ---------- commands ----------

const ThesisCommands = Extension.create({
  name: 'thesisCommands',

  addCommands() {
    return {
      setThesisStyle:
        (level) =>
        ({ state, tr, dispatch }) => {
          const { $from, from, to, empty } = state.selection
          const para = $from.parent
          if (!para.isTextblock || (para.type.name !== 'paragraph' && para.type.name !== 'heading')) return false
          const schema = state.schema
          const runIn = schema.marks.runIn
          const start = $from.start()
          const end = $from.end()
          if (!dispatch) return true
          tr.removeMark(start, end, runIn)
          if (level >= 1 && level <= 3) {
            tr.setBlockType(start, end, schema.nodes.heading, { level })
          } else {
            if (para.type.name === 'heading') tr.setBlockType(start, end, schema.nodes.paragraph)
            if (level >= 4) {
              const mark = runIn.create({ level })
              const text = para.textContent
              if (!empty && para.type.name === 'paragraph') tr.addMark(from, to, mark)
              else if (!text) tr.addStoredMark(mark)
              else if (para.type.name === 'heading') {
                // A promoted heading becomes the whole run-in, ending in a period.
                if (!/[.?!:]$/.test(text.trim())) tr.insertText('.', end)
                tr.addMark(start, tr.mapping.map(end), mark)
                tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(end)))
              } else {
                const dot = text.indexOf('.')
                tr.addMark(start, dot >= 0 ? start + dot + 1 : end, mark)
              }
            } else {
              tr.setStoredMarks((state.storedMarks ?? $from.marks()).filter((m) => m.type !== runIn))
            }
          }
          return true
        },

      insertFootnote:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from, to } = state.selection
          if (!$from.parent.inlineContent) return false
          if (dispatch) {
            tr.insert(to, state.schema.nodes.footnote.create({ text: '' }))
            setTimeout(() => openFootnote(to))
          }
          return true
        },

      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }])
    }
  }
})

// ---------- guidance placeholders ----------

function guidance(section: PMNode, index: number): string {
  const node = section.child(index)
  if (node.type.name === 'heading') return 'Título'
  if (node.type.name !== 'paragraph') return ''
  const kind = section.attrs.kind as SectionKind
  const before = index > 0 ? section.child(index - 1) : null
  if (before?.type.name === 'heading') return HEADING_GUIDANCE[normalizeHeading(before.textContent)] ?? DEFAULT_HEADING_GUIDANCE
  if (kind === 'referencias') return index === 1 && section.childCount === 2 ? SECTION_GUIDANCE.referencias ?? '' : ''
  return index === 0 ? SECTION_GUIDANCE[kind] ?? '' : ''
}

/** Template guidance in empty paragraphs, like the bracketed notes in the UCEMA .docx. */
const Guidance = Extension.create({
  name: 'thesisGuidance',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('thesisGuidance'),
        props: {
          decorations(state) {
            if (!editor.isEditable) return null
            const decos: Decoration[] = []
            state.doc.forEach((section, secPos) => {
              section.forEach((child, off, i) => {
                if (!child.isTextblock || child.content.size) return
                const text = guidance(section, i)
                const pos = secPos + 1 + off
                if (text) decos.push(Decoration.node(pos, pos + child.nodeSize, { class: 'is-empty', 'data-placeholder': text }))
              })
            })
            return DecorationSet.create(state.doc, decos)
          }
        }
      })
    ]
  }
})

export function buildThesisExtensions() {
  return [
    StarterKit.configure({
      document: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', target: '_blank' } }
    }),
    ThesisDoc,
    Section,
    TocBlock,
    ReferenceList,
    RunIn,
    Footnote,
    PageBreak,
    ThesisCommands,
    SourceQuote,
    Citation.configure(THESIS_CITE),
    Highlight.configure({ multicolor: false }),
    Typography,
    Guidance,
    StyleCheck,
    Autocomplete
  ]
}

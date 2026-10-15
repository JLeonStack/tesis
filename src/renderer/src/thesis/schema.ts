import { Document } from '@tiptap/extension-document'
import { Extension, InputRule, Mark, Node, mergeAttributes, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Citation, SourceQuote } from '../editor/extensions'
import { useStore } from '../store'
import { analyze, runInOf } from './analyze'
import { Pagination } from './pagination'
import { guideTip } from './guideTip'
import { StyleCheck } from './lint'
import { CitationCheck } from './uncited'
import { Autocomplete } from './autocomplete'
import { THESIS_CITE, italicHtml, referenceEntries, thesisReferenceIds } from './references'
import { cleanSvg, figureHtml, tableHtml, type ApaFigure, type ApaTable } from './tables'
import {
  BODY_OUTLINE,
  DEFAULT_HEADING_GUIDANCE,
  HEADING_GUIDANCE,
  SECTION_GUIDANCE,
  SECTION_INFO,
  SECTION_KINDS,
  defaultSectionContent,
  normalizeHeading,
  outlineNode,
  sectionTitle,
  type SectionKind
} from './template'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    thesis: {
      /** 0 = normal text, 1–3 = block heading, 4–5 = run-in heading. */
      setThesisStyle: (level: number) => ReturnType
      insertFootnote: () => ReturnType
      insertPageBreak: () => ReturnType
      insertApaTable: (t: ApaTable) => ReturnType
      insertApaFigure: (f: ApaFigure) => ReturnType
      /** Paragraphs of AI-drafted text, marked until the student reviews them. */
      insertDraft: (paragraphs: string[], logId: string) => ReturnType
      /** Takes the AI-draft mark off one draft's text (the student reviewed and owns it). */
      clearDraft: (logId: string) => ReturnType
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
      kind: { default: 'cuerpo', parseHTML: (el) => el.getAttribute('data-kind'), renderHTML: (a) => ({ 'data-kind': a.kind }) },
      /** The student's title for the sheet (null: the template's). */
      title: { default: null, parseHTML: (el) => el.getAttribute('data-title'), renderHTML: (a) => (a.title ? { 'data-title': a.title } : {}) }
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
      if (SECTION_GUIDANCE[kind]) label.append(guideTip(SECTION_GUIDANCE[kind]))
      dom.append(label)

      // The sheet's title is the template's until the student writes their own (empty brings it back).
      let titleInput: HTMLInputElement | null = null
      if (info.title) {
        const title = document.createElement('div')
        title.className = 'sheet-title'
        title.contentEditable = 'false'
        const input = document.createElement('input')
        input.className = 'sheet-title-input'
        input.spellcheck = true
        input.placeholder = info.title
        input.title = 'Título de la sección: escribí el tuyo o dejalo vacío para usar el de la plantilla'
        input.value = sectionTitle(kind, node.attrs.title) ?? ''
        const commit = () => {
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos == null) return
          const value = input.value.trim()
          const next = !value || value === info.title ? null : value
          if (!value) input.value = info.title ?? ''
          if (next === (current.attrs.title ?? null)) return
          editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'title', next))
        }
        input.addEventListener('change', commit)
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            if (e.key === 'Escape') input.value = sectionTitle(kind, current.attrs.title) ?? ''
            e.preventDefault()
            input.blur()
            editor.commands.focus()
          }
        })
        title.append(input)
        titleInput = input
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
          if (titleInput && document.activeElement !== titleInput) titleInput.value = sectionTitle(kind, n.attrs.title) ?? ''
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
  const titles = new Map<string, string | null>()
  doc.forEach((sec) => {
    const kind = sec.type.name === 'section' ? sec.attrs.kind : 'cuerpo'
    if (sec.type.name === 'section' && sec.attrs.title) titles.set(kind, sec.attrs.title)
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
    return schema.nodes.section.create({ kind, title: titles.get(kind) ?? null }, content)
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
  const title = (kind: SectionKind) => sectionTitle(kind, sectionNode(doc, kind)?.attrs.title) ?? ''
  const out: TocEntry[] = [{ level: 1, text: title('resumen'), pos: sectionPos(doc, 'resumen') }]
  for (const h of outline) if (h.section === 'cuerpo' && h.level <= 3) out.push({ level: h.level, text: h.text, pos: h.pos })
  out.push({ level: 1, text: title('referencias'), pos: sectionPos(doc, 'referencias') })
  const apx = sectionNode(doc, 'apendices')
  if (apx && apx.textContent.trim()) {
    out.push({ level: 1, text: title('apendices'), pos: sectionPos(doc, 'apendices') })
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

/**
 * Adds the template's body headings that the thesis doesn't have (same text, at any level),
 * each one after the ones that come before it in the template; nothing is removed or moved.
 * Returns how many were added (undo brings the body back).
 */
export function completeOutline(editor: Editor): number {
  const tr = editor.state.tr
  const norm = (t: string) => normalizeHeading(t.replace(/\.$/, ''))
  let insertAt: number | null = null
  let added = 0
  for (const o of BODY_OUTLINE) {
    let secPos = -1
    tr.doc.forEach((n, off) => n.attrs.kind === 'cuerpo' && (secPos = off))
    const sec = tr.doc.nodeAt(secPos)
    if (!sec) return 0
    const blocks: { pos: number; heading: string | null }[] = []
    sec.forEach((child, off) =>
      blocks.push({ pos: secPos + 1 + off, heading: child.type.name === 'heading' ? child.textContent : child.type.name === 'paragraph' ? (runInOf(child)?.text ?? null) : null })
    )
    const i = blocks.findIndex((b) => b.heading != null && norm(b.heading) === norm(o.text))
    if (i >= 0) {
      // What comes next goes after this heading's own text, before the following heading.
      const j = blocks.findIndex((b, k) => k > i && b.heading != null)
      insertAt = j >= 0 ? blocks[j].pos : secPos + sec.nodeSize - 1
      continue
    }
    const at: number = insertAt ?? secPos + 1
    const nodes = [outlineNode(o), ...(o.level <= 3 ? [{ type: 'paragraph' }] : [])].map((j) => editor.schema.nodeFromJSON(j))
    tr.insert(at, nodes)
    insertAt = at + nodes.reduce((n, node) => n + node.nodeSize, 0)
    added++
  }
  // Its own undo step, apart from what was typed just before.
  if (added) editor.view.dispatch(closeHistory(tr))
  return added
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
        const entries = referenceEntries(thesisReferenceIds(analyze(editor.state.doc)))
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

// ---------- APA tables and figures ----------

/** Commits an edit made inside a node view (caption, note, a cell) to the node's attributes. */
function editable(el: HTMLElement, commit: (text: string) => void): void {
  el.contentEditable = 'true'
  el.spellcheck = true
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      el.blur()
    }
    e.stopPropagation()
  })
  el.addEventListener('blur', () => commit(el.textContent ?? ''))
}

function floatView(kind: 'table' | 'figure') {
  return ({ node, getPos, editor }: { node: PMNode; getPos: (() => number | undefined) | boolean; editor: Editor }) => {
    const dom = document.createElement('div')
    dom.className = `apa-float apa-float-${kind}`
    dom.contentEditable = 'false'
    let current = node
    const pos = () => (typeof getPos === 'function' ? getPos() : undefined)
    const setAttrs = (patch: Record<string, unknown>) => {
      const p = pos()
      if (p == null) return
      editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...current.attrs, ...patch }))
    }
    const paint = () => {
      const p = pos()
      const info = analyze(editor.state.doc)
      const n = (kind === 'table' ? info.tables : info.figures).find((x) => x.pos === p)?.n ?? 0
      const a = current.attrs
      dom.innerHTML = kind === 'table' ? tableHtml(n, a as unknown as ApaTable) : figureHtml(n, a as unknown as ApaFigure)
      const title = dom.querySelector<HTMLElement>('.apa-title i')
      if (title) editable(title, (t) => t !== a.title && setAttrs({ title: t }))
      let note = dom.querySelector<HTMLElement>('.apa-note')
      if (!note) {
        note = document.createElement('p')
        note.className = 'apa-note apa-note-empty'
        note.innerHTML = '<i>Nota.</i> '
        dom.querySelector(`.apa-${kind}`)?.append(note)
      }
      const noteText = document.createElement('span')
      noteText.textContent = a.note || ''
      noteText.dataset.placeholder = 'Agregá una nota (abreviaturas, fuente, significación)…'
      note.replaceChildren(Object.assign(document.createElement('i'), { textContent: 'Nota.' }), ' ', noteText)
      editable(noteText, (t) => t !== a.note && setAttrs({ note: t.trim() }))
      if (kind === 'table') {
        dom.querySelectorAll<HTMLElement>('th').forEach((th, j) =>
          editable(th, (t) => {
            if (t === a.headers[j]) return
            setAttrs({ headers: (a.headers as string[]).map((h, k) => (k === j ? t : h)) })
          })
        )
        dom.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr, i) =>
          tr.querySelectorAll<HTMLElement>('td').forEach((td, j) =>
            editable(td, (t) => {
              if (t === (a.rows[i]?.[j] ?? '')) return
              setAttrs({ rows: (a.rows as string[][]).map((r, k) => (k === i ? r.map((c, l) => (l === j ? t : c)) : r)) })
            })
          )
        )
      }
      const del = document.createElement('button')
      del.className = 'apa-delete'
      del.type = 'button'
      del.title = kind === 'table' ? 'Quitar la tabla' : 'Quitar la figura'
      del.textContent = '×'
      del.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const p = pos()
        if (p != null) editor.view.dispatch(editor.state.tr.delete(p, p + current.nodeSize))
      })
      dom.append(del)
    }
    queueMicrotask(paint)
    let sig = ''
    const repaintNumbers = () => {
      const info = analyze(editor.state.doc)
      const next = JSON.stringify((kind === 'table' ? info.tables : info.figures).map((x) => x.pos === pos()))
      if (next !== sig) (sig = next), paint()
    }
    const off = onDocUpdate(editor, repaintNumbers)
    return {
      dom,
      update: (n: PMNode) => {
        if (n.type !== current.type) return false
        if (n.attrs !== current.attrs) {
          current = n
          // Don't repaint under the caret while the student is typing in a field.
          if (!dom.contains(document.activeElement)) paint()
        }
        return true
      },
      stopEvent: (e: Event) => dom.contains(e.target as globalThis.Node) && e.type !== 'dragstart',
      ignoreMutation: () => true,
      destroy: off
    }
  }
}

/** An attribute carried, with the node's others, in one data-json attribute (copy and paste keep it). */
const json = (key: string, def: unknown) => ({
  default: def,
  parseHTML: (el: HTMLElement) => {
    try {
      return JSON.parse(el.getAttribute('data-json') ?? '{}')[key] ?? def
    } catch {
      return def
    }
  },
  renderHTML: () => ({})
})

const ApaTableNode = Node.create({
  name: 'apaTable',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { title: json('title', ''), headers: json('headers', []), rows: json('rows', []), note: json('note', '') }
  },
  parseHTML() {
    return [{ tag: 'div[data-apa-table]' }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-apa-table': '', 'data-json': JSON.stringify(node.attrs) }]
  },
  renderText({ node }) {
    return `Tabla: ${node.attrs.title}`
  },
  addNodeView() {
    return floatView('table')
  }
})

const ApaFigureNode = Node.create({
  name: 'apaFigure',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { title: json('title', ''), svg: json('svg', ''), note: json('note', '') }
  },
  parseHTML() {
    return [{ tag: 'div[data-apa-figure]' }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-apa-figure': '', 'data-json': JSON.stringify({ ...node.attrs, svg: cleanSvg(node.attrs.svg) }) }]
  },
  renderText({ node }) {
    return `Figura: ${node.attrs.title}`
  },
  addNodeView() {
    return floatView('figure')
  }
})

// ---------- AI drafts ----------

/**
 * Text the assistant drafted and the student inserted: underlined until they
 * review it, so it's never mistaken for their own writing (UCEMA pautas, Turnitin).
 */
const AiDraft = Mark.create({
  name: 'aiDraft',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { logId: { default: '', parseHTML: (el) => el.getAttribute('data-ai-draft') ?? '', renderHTML: (a) => ({ 'data-ai-draft': a.logId }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-ai-draft]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'ai-draft', title: 'Borrador de la IA: revisalo, reescribilo con tu voz y marcalo como revisado en Requisitos' }), 0]
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
          commands.insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]),

      insertApaTable:
        (t) =>
        ({ commands }) =>
          commands.insertContent([{ type: 'apaTable', attrs: { ...t } }, { type: 'paragraph' }]),

      insertApaFigure:
        (f) =>
        ({ commands }) =>
          commands.insertContent([{ type: 'apaFigure', attrs: { ...f } }, { type: 'paragraph' }]),

      insertDraft:
        (paragraphs, logId) =>
        ({ commands }) =>
          commands.insertContent(
            paragraphs
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p, marks: [{ type: 'aiDraft', attrs: { logId } }] }] }))
          ),

      clearDraft:
        (logId) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks.aiDraft
          const spans = analyze(state.doc).drafts.filter((d) => d.logId === logId)
          if (!spans.length) return false
          if (dispatch) for (const d of spans) tr.removeMark(d.from, d.to, type)
          return true
        }
    }
  }
})

// ---------- guidance ----------

/** The template's guidance for a heading: the specific one, else the general rule for headings. */
function headingGuidance(text: string): string {
  return HEADING_GUIDANCE[normalizeHeading(text)] ?? DEFAULT_HEADING_GUIDANCE
}

/**
 * Template guidance, like the bracketed notes in the UCEMA .docx, as an ⓘ next
 * to each heading (and on each sheet's label): always there, never in the way
 * of the text. An empty heading still reads «Título».
 */
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
              section.forEach((child, off) => {
                if (child.type.name !== 'heading') return
                const pos = secPos + 1 + off
                if (!child.content.size) {
                  decos.push(Decoration.node(pos, pos + child.nodeSize, { class: 'is-empty', 'data-placeholder': 'Título' }))
                  return
                }
                const text = headingGuidance(child.textContent)
                decos.push(Decoration.widget(pos + child.nodeSize - 1, () => guideTip(text), { side: 1, ignoreSelection: true, key: `guide:${text}` }))
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
    ApaTableNode,
    ApaFigureNode,
    AiDraft,
    ThesisCommands,
    SourceQuote,
    Citation.configure(THESIS_CITE),
    Highlight.configure({ multicolor: false }),
    Typography,
    Guidance,
    Pagination,
    StyleCheck,
    CitationCheck,
    Autocomplete
  ]
}

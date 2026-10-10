import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import {
  Bold,
  Italic,
  Highlighter,
  Quote as CiteIcon,
  Superscript,
  Replace,
  SpellCheck,
  Wand2,
  MoreHorizontal,
  BookOpenText,
  Languages,
  CaseSensitive,
  Link2,
  Search,
  Sparkles,
  Copy,
  Check,
  X,
  RotateCcw,
  EyeOff,
  ArrowLeft,
  Lightbulb
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { Hint } from '../components/common'
import { askAssistant, openPalette, toast, useStore } from '../store'
import { mod } from '../lib/util'
import { ASSIST_LABELS, runAssist, type AssistKind, type AssistResult } from './assist'
import { CONNECTOR_GROUPS, type Connector } from './connectors'
import { LINT_EVENT, LINT_RULE_LABELS, type LintIssue } from './lint'
import { contextOf, writingContext, countWordsIn, diffWords, matchCase, rangeText, rebuild, stripMarkers, titleCase, wordAt, type RangeText } from './text'

/** Window event that opens the helpers at the caret (⌘. or the toolbar's Ayudas button). */
export const HELPERS_EVENT = 'thesis:helpers'
export const openHelpers = () => window.dispatchEvent(new CustomEvent(HELPERS_EVENT))

type Panel =
  | { type: 'assist'; kind: AssistKind; target: RangeText; context: string; status: 'loading' | 'done' | 'error'; result?: AssistResult; error?: string }
  | { type: 'rewrite' }
  | { type: 'more' }
  | { type: 'connectors' }
  | { type: 'lint'; issue: LintIssue }

interface Anchor {
  from: number
  to: number
  /** Viewport rect of the selection (or caret / flagged word). */
  rect: DOMRect
  caret: boolean
}

const AI_REWRITES: { kind: AssistKind; hint: string }[] = [
  { kind: 'clearer', hint: 'Misma idea, más fluida' },
  { kind: 'formal', hint: 'Registro académico e impersonal' },
  { kind: 'concise', hint: 'Sin relleno ni redundancias' }
]

const LOADING: Record<AssistKind, string> = {
  synonyms: 'Buscando sinónimos…',
  correct: 'Revisando ortografía y gramática…',
  clearer: 'Buscando una redacción más clara…',
  formal: 'Ajustando el registro…',
  concise: 'Condensando…',
  define: 'Buscando la definición…',
  translate: 'Traduciendo…',
  ideas: 'Pensando preguntas para seguir…'
}

function selectionRect(editor: Editor, from: number, to: number): DOMRect {
  const a = editor.view.coordsAtPos(from)
  const b = editor.view.coordsAtPos(to, -1)
  const left = Math.min(a.left, b.left)
  const right = Math.max(a.right, b.right)
  // Multi-line selections: span the full lines.
  return new DOMRect(a.top === b.top ? left : Math.min(a.left, b.left), a.top, Math.max(1, (a.top === b.top ? right : Math.max(a.right, b.right)) - left), b.bottom - a.top)
}

/**
 * Writing helpers that float over the thesis: on a selection (synonyms,
 * corrections, rewrites, definitions, formatting, citing) and at the caret
 * (connectors). Also shows the style-review cards for flagged text.
 */
export function WritingToolbar({ editor, thesisId }: { editor: Editor; thesisId: string }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const reqId = useRef(0)
  const panelRef = useRef<Panel | null>(null)
  panelRef.current = panel

  const close = useCallback(() => {
    reqId.current++
    setPanel(null)
    setAnchor(null)
  }, [])

  // Follow the selection.
  const sync = useCallback(() => {
    if (dragging.current || editor.isDestroyed) return
    const { selection } = editor.state
    const { from, to, empty, $from, $to } = selection
    if (empty || !(selection instanceof TextSelection) || !$from.parent.inlineContent || !$to.parent.inlineContent || !editor.isFocused) {
      if (panelRef.current?.type !== 'lint' && !(anchor?.caret && panelRef.current)) setAnchor((a) => (a?.caret ? a : null))
      return
    }
    if (!editor.state.doc.textBetween(from, to).trim()) return setAnchor(null)
    setAnchor({ from, to, rect: selectionRect(editor, from, to), caret: false })
    setPanel((p) => (p && p.type !== 'lint' && (p.type !== 'assist' || (p.target.from === from && p.target.to === to)) ? p : null))
  }, [editor, anchor?.caret])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      if (editor.view.dom.contains(e.target as Node)) {
        dragging.current = true
        setAnchor(null)
        setPanel((p) => (p?.type === 'lint' ? p : null))
      } else close()
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      requestAnimationFrame(sync)
    }
    const onSel = () => requestAnimationFrame(sync)
    const onBlur = ({ event }: { event: FocusEvent }) => {
      if (rootRef.current?.contains(event.relatedTarget as Node)) return
      setTimeout(() => !editor.isFocused && !rootRef.current?.contains(document.activeElement) && close(), 120)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !anchorRef.current) return
      if (panelRef.current && panelRef.current.type !== 'lint') setPanel(null)
      else close()
    }
    const onUpdate = ({ transaction }: { transaction: { getMeta: (k: string) => unknown } }) => {
      // Typing invalidates suggestions for the old text.
      if (!transaction.getMeta('thesisHelper') && panelRef.current?.type === 'assist') setPanel(null)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mouseup', onUp, true)
    window.addEventListener('keydown', onKey, true)
    editor.on('selectionUpdate', onSel)
    editor.on('blur', onBlur)
    editor.on('update', onUpdate)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('keydown', onKey, true)
      editor.off('selectionUpdate', onSel)
      editor.off('blur', onBlur)
      editor.off('update', onUpdate)
    }
  }, [editor, sync, close])

  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  // Keep the toolbar glued to its text while the pages scroll or zoom.
  useEffect(() => {
    if (!anchor) return
    const reposition = () => {
      const a = anchorRef.current
      if (!a || editor.isDestroyed || a.to > editor.state.doc.content.size) return
      setAnchor({ ...a, rect: selectionRect(editor, a.from, a.to) })
    }
    const desk = editor.view.dom.closest('.thesis-desk')
    desk?.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      desk?.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [editor, !!anchor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘. — helpers at the caret (connectors, synonyms of the word under it).
  useEffect(() => {
    const onHelpers = () => {
      const { from, to, empty } = editor.state.selection
      if (!empty) return sync()
      if (!editor.state.selection.$from.parent.inlineContent) return
      setAnchor({ from, to, rect: selectionRect(editor, from, to), caret: true })
      setPanel({ type: 'connectors' })
    }
    const onLint = (e: Event) => {
      const { issue, rect } = (e as CustomEvent<{ issue: LintIssue; rect: DOMRect }>).detail
      setAnchor({ from: issue.from, to: issue.to, rect, caret: true })
      setPanel({ type: 'lint', issue })
    }
    window.addEventListener(HELPERS_EVENT, onHelpers)
    window.addEventListener(LINT_EVENT, onLint)
    return () => {
      window.removeEventListener(HELPERS_EVENT, onHelpers)
      window.removeEventListener(LINT_EVENT, onLint)
    }
  }, [editor, sync])

  // ---------- actions ----------

  const ask = async (kind: AssistKind, from: number, to: number) => {
    const target = rangeText(editor.state, from, to)
    const context = kind === 'ideas' ? writingContext(editor.state, from) : contextOf(editor.state, from)
    const id = ++reqId.current
    setPanel({ type: 'assist', kind, target, context, status: 'loading' })
    try {
      const result = await runAssist(kind, target.text, context)
      if (id === reqId.current) setPanel({ type: 'assist', kind, target, context, status: 'done', result })
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      if (/CANCELLED/.test(msg) || id !== reqId.current) return
      setPanel({ type: 'assist', kind, target, context, status: 'error', error: msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  /** Replaces the target range, keeping citations/footnotes and the text's formatting. */
  const replace = (target: RangeText, text: string) => {
    const { state } = editor
    if (target.to > state.doc.content.size || rangeText(state, target.from, target.to).text !== target.text) {
      toast('El texto cambió. Volvé a pedir la sugerencia.')
      return setPanel(null)
    }
    const marks = (state.doc.nodeAt(target.from)?.marks ?? []).filter((m) => m.type.name !== 'highlight')
    const nodes = rebuild(state.schema, text, target.atoms, marks)
    const tr = state.tr.replaceWith(target.from, target.to, nodes)
    const size = nodes.reduce((n, node) => n + node.nodeSize, 0)
    tr.setSelection(TextSelection.create(tr.doc, target.from, target.from + size)).setMeta('thesisHelper', true).scrollIntoView()
    editor.view.dispatch(tr)
    editor.commands.focus()
    setPanel(null)
  }

  const insertConnector = (c: Connector) => {
    const { state } = editor
    const pos = state.selection.from
    const $pos = state.doc.resolve(pos)
    const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '￼')
    const startOfSentence = !before.trim() || /[.!?…:]\s*$/.test(before)
    let text = startOfSentence ? c.text.charAt(0).toUpperCase() + c.text.slice(1) : c.text
    text += c.comma && startOfSentence ? ', ' : ' '
    if (before && !/\s$/.test(before)) text = ` ${text}`
    editor.chain().focus().insertContentAt(pos, text).run()
    close()
  }

  const applyTitleCase = (from: number, to: number) => {
    const { state } = editor
    const tr = state.tr
    const atStart = state.doc.resolve(from).parentOffset === 0
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true
      const s = Math.max(from, pos)
      const e = Math.min(to, pos + node.nodeSize)
      const orig = node.text!.slice(s - pos, e - pos)
      const next = titleCase(orig, s === from && atStart)
      if (next !== orig && next.length === orig.length) tr.replaceWith(s, e, state.schema.text(next, node.marks))
      return false
    })
    if (tr.docChanged) editor.view.dispatch(tr.setMeta('thesisHelper', true))
    editor.commands.focus()
  }

  if (!anchor) return null

  const selected = anchor.caret ? null : rangeText(editor.state, anchor.from, anchor.to)
  const plain = selected ? stripMarkers(selected.text) : ''
  const words = selected ? countWordsIn(selected.text) : 0
  const short = words > 0 && words <= 4
  const oneBlock = editor.state.doc.resolve(anchor.from).parent === editor.state.doc.resolve(anchor.to).parent
  const inHeading = editor.state.doc.resolve(anchor.from).parent.type.name === 'heading'
  const caretWord = anchor.caret ? wordAt(editor.state, anchor.from) : null
  const chatId = `thesis:${thesisId}`
  const c = () => editor.chain().focus()

  const aiHint = oneBlock ? undefined : 'Seleccioná dentro de un solo párrafo'

  const toolbar = (
    <div className="flex items-center gap-0.5">
      {anchor.caret ? (
        <>
          <Tool label="Conectores para enlazar ideas" onClick={() => setPanel({ type: 'connectors' })} active={panel?.type === 'connectors'}>
            <Link2 /> Conectores
          </Tool>
          <Tool label="Ideas para seguir: preguntas guía, sin escribir por vos" onClick={() => void ask('ideas', anchor.from, anchor.from)}>
            <Lightbulb /> Ideas
          </Tool>
          {caretWord && (
            <Tool label={`Sinónimos de «${caretWord.text}»`} accent onClick={() => void ask('synonyms', caretWord.from, caretWord.to)}>
              <Replace /> Sinónimos
            </Tool>
          )}
          <Sep />
          <Tool label="Nota al pie" keys={[mod, '⌥', 'F']} onClick={() => c().insertFootnote().run()}>
            <Superscript />
          </Tool>
          <Tool
            label="Citar una fuente"
            keys={[mod, '⇧', 'C']}
            onClick={() => {
              close()
              openPalette('cite', thesisId)
            }}
          >
            <CiteIcon />
          </Tool>
        </>
      ) : (
        <>
          {short && (
            <Tool label="Sinónimos que encajan en la oración" accent disabled={!oneBlock} onClick={() => void ask('synonyms', anchor.from, anchor.to)}>
              <Replace /> Sinónimos
            </Tool>
          )}
          <Tool label={aiHint ?? 'Corregir ortografía, gramática y puntuación'} accent={!short} disabled={!oneBlock} onClick={() => void ask('correct', anchor.from, anchor.to)}>
            <SpellCheck /> Corregir
          </Tool>
          {!short && (
            <Tool label={aiHint ?? 'Reescribir: más claro, académico o conciso'} disabled={!oneBlock} active={panel?.type === 'rewrite'} onClick={() => setPanel(panel?.type === 'rewrite' ? null : { type: 'rewrite' })}>
              <Wand2 /> Mejorar
            </Tool>
          )}
          <Sep />
          <Tool label="Negrita" keys={[mod, 'B']} active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}>
            <Bold />
          </Tool>
          <Tool label="Cursiva" keys={[mod, 'I']} active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}>
            <Italic />
          </Tool>
          <Tool label="Resaltar (solo borrador)" active={editor.isActive('highlight')} onClick={() => c().toggleHighlight().run()}>
            <Highlighter />
          </Tool>
          <Sep />
          <Tool
            label="Citar una fuente después de la selección"
            keys={[mod, '⇧', 'C']}
            onClick={() => {
              c().setTextSelection(anchor.to).run()
              close()
              openPalette('cite', thesisId)
            }}
          >
            <CiteIcon />
          </Tool>
          <Tool
            label="Nota al pie después de la selección"
            onClick={() => {
              c().setTextSelection(anchor.to).insertFootnote().run()
              close()
            }}
          >
            <Superscript />
          </Tool>
          <Tool label="Más ayudas" active={panel?.type === 'more'} onClick={() => setPanel(panel?.type === 'more' ? null : { type: 'more' })}>
            <MoreHorizontal />
          </Tool>
          <span className="px-1.5 text-[11px] whitespace-nowrap text-faint tabular-nums">
            {words} {words === 1 ? 'palabra' : 'palabras'}
          </span>
        </>
      )}
    </div>
  )

  let body: ReactNode = null
  if (panel?.type === 'rewrite') {
    body = (
      <Menu>
        {AI_REWRITES.map((r) => (
          <MenuItem key={r.kind} icon={<Wand2 />} label={ASSIST_LABELS[r.kind]} hint={r.hint} onClick={() => void ask(r.kind, anchor.from, anchor.to)} />
        ))}
      </Menu>
    )
  } else if (panel?.type === 'more' && selected) {
    body = (
      <Menu>
        {short && <MenuItem icon={<BookOpenText />} label="Definir" hint="Significado y registro" disabled={!oneBlock} onClick={() => void ask('define', anchor.from, anchor.to)} />}
        {!short && AI_REWRITES.map((r) => <MenuItem key={r.kind} icon={<Wand2 />} label={ASSIST_LABELS[r.kind]} hint={r.hint} disabled={!oneBlock} onClick={() => void ask(r.kind, anchor.from, anchor.to)} />)}
        <MenuItem icon={<Languages />} label="Traducir al español" hint="Para citas o notas en inglés" disabled={!oneBlock} onClick={() => void ask('translate', anchor.from, anchor.to)} />
        <MenuItem
          icon={<CaseSensitive />}
          label="Capitalizar como título"
          hint={inHeading ? 'Mayúscula en las palabras principales (APA)' : 'Para títulos: palabras principales con mayúscula'}
          onClick={() => applyTitleCase(anchor.from, anchor.to)}
        />
        <MenuItem icon={<Link2 />} label="Insertar conector antes" hint="Enlazar con la idea anterior" onClick={() => {
          c().setTextSelection(anchor.from).run()
          setAnchor({ ...anchor, to: anchor.from, caret: true })
          setPanel({ type: 'connectors' })
        }} />
        <div className="my-1 h-px bg-border" />
        <MenuItem
          icon={<Search />}
          label="Buscar respaldo en mis fuentes"
          hint="El asistente busca en tu biblioteca"
          onClick={() => {
            close()
            askAssistant({ chatId, prefill: `¿Qué fuentes de mi biblioteca respaldan o discuten esta afirmación? Indicá autor, año y páginas.\n\n«${plain}»`, autoSend: true })
          }}
        />
        <MenuItem
          icon={<Sparkles />}
          label="Preguntar al asistente"
          hint="Con este fragmento como contexto"
          onClick={() => {
            close()
            askAssistant({ chatId, prefill: `Sobre este fragmento de mi tesis:\n«${plain}»\n\n` })
          }}
        />
        <MenuItem
          icon={<Copy />}
          label="Copiar"
          onClick={() => {
            void navigator.clipboard.writeText(plain)
            toast('Copiado')
            close()
          }}
        />
      </Menu>
    )
  } else if (panel?.type === 'connectors') {
    body = <Connectors onPick={insertConnector} />
  } else if (panel?.type === 'lint') {
    body = (
      <LintCard
        issue={panel.issue}
        onFix={(fix) => {
          editor.chain().focus().applyLintFix(panel.issue, fix).run()
          close()
        }}
        onIgnore={() => {
          editor.commands.ignoreLint(panel.issue)
          close()
        }}
        onSynonyms={() => void ask('synonyms', panel.issue.from, panel.issue.to)}
      />
    )
  } else if (panel?.type === 'assist') {
    body = (
      <AssistCard
        panel={panel}
        onRetry={() => void ask(panel.kind, panel.target.from, panel.target.to)}
        onBack={() => setPanel(panel.kind === 'synonyms' || panel.kind === 'correct' || panel.kind === 'ideas' ? null : { type: 'rewrite' })}
        onReplace={(text) => replace(panel.target, panel.kind === 'synonyms' ? matchCase(panel.target.text, text) : text)}
      />
    )
  }

  return (
    <Floating ref={rootRef} rect={anchor.rect} showToolbar={panel?.type !== 'lint'} toolbar={toolbar} body={body} />
  )
}

// ---------- layout ----------

import { forwardRef } from 'react'

const Floating = forwardRef<HTMLDivElement, { rect: DOMRect; showToolbar: boolean; toolbar: ReactNode; body: ReactNode }>(function Floating(
  { rect, showToolbar, toolbar, body },
  ref
) {
  const barRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ bar?: { left: number; top: number }; card?: { left: number; top: number; maxHeight: number } }>({})

  useLayoutEffect(() => {
    const next: typeof pos = {}
    // Stay inside the writing area (below the editor toolbar, above the status bar).
    const desk = document.querySelector('.thesis-desk')?.getBoundingClientRect()
    const minTop = (desk?.top ?? 56) + 6
    const maxBottom = (desk?.bottom ?? innerHeight) - 6
    const bar = barRef.current
    let barBottom = rect.top
    let barTop = rect.top
    if (bar) {
      const w = bar.offsetWidth
      const h = bar.offsetHeight
      let top = rect.top - h - 10
      if (top < minTop) top = rect.bottom + 10
      barTop = top
      next.bar = { left: clamp(rect.left + rect.width / 2 - w / 2, 8, innerWidth - w - 8), top }
      barBottom = top > rect.top ? top + h : rect.bottom
    }
    const card = cardRef.current
    if (card) {
      const w = card.offsetWidth
      const h = card.scrollHeight
      const below = Math.max(barBottom, rect.bottom) + 8
      const above = Math.min(rect.top, barTop) - 8
      const roomBelow = maxBottom - below
      const roomAbove = above - minTop
      // Below by default; above only when it fits better there. Scroll if neither fits.
      const down = h <= roomBelow || roomBelow >= roomAbove
      const maxHeight = Math.max(120, down ? roomBelow : roomAbove)
      const top = down ? below : above - Math.min(h, maxHeight)
      next.card = { left: clamp(rect.left + rect.width / 2 - w / 2, 8, innerWidth - w - 8), top, maxHeight }
    }
    setPos(next)
  }, [rect, showToolbar, body])

  return (
    <div ref={ref} onMouseDown={(e) => e.preventDefault()}>
      {showToolbar && (
        <motion.div
          ref={barRef}
          className="fixed z-[60] rounded-xl border bg-popover p-1 shadow-xl shadow-black/10"
          style={pos.bar ? { left: pos.bar.left, top: pos.bar.top } : { visibility: 'hidden', left: 0, top: 0 }}
          initial={{ opacity: 0, scale: 0.95, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        >
          {toolbar}
        </motion.div>
      )}
      <AnimatePresence>
        {body && (
          <motion.div
            ref={cardRef}
            key="card"
            className="fixed z-[61] w-[400px] max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-2xl shadow-black/15"
            style={pos.card ? { left: pos.card.left, top: pos.card.top, maxHeight: pos.card.maxHeight } : { visibility: 'hidden', left: 0, top: 0 }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
          >
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

function Tool({
  label,
  keys,
  onClick,
  active,
  accent,
  disabled,
  children
}: {
  label: string
  keys?: string[]
  onClick: () => void
  active?: boolean
  accent?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Hint label={label} keys={keys} side="top">
      <button
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[15px]',
          active ? 'bg-brand-soft text-brand-text' : accent ? 'text-brand-text hover:bg-brand-soft' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        {children}
      </button>
    </Hint>
  )
}

const Sep = () => <Separator orientation="vertical" className="mx-1 !h-4" />

function Menu({ children }: { children: ReactNode }) {
  return <div className="p-1">{children}</div>
}

function MenuItem({ icon, label, hint, onClick, disabled }: { icon: ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:flex-none [&_svg]:text-muted-foreground"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-[11.5px] text-faint">{hint}</span>}
      </span>
    </button>
  )
}

function CardHeader({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-1.5 border-b px-2 text-[12px] font-medium text-muted-foreground">
      {onBack && (
        <button onClick={onBack} aria-label="Volver" className="grid size-6 place-items-center rounded-md hover:bg-accent hover:text-foreground">
          <ArrowLeft className="size-3.5" />
        </button>
      )}
      <span className="flex-1 truncate pl-1">{title}</span>
      {children}
    </div>
  )
}

// ---------- cards ----------

function AssistCard({
  panel,
  onRetry,
  onBack,
  onReplace
}: {
  panel: Extract<Panel, { type: 'assist' }>
  onRetry: () => void
  onBack: () => void
  onReplace: (text: string) => void
}) {
  const settingsOpen = () => useStore.setState({ settingsOpen: true })
  const title = panel.kind === 'synonyms' ? `Sinónimos de «${stripMarkers(panel.target.text)}»` : ASSIST_LABELS[panel.kind]
  let content: ReactNode
  if (panel.status === 'loading') {
    content = (
      <div className="px-3.5 py-4 text-[13px]">
        <TextShimmer>{LOADING[panel.kind]}</TextShimmer>
      </div>
    )
  } else if (panel.status === 'error') {
    const needsAccount = /Conectá|ChatGPT session|Reconnect/i.test(panel.error ?? '')
    content = (
      <div className="space-y-2 px-3.5 py-3 text-[13px]">
        <p className="text-muted-foreground">{panel.error}</p>
        <button onClick={needsAccount ? settingsOpen : onRetry} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-text hover:underline">
          {needsAccount ? 'Abrir Settings' : (<><RotateCcw className="size-3.5" /> Reintentar</>)}
        </button>
      </div>
    )
  } else if (panel.result) {
    const r = panel.result
    if (r.kind === 'synonyms') {
      content = r.options.length ? (
        <div className="flex max-h-[300px] flex-col overflow-y-auto p-1">
          {r.options.map((o) => (
            <button key={o.text} onClick={() => onReplace(o.text)} className="group flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent">
              <span className="text-[13.5px] font-medium">{o.text}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{o.note}</span>
              <span className="text-[11px] text-brand-text opacity-0 group-hover:opacity-100">Reemplazar</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-3.5 py-3 text-[13px] text-muted-foreground">No hay sinónimos adecuados en este contexto.</p>
      )
    } else if (r.kind === 'correct') {
      const original = panel.target.text
      const same = r.text.trim() === original.trim() || !r.changes.length
      content = same ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-muted-foreground">
          <Check className="size-4 text-success" /> Sin errores de ortografía, gramática ni puntuación.
        </p>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          <p className="px-3.5 pt-3 text-[13.5px] leading-relaxed">
            {diffWords(stripMarkers(original), stripMarkers(r.text)).map((d, i) =>
              d.kind === 'same' ? (
                <span key={i}>{d.text}</span>
              ) : d.kind === 'del' ? (
                <del key={i} className="rounded-sm bg-destructive/12 text-destructive decoration-destructive/60">
                  {d.text}
                </del>
              ) : (
                <ins key={i} className="rounded-sm bg-success/15 text-success no-underline">
                  {d.text}
                </ins>
              )
            )}
          </p>
          <ul className="space-y-1 px-3.5 pt-2.5 pb-1 text-[12px] text-muted-foreground">
            {r.changes.map((ch, i) => (
              <li key={i}>
                <span className="text-destructive line-through">{ch.original}</span> → <span className="text-success">{ch.replacement}</span>
                <span className="text-faint"> · {ch.reason}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t px-3 py-2">
            <button onClick={() => onReplace(r.text)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:opacity-90">
              <Check className="size-3.5" /> Aplicar corrección
            </button>
          </div>
        </div>
      )
    } else if (r.kind === 'ideas') {
      content = (
        <div className="max-h-[360px] overflow-y-auto p-1">
          {r.ideas.map((idea, i) => (
            <div key={i} className="flex gap-2.5 rounded-lg px-2.5 py-2">
              <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-text">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[13.5px] leading-relaxed">{idea.question}</p>
                {idea.why && <p className="mt-0.5 text-[11.5px] text-faint">{idea.why}</p>}
              </div>
            </div>
          ))}
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">Respondelas con tus palabras: son un punto de partida, no texto para copiar.</p>
        </div>
      )
    } else if (r.kind === 'define') {
      content = (
        <div className="space-y-2 px-3.5 py-3 text-[13px] leading-relaxed">
          <p>{r.definition}</p>
          {r.example && <p className="text-muted-foreground italic">{r.example}</p>}
          {r.register && <p className="text-[11.5px] text-faint">{r.register}</p>}
        </div>
      )
    } else {
      content = (
        <div className="max-h-[380px] space-y-1 overflow-y-auto p-1">
          {r.options.map((o, i) => (
            <div key={i} className="group rounded-lg px-2.5 py-2 hover:bg-accent/60">
              <p className="text-[13.5px] leading-relaxed">{stripMarkers(o.text)}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[11.5px] text-faint">{o.note}</span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(stripMarkers(o.text))
                    toast('Copiado')
                  }}
                  className="text-[11.5px] text-muted-foreground hover:text-foreground"
                >
                  Copiar
                </button>
                <button onClick={() => onReplace(o.text)} className="text-[11.5px] font-medium text-brand-text hover:underline">
                  Reemplazar
                </button>
              </div>
            </div>
          ))}
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">Revisá cada sugerencia: la versión final tiene que reflejar tu criterio.</p>
        </div>
      )
    }
  }
  return (
    <>
      <CardHeader title={title} onBack={panel.kind === 'synonyms' || panel.kind === 'correct' || panel.kind === 'ideas' ? undefined : onBack} />
      {content}
    </>
  )
}

function Connectors({ onPick }: { onPick: (c: Connector) => void }) {
  return (
    <>
      <CardHeader title="Conectores" />
      <div className="max-h-[340px] space-y-2 overflow-y-auto px-3 py-2.5">
        {CONNECTOR_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
              {g.label} <span className="font-normal tracking-normal normal-case">· {g.hint}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {g.items.map((c) => (
                <button
                  key={c.text}
                  onClick={() => onPick(c)}
                  className="rounded-md border bg-card px-2 py-0.5 text-[12.5px] transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand-text"
                >
                  {c.text}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function LintCard({ issue, onFix, onIgnore, onSynonyms }: { issue: LintIssue; onFix: (fix: string) => void; onIgnore: () => void; onSynonyms: () => void }) {
  return (
    <>
      <CardHeader title={LINT_RULE_LABELS[issue.rule] ?? 'Estilo'}>
        <button onClick={onIgnore} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] hover:bg-accent hover:text-foreground" title="No volver a marcar este caso">
          <EyeOff className="size-3.5" /> Ignorar
        </button>
      </CardHeader>
      <div className="space-y-2 px-3.5 py-3">
        <p className="text-[13.5px] font-medium">{issue.title}</p>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{issue.detail}</p>
        {(issue.fixes.length > 0 || issue.synonyms) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {issue.fixes.map((f) => (
              <button
                key={f || 'delete'}
                onClick={() => onFix(f)}
                className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-[12.5px] transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand-text"
              >
                {f === '' ? (<><X className="size-3" /> Quitar</>) : f === ' ' ? 'Un solo espacio' : f}
              </button>
            ))}
            {issue.synonyms && (
              <button onClick={onSynonyms} className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand-soft px-2 py-0.5 text-[12.5px] text-brand-text">
                <Replace className="size-3" /> Ver sinónimos
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

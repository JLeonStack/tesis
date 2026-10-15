import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Highlighter,
  List,
  ListOrdered,
  TextQuote,
  Quote as CiteIcon,
  Superscript,
  SeparatorHorizontal,
  MoreHorizontal,
  Sparkles,
  Check,
  ChevronDown,
  Minus,
  Plus,
  FileDown,
  FileText,
  Wand2,
  ScanText,
  TextCursorInput,
  ListTree,
  History,
  BookCheck
} from 'lucide-react'
import type { Thesis, ThesisMeta } from '@shared/types'
import { openPalette, saveThesis, toast, useStore } from '../store'
import { registerEditor } from '../editor/noteBridge'
import { debounce, mod } from '../lib/util'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Hint, IconButton } from '../components/common'
import { buildThesisExtensions, completeOutline } from './schema'
import { runInOf } from './analyze'
import { buildThesisModel, type WordCounts } from './model'
import { AuthorizationsSheet, CoverSheet } from './Sheets'
import { FootnoteEditor } from './FootnoteEditor'
import { ABSTRACT_LIMIT, WORD_LIMIT } from './template'
import { exportThesisDocx, exportThesisPdf } from './exporting'
import { registerThesisEditor, registerThesisMeta, thesisEditor } from './bridge'
import { backSentence } from './evidence'
import { uncitedEnabled, uncitedSentences } from './uncited'
import { maybeAutoVersion } from './versions'
import { VersionsDialog } from './VersionsDialog'
import { loadThesisFonts } from './fonts'
import { WritingToolbar, openHelpers } from './WritingToolbar'
import { lintEnabled, lintIssues } from './lint'
import { autocompleteEnabled } from './autocomplete'

export function ThesisEditor({ thesisId }: { thesisId: string }) {
  const thesis = useStore((s) => s.theses[thesisId])
  if (!thesis) return <div className="p-10 text-muted-foreground">No se encontró la tesis.</div>
  return <ThesisEditorInner key={thesisId} thesis={thesis} />
}

const STYLES = [
  { level: 0, label: 'Texto normal', hint: 'Párrafo con sangría de 1,27 cm' },
  { level: 1, label: 'Nivel 1', hint: 'Negrita, centrado' },
  { level: 2, label: 'Nivel 2', hint: 'Negrita, alineado a la izquierda' },
  { level: 3, label: 'Nivel 3', hint: 'Negrita cursiva, a la izquierda' },
  { level: 4, label: 'Nivel 4', hint: 'Negrita, en línea con sangría. Termina en punto' },
  { level: 5, label: 'Nivel 5', hint: 'Negrita cursiva, en línea con sangría. Termina en punto' }
]

const ZOOM_KEY = 'thesis-zoom'
const readZoom = (): number | null => {
  try {
    return Number(localStorage.getItem(ZOOM_KEY)) || null
  } catch {
    return null
  }
}
const SHEET_PX = 816 // 8.5in at 96 dpi

function ThesisEditorInner({ thesis }: { thesis: Thesis }) {
  const id = thesis.id
  const [meta, setMeta] = useState<ThesisMeta>(thesis.meta)
  const metaRef = useRef(meta)
  const [saved, setSavedState] = useState(true)
  const savedRef = useRef(true)
  const setSaved = (v: boolean) => {
    savedRef.current = v
    setSavedState(v)
  }
  const [words, setWords] = useState<WordCounts | null>(null)
  const deskRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoomState] = useState(() => readZoom() ?? 1)
  const setZoom = (z: number | ((z: number) => number)) =>
    setZoomState((prev) => {
      const v = Math.round(Math.min(1.5, Math.max(0.5, typeof z === 'function' ? z(prev) : z)) * 100) / 100
      try {
        localStorage.setItem(ZOOM_KEY, String(v))
      } catch {
        // ignore
      }
      return v
    })
  const fitWidth = () => {
    const w = deskRef.current?.clientWidth
    if (w) setZoom(Math.min(1, (w - 56) / SHEET_PX))
  }
  // First time: fit the page to the pane instead of overflowing it.
  useEffect(() => {
    void loadThesisFonts()
    if (readZoom() == null) fitWidth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistNow = (ed: Editor | null) => {
    const cur = useStore.getState().theses[id]
    if (!cur) return
    const next: Thesis = { ...cur, meta: metaRef.current, updatedAt: Date.now() }
    if (ed && !ed.isDestroyed) {
      next.content = ed.getJSON()
      next.plain = ed.getText({ blockSeparator: '\n' })
    }
    saveThesis(next)
    maybeAutoVersion(next)
    setSaved(true)
  }
  const persist = useMemo(() => debounce(persistNow, 500), [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const recount = useMemo(
    () => debounce((ed: Editor) => !ed.isDestroyed && setWords(buildThesisModel(ed.state.doc, metaRef.current).words), 250),
    []
  )

  const editor = useEditor(
    {
      extensions: buildThesisExtensions(),
      content: thesis.content as object,
      editorProps: {
        attributes: { class: 'thesis-prose', spellcheck: 'true', lang: 'es' },
        handleKeyDown: (_view, e) => {
          if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
            openPalette('cite', id)
            return true
          }
          // ⌘⌥E: back the sentence at the caret (or the selection) with the library.
          if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyE') {
            const ed = thesisEditor(id)
            if (ed) backSentence(ed, id)
            return true
          }
          return false
        }
      },
      onCreate: ({ editor }) => recount(editor),
      onUpdate: ({ editor }) => {
        setSaved(false)
        persist(editor)
        recount(editor)
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false
    },
    [id]
  )

  useEffect(() => (editor ? registerEditor(id, editor) : undefined), [editor, id])
  useEffect(() => (editor ? registerThesisEditor(id, editor) : undefined), [editor, id])
  useEffect(
    () =>
      registerThesisMeta(id, {
        get: () => metaRef.current,
        set: (m) => {
          metaRef.current = m
          setMeta(m)
        }
      }),
    [id]
  )
  useEffect(
    () => () => {
      persist.cancel()
      recount.cancel()
    },
    [persist, recount]
  )

  // Flush pending changes when the window hides or the component unmounts.
  useEffect(() => {
    const flush = () => persistNow(editor)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (!savedRef.current) {
        persist.cancel()
        flush()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id])

  const patchMeta = (patch: Partial<ThesisMeta> | ((m: ThesisMeta) => Partial<ThesisMeta>)) => {
    const next = { ...metaRef.current, ...(typeof patch === 'function' ? patch(metaRef.current) : patch) }
    metaRef.current = next
    setMeta(next)
    setSaved(false)
    persist(editor)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {editor && <Toolbar editor={editor} thesisId={id} zoom={zoom} setZoom={setZoom} fitWidth={fitWidth} flush={() => persistNow(editor)} />}
      <div ref={deskRef} className="thesis-desk min-h-0 flex-1 overflow-auto">
        <div className="thesis-pages" style={{ zoom }}>
          <CoverSheet meta={meta} onChange={patchMeta} />
          <EditorContent editor={editor} />
          <AuthorizationsSheet meta={meta} onChange={patchMeta} />
        </div>
      </div>
      <StatusBar words={words} saved={saved} />
      {editor && <FootnoteEditor editor={editor} />}
      {editor && <WritingToolbar editor={editor} thesisId={id} />}
    </div>
  )
}

function StatusBar({ words, saved }: { words: WordCounts | null; saved: boolean }) {
  const total = words?.total ?? 0
  const ratio = total / WORD_LIMIT
  const tone = ratio > 1 ? 'text-destructive' : ratio > 0.9 ? 'text-bloom-amber' : 'text-muted-foreground'
  const abstractOver = (words?.resumen ?? 0) > ABSTRACT_LIMIT
  const fmt = (n: number) => n.toLocaleString('es-AR')
  return (
    <div className="flex h-8 flex-none items-center gap-4 border-t bg-card px-3 text-[11.5px] text-muted-foreground tabular-nums">
      <Hint label="Límite: 18.000 palabras, incluyendo resumen, referencias y notas al pie" side="top">
        <span className={cn('flex items-center gap-2', tone)}>
          <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <span
              className={cn('absolute inset-y-0 left-0 rounded-full', ratio > 1 ? 'bg-destructive' : ratio > 0.9 ? 'bg-bloom-amber' : 'bg-brand')}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </span>
          {fmt(total)} / {fmt(WORD_LIMIT)} palabras
        </span>
      </Hint>
      <Hint label="El resumen admite hasta 250 palabras (sin contar las palabras clave)" side="top">
        <span className={cn(abstractOver && 'text-destructive')}>
          Resumen {fmt(words?.resumen ?? 0)} / {ABSTRACT_LIMIT}
        </span>
      </Hint>
      {!!words?.footnotes && <span>Notas {fmt(words.footnotes)}</span>}
      {!!words?.references && <span>Referencias {fmt(words.references)}</span>}
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 text-faint" title={saved ? 'Todos los cambios guardados' : 'Guardando…'}>
        {saved ? (
          <>
            <Check className="size-3" /> Guardado
          </>
        ) : (
          <>
            <span className="size-1.5 animate-pulse rounded-full bg-faint" /> Guardando…
          </>
        )}
      </span>
    </div>
  )
}

function Toolbar({
  editor,
  thesisId,
  zoom,
  setZoom,
  fitWidth,
  flush
}: {
  editor: Editor
  thesisId: string
  zoom: number
  setZoom: (z: (z: number) => number) => void
  fitWidth: () => void
  flush: () => void
}) {
  const [versionsOpen, setVersionsOpen] = useState(false)
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from } = e.state.selection
      let level = 0
      if ($from.parent.type.name === 'heading') level = $from.parent.attrs.level
      else if ($from.parent.type.name === 'paragraph') {
        const stored = (e.state.storedMarks ?? $from.marks()).find((m) => m.type.name === 'runIn')
        level = stored?.attrs.level ?? runInOf($from.parent)?.level ?? 0
      }
      const kind = $from.depth >= 1 ? $from.node(1).attrs.kind : 'cuerpo'
      return {
        level,
        kind,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        highlight: e.isActive('highlight'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        quote: e.isActive('blockquote'),
        lintOn: lintEnabled(e.state),
        lintCount: lintIssues(e.state).length,
        acOn: autocompleteEnabled(e.state),
        uncitedOn: uncitedEnabled(e.state),
        uncitedCount: uncitedSentences(e.state).length
      }
    }
  })
  const c = () => editor.chain().focus()
  const styleLabel = STYLES.find((s) => s.level === st.level)?.label ?? 'Texto normal'
  const headingsAllowed = st.kind === 'cuerpo' || st.kind === 'apendices'

  const T = ({ on, label, keys, run, children }: { on?: boolean; label: string; keys?: string[]; run: () => void; children: React.ReactNode }) => (
    <Hint label={label} keys={keys}>
      <button
        aria-label={label}
        aria-pressed={on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={run}
        className={cn(
          'grid size-7 place-items-center rounded-md transition-colors [&_svg]:size-[15px]',
          on ? 'bg-brand-soft text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        {children}
      </button>
    </Hint>
  )
  const Sep = () => <Separator orientation="vertical" className="mx-1 !h-4" />

  return (
    <div className="scrollbar-none flex h-10 flex-none items-center gap-0.5 overflow-x-auto border-b bg-card px-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="h-7 w-[124px] justify-between font-normal text-muted-foreground" onMouseDown={(e) => e.preventDefault()}>
            {styleLabel} <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
          {STYLES.map((s) => (
            <DropdownMenuItem
              key={s.level}
              disabled={s.level > 0 && !headingsAllowed}
              onSelect={() => editor.chain().focus().setThesisStyle(s.level).run()}
              className="flex-col items-start gap-0"
            >
              <span className={cn('thesis-style-sample', `lvl-${s.level}`)}>{s.label}</span>
              <span className="text-[11px] text-faint">{s.hint}</span>
              {s.level > 0 && s.level < 4 && <DropdownMenuShortcut className="absolute right-2">{'#'.repeat(s.level)}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Sep />
      <T on={st.bold} label="Negrita" keys={[mod, 'B']} run={() => c().toggleBold().run()}>
        <Bold />
      </T>
      <T on={st.italic} label="Cursiva" keys={[mod, 'I']} run={() => c().toggleItalic().run()}>
        <Italic />
      </T>
      <T on={st.highlight} label="Resaltar (solo borrador, no se exporta)" keys={[mod, '⇧', 'H']} run={() => c().toggleHighlight().run()}>
        <Highlighter />
      </T>
      <Sep />
      <T on={st.bullet} label="Lista con viñetas" keys={['-']} run={() => c().toggleBulletList().run()}>
        <List />
      </T>
      <T on={st.ordered} label="Lista numerada" keys={['1.']} run={() => c().toggleOrderedList().run()}>
        <ListOrdered />
      </T>
      <T on={st.quote} label="Cita en bloque (40 palabras o más)" keys={['>']} run={() => c().toggleBlockquote().run()}>
        <TextQuote />
      </T>
      <Sep />
      <T label="Nota al pie" keys={[mod, '⌥', 'F']} run={() => c().insertFootnote().run()}>
        <Superscript />
      </T>
      <T label="Salto de página" run={() => c().insertPageBreak().run()}>
        <SeparatorHorizontal />
      </T>
      <Hint label="Citar una fuente (APA)" keys={[mod, '⇧', 'C']}>
        <Button
          variant="ghost"
          size="xs"
          className="h-7 text-brand-text hover:bg-brand-soft hover:text-brand-text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openPalette('cite', null)}
        >
          <CiteIcon /> Citar
        </Button>
      </Hint>
      <Hint label="Respaldar con tu biblioteca: papers que dicen algo parecido, con el pasaje, la página y si lo apoyan" keys={[mod, '⌥', 'E']}>
        <Button
          variant="ghost"
          size="xs"
          className="h-7 text-muted-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => backSentence(editor, thesisId)}
        >
          <BookCheck /> Respaldar
        </Button>
      </Hint>
      <Hint
        label={
          st.uncitedOn
            ? 'Oraciones sin cita marcadas en el texto (subrayado punteado). Clic para dejar de marcarlas'
            : 'Marcar las oraciones del cuerpo que afirman algo y no tienen cita'
        }
      >
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={st.uncitedOn}
          className={cn('h-7 tabular-nums', st.uncitedOn ? 'text-foreground' : 'text-faint')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.toggleUncitedMarks()}
        >
          {st.uncitedCount ? `${st.uncitedCount} sin cita` : 'Todo citado'}
          {st.uncitedOn && st.uncitedCount > 0 && <span className="size-1.5 rounded-full bg-bloom-pink" />}
        </Button>
      </Hint>
      <Sep />
      <Hint label="Ayudas de redacción: sinónimos, correcciones, conectores… (o seleccioná texto)" keys={[mod, '.']}>
        <Button variant="ghost" size="xs" className="h-7 text-muted-foreground" onMouseDown={(e) => e.preventDefault()} onClick={() => {
          editor.commands.focus()
          openHelpers()
        }}>
          <Wand2 /> Ayudas
        </Button>
      </Hint>
      <Hint label={st.lintOn ? 'Revisión de estilo activada: subraya muletillas, anglicismos, repeticiones y oraciones largas' : 'Activar la revisión de estilo'}>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={st.lintOn}
          className={cn('h-7 tabular-nums', st.lintOn ? 'text-foreground' : 'text-faint')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.toggleStyleCheck()}
        >
          <ScanText />
          {st.lintOn ? (st.lintCount ? `${st.lintCount} ${st.lintCount === 1 ? 'sugerencia' : 'sugerencias'}` : 'Sin sugerencias') : 'Estilo'}
          {st.lintOn && st.lintCount > 0 && <span className="size-1.5 rounded-full bg-bloom-amber" />}
        </Button>
      </Hint>
      <Hint
        label={
          st.acOn
            ? 'Autocompletar activado: al pausar al final de un párrafo sugiere cómo terminar la oración. Tab acepta · ⌥→ una palabra · Esc descarta'
            : 'Activar autocompletar'
        }
        keys={['⌥', '↩']}
      >
        <button
          aria-label="Autocompletar"
          aria-pressed={st.acOn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.toggleAutocomplete()}
          className={cn(
            'grid size-7 place-items-center rounded-md transition-colors [&_svg]:size-[15px]',
            st.acOn ? 'bg-brand-soft text-brand-text' : 'text-faint hover:bg-accent hover:text-foreground'
          )}
        >
          <TextCursorInput />
        </button>
      </Hint>
      <span className="flex-1" />
      <IconButton label="Alejar" onClick={() => setZoom((z) => z - 0.1)}>
        <Minus />
      </IconButton>
      <button className="w-10 text-center text-[11.5px] text-muted-foreground tabular-nums hover:text-foreground" title="Ajustar al ancho" onClick={fitWidth}>
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Acercar" onClick={() => setZoom((z) => z + 0.1)}>
        <Plus />
      </IconButton>
      <Sep />
      <IconButton
        label="Historial de versiones"
        onClick={() => {
          flush()
          setVersionsOpen(true)
        }}
      >
        <History />
      </IconButton>
      <VersionsDialog thesisId={thesisId} open={versionsOpen} onOpenChange={setVersionsOpen} />
      <IconButton label="Revisar con el asistente" keys={[mod, 'J']} onClick={() => useStore.setState({ rightOpen: true, rightTab: 'assistant' })}>
        <Sparkles />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Más" className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem
            onSelect={() => {
              flush()
              void exportThesisDocx()
            }}
          >
            <FileText /> Exportar a Word (.docx)…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              flush()
              void exportThesisPdf()
            }}
          >
            <FileDown /> Exportar a PDF…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              const n = completeOutline(editor)
              toast(
                n ? `Se agregaron ${n} título${n === 1 ? '' : 's'} de la plantilla` : 'La tesis ya tiene todos los títulos de la plantilla',
                n ? { label: 'Deshacer', run: () => editor.commands.undo() } : undefined,
                n ? { status: 'success' } : {}
              )
            }}
          >
            <ListTree /> Completar la estructura de la plantilla
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              flush()
              setVersionsOpen(true)
            }}
          >
            <History /> Historial de versiones…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => useStore.setState({ rightOpen: true, rightTab: 'checks' })}>Ver requisitos UCEMA</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useStore.setState({ rightOpen: true, rightTab: 'outline' })}>Ver esquema</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useStore.setState({ rightOpen: true, rightTab: 'support' })}>Ver oraciones sin cita</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

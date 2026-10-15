import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Highlighter,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Quote as CiteIcon,
  MoreHorizontal,
  Plus,
  FileText,
  Sparkles,
  Check,
  X
} from 'lucide-react'
import type { Note } from '@shared/types'
import { deleteNote, openPalette, openTab, saveNote, useStore } from '../store'
import { buildExtensions } from './extensions'
import { registerEditor } from './noteBridge'
import { citedPaperIds, copyText, noteToMarkdown, bibliography, notePapers, exportActiveNote } from '../lib/exporting'
import { shortLabel, plainRef } from '../lib/citation'
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

export function NoteEditor({ noteId, side = false }: { noteId: string; side?: boolean }) {
  const note = useStore((s) => s.notes[noteId])
  if (!note) return <div className="p-10 text-muted-foreground">Esta nota fue eliminada.</div>
  return <NoteEditorInner key={noteId} note={note} side={side} />
}

function NoteEditorInner({ note, side }: { note: Note; side: boolean }) {
  const noteId = note.id
  const [title, setTitle] = useState(note.title)
  const [saved, setSavedState] = useState(true)
  const savedRef = useRef(true)
  const setSaved = (v: boolean) => {
    savedRef.current = v
    setSavedState(v)
  }
  const titleRef = useRef<HTMLTextAreaElement>(null)

  const persist = useMemo(
    () =>
      debounce((ed: Editor | null, t: string) => {
        const cur = useStore.getState().notes[noteId]
        if (!cur) return
        const next: Note = { ...cur, title: t, updatedAt: Date.now() }
        if (ed) {
          next.content = ed.getJSON()
          next.plain = ed.getText({ blockSeparator: '\n' })
          const cited = citedPaperIds(next.content).filter((id) => !cur.paperIds.includes(id))
          if (cited.length) next.paperIds = [...cur.paperIds, ...cited]
        }
        saveNote(next)
        setSaved(true)
      }, 400),
    [noteId]
  )

  const editor = useEditor(
    {
      extensions: buildExtensions(side ? 'Anotá ideas mientras leés…' : 'Empezá a escribir. Funcionan los atajos de Markdown: # título, - lista, > cita textual'),
      content: (note.content as object) ?? '',
      autofocus: !side && !note.plain && !!note.title ? 'end' : false,
      editorProps: {
        attributes: { class: 'prose', spellcheck: 'true' },
        handleKeyDown: (_view, e) => {
          if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
            openPalette('cite', noteId)
            return true
          }
          return false
        }
      },
      onUpdate: ({ editor }) => {
        setSaved(false)
        persist(editor, titleRef.current?.value ?? '')
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false
    },
    [noteId]
  )

  useEffect(() => (editor ? registerEditor(noteId, editor) : undefined), [editor, noteId])
  useEffect(() => () => persist.cancel(), [persist])

  // Flush pending changes when the window hides or the component unmounts.
  useEffect(() => {
    const flush = () => editor && !editor.isDestroyed && persistNow(editor)
    const persistNow = (ed: Editor) => {
      persist.cancel()
      const cur = useStore.getState().notes[noteId]
      if (!cur) return
      saveNote({ ...cur, title: titleRef.current?.value ?? cur.title, content: ed.getJSON(), plain: ed.getText({ blockSeparator: '\n' }), updatedAt: Date.now() })
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (!savedRef.current) flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId])

  // Autosize title.
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = '0'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  const papers = useStore((s) => s.papers)
  const linked = note.paperIds.map((id) => papers[id]).filter(Boolean)

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-card', side && 'note-side')}>
      {editor && <Toolbar editor={editor} note={note} saved={saved} side={side} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto max-w-[740px]', side ? 'px-7 pt-6 pb-[40vh]' : 'px-12 pt-11 pb-[40vh]')}>
          <textarea
            ref={titleRef}
            className={cn(
              'block w-full resize-none overflow-hidden bg-transparent font-heading leading-tight font-medium tracking-tight outline-none placeholder:text-faint',
              side ? 'text-[22px]' : 'text-[32px]'
            )}
            placeholder="Sin título"
            rows={1}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setSaved(false)
              persist(editor, e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
          />
          <div className="mt-3 mb-5 flex flex-wrap gap-1.5">
            {linked.map((p) => (
              <button
                key={p.id}
                onClick={() => openTab({ kind: 'paper', id: p.id })}
                title={p.title}
                className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground"
              >
                <FileText className="size-3" /> {shortLabel(p)}
              </button>
            ))}
            <button
              onClick={() => openPalette('link', noteId)}
              title="Vincular un paper a esta nota"
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed px-2.5 text-xs font-medium text-faint transition-colors hover:border-primary hover:text-brand-text"
            >
              <Plus className="size-3" /> {linked.length ? 'Vincular paper' : 'Vincular los papers de esta nota'}
            </button>
          </div>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

function Toolbar({ editor, note, saved, side }: { editor: Editor; note: Note; saved: boolean; side: boolean }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      highlight: e.isActive('highlight'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      words: e.storage.characterCount?.words?.() ?? 0
    })
  })
  const c = () => editor.chain().focus()
  const current = () => useStore.getState().notes[note.id] ?? note

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
      <T on={st.bold} label="Negrita" keys={[mod, 'B']} run={() => c().toggleBold().run()}>
        <Bold />
      </T>
      <T on={st.italic} label="Cursiva" keys={[mod, 'I']} run={() => c().toggleItalic().run()}>
        <Italic />
      </T>
      <T on={st.highlight} label="Resaltado" keys={[mod, '⇧', 'H']} run={() => c().toggleHighlight().run()}>
        <Highlighter />
      </T>
      <Sep />
      {!side && (
        <>
          <T on={st.h1} label="Título 1" keys={['#']} run={() => c().toggleHeading({ level: 1 }).run()}>
            <Heading1 />
          </T>
          <T on={st.h2} label="Título 2" keys={['##']} run={() => c().toggleHeading({ level: 2 }).run()}>
            <Heading2 />
          </T>
          <Sep />
        </>
      )}
      <T on={st.bullet} label="Lista con viñetas" keys={['-']} run={() => c().toggleBulletList().run()}>
        <List />
      </T>
      {!side && (
        <T on={st.ordered} label="Lista numerada" keys={['1.']} run={() => c().toggleOrderedList().run()}>
          <ListOrdered />
        </T>
      )}
      <T on={st.task} label="Lista de tareas" keys={['[]']} run={() => c().toggleTaskList().run()}>
        <ListChecks />
      </T>
      <T on={st.quote} label="Cita textual" keys={['>']} run={() => c().toggleBlockquote().run()}>
        <Quote />
      </T>
      <Sep />
      <Hint label="Insertar cita" keys={[mod, '⇧', 'C']}>
        <Button
          variant="ghost"
          size="xs"
          className="h-7 text-brand-text hover:bg-brand-soft hover:text-brand-text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openPalette('cite', note.id)}
        >
          <CiteIcon /> {!side && 'Citar'}
        </Button>
      </Hint>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 px-1.5 text-[11.5px] whitespace-nowrap text-faint tabular-nums" title={saved ? 'Todos los cambios guardados' : 'Guardando…'}>
        {!side && `${st.words} ${st.words === 1 ? 'palabra' : 'palabras'}`}
        {saved ? <Check className="size-3" /> : <span className="size-1.5 animate-pulse rounded-full bg-faint" />}
      </span>
      {!side && (
        <IconButton label="Preguntar al asistente sobre esta nota" keys={[mod, 'J']} onClick={() => useStore.setState({ rightOpen: true, rightTab: 'assistant' })}>
          <Sparkles />
        </IconButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Más" className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {side && <DropdownMenuItem onSelect={() => openTab({ kind: 'note', id: note.id })}>Abrir como pestaña</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => void copyText(noteToMarkdown(current()), 'Markdown copiado')}>Copiar como Markdown</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              const refs = bibliography(notePapers(current()))
              if (refs.length) void copyText(refs.map(plainRef).join('\n\n'), `${refs.length} referencias copiadas`)
            }}
          >
            Copiar bibliografía
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportActiveNote()}>
            Exportar como Markdown… <DropdownMenuShortcut>{mod}⇧E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => deleteNote(note.id)}>
            Eliminar nota
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {side && (
        <IconButton label="Cerrar nota lateral" keys={[mod, '⇧', 'N']} onClick={() => useStore.setState({ sideNoteId: null })}>
          <X />
        </IconButton>
      )}
    </div>
  )
}

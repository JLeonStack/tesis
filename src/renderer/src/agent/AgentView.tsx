import { Eye, FileText, NotebookPen, Sparkles, X } from 'lucide-react'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { openTab, useStore } from '../store'
import { shortLabel } from '../lib/citation'
import { mod } from '../lib/util'

/**
 * The general assistant, in its own tab: one conversation about the whole
 * workspace. It knows what you were just looking at (the focus chip), so
 * "this paper" works after switching here from the reader.
 */
export function AgentView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none items-center gap-2.5 border-b px-5 py-3">
        <span className="grid size-7 place-items-center rounded-lg bg-brand text-white">
          <Sparkles className="size-3.5" />
        </span>
        <div className="mr-auto min-w-0">
          <h1 className="text-[14px] leading-tight font-semibold">Asistente</h1>
          <p className="text-[11.5px] text-muted-foreground">Sabe lo que estás haciendo y puede actuar en toda la app. También está en el panel lateral de cada vista · {mod}⌥A</p>
        </div>
        <FocusChip />
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-[800px] flex-1 flex-col">
        <AssistantPanel />
      </div>
    </div>
  )
}

/** What "this paper" or "this note" means right now; clear it to talk about nothing in particular. */
function FocusChip() {
  const focus = useStore((s) => s.focus)
  const paper = useStore((s) => (s.focus?.kind === 'paper' ? s.papers[s.focus.id] : undefined))
  const note = useStore((s) => (s.focus?.kind === 'note' ? s.notes[s.focus.id] : undefined))
  if (!focus || (!paper && !note)) return <span className="text-[11.5px] text-faint">Sin foco: abrí un paper o una nota y volvé</span>
  return (
    <span className="flex max-w-[320px] items-center gap-1.5 rounded-full border bg-card py-0.5 pr-1 pl-2.5 text-[12px]" title="Lo que el asistente entiende por «este paper» o «esta nota»">
      <Eye className="size-3.5 flex-none text-faint" />
      <button
        className="flex min-w-0 items-center gap-1 hover:underline"
        onClick={() => openTab(paper ? { kind: 'paper', id: paper.id } : { kind: 'note', id: note!.id })}
      >
        {paper ? <FileText className="size-3.5 flex-none text-kind-paper" /> : <NotebookPen className="size-3.5 flex-none text-kind-note" />}
        <span className="truncate">{paper ? `${shortLabel(paper)}${paper.lastPage ? ` · p. ${paper.lastPage}` : ''}` : note!.title || 'Nota sin título'}</span>
      </button>
      <button aria-label="Quitar el foco" onClick={() => useStore.setState({ focus: null })} className="grid size-5 flex-none place-items-center rounded-full text-faint hover:bg-accent hover:text-foreground">
        <X className="size-3" />
      </button>
    </span>
  )
}

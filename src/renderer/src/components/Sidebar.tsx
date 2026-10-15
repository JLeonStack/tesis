import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, NotebookPen, Plus, Search, Settings2, Star, FilePlus2, PanelLeftClose, PanelLeftOpen, Pin, Upload, GraduationCap, ListTodo, Shapes, Table2, BookOpenText, Sparkles, Bookmark, Crosshair, ChartColumn } from 'lucide-react'
import type { Note, Paper } from '@shared/types'
import { createNote, deleteNote, deletePaper, openBoard, openMatrix, openPalette, openTab, openTasks, openThesis, openWiki, openAgent, openResearch, openAnalysis, addToList, removeFromList, deleteList, listByName, CANDIDATES_LIST, patchPaper, providerLabel, saveNote, useStore } from '../store'
import { bucketOf, today } from '../tasks/dates'
import { deliveryLabel, frameworkChecks, nextDelivery, pairLabel } from '../research/framework'
import { importPapers } from '../lib/ingest'
import { authorLine } from '../lib/citation'
import { matchScore, mod, timeAgo } from '../lib/util'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { EmptyState, IconButton } from './common'
import { Collapsible } from './Collapsible'
import { Rail, RailButton } from './Rail'
import { Segmented } from './Segmented'

type Filter = 'all' | 'reading' | 'unread' | 'starred' | `list:${string}`
const FILTERS: { id: Filter; label: string; dot?: string; star?: boolean }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'reading', label: 'Leyendo', dot: 'bg-status-reading' },
  { id: 'unread', label: 'Por leer', dot: 'bg-status-unread' },
  { id: 'starred', label: 'Destacados', star: true }
]

export function Sidebar() {
  const view = useStore((s) => s.sidebarView)
  const paperCount = useStore((s) => Object.keys(s.papers).length)
  const noteCount = useStore((s) => Object.keys(s.notes).length)

  return (
    <aside className="flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="drag flex h-[46px] flex-none items-center justify-end px-2.5">
        <IconButton label="Contraer barra lateral" keys={[mod, '\\']} onClick={() => useStore.setState({ sidebarOpen: false })}>
          <PanelLeftClose />
        </IconButton>
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-2.5">
        <button
          onClick={() => openPalette()}
          className="group flex h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-muted-foreground shadow-xs transition-colors hover:border-input hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Buscar o saltar a…</span>
          <Kbd>{mod}K</Kbd>
        </button>
        <div className="-mt-1.5 flex flex-col">
          <AgentButton />
          <ResearchButton />
          <ThesisButton />
          <WhiteboardButton />
          <MatrixButton />
          <AnalysisButton />
          <TasksButton />
          <WikiButton />
        </div>
        <Segmented
          fill
          value={view}
          onChange={(v) => useStore.setState({ sidebarView: v })}
          items={[
            { value: 'library', label: 'Biblioteca', icon: <BookOpen className="text-kind-paper" />, count: paperCount },
            { value: 'notes', label: 'Notas', icon: <NotebookPen className="text-kind-note" />, count: noteCount }
          ]}
        />
      </div>

      {view === 'library' ? <LibraryList /> : <NotesList />}
      <SidebarFooter />
    </aside>
  )
}

/** The course's framework: the two topics crossed, and what still breaks it. */
function ResearchButton() {
  const on = useStore((s) => s.active === 'research:framework')
  const settings = useStore((s) => s.settings)
  const { pair, problems, next } = useMemo(() => {
    const problems = frameworkChecks(settings).filter((c) => !c.ok && c.severity !== 'info').length
    return { pair: settings.research.constructs.length === 2 ? pairLabel(settings.research, true) : '', problems, next: nextDelivery() }
  }, [settings])
  return (
    <button
      onClick={openResearch}
      title={`Abrir el marco de investigación (${mod}⌥M)${pair ? `: ${pair}` : ''}`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <Crosshair className="size-4 flex-none text-bloom-teal" />
      <span className="min-w-0 flex-1 truncate font-medium">{pair || 'Marco de investigación'}</span>
      {!pair ? (
        <span className="text-[11px] font-medium text-destructive">Elegí 2 temas</span>
      ) : problems ? (
        <span className="text-[11px] text-bloom-amber tabular-nums" title={`${problems} punto${problems > 1 ? 's' : ''} para revisar`}>
          {problems}
        </span>
      ) : (
        next && (
          <span className="text-[11px] text-faint tabular-nums" title={`Días para la ${deliveryLabel(next.n).toLowerCase()}`}>
            {next.left} d
          </span>
        )
      )}
    </button>
  )
}

/** A place to think visually: one Excalidraw board, always one click away. */
function WhiteboardButton() {
  const on = useStore((s) => s.active === 'board:excalidraw')
  return (
    <button
      onClick={openBoard}
      title={`Abrir pizarra (${mod}⌥B)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <Shapes className="size-4 flex-none text-bloom-lilac" />
      <span className="min-w-0 flex-1 truncate font-medium">Pizarra</span>
      <span className="text-[11px] text-faint">Excalidraw</span>
    </button>
  )
}

/** Every paper in the same comparable fields, side by side. */
function MatrixButton() {
  const on = useStore((s) => s.active === 'matrix:library')
  return (
    <button
      onClick={openMatrix}
      title={`Abrir matriz de literatura (${mod}⌥L)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <Table2 className="size-4 flex-none text-bloom-teal" />
      <span className="min-w-0 flex-1 truncate font-medium">Matriz de literatura</span>
    </button>
  )
}

/** The course dataset, scored and tested for the student's pair. */
function AnalysisButton() {
  const on = useStore((s) => s.active === 'analysis:data')
  const loaded = useStore((s) => !!s.settings.analysis.datasetId && !!s.datasets[s.settings.analysis.datasetId])
  return (
    <button
      onClick={openAnalysis}
      title={`Abrir el análisis de datos (${mod}⌥Y)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <ChartColumn className="size-4 flex-none text-bloom-amber" />
      <span className="min-w-0 flex-1 truncate font-medium">Análisis de datos</span>
      {!loaded && <span className="text-[11px] text-faint">Importar base</span>}
    </button>
  )
}

/** What's due today or late, counted (Zeigarnik): the plan stays in view. */
function useDueTasks(): { due: number; late: number } {
  const tasks = useStore((s) => s.tasks)
  return useMemo(() => {
    const now = today()
    let due = 0
    let late = 0
    for (const t of Object.values(tasks)) {
      const b = bucketOf(t, now)
      if (b === 'overdue') late++
      if (b === 'overdue' || b === 'today') due++
    }
    return { due, late }
  }, [tasks])
}

/** Tasks and the thesis timeline. */
function TasksButton() {
  const on = useStore((s) => s.active === 'tasks:all')
  const { due, late } = useDueTasks()
  return (
    <button
      onClick={() => openTasks()}
      title={`Abrir tareas (${mod}⌥D)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <ListTodo className="size-4 flex-none text-bloom-pink" />
      <span className="min-w-0 flex-1 truncate font-medium">Tareas</span>
      {due > 0 && (
        <span className={cn('text-[11px] tabular-nums', late ? 'font-medium text-destructive' : 'text-faint')} title={late ? `${late} vencidas` : 'Para hoy'}>
          {due}
        </span>
      )}
    </button>
  )
}

/** The general assistant: blue, because blue is reserved for AI (Von Restorff). */
function AgentButton() {
  const on = useStore((s) => s.active === 'agent:main')
  return (
    <button
      onClick={() => openAgent()}
      title={`Abrir el asistente (${mod}⌥A)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-brand-soft text-brand-text' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <Sparkles className="size-4 flex-none text-brand" />
      <span className="min-w-0 flex-1 truncate font-medium">Asistente</span>
      <span className="text-[11px] text-faint">{mod}⌥A</span>
    </button>
  )
}

/** Everything saved while reading, in one searchable place. */
function WikiButton() {
  const on = useStore((s) => s.active === 'wiki:all')
  const count = useStore((s) => Object.keys(s.annotations).length)
  return (
    <button
      onClick={openWiki}
      title={`Abrir la wiki de conocimiento (${mod}⌥K)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <BookOpenText className="size-4 flex-none text-bloom-amber" />
      <span className="min-w-0 flex-1 truncate font-medium">Wiki</span>
      {count > 0 && <span className="text-[11px] text-faint tabular-nums" title={`${count} resaltados`}>{count}</span>}
    </button>
  )
}

/** The thesis is the one document everything else feeds, so it gets a permanent spot. */
function ThesisButton() {
  const title = useStore((s) => {
    const t = Object.values(s.theses).sort((a, b) => a.createdAt - b.createdAt)[0]
    return t ? t.meta.title || 'Mi tesis' : null
  })
  const on = useStore((s) => s.active?.startsWith('thesis:') ?? false)
  return (
    <button
      onClick={() => openThesis()}
      title={`Abrir tesis (${mod}⌥T)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-brand-soft text-brand-text' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <GraduationCap className="size-4 flex-none text-brand" />
      <span className="min-w-0 flex-1 truncate font-medium">{title ?? 'Empezar la tesis'}</span>
      {!title && <span className="text-[11px] text-faint">Plantilla UCEMA</span>}
    </button>
  )
}

function ListTools({ placeholder, value, onChange, addLabel, addKeys, onAdd }: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  addLabel: string
  addKeys: string[]
  onAdd: () => void
}) {
  return (
    <div className="flex items-center gap-1 px-3 pb-2">
      <input
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[12.5px] outline-none placeholder:text-faint hover:bg-sidebar-accent focus:bg-card focus:ring-2 focus:ring-ring/30"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <IconButton label={addLabel} keys={addKeys} onClick={onAdd} className="text-brand-text hover:bg-brand-soft hover:text-brand-text">
        <Plus />
      </IconButton>
    </div>
  )
}

function LibraryList() {
  const papers = useStore((s) => s.papers)
  const lists = useStore((s) => s.lists)
  const [q, setQ] = useState('')
  const [picked, setFilter] = useState<Filter>('all')
  // A deleted list falls back to everything.
  const filter: Filter = picked.startsWith('list:') && !lists[picked.slice(5)] ? 'all' : picked
  const shownLists = useMemo(
    () => Object.values(lists).filter((l) => l.paperIds.some((id) => papers[id])).sort((a, b) => Number(b.name === CANDIDATES_LIST) - Number(a.name === CANDIDATES_LIST) || a.createdAt - b.createdAt),
    [lists, papers]
  )

  const list = useMemo(() => {
    let arr = Object.values(papers)
    if (filter === 'reading') arr = arr.filter((p) => p.status === 'reading')
    if (filter === 'unread') arr = arr.filter((p) => p.status === 'unread')
    if (filter === 'starred') arr = arr.filter((p) => p.starred)
    // A list keeps its own order.
    if (filter.startsWith('list:') && !q.trim()) return (lists[filter.slice(5)]?.paperIds ?? []).map((id) => papers[id]).filter(Boolean)
    if (filter.startsWith('list:')) arr = arr.filter((p) => lists[filter.slice(5)]?.paperIds.includes(p.id))
    if (q.trim()) {
      return arr
        .map((p) => ({ p, s: matchScore(`${p.title} ${authorLine(p, 99)} ${p.year ?? ''} ${p.tags.map((t) => `#${t}`).join(' ')} ${p.venue ?? ''}`, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p)
    }
    return arr.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [papers, lists, q, filter])

  const total = Object.keys(papers).length
  const readCount = useMemo(() => Object.values(papers).filter((p) => p.status === 'read').length, [papers])
  // Chunking: with no filter or query, the library is grouped by reading status.
  const grouped = filter === 'all' && !q.trim()

  return (
    <>
      <ListTools placeholder="Filtrar por título, autor, #etiqueta" value={q} onChange={setQ} addLabel="Importar PDF" addKeys={[mod, 'O']} onAdd={() => void importPapers()} />
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition-colors',
              filter === f.id
                ? 'border-foreground bg-foreground text-background'
                : 'border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
            )}
          >
            {f.dot && <span aria-hidden className={cn('size-1.5 rounded-full', f.dot)} />}
            {f.star && <Star aria-hidden className="size-2.5 fill-hl-yellow text-hl-yellow" />}
            {f.label}
          </button>
        ))}
        {shownLists.map((l) => {
          const id: Filter = `list:${l.id}`
          return (
            <ContextMenu key={l.id}>
              <ContextMenuTrigger asChild>
                <button
                  onClick={() => setFilter(filter === id ? 'all' : id)}
                  title={`Lista «${l.name}»`}
                  className={cn(
                    'flex h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition-colors',
                    filter === id
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                  )}
                >
                  <Bookmark aria-hidden className={cn('size-2.5 flex-none', l.name === CANDIDATES_LIST && 'fill-bloom-pink text-bloom-pink')} />
                  <span className="truncate">{l.name === CANDIDATES_LIST ? 'Candidatas' : l.name}</span>
                  <span className="tabular-nums opacity-60">{l.paperIds.filter((pid) => papers[pid]).length}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem variant="destructive" onSelect={() => deleteList(l.id)}>
                  Eliminar la lista
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2 px-3.5 pb-2" title={`${readCount} de ${total} papers leídos`}>
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-sidebar-accent">
            <span className="block h-full rounded-full bg-status-read transition-[width] duration-500" style={{ width: `${(readCount / total) * 100}%` }} />
          </span>
          <span className="text-[11px] text-faint tabular-nums">
            {readCount}/{total} leídos
          </span>
        </div>
      )}
      <NewListDialog />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3">
        {total === 0 ? (
          <EmptyState icon={<FilePlus2 />} title="Tu biblioteca está vacía" description="Soltá PDF en cualquier parte de la ventana.">
            <Button size="sm" onClick={() => void importPapers()}>
              Importar PDF
            </Button>
          </EmptyState>
        ) : list.length === 0 ? (
          <p className="p-5 text-center text-muted-foreground">Ningún paper coincide</p>
        ) : grouped ? (
          <div className="flex flex-col gap-1">
            {STATUS_GROUPS.map((g) => {
              const items = list.filter((p) => p.status === g.status)
              if (!items.length) return null
              return (
                <Collapsible
                  key={g.status}
                  id={`library.${g.status}`}
                  group="library"
                  defaultOpen={g.status !== 'read'}
                  title={g.label}
                  marker={g.marker}
                  count={items.length}
                  headerClassName="px-2"
                >
                  {items.map((p) => (
                    <PaperRow key={p.id} paper={p} />
                  ))}
                </Collapsible>
              )
            })}
          </div>
        ) : (
          list.map((p) => <PaperRow key={p.id} paper={p} />)
        )}
      </div>
    </>
  )
}

/** Names a new reading list and puts the paper in it (Electron has no window.prompt). */
function NewListDialog() {
  const [paperId, setPaperId] = useState<string | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    const open = (e: Event) => {
      setName('')
      setPaperId((e as CustomEvent<string>).detail)
    }
    window.addEventListener('new-list', open)
    return () => window.removeEventListener('new-list', open)
  }, [])
  const create = () => {
    if (paperId && name.trim()) addToList(name, paperId)
    setPaperId(null)
  }
  return (
    <Dialog open={!!paperId} onOpenChange={(o) => !o && setPaperId(null)}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Lista nueva</DialogTitle>
          <DialogDescription>Para agrupar papers: un capítulo, un tema, lo que querés profundizar.</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="Capítulo 2, Para profundizar…"
          className="h-9 rounded-md border bg-card px-3 text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setPaperId(null)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={create}>
            Crear y agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ active, onClick, children, menu }: { active: boolean; onClick: () => void; children: ReactNode; menu: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-[background,box-shadow] duration-150',
            active ? 'bg-card shadow-xs ring-1 ring-sidebar-border' : 'hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent'
          )}
        >
          {children}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">{menu}</ContextMenuContent>
    </ContextMenu>
  )
}

const STATUS_GROUPS: { status: Paper['status']; label: string; marker: string }[] = [
  { status: 'reading', label: 'Leyendo', marker: 'bg-status-reading' },
  { status: 'unread', label: 'Por leer', marker: 'bg-status-unread' },
  { status: 'read', label: 'Leído', marker: 'bg-status-read' }
]
const STATUS_LABEL: Record<Paper['status'], string> = { unread: 'Por leer', reading: 'Leyendo', read: 'Leído' }

const STATUS_DOT: Record<Paper['status'], string> = {
  unread: 'border-status-unread',
  reading: 'border-status-reading bg-[linear-gradient(90deg,var(--status-reading)_50%,transparent_50%)]',
  read: 'border-status-read bg-status-read'
}

const PaperRow = memo(function PaperRow({ paper }: { paper: Paper }) {
  const active = useStore((s) => s.active === `paper:${paper.id}`)
  const lists = useStore((s) => s.lists)
  const candidate = !!listByName(CANDIDATES_LIST)?.paperIds.includes(paper.id)
  const progress = paper.pageCount && paper.maxPage ? Math.min(1, paper.maxPage / paper.pageCount) : 0
  return (
    <Row
      active={active}
      onClick={() => openTab({ kind: 'paper', id: paper.id })}
      menu={
        <>
          <ContextMenuItem onSelect={() => openTab({ kind: 'paper', id: paper.id })}>Abrir</ContextMenuItem>
          <ContextMenuItem onSelect={() => patchPaper(paper.id, { starred: !paper.starred })}>{paper.starred ? 'Quitar destacado' : 'Destacar'}</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const l = listByName(CANDIDATES_LIST)
              if (candidate && l) removeFromList(l.id, paper.id)
              else addToList(CANDIDATES_LIST, paper.id)
            }}
          >
            {candidate ? 'Quitar de candidatas' : 'Agregar a candidatas para la tesis'}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Listas</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              {Object.values(lists)
                .filter((l) => l.name !== CANDIDATES_LIST)
                .map((l) => {
                  const inList = l.paperIds.includes(paper.id)
                  return (
                    <ContextMenuItem key={l.id} onSelect={() => (inList ? removeFromList(l.id, paper.id) : addToList(l.name, paper.id))}>
                      <span className="flex-1 truncate">{l.name}</span>
                      {inList && <span className="text-faint">✓</span>}
                    </ContextMenuItem>
                  )
                })}
              <ContextMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('new-list', { detail: paper.id }))}>
                Lista nueva…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => patchPaper(paper.id, { status: 'read' })}>Marcar como leído</ContextMenuItem>
          <ContextMenuItem onSelect={() => patchPaper(paper.id, { status: 'unread' })}>Marcar como por leer</ContextMenuItem>
          <ContextMenuItem onSelect={() => window.api.papers.reveal(paper.fileName)}>
            Mostrar en el Finder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => confirm(`¿Mover “${paper.title}” a la papelera?`) && void deletePaper(paper.id)}>
            Eliminar paper…
          </ContextMenuItem>
        </>
      }
    >
      <span title={STATUS_LABEL[paper.status]} className={cn('mt-[5px] size-[7px] flex-none rounded-full border-[1.5px]', STATUS_DOT[paper.status])}>
        <span className="sr-only">{STATUS_LABEL[paper.status]}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[12.5px] leading-snug font-[550]">{paper.title}</span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {paper.textStatus === 'pending' ? (
            <TextShimmer duration={1.6}>Leyendo PDF…</TextShimmer>
          ) : (
            <>
              {authorLine(paper, 2) || 'Autor desconocido'}
              {paper.year ? ` · ${paper.year}` : ''}
            </>
          )}
        </span>
        {progress > 0 && progress < 1 && (
          <span className="mt-1 h-0.5 overflow-hidden rounded-full bg-sidebar-accent">
            <span className="block h-full rounded-full bg-status-reading" style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </span>
      {candidate && <Bookmark aria-label="Candidata para la tesis" className="mt-0.5 size-3 flex-none fill-bloom-pink text-bloom-pink" />}
      {paper.starred && <Star className="mt-0.5 size-3 flex-none fill-hl-yellow text-hl-yellow" />}
    </Row>
  )
})

function NotesList() {
  const notes = useStore((s) => s.notes)
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    let arr = Object.values(notes)
    if (q.trim())
      arr = arr
        .map((n) => ({ n, s: matchScore(`${n.title} ${n.plain.slice(0, 4000)}`, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.n)
    else arr.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
    return arr
  }, [notes, q])

  return (
    <>
      <ListTools placeholder="Filtrar notas" value={q} onChange={setQ} addLabel="Nueva nota" addKeys={[mod, 'N']} onAdd={() => createNote()} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3">
        {Object.keys(notes).length === 0 ? (
          <EmptyState icon={<NotebookPen />} title="Capturá ideas, citas y esquemas">
            <Button size="sm" onClick={() => createNote()}>
              Nueva nota
            </Button>
          </EmptyState>
        ) : list.length === 0 ? (
          <p className="p-5 text-center text-muted-foreground">Ninguna nota coincide</p>
        ) : !q.trim() && list.some((n) => n.pinned) ? (
          <div className="flex flex-col gap-1">
            <Collapsible id="notes.pinned" group="notes" title="Fijadas" icon={<Pin className="text-faint" />} count={list.filter((n) => n.pinned).length} headerClassName="px-2">
              {list.filter((n) => n.pinned).map((n) => (
                <NoteRow key={n.id} note={n} />
              ))}
            </Collapsible>
            <Collapsible id="notes.all" group="notes" title="Notas" marker="bg-kind-note" count={list.filter((n) => !n.pinned).length} headerClassName="px-2">
              {list.filter((n) => !n.pinned).map((n) => (
                <NoteRow key={n.id} note={n} />
              ))}
            </Collapsible>
          </div>
        ) : (
          list.map((n) => <NoteRow key={n.id} note={n} />)
        )}
      </div>
    </>
  )
}

const NoteRow = memo(function NoteRow({ note }: { note: Note }) {
  const active = useStore((s) => s.active === `note:${note.id}`)
  const snippet = note.plain.replace(/\s+/g, ' ').slice(0, 90)
  return (
    <Row
      active={active}
      onClick={() => openTab({ kind: 'note', id: note.id })}
      menu={
        <>
          <ContextMenuItem onSelect={() => openTab({ kind: 'note', id: note.id })}>Abrir</ContextMenuItem>
          <ContextMenuItem onSelect={() => useStore.setState({ sideNoteId: note.id })}>
            Abrir al lado del paper <ContextMenuShortcut>{mod}⇧N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => saveNote({ ...note, pinned: !note.pinned })}>{note.pinned ? 'Desfijar' : 'Fijar arriba'}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => deleteNote(note.id)}>
            Eliminar nota
          </ContextMenuItem>
        </>
      }
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[12.5px] leading-snug font-[550]">
          {note.pinned && <Pin className="mr-1 inline size-3 align-[-1px] text-faint" />}
          {note.title || 'Nota sin título'}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {timeAgo(note.updatedAt)}
          {snippet ? ` · ${snippet}` : ''}
        </span>
      </span>
    </Row>
  )
})

function SidebarFooter() {
  const account = useStore((s) => s.account)
  const state = account == null ? 'checking' : account.connected ? 'on' : 'off'
  const provider = useStore((s) => providerLabel(s.settings))
  return (
    <div className="flex items-center gap-1 border-t border-sidebar-border px-2.5 py-2">
      <Button variant="ghost" size="sm" className="gap-2 px-2 text-muted-foreground hover:text-foreground" onClick={() => useStore.setState({ settingsOpen: true })}>
        <Settings2 /> Ajustes
      </Button>
      <button
        onClick={() => useStore.setState({ settingsOpen: true })}
        title={account?.email ? `${provider}: ${account.email}` : `Conexión de ${provider}`}
        className={cn(
          'ml-auto flex h-6 max-w-[60%] items-center gap-1.5 truncate rounded-full px-2.5 text-[11.5px] font-medium transition-colors',
          state === 'off' ? 'bg-brand-soft text-brand-text' : 'text-muted-foreground hover:bg-sidebar-accent'
        )}
      >
        <span
          className={cn(
            'size-[7px] flex-none rounded-full',
            state === 'on' && 'bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_22%,transparent)]',
            state === 'off' && 'bg-primary',
            state === 'checking' && 'animate-pulse bg-faint'
          )}
        />
        {state === 'on' ? `${provider}${account?.plan ? ` · ${account.plan}` : ''}` : state === 'checking' ? 'Conectando…' : `Conectar ${provider}`}
      </button>
    </div>
  )
}

/** The sidebar, collapsed: search, both lists and creation stay one click away. */
export function SidebarRail() {
  const view = useStore((s) => s.sidebarView)
  const paperCount = useStore((s) => Object.keys(s.papers).length)
  const noteCount = useStore((s) => Object.keys(s.notes).length)
  const { due } = useDueTasks()
  const show = (v: 'library' | 'notes') => useStore.setState({ sidebarOpen: true, sidebarView: v })
  return (
    <Rail side="left">
      {/* Room for the window's traffic lights. */}
      <div className="drag h-[46px] w-full flex-none" />
      <RailButton side="left" label="Expandir barra lateral" keys={[mod, '\\']} icon={<PanelLeftOpen />} onClick={() => useStore.setState({ sidebarOpen: true })} />
      <RailButton side="left" label="Buscar o saltar a…" keys={[mod, 'K']} icon={<Search />} onClick={() => openPalette()} />
      <RailButton side="left" label="Asistente" keys={[mod, '⌥', 'A']} icon={<Sparkles className="text-brand" />} onClick={() => openAgent()} />
      <RailButton side="left" label="Marco de investigación" keys={[mod, '⌥', 'M']} icon={<Crosshair className="text-bloom-teal" />} onClick={openResearch} />
      <RailButton side="left" label="Tesis" keys={[mod, '⌥', 'T']} icon={<GraduationCap className="text-brand" />} onClick={() => openThesis()} />
      <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
      <RailButton side="left" label="Biblioteca" icon={<BookOpen className="text-kind-paper" />} badge={paperCount} active={view === 'library'} onClick={() => show('library')} />
      <RailButton side="left" label="Notas" icon={<NotebookPen className="text-kind-note" />} badge={noteCount} active={view === 'notes'} onClick={() => show('notes')} />
      <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
      <RailButton side="left" label="Importar PDF" keys={[mod, 'O']} icon={<Upload />} onClick={() => void importPapers()} />
      <RailButton side="left" label="Nueva nota" keys={[mod, 'N']} icon={<Plus />} onClick={() => createNote()} />
      <RailButton side="left" label="Pizarra" keys={[mod, '⌥', 'B']} icon={<Shapes className="text-bloom-lilac" />} onClick={openBoard} />
      <RailButton side="left" label="Matriz de literatura" keys={[mod, '⌥', 'L']} icon={<Table2 className="text-bloom-teal" />} onClick={openMatrix} />
      <RailButton side="left" label="Análisis de datos" keys={[mod, '⌥', 'Y']} icon={<ChartColumn className="text-bloom-amber" />} onClick={openAnalysis} />
      <RailButton side="left" label="Tareas" keys={[mod, '⌥', 'D']} icon={<ListTodo className="text-bloom-pink" />} badge={due || undefined} onClick={() => openTasks()} />
      <RailButton side="left" label="Wiki" keys={[mod, '⌥', 'K']} icon={<BookOpenText className="text-bloom-amber" />} onClick={openWiki} />
      <span className="flex-1" />
      <RailButton side="left" label="Ajustes" keys={[mod, ',']} icon={<Settings2 />} onClick={() => useStore.setState({ settingsOpen: true })} />
    </Rail>
  )
}

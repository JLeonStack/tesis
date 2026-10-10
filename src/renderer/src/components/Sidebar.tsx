import { memo, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, NotebookPen, Plus, Search, Settings2, Star, FilePlus2, PanelLeftClose, PanelLeftOpen, Pin, Upload, GraduationCap, Shapes, Table2 } from 'lucide-react'
import type { Note, Paper } from '@shared/types'
import { createNote, deleteNote, deletePaper, openBoard, openMatrix, openPalette, openTab, openThesis, patchPaper, providerLabel, saveNote, useStore } from '../store'
import { importPapers } from '../lib/ingest'
import { authorLine } from '../lib/citation'
import { matchScore, mod, timeAgo } from '../lib/util'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { EmptyState, IconButton } from './common'
import { Collapsible } from './Collapsible'
import { Rail, RailButton } from './Rail'
import { Segmented } from './Segmented'

type Filter = 'all' | 'reading' | 'unread' | 'starred'
const FILTERS: { id: Filter; label: string; dot?: string; star?: boolean }[] = [
  { id: 'all', label: 'All' },
  { id: 'reading', label: 'Reading', dot: 'bg-status-reading' },
  { id: 'unread', label: 'To read', dot: 'bg-status-unread' },
  { id: 'starred', label: 'Starred', star: true }
]

export function Sidebar() {
  const view = useStore((s) => s.sidebarView)
  const paperCount = useStore((s) => Object.keys(s.papers).length)
  const noteCount = useStore((s) => Object.keys(s.notes).length)

  return (
    <aside className="flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="drag flex h-[46px] flex-none items-center justify-end px-2.5">
        <IconButton label="Collapse sidebar" keys={[mod, '\\']} onClick={() => useStore.setState({ sidebarOpen: false })}>
          <PanelLeftClose />
        </IconButton>
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-2.5">
        <button
          onClick={() => openPalette()}
          className="group flex h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-muted-foreground shadow-xs transition-colors hover:border-input hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>{mod}K</Kbd>
        </button>
        <div className="-mt-1.5 flex flex-col">
          <ThesisButton />
          <WhiteboardButton />
          <MatrixButton />
        </div>
        <Segmented
          fill
          value={view}
          onChange={(v) => useStore.setState({ sidebarView: v })}
          items={[
            { value: 'library', label: 'Library', icon: <BookOpen className="text-kind-paper" />, count: paperCount },
            { value: 'notes', label: 'Notes', icon: <NotebookPen className="text-kind-note" />, count: noteCount }
          ]}
        />
      </div>

      {view === 'library' ? <LibraryList /> : <NotesList />}
      <SidebarFooter />
    </aside>
  )
}

/** A place to think visually: one Excalidraw board, always one click away. */
function WhiteboardButton() {
  const on = useStore((s) => s.active === 'board:excalidraw')
  return (
    <button
      onClick={openBoard}
      title={`Open the whiteboard (${mod}⌥B)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <Shapes className="size-4 flex-none text-bloom-lilac" />
      <span className="min-w-0 flex-1 truncate font-medium">Whiteboard</span>
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
      title={`Open the literature matrix (${mod}⌥L)`}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        on ? 'bg-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      )}
    >
      <Table2 className="size-4 flex-none text-bloom-teal" />
      <span className="min-w-0 flex-1 truncate font-medium">Literature matrix</span>
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
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const list = useMemo(() => {
    let arr = Object.values(papers)
    if (filter === 'reading') arr = arr.filter((p) => p.status === 'reading')
    if (filter === 'unread') arr = arr.filter((p) => p.status === 'unread')
    if (filter === 'starred') arr = arr.filter((p) => p.starred)
    if (q.trim()) {
      return arr
        .map((p) => ({ p, s: matchScore(`${p.title} ${authorLine(p, 99)} ${p.year ?? ''} ${p.tags.map((t) => `#${t}`).join(' ')} ${p.venue ?? ''}`, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p)
    }
    return arr.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [papers, q, filter])

  const total = Object.keys(papers).length
  const readCount = useMemo(() => Object.values(papers).filter((p) => p.status === 'read').length, [papers])
  // Chunking: with no filter or query, the library is grouped by reading status.
  const grouped = filter === 'all' && !q.trim()

  return (
    <>
      <ListTools placeholder="Filter by title, author, #tag" value={q} onChange={setQ} addLabel="Import PDFs" addKeys={[mod, 'O']} onAdd={() => void importPapers()} />
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
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2 px-3.5 pb-2" title={`${readCount} of ${total} papers read`}>
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-sidebar-accent">
            <span className="block h-full rounded-full bg-status-read transition-[width] duration-500" style={{ width: `${(readCount / total) * 100}%` }} />
          </span>
          <span className="text-[11px] text-faint tabular-nums">
            {readCount}/{total} read
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3">
        {total === 0 ? (
          <EmptyState icon={<FilePlus2 />} title="Your library is empty" description="Drop PDFs anywhere in the window.">
            <Button size="sm" onClick={() => void importPapers()}>
              Import PDFs
            </Button>
          </EmptyState>
        ) : list.length === 0 ? (
          <p className="p-5 text-center text-muted-foreground">No papers match</p>
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
  { status: 'reading', label: 'Reading', marker: 'bg-status-reading' },
  { status: 'unread', label: 'To read', marker: 'bg-status-unread' },
  { status: 'read', label: 'Read', marker: 'bg-status-read' }
]
const STATUS_LABEL: Record<Paper['status'], string> = { unread: 'To read', reading: 'Reading', read: 'Read' }

const STATUS_DOT: Record<Paper['status'], string> = {
  unread: 'border-status-unread',
  reading: 'border-status-reading bg-[linear-gradient(90deg,var(--status-reading)_50%,transparent_50%)]',
  read: 'border-status-read bg-status-read'
}

const PaperRow = memo(function PaperRow({ paper }: { paper: Paper }) {
  const active = useStore((s) => s.active === `paper:${paper.id}`)
  const progress = paper.pageCount && paper.maxPage ? Math.min(1, paper.maxPage / paper.pageCount) : 0
  return (
    <Row
      active={active}
      onClick={() => openTab({ kind: 'paper', id: paper.id })}
      menu={
        <>
          <ContextMenuItem onSelect={() => openTab({ kind: 'paper', id: paper.id })}>Open</ContextMenuItem>
          <ContextMenuItem onSelect={() => patchPaper(paper.id, { starred: !paper.starred })}>{paper.starred ? 'Unstar' : 'Star'}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => patchPaper(paper.id, { status: 'read' })}>Mark as read</ContextMenuItem>
          <ContextMenuItem onSelect={() => patchPaper(paper.id, { status: 'unread' })}>Mark as to read</ContextMenuItem>
          <ContextMenuItem onSelect={() => window.api.papers.reveal(paper.fileName)}>
            Show in Finder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => confirm(`Move “${paper.title}” to the Trash?`) && void deletePaper(paper.id)}>
            Delete paper…
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
            <TextShimmer duration={1.6}>Reading PDF…</TextShimmer>
          ) : (
            <>
              {authorLine(paper, 2) || 'Unknown author'}
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
      <ListTools placeholder="Filter notes" value={q} onChange={setQ} addLabel="New note" addKeys={[mod, 'N']} onAdd={() => createNote()} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3">
        {Object.keys(notes).length === 0 ? (
          <EmptyState icon={<NotebookPen />} title="Capture ideas, quotes and outlines">
            <Button size="sm" onClick={() => createNote()}>
              New note
            </Button>
          </EmptyState>
        ) : list.length === 0 ? (
          <p className="p-5 text-center text-muted-foreground">No notes match</p>
        ) : !q.trim() && list.some((n) => n.pinned) ? (
          <div className="flex flex-col gap-1">
            <Collapsible id="notes.pinned" group="notes" title="Pinned" icon={<Pin className="text-faint" />} count={list.filter((n) => n.pinned).length} headerClassName="px-2">
              {list.filter((n) => n.pinned).map((n) => (
                <NoteRow key={n.id} note={n} />
              ))}
            </Collapsible>
            <Collapsible id="notes.all" group="notes" title="Notes" marker="bg-kind-note" count={list.filter((n) => !n.pinned).length} headerClassName="px-2">
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
          <ContextMenuItem onSelect={() => openTab({ kind: 'note', id: note.id })}>Open</ContextMenuItem>
          <ContextMenuItem onSelect={() => useStore.setState({ sideNoteId: note.id })}>
            Open beside paper <ContextMenuShortcut>{mod}⇧N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => saveNote({ ...note, pinned: !note.pinned })}>{note.pinned ? 'Unpin' : 'Pin to top'}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => deleteNote(note.id)}>
            Delete note
          </ContextMenuItem>
        </>
      }
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[12.5px] leading-snug font-[550]">
          {note.pinned && <Pin className="mr-1 inline size-3 align-[-1px] text-faint" />}
          {note.title || 'Untitled note'}
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
        <Settings2 /> Settings
      </Button>
      <button
        onClick={() => useStore.setState({ settingsOpen: true })}
        title={account?.email ? `${provider}: ${account.email}` : `${provider} connection`}
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
        {state === 'on' ? `${provider}${account?.plan ? ` · ${account.plan}` : ''}` : state === 'checking' ? 'Connecting…' : `Connect ${provider}`}
      </button>
    </div>
  )
}

/** The sidebar, collapsed: search, both lists and creation stay one click away. */
export function SidebarRail() {
  const view = useStore((s) => s.sidebarView)
  const paperCount = useStore((s) => Object.keys(s.papers).length)
  const noteCount = useStore((s) => Object.keys(s.notes).length)
  const show = (v: 'library' | 'notes') => useStore.setState({ sidebarOpen: true, sidebarView: v })
  return (
    <Rail side="left">
      {/* Room for the window's traffic lights. */}
      <div className="drag h-[46px] w-full flex-none" />
      <RailButton side="left" label="Expand sidebar" keys={[mod, '\\']} icon={<PanelLeftOpen />} onClick={() => useStore.setState({ sidebarOpen: true })} />
      <RailButton side="left" label="Search or jump to…" keys={[mod, 'K']} icon={<Search />} onClick={() => openPalette()} />
      <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
      <RailButton side="left" label="Library" icon={<BookOpen className="text-kind-paper" />} badge={paperCount} active={view === 'library'} onClick={() => show('library')} />
      <RailButton side="left" label="Notes" icon={<NotebookPen className="text-kind-note" />} badge={noteCount} active={view === 'notes'} onClick={() => show('notes')} />
      <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
      <RailButton side="left" label="Import PDFs" keys={[mod, 'O']} icon={<Upload />} onClick={() => void importPapers()} />
      <RailButton side="left" label="New note" keys={[mod, 'N']} icon={<Plus />} onClick={() => createNote()} />
      <RailButton side="left" label="Whiteboard" keys={[mod, '⌥', 'B']} icon={<Shapes className="text-bloom-lilac" />} onClick={openBoard} />
      <RailButton side="left" label="Literature matrix" keys={[mod, '⌥', 'L']} icon={<Table2 className="text-bloom-teal" />} onClick={openMatrix} />
      <span className="flex-1" />
      <RailButton side="left" label="Settings" keys={[mod, ',']} icon={<Settings2 />} onClick={() => useStore.setState({ settingsOpen: true })} />
    </Rail>
  )
}

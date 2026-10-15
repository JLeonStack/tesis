import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, BookA, BookOpenText, Brain, Clock, Copy, ExternalLink, FileText, Highlighter, MessageSquareText, NotebookPen, Search, X } from 'lucide-react'
import type { Annotation, HighlightColor, Note, Paper, RecallAnswer } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Collapsible } from '../components/Collapsible'
import { EmptyState, IconButton } from '../components/common'
import { jumpTo, jumpToSentence, openTab, useStore } from '../store'
import { COLORS, COLOR_VAR } from '../reader/SelectionToolbar'
import { HighlightText } from '../reader/HighlightText'
import { addQuoteToNote } from '../editor/noteBridge'
import { authorLine, inText, shortLabel } from '../lib/citation'
import { copyText } from '../lib/exporting'
import { VERDICT_LABEL } from '../lib/recall'
import { fold, timeAgo } from '../lib/util'
import { collectEntries, entryText, matches, papersWithKnowledge, type Entry } from './knowledge'

type Section = 'all' | 'highlights' | 'comments' | 'notes' | 'glossary' | 'recall'

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'all', label: 'Todo', icon: <Clock /> },
  { id: 'highlights', label: 'Resaltados', icon: <Highlighter className="text-bloom-amber" /> },
  { id: 'comments', label: 'Mis comentarios', icon: <MessageSquareText /> },
  { id: 'notes', label: 'Notas', icon: <NotebookPen className="text-kind-note" /> },
  { id: 'glossary', label: 'Glosario', icon: <BookA className="text-bloom-lilac" /> },
  { id: 'recall', label: 'En mis palabras', icon: <Brain className="text-bloom-lilac" /> }
]

const KIND_LABEL: Record<Entry['kind'], string> = { highlight: 'Resaltados', note: 'Notas', term: 'Glosario', recall: 'En mis palabras' }

const STATUS_DOT = { unread: 'bg-status-unread', reading: 'bg-status-reading', read: 'bg-status-read' } as const
const STATUS_LABEL = { unread: 'Por leer', reading: 'Leyendo', read: 'Leído' } as const

export function WikiView() {
  const annotations = useStore((s) => s.annotations)
  const notes = useStore((s) => s.notes)
  const guides = useStore((s) => s.guides)
  const recalls = useStore((s) => s.recalls)
  const papers = useStore((s) => s.papers)
  const [section, setSection] = useState<Section>('all')
  const [paperId, setPaperId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const entries = useMemo(() => collectEntries({ annotations, notes, guides, recalls, papers }), [annotations, notes, guides, recalls, papers])
  const found = useMemo(() => (query.trim() ? entries.filter((e) => matches(entryText(e, papers), query)) : entries), [entries, query, papers])
  const withKnowledge = useMemo(() => papersWithKnowledge(entries, papers), [entries, papers])

  const inSection = (e: Entry, s: Section) =>
    s === 'all' ||
    (s === 'highlights' && e.kind === 'highlight') ||
    (s === 'comments' && e.kind === 'highlight' && !!e.a.comment) ||
    (s === 'notes' && e.kind === 'note') ||
    (s === 'glossary' && e.kind === 'term') ||
    (s === 'recall' && e.kind === 'recall')
  const count = (s: Section) => found.filter((e) => inSection(e, s)).length
  const shown = found.filter((e) => inSection(e, section))

  // A search looks across everything, not inside the open paper page.
  useEffect(() => {
    if (query.trim()) setPaperId(null)
  }, [query])

  const openPaper = (id: string) => {
    setPaperId(id)
    setQuery('')
  }
  const nav = { query, openPaper }
  const counts = { highlights: entries.filter((e) => e.kind === 'highlight').length, notes: Object.keys(notes).length, terms: entries.filter((e) => e.kind === 'term').length }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2.5">
          <BookOpenText className="size-4.5 flex-none text-bloom-amber" />
          <div className="min-w-0">
            <h1 className="text-[14px] leading-tight font-semibold">Conocimiento</h1>
            <p className="text-[11.5px] text-muted-foreground">
              {counts.highlights} resaltados · {counts.notes} notas · {counts.terms} términos · de {withKnowledge.length} papers
            </p>
          </div>
        </div>
        <label className="flex h-8 w-80 items-center gap-1.5 rounded-lg border bg-card px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <Search className="size-3.5 flex-none text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Buscar en todo lo que guardaste…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          {query && (
            <button aria-label="Borrar búsqueda" onClick={() => setQuery('')} className="grid size-5 place-items-center rounded text-faint hover:bg-accent hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] flex-none flex-col gap-0.5 overflow-y-auto border-r px-2.5 py-3">
          {SECTIONS.map((s) => {
            const on = !paperId && section === s.id
            return (
              <button
                key={s.id}
                onClick={() => {
                  setSection(s.id)
                  setPaperId(null)
                }}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors [&_svg]:size-4',
                  on ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                {s.icon}
                <span className="flex-1 truncate">{s.label}</span>
                <span className="text-[11px] text-faint tabular-nums">{count(s.id)}</span>
              </button>
            )
          })}
          {withKnowledge.length > 0 && (
            <>
              <p className="mt-4 mb-1 px-2.5 text-[11px] font-medium tracking-wide text-faint uppercase">Papers</p>
              {withKnowledge.map(({ paper, count }) => (
                <button
                  key={paper.id}
                  onClick={() => openPaper(paper.id)}
                  title={paper.title}
                  className={cn(
                    'flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1 text-left text-[12.5px] transition-colors',
                    paperId === paper.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <span className={cn('size-1.5 flex-none rounded-full', STATUS_DOT[paper.status])} />
                  <span className="min-w-0 flex-1 truncate">{shortLabel(paper)}</span>
                  <span className="text-[11px] text-faint tabular-nums">{count}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-8 py-6">
            {entries.length === 0 ? (
              <EmptyState
                bloom
                icon={<BookOpenText />}
                title="Tu wiki se arma sola"
                description="Todo lo que resaltes, comentes y anotes mientras leés aparece acá, junto con el glosario de las guías de lectura y tus respuestas de repaso."
              />
            ) : paperId && papers[paperId] ? (
              <PaperPage paper={papers[paperId]} entries={entries} nav={nav} onBack={() => setPaperId(null)} />
            ) : (
              <SectionView section={section} entries={shown} nav={nav} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Nav {
  query: string
  openPaper: (id: string) => void
}

// ---------- sections ----------

function SectionView({ section, entries, nav }: { section: Section; entries: Entry[]; nav: Nav }) {
  const [color, setColor] = useState<HighlightColor | null>(null)

  if (!entries.length)
    return <p className="py-16 text-center text-[13px] text-muted-foreground">{nav.query ? 'Nada coincide con la búsqueda.' : 'Todavía no hay nada en esta sección.'}</p>

  if (section === 'all') {
    // Searching: results by kind. Browsing: what you saved most recently.
    if (!nav.query) return <EntryList entries={entries.slice(0, 60)} nav={nav} heading="Lo último que guardaste" />
    const kinds: Entry['kind'][] = ['highlight', 'note', 'term', 'recall']
    return (
      <>
        {kinds.map((k) => {
          const list = entries.filter((e) => e.kind === k)
          if (!list.length) return null
          return (
            <Collapsible key={k} local group="wiki-results" title={KIND_LABEL[k]} count={list.length} contentClassName="pt-1">
              <EntryList entries={list} nav={nav} />
            </Collapsible>
          )
        })}
      </>
    )
  }

  if (section === 'highlights') {
    const list = color ? entries.filter((e) => e.kind === 'highlight' && e.a.color === color) : entries
    return (
      <>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Color</span>
          <ColorChip on={!color} onClick={() => setColor(null)} label="Todos" />
          {COLORS.map((c) => (
            <ColorChip key={c} on={color === c} onClick={() => setColor(color === c ? null : c)} color={COLOR_VAR[c]} label={c} />
          ))}
        </div>
        <ByPaper entries={list} nav={nav} sortByPage />
      </>
    )
  }

  if (section === 'glossary') return <Glossary entries={entries as Extract<Entry, { kind: 'term' }>[]} nav={nav} />
  if (section === 'recall') return <ByPaper entries={entries} nav={nav} />
  if (section === 'notes') return <EntryList entries={entries} nav={nav} />
  // Comments: your own thinking first, the passage under it.
  return <EntryList entries={entries} nav={nav} heading={`${entries.length} pasajes que comentaste`} />
}

function ColorChip({ on, onClick, color, label }: { on: boolean; onClick: () => void; color?: string; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-pressed={on}
      className={cn('grid h-6 min-w-6 place-items-center rounded-full border px-1.5 text-[11px] transition-colors', on ? 'border-ring bg-accent' : 'hover:bg-accent/60')}
    >
      {color ? <span className="size-3 rounded-full" style={{ background: color }} /> : label}
    </button>
  )
}

function EntryList({ entries, nav, heading }: { entries: Entry[]; nav: Nav; heading?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {heading && <h2 className="mb-1 text-[12px] font-medium tracking-wide text-faint uppercase">{heading}</h2>}
      {entries.map((e) => (
        <EntryCard key={`${e.kind}:${e.id}`} e={e} nav={nav} />
      ))}
    </div>
  )
}

/** Grouped by paper, the paper with the newest material first. */
function ByPaper({ entries, nav, sortByPage }: { entries: Entry[]; nav: Nav; sortByPage?: boolean }) {
  const papers = useStore((s) => s.papers)
  const groups = useMemo(() => {
    const by = new Map<string, Entry[]>()
    for (const e of entries) if ('paperId' in e) by.set(e.paperId, [...(by.get(e.paperId) ?? []), e])
    const out = [...by].filter(([id]) => papers[id])
    if (sortByPage) for (const [, list] of out) list.sort((a, b) => (a.kind === 'highlight' && b.kind === 'highlight' ? a.a.page - b.a.page : 0))
    return out
  }, [entries, papers, sortByPage])
  if (!groups.length) return <p className="py-16 text-center text-[13px] text-muted-foreground">Nada con ese color.</p>
  return (
    <>
      {groups.map(([id, list]) => (
        <Collapsible
          key={id}
          local
          group="wiki-papers"
          title={<span className="normal-case">{shortLabel(papers[id])}</span>}
          marker="bg-kind-paper"
          count={list.length}
          summary={papers[id].title}
          actions={
            <button onClick={() => nav.openPaper(id)} className="text-[11.5px] text-muted-foreground hover:text-foreground">
              Página del paper
            </button>
          }
          contentClassName="pt-1"
        >
          <EntryList entries={list} nav={nav} />
        </Collapsible>
      ))}
    </>
  )
}

/** Terms from every reading guide, A to Z; the same term from several papers sits together. */
function Glossary({ entries, nav }: { entries: Extract<Entry, { kind: 'term' }>[]; nav: Nav }) {
  const groups = useMemo(() => {
    const by = new Map<string, Extract<Entry, { kind: 'term' }>[]>()
    for (const e of entries) {
      const k = fold(e.term.term.trim())
      by.set(k, [...(by.get(k) ?? []), e])
    }
    return [...by.values()].sort((a, b) => a[0].term.term.localeCompare(b[0].term.term, 'es'))
  }, [entries])
  let letter = ''
  return (
    <div className="flex flex-col gap-1">
      {groups.map((list) => {
        const first = fold(list[0].term.term.trim().charAt(0)).toUpperCase()
        const header = first !== letter ? (letter = first) : null
        return (
          <div key={list[0].id}>
            {header && <h2 className="mt-3 mb-1 font-heading text-[18px] font-medium text-faint">{header}</h2>}
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="font-heading text-[16px] font-medium">
                <Mark text={list[0].term.term} query={nav.query} />
              </p>
              {list.map((e) => (
                <TermBody key={e.id} e={e} nav={nav} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- paper page ----------

function PaperPage({ paper, entries, nav, onBack }: { paper: Paper; entries: Entry[]; nav: Nav; onBack: () => void }) {
  const guide = useStore((s) => s.guides[paper.id])
  const mine = entries.filter((e) => (e.kind === 'note' ? e.note.paperIds.includes(paper.id) : e.paperId === paper.id))
  const highlights = mine.filter((e): e is Extract<Entry, { kind: 'highlight' }> => e.kind === 'highlight').sort((a, b) => a.a.page - b.a.page)
  const notes = mine.filter((e) => e.kind === 'note')
  const terms = mine.filter((e): e is Extract<Entry, { kind: 'term' }> => e.kind === 'term')
  const recall = mine.filter((e) => e.kind === 'recall')
  const local = { ...nav, paperPage: paper.id }

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 self-start text-[12px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Volver
      </button>
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-[24px] leading-tight font-medium">{paper.title}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
          <span>{authorLine(paper, 4) || 'Autor desconocido'}</span>
          {paper.year && <span>· {paper.year}</span>}
          <span className="flex items-center gap-1">
            · <span className={cn('size-1.5 rounded-full', STATUS_DOT[paper.status])} /> {STATUS_LABEL[paper.status]}
          </span>
          {paper.tags.map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 text-[11.5px]">
              #{t}
            </span>
          ))}
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={() => openTab({ kind: 'paper', id: paper.id })}>
            <FileText className="text-kind-paper" /> Abrir el PDF
          </Button>
        </div>
      </header>

      {guide?.tldr && (
        <div className="rounded-xl border bg-card px-4 py-3 text-[13.5px] leading-relaxed">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-faint uppercase">En tres líneas</p>
          <p>{guide.tldr}</p>
          {guide.relevance && (
            <>
              <p className="mt-3 mb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Para tu tesis</p>
              <p className="text-muted-foreground">{guide.relevance}</p>
            </>
          )}
        </div>
      )}

      {highlights.length > 0 && (
        <Collapsible id="wiki.paper.highlights" title="Resaltados" marker="bg-bloom-amber" count={highlights.length} contentClassName="pt-1">
          <EntryList entries={highlights} nav={local} />
        </Collapsible>
      )}
      {notes.length > 0 && (
        <Collapsible id="wiki.paper.notes" title="Notas que lo citan" marker="bg-kind-note" count={notes.length} contentClassName="pt-1">
          <EntryList entries={notes} nav={local} />
        </Collapsible>
      )}
      {terms.length > 0 && (
        <Collapsible id="wiki.paper.terms" title="Términos" marker="bg-bloom-lilac" count={terms.length} contentClassName="pt-1">
          <div className="flex flex-col gap-1">
            {terms.map((e) => (
              <div key={e.id} className="rounded-lg px-3 py-2 hover:bg-accent/50">
                <p className="text-[13.5px] font-medium">{e.term.term}</p>
                <TermBody e={e} nav={local} />
              </div>
            ))}
          </div>
        </Collapsible>
      )}
      {recall.length > 0 && (
        <Collapsible id="wiki.paper.recall" title="En mis palabras" marker="bg-bloom-lilac" count={recall.length} contentClassName="pt-1">
          <EntryList entries={recall} nav={local} />
        </Collapsible>
      )}
      {!mine.length && <p className="text-[13px] text-muted-foreground">Todavía no guardaste nada de este paper.</p>}
    </>
  )
}

// ---------- entries ----------

function EntryCard({ e, nav }: { e: Entry; nav: Nav & { paperPage?: string } }) {
  switch (e.kind) {
    case 'highlight':
      return <HighlightCard a={e.a} nav={nav} />
    case 'note':
      return <NoteCard note={e.note} nav={nav} />
    case 'term':
      return (
        <div className="rounded-lg px-3 py-2.5 hover:bg-accent/50">
          <p className="flex items-center gap-1.5 text-[13.5px] font-medium">
            <BookA className="size-3.5 text-bloom-lilac" />
            <Mark text={e.term.term} query={nav.query} />
          </p>
          <TermBody e={e} nav={nav} />
        </div>
      )
    case 'recall':
      return <RecallCard paperId={e.paperId} answer={e.answer} nav={nav} />
  }
}

/** Where an entry comes from: the paper (its wiki page) and the page in the PDF. */
function SourceLine({ paperId, page, nav, onJump }: { paperId: string; page?: number; nav: Nav & { paperPage?: string }; onJump?: () => void }) {
  const paper = useStore((s) => s.papers[paperId])
  if (!paper) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground" onClick={(e) => e.stopPropagation()}>
      {nav.paperPage !== paperId && (
        <button onClick={() => nav.openPaper(paperId)} className="min-w-0 truncate hover:text-foreground hover:underline" title={`${paper.title}: página del paper`}>
          {shortLabel(paper)}
        </button>
      )}
      {page !== undefined && (
        <button onClick={onJump ?? (() => jumpTo(paperId, page))} className="flex flex-none items-center gap-0.5 hover:text-foreground" title="Abrir en el PDF">
          p. {page} <ExternalLink className="size-3" />
        </button>
      )}
    </span>
  )
}

function HighlightCard({ a, nav }: { a: Annotation; nav: Nav & { paperPage?: string } }) {
  const paper = useStore((s) => s.papers[a.paperId])
  const style = useStore((s) => s.settings.citationStyle)
  const searching = !!nav.query.trim()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => jumpTo(a.paperId, a.page, a.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && jumpTo(a.paperId, a.page, a.id)}
      className="group flex gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40"
      title="Abrir en el PDF"
    >
      <span className="w-[3px] flex-none rounded-full" style={{ background: COLOR_VAR[a.color] }} />
      <div className="min-w-0 flex-1">
        {a.comment && (
          <p className="mb-1.5 flex gap-1.5 text-[13px] font-medium">
            <MessageSquareText className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
            <span>
              <Mark text={a.comment} query={nav.query} />
            </span>
          </p>
        )}
        {searching ? (
          <div>
            <p className="font-serif text-[13.5px] leading-relaxed">
              <Mark text={a.translation ?? a.text} query={nav.query} />
            </p>
            {a.translation && (
              <p className="mt-1 font-serif text-[12px] leading-snug text-muted-foreground italic">
                <span className="font-sans font-semibold not-italic">Original:</span> “<Mark text={a.text} query={nav.query} />”
              </p>
            )}
          </div>
        ) : (
          <HighlightText a={a} />
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <SourceLine paperId={a.paperId} page={a.page} nav={nav} onJump={() => jumpTo(a.paperId, a.page, a.id)} />
          <span className="flex-1" />
          <span className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <IconButton size="icon-xs" label="Agregar a una nota" onClick={() => addQuoteToNote(a.paperId, a.page, a.text, a.id, a.translation)}>
              <NotebookPen />
            </IconButton>
            <IconButton size="icon-xs" label="Copiar con la cita" onClick={() => paper && void copyText(`“${a.text}” ${inText(paper, style, a.page)}`, 'Cita copiada')}>
              <Copy />
            </IconButton>
          </span>
        </div>
      </div>
    </div>
  )
}

function NoteCard({ note, nav }: { note: Note; nav: Nav & { paperPage?: string } }) {
  const papers = useStore((s) => s.papers)
  const snippet = excerpt(note.plain, nav.query)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTab({ kind: 'note', id: note.id })}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openTab({ kind: 'note', id: note.id })}
      className="flex gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40"
      title="Abrir la nota"
    >
      <NotebookPen className="mt-0.5 size-4 flex-none text-kind-note" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            <Mark text={note.title || 'Nota sin título'} query={nav.query} />
          </span>
          <span className="flex-none text-[11px] text-faint">{timeAgo(note.updatedAt)}</span>
        </p>
        {snippet && (
          <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
            <Mark text={snippet} query={nav.query} />
          </p>
        )}
        {note.paperIds.some((id) => papers[id]) && (
          <p className="mt-1 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
            {note.paperIds
              .filter((id) => papers[id] && id !== nav.paperPage)
              .map((id) => (
                <button key={id} onClick={() => nav.openPaper(id)} className="rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" title={papers[id].title}>
                  {shortLabel(papers[id])}
                </button>
              ))}
          </p>
        )}
      </div>
    </div>
  )
}

function TermBody({ e, nav }: { e: Extract<Entry, { kind: 'term' }>; nav: Nav & { paperPage?: string } }) {
  const guide = useStore((s) => s.guides[e.paperId])
  const sentence = e.term.sentenceId ? guide?.sentences.find((x) => x.id === e.term.sentenceId) : undefined
  return (
    <div className="mt-1">
      <p className="text-[13px] leading-relaxed">
        <Mark text={e.term.definition} query={nav.query} />
      </p>
      {e.term.original && fold(e.term.original) !== fold(e.term.term) && <p className="text-[11.5px] text-muted-foreground italic">En el paper: {e.term.original}</p>}
      <div className="mt-1">
        <SourceLine paperId={e.paperId} page={sentence?.page ?? e.term.page} nav={nav} onJump={() => (sentence ? jumpToSentence(e.paperId, sentence) : jumpTo(e.paperId, e.term.page))} />
      </div>
    </div>
  )
}

function RecallCard({ paperId, answer, nav }: { paperId: string; answer: RecallAnswer; nav: Nav & { paperPage?: string } }) {
  const tone = answer.verdict === 'right' ? 'text-status-read' : answer.verdict === 'partial' ? 'text-status-reading' : 'text-destructive'
  return (
    <div className="rounded-lg px-3 py-2.5 hover:bg-accent/50">
      <p className="flex items-start gap-1.5 text-[13px] font-medium">
        <Brain className="mt-0.5 size-3.5 flex-none text-bloom-lilac" />
        <Mark text={answer.question} query={nav.query} />
      </p>
      <p className="mt-1 pl-5 text-[13px] leading-relaxed">
        <Mark text={answer.answer} query={nav.query} />
      </p>
      <div className="mt-1 flex items-center gap-2 pl-5">
        <span className={cn('text-[11.5px] font-medium', tone)}>{VERDICT_LABEL[answer.verdict]}</span>
        <SourceLine paperId={paperId} page={answer.pages[0]} nav={nav} />
      </div>
    </div>
  )
}

// ---------- search helpers ----------

/** A window of text around the first match, or the start of it. */
function excerpt(text: string, query: string, size = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return flat.slice(0, size)
  const i = fold(flat).indexOf(words[0])
  if (i < 0) return flat.slice(0, size)
  const from = Math.max(0, i - 60)
  return `${from ? '…' : ''}${flat.slice(from, from + size)}${from + size < flat.length ? '…' : ''}`
}

/** The text with every query word marked (accent and case insensitive). */
function Mark({ text, query }: { text: string; query: string }) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const folded = fold(text)
  // `fold` keeps length for composed text; when it doesn't, show it unmarked.
  if (!words.length || folded.length !== text.length) return <>{text}</>
  const ranges: [number, number][] = []
  for (const w of words) {
    let i = folded.indexOf(w)
    while (i >= 0) {
      ranges.push([i, i + w.length])
      i = folded.indexOf(w, i + w.length)
    }
  }
  if (!ranges.length) return <>{text}</>
  ranges.sort((a, b) => a[0] - b[0])
  const out: ReactNode[] = []
  let at = 0
  for (const [s, e] of ranges) {
    if (s < at) continue
    if (s > at) out.push(text.slice(at, s))
    out.push(
      <mark key={s} className="rounded-[3px] bg-bloom-amber/30 px-px text-inherit">
        {text.slice(s, e)}
      </mark>
    )
    at = e
  }
  out.push(text.slice(at))
  return <>{out}</>
}

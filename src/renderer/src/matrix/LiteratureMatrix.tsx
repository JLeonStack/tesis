import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ClipboardCopy,
  Copy,
  Download,
  FileText,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Square,
  Table2,
  X
} from 'lucide-react'
import { type ConstructId, type MatrixFields, type Paper, type PaperGuide } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Segmented } from '../components/Segmented'
import { IconButton } from '../components/common'
import { askAssistant, clearMatrixFilter, openTab, patchMatrix, providerLabel, tabKey, toast, useStore, MATRIX_TAB, type MatrixView } from '../store'
import { authorLine } from '../lib/citation'
import { buildGuide, buildGuides, onBulkProgress, stopBuildingGuides, type BulkProgress } from '../lib/guide'
import { copyText } from '../lib/exporting'
import { allRows, byline, columnText, COLUMNS, inTopic, isCurrent, isOutdated, LEVEL, rowText, rowTopics, toCsv, toMarkdown, toTsv, visibleRows, type Row } from './model'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CONSTRUCTS, CONSTRUCT_ORDER, pairLabel } from '../research/framework'
import { TopicBadges } from '../research/TopicChips'

// The literature matrix: every paper in the same comparable fields, side by
// side, so patterns and gaps across the literature show at a glance (the
// review matrix of Garrard's "Matrix Method"). Filled from the reading guides;
// the assistant beside it reads the same rows and can filter and rank them.

type Column = keyof MatrixFields | 'relevance'
const COLUMN_LABEL: Record<Column, string> = { ...Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])), relevance: 'Relevancia para tu tesis' } as Record<Column, string>

const MATRIX_CHAT = tabKey(MATRIX_TAB)
const ask = (prefill: string, autoSend = false) => askAssistant({ chatId: MATRIX_CHAT, prefill, autoSend })
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)

/** Papers that can get a guide now: their text is in, and no guide is being built for them. */
const buildable = (rows: Row[], guiding: Record<string, number>) => rows.filter((r) => r.paper.textStatus === 'ready' && !guiding[r.paper.id])

/** Narrows the matrix to one course topic, or to the papers crossing the student's two. */
function TopicFilter({ all, value, pair, pairName }: { all: Row[]; value: MatrixView['topic']; pair: ConstructId[]; pairName: string }) {
  const count = (t: MatrixView['topic']) => all.filter((r) => inTopic(r, t, pair)).length
  return (
    <Select value={value} onValueChange={(topic) => patchMatrix({ topic: topic as MatrixView['topic'] })}>
      <SelectTrigger size="sm" className="h-7 min-w-36 text-[12.5px]" title="Filtrar por tema de la cátedra">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los temas</SelectItem>
        {pair.length === 2 && (
          <SelectItem value="pair">
            Cruce: {pairName} <span className="text-faint tabular-nums">{count('pair')}</span>
          </SelectItem>
        )}
        <SelectSeparator />
        {CONSTRUCT_ORDER.map((id) => (
          <SelectItem key={id} value={id}>
            {CONSTRUCTS[id].label} <span className="text-faint tabular-nums">{count(id)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function LiteratureMatrix() {
  const papers = useStore((s) => s.papers)
  const guides = useStore((s) => s.guides)
  const guiding = useStore((s) => s.guiding)
  const view = useStore((s) => s.matrix)
  const connected = useStore((s) => !!s.account?.connected)
  const research = useStore((s) => s.settings.research)
  const [open, setOpen] = useState<string | null>(null)
  const [bulk, setBulk] = useState<BulkProgress>({ running: false, stopping: false, done: 0, total: 0, failed: 0 })
  useEffect(() => onBulkProgress(setBulk), [])

  const all = useMemo(() => allRows({ papers, guides }), [papers, guides])
  const rows = useMemo(() => visibleRows(all, view, research.constructs), [all, view, research.constructs])
  const filled = all.filter((r) => isCurrent(r.guide)).length

  // A paper deleted since it was picked or selected just drops out.
  const selected = useMemo(() => new Set(view.selected.filter((id) => papers[id])), [view.selected, papers])
  // Selected rows count even when a search hides them.
  const selectedRows = all.filter((r) => selected.has(r.paper.id))
  const scope = selected.size ? selectedRows : rows
  const toggle = (id: string) => patchMatrix({ selected: selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id] })
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.paper.id))

  const busy = bulk.running || !connected

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-background"
      // ⌘C with rows ticked and no text selected copies them, ready to paste into a spreadsheet.
      onCopy={(e) => {
        if (!selected.size || !window.getSelection()?.isCollapsed) return
        e.preventDefault()
        e.clipboardData.setData('text/plain', toTsv(scope))
        toast(`${scope.length} ${scope.length === 1 ? 'fila copiada' : 'filas copiadas'} · pegalas en Excel o Sheets`)
      }}
    >
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2.5">
          <Table2 className="size-4.5 flex-none text-bloom-teal" />
          <div className="min-w-0">
            <h1 className="text-[14px] leading-tight font-semibold">Matriz de literatura</h1>
            <p className="text-[11.5px] text-muted-foreground">
              {filled} de {all.length} papers en la matriz · se completa con la guía de lectura de cada uno
            </p>
          </div>
        </div>
        <label className="flex h-7 w-56 items-center gap-1.5 rounded-md border bg-card px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <Search className="size-3.5 flex-none text-faint" />
          <input
            value={view.query}
            onChange={(e) => patchMatrix({ query: e.target.value })}
            placeholder="Buscar en la matriz…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
          {view.query && (
            <button aria-label="Borrar búsqueda" onClick={() => patchMatrix({ query: '' })} className="text-faint hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </label>
        <TopicFilter all={all} value={view.topic} pair={research.constructs} pairName={pairLabel(research, true)} />
        <Segmented
          size="sm"
          value={view.level}
          onChange={(level) => patchMatrix({ level })}
          items={[
            { value: 'all', label: 'Todos' },
            { value: 'high', label: 'Alta', title: 'Solo los muy relevantes para tu tesis' },
            { value: 'medium', label: 'Media+', title: 'Relevancia alta o media' }
          ]}
        />
        <Segmented<MatrixView['sort']>
          size="sm"
          value={view.sort}
          onChange={(sort) => patchMatrix({ sort })}
          items={[
            ...(view.filter ? [{ value: 'rank' as const, label: 'Ranking', title: 'El orden del asistente: el más pertinente primero' }] : []),
            { value: 'relevance', label: 'Relevancia' },
            { value: 'year', label: 'Año' },
            { value: 'author', label: 'Autor' }
          ]}
        />
        <span className="h-4 w-px bg-border" />
        {bulk.running ? (
          <Button variant="outline" size="sm" disabled={bulk.stopping} onClick={stopBuildingGuides} title="Frenar después del paper en curso">
            <Loader2 className="animate-spin" /> {bulk.stopping ? 'Terminando el paper en curso…' : `Guías ${bulk.done} / ${bulk.total}`}
            {!bulk.stopping && <Square className="ml-0.5 size-3 fill-current" />}
          </Button>
        ) : connected ? (
          <GuidesMenu all={all} rows={rows} selected={selectedRows} guiding={guiding} />
        ) : (
          <Button variant="outline" size="sm" onClick={() => useStore.setState({ settingsOpen: true })}>
            Conectar {providerLabel()}
          </Button>
        )}
        <CopyMenu rows={scope} selection={selected.size > 0} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => useStore.setState({ rightOpen: true, rightTab: 'assistant' })}
          title="El asistente lee la matriz: preguntale, pedile que compare o que filtre los papers por un tema"
        >
          <Sparkles className="text-brand" /> Preguntar
        </Button>
      </div>

      {view.filter && <FilterBanner label={view.filter.label} shown={rows.length} total={view.filter.ids.filter((id) => papers[id]).length} />}

      {all.length === 0 ? (
        <div className="grid flex-1 place-content-center text-center text-[13px] text-muted-foreground">Importá papers para armar la matriz.</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="matrix w-max min-w-full border-separate border-spacing-0 text-[12.5px] leading-snug select-text">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-[280px] min-w-[280px]">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={allOn ? 'Deseleccionar todos' : 'Seleccionar todos los visibles'}
                      checked={allOn}
                      onChange={() => patchMatrix({ selected: allOn ? [] : rows.map((r) => r.paper.id) })}
                      className="size-3.5 flex-none accent-brand"
                    />
                    Paper
                  </span>
                </th>
                {COLUMNS.map((c) => (
                  <ColumnHeader key={c.key} column={c.key} rows={rows} className="w-[230px] min-w-[230px]" />
                ))}
                <ColumnHeader column="relevance" rows={rows} className="w-[250px] min-w-[250px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <MatrixRow
                  key={row.paper.id}
                  row={row}
                  rank={view.sort === 'rank' && view.filter ? i + 1 : undefined}
                  why={view.filter?.why[row.paper.id]}
                  expanded={open === row.paper.id}
                  onExpand={() => setOpen(open === row.paper.id ? null : row.paper.id)}
                  selected={selected.has(row.paper.id)}
                  onSelect={() => toggle(row.paper.id)}
                  building={!!guiding[row.paper.id]}
                  disabled={busy}
                />
              ))}
            </tbody>
          </table>
          {/* Room for the selection bar, so it never covers the last row. */}
          {selected.size > 0 && <div className="h-16" />}
          {rows.length === 0 && (
            <p className="p-8 text-center text-[13px] text-muted-foreground">
              Nada coincide con la búsqueda o el filtro.{' '}
              {(view.query || view.level !== 'all' || view.topic !== 'all' || view.filter) && (
                <button
                  className="font-medium text-brand-text hover:underline"
                  onClick={() => {
                    clearMatrixFilter()
                    patchMatrix({ query: '', level: 'all', topic: 'all' })
                  }}
                >
                  Mostrar todo
                </button>
              )}
            </p>
          )}
        </div>
      )}
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          buildable={buildable(selectedRows, guiding).length}
          busy={busy}
          onCopy={() => void copyText(toTsv(scope), `${scope.length} ${scope.length === 1 ? 'fila copiada' : 'filas copiadas'} · pegalas en Excel o Sheets`)}
          onRebuild={() => void buildGuides(buildable(selectedRows, guiding).map((r) => r.paper.id))}
          onClear={() => patchMatrix({ selected: [] })}
        />
      )}
    </div>
  )
}

/** The assistant's filter, named, with the way back to the whole matrix. */
function FilterBanner({ label, shown, total }: { label: string; shown: number; total: number }) {
  return (
    <div className="flex flex-none items-center gap-2 border-b bg-bloom-teal/8 px-5 py-1.5 text-[12px]">
      <Sparkles className="size-3.5 flex-none text-brand" />
      <span className="flex-none text-muted-foreground">Filtro del asistente:</span>
      <strong className="max-w-[45%] flex-none truncate font-semibold" title={label}>
        {label}
      </strong>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        · {shown === total ? `${total} ${total === 1 ? 'paper' : 'papers'}` : `${shown} de ${total} papers`}, del más al menos pertinente
      </span>
      <Button variant="ghost" size="xs" onClick={clearMatrixFilter}>
        <X /> Mostrar toda la matriz
      </Button>
    </div>
  )
}

function SelectionBar({
  count,
  buildable,
  busy,
  onCopy,
  onRebuild,
  onClear
}: {
  count: number
  buildable: number
  busy: boolean
  onCopy: () => void
  onRebuild: () => void
  onClear: () => void
}) {
  return (
    // Floats over the table rather than pushing it down: ticking a box never moves the next one.
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-popover py-1 pr-1 pl-3 text-[12px] shadow-lg">
        <strong className="mr-1 font-semibold tabular-nums">
          {count} {count === 1 ? 'seleccionado' : 'seleccionados'}
        </strong>
        <Button variant="ghost" size="xs" onClick={() => ask(`Sobre los ${count} papers que seleccioné en la matriz: `)}>
          <MessageSquareText /> Preguntar
        </Button>
        {count > 1 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              ask(
                `Compará los ${count} papers que seleccioné en la matriz: en qué coinciden y en qué difieren sus preguntas, teorías, métodos y hallazgos, y qué aporta cada uno a mi tesis.`,
                true
              )
            }
          >
            <Scale /> Comparar
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={onCopy} title="Como tabla: pegala en Excel, Sheets o Word (también con ⌘C)">
          <Copy /> Copiar filas
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || !buildable} onClick={onRebuild} title="Vuelve a armar la guía de lectura (y su fila) de cada seleccionado">
          <RefreshCw /> Rehacer guías{buildable ? ` (${buildable})` : ''}
        </Button>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <IconButton label="Quitar la selección" size="icon-xs" onClick={onClear}>
          <X />
        </IconButton>
      </div>
    </div>
  )
}

function GuidesMenu({ all, rows, selected, guiding }: { all: Row[]; rows: Row[]; selected: Row[]; guiding: Record<string, number> }) {
  const missing = buildable(
    all.filter((r) => !isCurrent(r.guide)),
    guiding
  )
  const outdated = buildable(
    all.filter((r) => isOutdated(r.guide)),
    guiding
  )
  const visible = buildable(rows, guiding)
  const every = buildable(all, guiding)
  const picked = buildable(selected, guiding)
  const run = (list: Row[]) => void buildGuides(list.map((r) => r.paper.id))
  const n = (list: Row[]) => <span className="ml-auto pl-4 text-[11.5px] text-faint tabular-nums">{list.length}</span>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles /> {missing.length ? `Completar guías (${missing.length})` : 'Guías'} <ChevronDown className="-mr-1 size-3 text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Cada guía arma la fila de su paper, de a uno</DropdownMenuLabel>
        <DropdownMenuItem disabled={!missing.length} onSelect={() => run(missing)}>
          <Sparkles /> Completar las que faltan {n(missing)}
        </DropdownMenuItem>
        {outdated.length > 0 && (
          <DropdownMenuItem onSelect={() => run(outdated)}>
            <RefreshCw /> Actualizar las de una versión anterior {n(outdated)}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {picked.length > 0 && (
          <DropdownMenuItem onSelect={() => run(picked)}>
            <RefreshCw /> Rehacer las seleccionadas {n(picked)}
          </DropdownMenuItem>
        )}
        {visible.length !== every.length && (
          <DropdownMenuItem disabled={!visible.length} onSelect={() => run(visible)}>
            <RefreshCw /> Rehacer las que estás viendo {n(visible)}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!every.length} onSelect={() => run(every)}>
          <RefreshCw /> Rehacer todas {n(every)}
        </DropdownMenuItem>
        <p className="px-2 pt-1 pb-1.5 text-[11px] leading-snug text-faint">
          Rehacé las guías si cambiaste el tema o la pregunta de tu tesis: la relevancia se vuelve a evaluar. Podés frenar en cualquier momento.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CopyMenu({ rows, selection }: { rows: Row[]; selection: boolean }) {
  const what = `${rows.length} ${selection ? (rows.length === 1 ? 'seleccionado' : 'seleccionados') : rows.length === 1 ? 'paper' : 'papers'}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!rows.length}>
          <Copy /> Copiar <ChevronDown className="-mr-1 size-3 text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          {selection ? 'Los seleccionados' : 'Lo que estás viendo'} ({what})
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void copyText(toTsv(rows), 'Matriz copiada · pegala en Excel, Sheets o Word')}>
          <ClipboardCopy /> Como tabla (Excel, Sheets, Word)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(toMarkdown(rows), 'Matriz copiada como tabla Markdown')}>
          <Copy /> Como Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(rows.map(rowText).join('\n\n'), 'Matriz copiada como texto')}>
          <FileText /> Como texto, un paper por bloque
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void exportCsv(rows)}>
          <Download /> Exportar CSV…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A column's header: compare it across the papers on screen, or copy it. */
function ColumnHeader({ column, rows, className }: { column: Column; rows: Row[]; className?: string }) {
  const label = COLUMN_LABEL[column]
  const name = column === 'relevance' ? 'la relevancia para mi tesis' : `«${label}»`
  const filled = rows.filter((r) => isCurrent(r.guide)).length
  return (
    <th className={cn('sticky top-0 z-20 !p-0', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="group/h flex w-full items-center gap-1 px-3 py-2 text-left hover:text-foreground data-[state=open]:text-foreground">
            {label}
            <ChevronDown className="size-3 opacity-0 transition-opacity group-hover/h:opacity-100 group-data-[state=open]/h:opacity-100" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem
            disabled={!filled}
            onSelect={() => ask(`Compará ${name} entre los papers que estoy viendo en la matriz: qué tienen en común, en qué difieren y qué huecos quedan para mi tesis.`, true)}
          >
            <Scale /> Comparar entre los papers visibles
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!filled} onSelect={() => ask(`Sobre ${name} en los papers que estoy viendo en la matriz: `)}>
            <MessageSquareText /> Preguntar sobre esta columna…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!filled} onSelect={() => void copyText(columnText(rows, column), `Columna «${label}» copiada (${filled} papers)`)}>
            <Copy /> Copiar la columna
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </th>
  )
}

function MatrixRow({
  row,
  rank,
  why,
  expanded,
  onExpand,
  selected,
  onSelect,
  building,
  disabled
}: {
  row: Row
  rank?: number
  why?: string
  expanded: boolean
  onExpand: () => void
  selected: boolean
  onSelect: () => void
  building: boolean
  disabled: boolean
}) {
  const { paper, guide } = row
  const current = isCurrent(guide)
  // The cell under the pointer when the menu opened: what "this" means.
  const [cell, setCell] = useState<Column | null>(null)
  const cellText = (c: Column) => (current ? (c === 'relevance' ? guide.relevance : guide.matrix[c]) : '')

  return (
    <ContextMenu onOpenChange={(o) => !o && setCell(null)}>
      <ContextMenuTrigger asChild>
        <tr
          className={cn('group', expanded && 'expanded', selected && 'selected')}
          // Selecting text to copy shouldn't fold the row.
          onClick={() => window.getSelection()?.isCollapsed !== false && onExpand()}
          onContextMenu={(e) => setCell(((e.target as HTMLElement).closest<HTMLElement>('td[data-col]')?.dataset.col as Column) ?? null)}
        >
          <td className="sticky left-0 z-10">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label="Seleccionar"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={onSelect}
                className={cn('mt-0.5 size-3.5 flex-none accent-brand transition-opacity', !selected && 'opacity-30 group-hover:opacity-100 focus-visible:opacity-100')}
              />
              {rank !== undefined && <span className="mt-px flex-none text-[11px] font-semibold text-bloom-teal tabular-nums">{rank}</span>}
              <div className="min-w-0 flex-1">
                <button
                  className="text-left font-semibold hover:text-brand-text hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    openTab({ kind: 'paper', id: paper.id })
                  }}
                  title="Abrir el paper"
                >
                  <span className={cn(!expanded && 'line-clamp-3')}>{paper.title}</span>
                </button>
                <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
                  {authorLine(paper) || 'Autor desconocido'}
                  {paper.year ? ` · ${paper.year}` : ''}
                </div>
                <TopicBadges ids={rowTopics(row)} className="mt-1.5" />
                {why && (
                  <p className="mt-1.5 flex gap-1 text-[11.5px] leading-snug text-foreground/80">
                    <Sparkles className="mt-0.5 size-3 flex-none text-brand" />
                    <span className={cn(!expanded && 'line-clamp-3')}>{why}</span>
                  </p>
                )}
              </div>
              <RowMenu row={row} disabled={disabled} />
            </div>
          </td>
          {current ? (
            <>
              {COLUMNS.map((c) => (
                <td key={c.key} data-col={c.key}>
                  <span className={cn(!expanded && 'line-clamp-5')}>{guide.matrix[c.key] || '—'}</span>
                </td>
              ))}
              <td data-col="relevance">
                <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', LEVEL[guide.relevanceLevel].dot)} /> {LEVEL[guide.relevanceLevel].label}
                </span>
                <span className={cn(!expanded && 'line-clamp-4')}>{guide.relevance}</span>
              </td>
            </>
          ) : (
            <td colSpan={COLUMNS.length + 1} className="!align-middle">
              <MissingRow paper={paper} guide={guide} building={building} disabled={disabled} />
            </td>
          )}
        </tr>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {cell && current && (
          <>
            <ContextMenuItem onSelect={() => void copyText(cellText(cell), `«${COLUMN_LABEL[cell]}» copiado`)}>
              <Copy /> Copiar «{COLUMN_LABEL[cell]}»
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                ask(
                  `Sobre ${cell === 'relevance' ? 'la relevancia para mi tesis' : `«${COLUMN_LABEL[cell]}»`} de ${byline(paper)} («${clip(cellText(cell).replace(/\s+/g, ' '), 220)}»): `
                )
              }
            >
              <MessageSquareText /> Preguntar sobre esto…
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <RowItems row={row} disabled={disabled} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The same row actions, from the ⋯ button: for those who don't right-click. */
function RowMenu({ row, disabled }: { row: Row; disabled: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="Acciones del paper"
          size="icon-xs"
          className="-mt-0.5 -mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" onClick={(e) => e.stopPropagation()}>
        <RowItems row={row} disabled={disabled} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ItemComponent = typeof ContextMenuItem | typeof DropdownMenuItem
type SeparatorComponent = typeof ContextMenuSeparator | typeof DropdownMenuSeparator

function RowItems({ row, disabled, Item, Separator }: { row: Row; disabled: boolean; Item: ItemComponent; Separator: SeparatorComponent }) {
  const { paper, guide } = row
  const current = isCurrent(guide)
  const building = useStore((s) => !!s.guiding[paper.id])
  return (
    <>
      <Item onSelect={() => ask(`Sobre ${byline(paper)}, «${clip(paper.title, 120)}»: `)}>
        <MessageSquareText /> Preguntar sobre este paper…
      </Item>
      <Item
        onSelect={() =>
          ask(
            `¿Qué otros papers de la matriz se parecen a ${byline(paper)} («${clip(paper.title, 120)}») por tema, teoría o método? Mostralos en la matriz, del más al menos parecido.`,
            true
          )
        }
      >
        <Sparkles /> Mostrar los parecidos
      </Item>
      <Separator />
      {current && (
        <Item onSelect={() => void copyText(toTsv([row], false), 'Fila copiada · pegala en Excel o Sheets')}>
          <Copy /> Copiar la fila
        </Item>
      )}
      {current && (
        <Item onSelect={() => void copyText(rowText(row), 'Fila copiada como texto')}>
          <FileText /> Copiar como texto
        </Item>
      )}
      <Item onSelect={() => openTab({ kind: 'paper', id: paper.id })}>
        <ArrowUpRight /> Abrir el paper
      </Item>
      {paper.textStatus === 'ready' && (
        <>
          <Separator />
          <Item
            disabled={disabled || building}
            onSelect={() =>
              void buildGuide(paper.id, { quiet: true }).then((ok) =>
                toast(ok ? 'Guía rehecha: la fila está al día' : 'No se pudo armar la guía', undefined, { status: ok ? 'success' : 'error' })
              )
            }
          >
            <RefreshCw /> {building ? 'Armando la guía…' : guide ? 'Rehacer la guía' : 'Crear la guía'}
          </Item>
        </>
      )}
    </>
  )
}

function MissingRow({ paper, guide, building, disabled }: { paper: Paper; guide?: PaperGuide; building: boolean; disabled: boolean }) {
  if (building)
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Armando la guía de lectura…
      </span>
    )
  if (paper.textStatus !== 'ready')
    return <span className="text-faint">{paper.textStatus === 'error' ? 'No se pudo leer el texto de este PDF.' : 'Extrayendo el texto del PDF…'}</span>
  return (
    <span className="flex items-center gap-3 text-muted-foreground">
      {guide ? 'La guía de este paper es anterior a la matriz.' : 'Este paper todavía no tiene guía de lectura.'}
      <Button
        variant="outline"
        size="xs"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          void buildGuide(paper.id, { quiet: true }).then((ok) => ok || toast('No se pudo armar la guía', undefined, { status: 'error' }))
        }}
      >
        <Sparkles /> {guide ? 'Actualizar guía' : 'Crear guía'}
      </Button>
    </span>
  )
}

async function exportCsv(rows: Row[]): Promise<void> {
  const path = await window.api.shell.saveFile('matriz-de-literatura.csv', toCsv(rows), [{ name: 'CSV', extensions: ['csv'] }])
  if (path) toast(`Matriz exportada (${rows.length} papers)`)
}

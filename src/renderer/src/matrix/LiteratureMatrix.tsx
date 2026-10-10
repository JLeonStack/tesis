import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Loader2, Search, Sparkles, Square, Table2 } from 'lucide-react'
import { type MatrixFields, type Paper, type PaperGuide } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Segmented } from '../components/Segmented'
import { openTab, providerLabel, toast, useStore } from '../store'
import { authorLine } from '../lib/citation'
import { buildGuide, buildGuides, onBulkProgress, stopBuildingGuides, type BulkProgress } from '../lib/guide'
import { copyText } from '../lib/exporting'

// The literature matrix: every paper in the same comparable fields, side by
// side, so patterns and gaps across the literature show at a glance (the
// review matrix of Garrard's "Matrix Method"). Filled from the reading guides.

const COLUMNS: { key: keyof MatrixFields; label: string }[] = [
  { key: 'question', label: 'Pregunta' },
  { key: 'theory', label: 'Teoría' },
  { key: 'method', label: 'Método' },
  { key: 'context', label: 'Contexto y muestra' },
  { key: 'findings', label: 'Hallazgos' },
  { key: 'limitations', label: 'Limitaciones' }
]

const LEVEL = {
  high: { dot: 'bg-status-read', label: 'Alta', rank: 0 },
  medium: { dot: 'bg-status-reading', label: 'Media', rank: 1 },
  low: { dot: 'bg-faint/60', label: 'Baja', rank: 2 }
} as const

type Filter = 'all' | 'high' | 'medium'
type Sort = 'relevance' | 'year' | 'author'

/** In the matrix once its guide has the matrix fields (version 2 on). */
const isCurrent = (g: PaperGuide | undefined): g is PaperGuide & { matrix: MatrixFields } => !!g?.matrix

interface Row {
  paper: Paper
  guide?: PaperGuide
}

export function LiteratureMatrix() {
  const papers = useStore((s) => s.papers)
  const guides = useStore((s) => s.guides)
  const guiding = useStore((s) => s.guiding)
  const connected = useStore((s) => !!s.account?.connected)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('relevance')
  const [open, setOpen] = useState<string | null>(null)
  const [bulk, setBulk] = useState<BulkProgress>({ running: false, stopping: false, done: 0, total: 0, failed: 0 })
  useEffect(() => onBulkProgress(setBulk), [])

  const all = useMemo<Row[]>(() => Object.values(papers).map((paper) => ({ paper, guide: guides[paper.id] })), [papers, guides])
  const missing = all.filter((r) => !isCurrent(r.guide) && r.paper.textStatus === 'ready' && !guiding[r.paper.id])
  const filled = all.filter((r) => isCurrent(r.guide)).length

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = all.filter(({ paper, guide }) => {
      if (filter !== 'all') {
        const level = isCurrent(guide) ? guide.relevanceLevel : null
        if (!level || (filter === 'high' ? level !== 'high' : level === 'low')) return false
      }
      if (!q) return true
      const hay = [paper.title, authorLine(paper, 20), paper.year, guide?.tldr, ...(guide?.matrix ? Object.values(guide.matrix) : [])]
      return hay.some((h) => h?.toLowerCase().includes(q))
    })
    const rank = (r: Row) => (isCurrent(r.guide) ? LEVEL[r.guide.relevanceLevel].rank : 3)
    const year = (r: Row) => Number(r.paper.year) || 0
    const author = (r: Row) => r.paper.authors[0]?.family ?? r.paper.title
    return list.sort((a, b) =>
      sort === 'year'
        ? year(b) - year(a) || author(a).localeCompare(author(b))
        : sort === 'author'
          ? author(a).localeCompare(author(b)) || year(a) - year(b)
          : rank(a) - rank(b) || year(b) - year(a)
    )
  }, [all, query, filter, sort])

  const exportable = rows.filter((r) => isCurrent(r.guide))

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en la matriz…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </label>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'Todos' },
            { value: 'high', label: 'Alta', title: 'Solo los muy relevantes para tu tesis' },
            { value: 'medium', label: 'Media+', title: 'Relevancia alta o media' }
          ]}
        />
        <Segmented
          size="sm"
          value={sort}
          onChange={setSort}
          items={[
            { value: 'relevance', label: 'Relevancia' },
            { value: 'year', label: 'Año' },
            { value: 'author', label: 'Autor' }
          ]}
        />
        <span className="h-4 w-px bg-border" />
        {bulk.running ? (
          <Button variant="outline" size="sm" disabled={bulk.stopping} onClick={stopBuildingGuides} title="Frenar después del paper en curso">
            <Loader2 className="animate-spin" /> {bulk.stopping ? 'Terminando el paper en curso…' : `${bulk.done} / ${bulk.total}`}
            {!bulk.stopping && <Square className="ml-0.5 size-3 fill-current" />}
          </Button>
        ) : (
          missing.length > 0 &&
          (connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void buildGuides(missing.map((r) => r.paper.id))}
              title="Crea o actualiza la guía de lectura de cada paper que falta, de a uno"
            >
              <Sparkles /> Completar guías ({missing.length})
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => useStore.setState({ settingsOpen: true })}>
              Conectar {providerLabel()}
            </Button>
          ))
        )}
        <Button variant="ghost" size="sm" disabled={!exportable.length} onClick={() => void copyText(toMarkdown(exportable), 'Matriz copiada como tabla Markdown')}>
          <Copy /> Markdown
        </Button>
        <Button variant="ghost" size="sm" disabled={!exportable.length} onClick={() => void exportCsv(exportable)}>
          <Download /> CSV
        </Button>
      </div>

      {all.length === 0 ? (
        <div className="grid flex-1 place-content-center text-center text-[13px] text-muted-foreground">Importá papers para armar la matriz.</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="matrix w-max min-w-full border-separate border-spacing-0 text-[12.5px] leading-snug">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-[260px] min-w-[260px]">Paper</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="sticky top-0 z-20 w-[230px] min-w-[230px]">
                    {c.label}
                  </th>
                ))}
                <th className="sticky top-0 z-20 w-[250px] min-w-[250px]">Relevancia para tu tesis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ paper, guide }) => {
                const expanded = open === paper.id
                const current = isCurrent(guide)
                return (
                  <tr key={paper.id} className={cn('group', expanded && 'expanded')} onClick={() => setOpen(expanded ? null : paper.id)}>
                    <td className="sticky left-0 z-10">
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
                    </td>
                    {current ? (
                      <>
                        {COLUMNS.map((c) => (
                          <td key={c.key}>
                            <span className={cn(!expanded && 'line-clamp-5')}>{guide.matrix[c.key] || '—'}</span>
                          </td>
                        ))}
                        <td>
                          <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                            <span className={cn('size-1.5 rounded-full', LEVEL[guide.relevanceLevel].dot)} /> {LEVEL[guide.relevanceLevel].label}
                          </span>
                          <span className={cn(!expanded && 'line-clamp-4')}>{guide.relevance}</span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={COLUMNS.length + 1} className="!align-middle">
                        <MissingRow paper={paper} guide={guide} building={!!guiding[paper.id]} disabled={!connected || bulk.running} />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-8 text-center text-[13px] text-muted-foreground">Nada coincide con la búsqueda o el filtro.</p>}
        </div>
      )}
    </div>
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

// ---------- export ----------

const HEAD = ['Autores', 'Año', 'Título', ...COLUMNS.map((c) => c.label), 'Relevancia', 'Nivel']

function cells({ paper, guide }: Row): string[] {
  const m = guide!.matrix!
  return [authorLine(paper, 20), paper.year ?? '', paper.title, ...COLUMNS.map((c) => m[c.key]), guide!.relevance, LEVEL[guide!.relevanceLevel].label]
}

function toMarkdown(rows: Row[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
  return [
    `| ${HEAD.join(' | ')} |`,
    `| ${HEAD.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${cells(r).map(cell).join(' | ')} |`)
  ].join('\n')
}

async function exportCsv(rows: Row[]): Promise<void> {
  const cell = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  // BOM so Excel reads the accents as UTF-8.
  const csv = '﻿' + [HEAD, ...rows.map(cells)].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
  const path = await window.api.shell.saveFile('matriz-de-literatura.csv', csv, [{ name: 'CSV', extensions: ['csv'] }])
  if (path) toast(`Matriz exportada (${rows.length} papers)`)
}

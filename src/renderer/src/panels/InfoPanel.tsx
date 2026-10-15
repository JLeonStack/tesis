import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Hint, IconButton } from '../components/common'
import { Collapsible } from '../components/Collapsible'
import { Segmented } from '../components/Segmented'
import { Copy, Sparkles, Loader2, FolderOpen, Trash2, RefreshCw, Star, ExternalLink } from 'lucide-react'
import type { Author, CitationStyle, Paper, PaperType, ReadingStatus } from '@shared/types'
import { deletePaper, patchPaper, patchSettings, toast, useStore } from '../store'
import { authorLine, formatReference, inText, looksTitleCase, STYLE_LABELS, toBibtex, toSentenceCase } from '../lib/citation'
import { copyReference, copyText } from '../lib/exporting'
import { autofillWithAi, detectPrintedPages, refreshFromDoi } from '../lib/ingest'
import { parsePageRange } from '../lib/pages'
import { TopicToggles } from '../research/TopicChips'

const TYPES: { id: PaperType; label: string }[] = [
  { id: 'article', label: 'Artículo de revista' },
  { id: 'book', label: 'Libro' },
  { id: 'chapter', label: 'Capítulo de libro' },
  { id: 'conference', label: 'Ponencia de congreso' },
  { id: 'report', label: 'Informe' },
  { id: 'thesis', label: 'Tesis' },
  { id: 'web', label: 'Página web' }
]

const authorsToText = (a: Author[]) => a.map((x) => [x.family, x.given].filter(Boolean).join(', ')).join('\n')
const textToAuthors = (t: string): Author[] =>
  t
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (l.includes(',')) {
        const [family, ...rest] = l.split(',')
        return { family: family.trim(), given: rest.join(',').trim() }
      }
      const parts = l.split(/\s+/)
      return { family: parts.pop() ?? '', given: parts.join(' ') }
    })

export function InfoPanel({ paperId }: { paperId: string }) {
  const paper = useStore((s) => s.papers[paperId])
  const style = useStore((s) => s.settings.citationStyle)
  const account = useStore((s) => s.account)
  const [busy, setBusy] = useState<'ai' | 'doi' | null>(null)
  if (!paper) return null

  const ref = formatReference(paper, style)
  const edit = (patch: Partial<Paper>) => patchPaper(paper.id, { ...patch, metaSource: 'manual' })

  const runAi = async () => {
    setBusy('ai')
    try {
      await autofillWithAi(paper.id)
      toast('Datos completados con IA. Revisalos.')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runDoi = async () => {
    if (!paper.doi) return
    setBusy('doi')
    const ok = await refreshFromDoi(paper.id, paper.doi)
    setBusy(null)
    toast(ok ? 'Actualizado desde Crossref' : 'No se encontró ningún registro para ese DOI')
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Progressive disclosure (Hick's law, Pareto): what you use most is open, the rest folds with a summary. */}
      <Collapsible
        id="info.citation"
        variant="title"
        title="Cita"
        summary={inText(paper, style)}
        className="border-b bg-muted/40 px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-1.5"
      >
        <Segmented
          size="sm"
          fill
          value={style}
          onChange={(s) => patchSettings({ citationStyle: s })}
          items={(Object.keys(STYLE_LABELS) as CitationStyle[]).map((s) => ({ value: s, label: STYLE_LABELS[s] }))}
        />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={ref}
            className="reference text-[13.5px]"
            initial={{ opacity: 0, filter: 'blur(4px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, filter: 'blur(4px)' }}
            transition={{ duration: 0.18 }}
            dangerouslySetInnerHTML={{ __html: escapeRef(ref) }}
          />
        </AnimatePresence>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" className="h-7 px-2.5" onClick={() => void copyReference(paper)}>
            <Copy /> Copiar referencia
          </Button>
          <Hint label="Copiar cita en el texto">
            <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={() => void copyText(inText(paper, style), 'Cita en el texto copiada')}>
              {inText(paper, style)}
            </Button>
          </Hint>
          <Button variant="ghost" size="xs" className="h-7 px-2.5 text-muted-foreground" onClick={() => void copyText(toBibtex(paper), 'BibTeX copiado')}>
            BibTeX
          </Button>
        </div>
        {(paper.metaSource === 'pdf' || !paper.authors.length || !paper.year) && (
          <div className="flex items-center gap-2 rounded-lg bg-hl-yellow/15 px-2.5 py-2 text-xs text-muted-foreground">
            <span className="flex-1">{paper.metaSource === 'pdf' ? 'Los datos se dedujeron del PDF.' : 'Faltan algunos datos.'}</span>
            <Button
              variant="outline"
              size="xs"
              disabled={!!busy || !account?.connected || paper.textStatus !== 'ready'}
              onClick={() => void runAi()}
            >
              {busy === 'ai' ? <Loader2 className="animate-spin" /> : <Sparkles />} Completar con IA
            </Button>
          </div>
        )}
      </Collapsible>

      <Collapsible
        id="info.details"
        variant="title"
        title="Detalles"
        summary={[authorLine(paper, 2), paper.year].filter(Boolean).join(' · ')}
        className="border-b px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-2"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <FieldShell label="Estado">
            <Select value={paper.status} onValueChange={(v) => patchPaper(paper.id, { status: v as ReadingStatus })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unread"><StatusDot className="bg-status-unread" />Por leer</SelectItem>
                <SelectItem value="reading"><StatusDot className="bg-status-reading" />Leyendo</SelectItem>
                <SelectItem value="read"><StatusDot className="bg-status-read" />Leído</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Tipo">
            <Select value={paper.type} onValueChange={(v) => edit({ type: v as PaperType })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        </div>
        <Field label="Título" value={paper.title} multiline onCommit={(v) => v.trim() && edit({ title: v.trim() })} />
        {paper.type !== 'book' && paper.type !== 'report' && looksTitleCase(paper.title) && (
          <div className="-mt-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="flex-1 leading-snug">APA escribe el título en tipo oración: mayúscula solo al inicio, después de dos puntos y en nombres propios.</span>
            <Button
              variant="outline"
              size="xs"
              className="h-7 flex-none"
              onClick={() => {
                edit({ title: toSentenceCase(paper.title) })
                toast('Título en tipo oración. Revisá que los nombres propios (escalas, países, teorías con nombre) sigan con mayúscula.')
              }}
            >
              Tipo oración
            </Button>
          </div>
        )}
        <Field label="Autores" hint="Uno por línea: Apellido, Nombre" value={authorsToText(paper.authors)} multiline onCommit={(v) => edit({ authors: textToAuthors(v) })} />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Año" value={paper.year ?? ''} onCommit={(v) => edit({ year: v.trim() || undefined })} />
          <Field label="Páginas" value={paper.pages ?? ''} onCommit={(v) => edit({ pages: v.trim() || undefined })} />
        </div>
        <PrintedPages paper={paper} />
      </Collapsible>

      <Collapsible
        id="info.publication"
        variant="title"
        title="Publicación"
        defaultOpen={false}
        summary={[paper.venue, paper.volume && `vol. ${paper.volume}`, paper.doi && 'DOI'].filter(Boolean).join(' · ') || 'Revista, DOI, enlace'}
        className="border-b px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-2"
      >
        <Field
          label={paper.type === 'book' || paper.type === 'chapter' ? 'Libro / colección' : paper.type === 'conference' ? 'Congreso' : 'Revista'}
          value={paper.venue ?? ''}
          onCommit={(v) => edit({ venue: v.trim() || undefined })}
        />
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Volumen" value={paper.volume ?? ''} onCommit={(v) => edit({ volume: v.trim() || undefined })} />
          <Field label="Número" value={paper.issue ?? ''} onCommit={(v) => edit({ issue: v.trim() || undefined })} />
          <Field label="Nº artículo" value={paper.articleNumber ?? ''} onCommit={(v) => edit({ articleNumber: v.trim() || undefined })} />
        </div>
        {(paper.type === 'chapter' || paper.type === 'conference') && (
          <Field
            label="Editores"
            hint="Uno por línea: Apellido, Nombre"
            value={authorsToText(paper.editors ?? [])}
            multiline
            onCommit={(v) => edit({ editors: textToAuthors(v) })}
          />
        )}
        <Field label="Editorial" value={paper.publisher ?? ''} onCommit={(v) => edit({ publisher: v.trim() || undefined })} />
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <Field label="DOI" value={paper.doi ?? ''} onCommit={(v) => edit({ doi: v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') || undefined })} />
          </div>
          <IconButton label="Obtener datos de Crossref" disabled={!paper.doi || !!busy} onClick={() => void runDoi()}>
            {busy === 'doi' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </IconButton>
        </div>
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <Field label="URL" value={paper.url ?? ''} onCommit={(v) => edit({ url: v.trim() || undefined })} />
          </div>
          <IconButton label="Abrir enlace" disabled={!paper.url} onClick={() => paper.url && window.api.shell.openExternal(paper.url)}>
            <ExternalLink />
          </IconButton>
        </div>
      </Collapsible>

      <Collapsible
        id="info.more"
        variant="title"
        title="Temas, etiquetas y resumen"
        defaultOpen={false}
        summary={[paper.tags.length ? paper.tags.map((t) => `#${t}`).join(' ') : 'Sin etiquetas', paper.abstract ? 'resumen' : ''].filter(Boolean).join(' · ')}
        className="border-b px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-2"
      >
        {/* Not a FieldShell: a <label> would forward stray clicks to the first toggle. */}
        <div className="flex flex-col gap-1.5">
          <span className="flex items-baseline gap-2 text-[11.5px] font-[550] text-muted-foreground">
            Temas de la cátedra <em className="font-normal text-faint not-italic">Filtran la matriz y cuentan para tu cruce</em>
          </span>
          <TopicToggles paperId={paper.id} />
        </div>
        <Field
          label="Etiquetas"
          hint="Separadas por coma"
          value={paper.tags.join(', ')}
          onCommit={(v) => patchPaper(paper.id, { tags: [...new Set(v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean))] })}
        />
        <Field label="Resumen" value={paper.abstract ?? ''} multiline rows={6} onCommit={(v) => edit({ abstract: v.trim() || undefined })} />
      </Collapsible>

      <section className="flex items-center gap-1 px-2.5 pt-2.5 pb-4">
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => patchPaper(paper.id, { starred: !paper.starred })}>
          <Star className={cn(paper.starred && 'fill-hl-yellow text-hl-yellow')} /> {paper.starred ? 'Destacado' : 'Destacar'}
        </Button>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => window.api.papers.reveal(paper.fileName)}>
          <FolderOpen /> Mostrar en el Finder
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => confirm(`¿Mover “${paper.title}” a la papelera?`) && void deletePaper(paper.id)}
        >
          <Trash2 /> Eliminar
        </Button>
      </section>
    </div>
  )
}

function escapeRef(ref: string): string {
  const esc = ref.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*([^*]+)\*/g, '<i>$1</i>')
}

function FieldShell({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-[11.5px] font-[550] text-muted-foreground">
        {label}
        {hint && <em className="font-normal text-faint not-italic">{hint}</em>}
      </span>
      {children}
    </label>
  )
}

/** Uncontrolled-while-editing field that commits on blur / Enter (no save button needed). */
function Field({
  label,
  hint,
  value,
  multiline,
  rows,
  onCommit
}: {
  label: string
  hint?: string
  value: string
  multiline?: boolean
  rows?: number
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])
  const commit = () => {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  const props = {
    value: draft,
    onFocus: () => setEditing(true),
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.metaKey)) (e.target as HTMLElement).blur()
      if (e.key === 'Escape') {
        setDraft(value)
        setTimeout(() => (e.target as HTMLElement).blur())
      }
    }
  }
  return (
    <FieldShell label={label} hint={hint}>
      {multiline ? (
        <Textarea rows={rows ?? Math.min(5, Math.max(2, draft.split('\n').length))} className="min-h-0 resize-none text-[12.5px] md:text-[12.5px]" {...props} />
      ) : (
        <Input className="h-8 text-[12.5px] md:text-[12.5px]" {...props} />
      )}
    </FieldShell>
  )
}

/**
 * Which printed page each PDF page is. APA cites the page printed on the
 * article; the reader keeps the PDF's numbering, so citations store the PDF
 * page and show the printed one.
 */
function PrintedPages({ paper }: { paper: Paper }) {
  const pp = paper.printedPages
  const offset = pp?.offset ?? null
  // Anchor the example on the article's first page when the range says which one it is.
  const start = parsePageRange(paper.pages)?.start
  const anchor = offset != null && start && start - offset >= 1 && start - offset <= (paper.pageCount ?? Infinity) ? start - offset : Math.max(1, 1 - (offset ?? 0))
  const [editing, setEditing] = useState(false)
  const [pdf, setPdf] = useState('')
  const [printed, setPrinted] = useState('')
  if (paper.textStatus !== 'ready' && !pp) return null

  const open = () => {
    const at = paper.lastPage ?? anchor
    setPdf(String(at))
    setPrinted(offset != null ? String(at + offset) : '')
    setEditing(true)
  }
  const n = Number(pdf)
  const m = Number(printed)
  const valid = Number.isInteger(n) && Number.isInteger(m) && n >= 1 && m >= 1 && (!paper.pageCount || n <= paper.pageCount)
  const save = () => {
    if (!valid) return
    patchPaper(paper.id, { printedPages: { offset: m - n, source: 'manual' } })
    setEditing(false)
  }
  const redetect = () => {
    patchPaper(paper.id, { printedPages: undefined })
    void detectPrintedPages(paper.id)
    setEditing(false)
  }

  const summary =
    offset == null ? (
      <>No se encontró la página impresa: las citas usan la página del PDF.</>
    ) : offset === 0 ? (
      <>Las páginas del PDF coinciden con las impresas.</>
    ) : (
      <>
        Las citas usan la página impresa: la <b className="font-medium text-foreground tabular-nums">{anchor}</b> del PDF es la{' '}
        <b className="font-medium text-foreground tabular-nums">p. {anchor + offset}</b>.
      </>
    )

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-[11.5px] font-[550] text-muted-foreground">
        Numeración de páginas
        <em className="font-normal text-faint not-italic">{pp?.source === 'manual' ? 'La indicaste vos' : pp ? 'Detectada del PDF' : 'Sin revisar'}</em>
      </span>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          La página
          <Input autoFocus aria-label="Página del PDF" inputMode="numeric" className="h-7 w-14 px-2 text-center text-[12.5px] tabular-nums md:text-[12.5px]" value={pdf} onChange={(e) => setPdf(e.target.value.trim())} />
          del PDF es la página impresa
          <Input aria-label="Página impresa" inputMode="numeric" className="h-7 w-16 px-2 text-center text-[12.5px] tabular-nums md:text-[12.5px]" value={printed} onChange={(e) => setPrinted(e.target.value.trim())} />
          <span className="flex basis-full items-center gap-1.5 pt-0.5">
            <Button type="submit" size="xs" className="h-7" disabled={!valid}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" size="xs" className="h-7 text-muted-foreground" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            {pp?.source === 'manual' && (
              <Button type="button" variant="ghost" size="xs" className="ml-auto h-7 text-muted-foreground" onClick={redetect}>
                <RefreshCw /> Detectar de nuevo
              </Button>
            )}
          </span>
        </form>
      ) : (
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {summary}{' '}
          <button className="font-medium text-brand-text hover:underline" onClick={open}>
            {offset == null ? 'Indicar' : 'Corregir'}
          </button>
        </p>
      )}
    </div>
  )
}

function StatusDot({ className }: { className: string }) {
  return <span aria-hidden className={cn('size-2 flex-none rounded-full', className)} />
}

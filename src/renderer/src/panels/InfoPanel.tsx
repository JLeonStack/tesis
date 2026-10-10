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
import { authorLine, formatReference, inText, STYLE_LABELS, toBibtex } from '../lib/citation'
import { copyReference, copyText } from '../lib/exporting'
import { autofillWithAi, refreshFromDoi } from '../lib/ingest'

const TYPES: { id: PaperType; label: string }[] = [
  { id: 'article', label: 'Journal article' },
  { id: 'book', label: 'Book' },
  { id: 'chapter', label: 'Book chapter' },
  { id: 'conference', label: 'Conference paper' },
  { id: 'report', label: 'Report' },
  { id: 'thesis', label: 'Thesis' },
  { id: 'web', label: 'Web page' }
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
      toast('Details filled in. Please double-check them.')
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
    toast(ok ? 'Updated from Crossref' : 'No record found for that DOI')
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Progressive disclosure (Hick's law, Pareto): what you use most is open, the rest folds with a summary. */}
      <Collapsible
        id="info.citation"
        variant="title"
        title="Citation"
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
            <Copy /> Copy reference
          </Button>
          <Hint label="Copy in-text citation">
            <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={() => void copyText(inText(paper, style), 'In-text citation copied')}>
              {inText(paper, style)}
            </Button>
          </Hint>
          <Button variant="ghost" size="xs" className="h-7 px-2.5 text-muted-foreground" onClick={() => void copyText(toBibtex(paper), 'BibTeX copied')}>
            BibTeX
          </Button>
        </div>
        {(paper.metaSource === 'pdf' || !paper.authors.length || !paper.year) && (
          <div className="flex items-center gap-2 rounded-lg bg-hl-yellow/15 px-2.5 py-2 text-xs text-muted-foreground">
            <span className="flex-1">{paper.metaSource === 'pdf' ? 'Details were guessed from the PDF.' : 'Some details are missing.'}</span>
            <Button
              variant="outline"
              size="xs"
              disabled={!!busy || !account?.connected || paper.textStatus !== 'ready'}
              onClick={() => void runAi()}
            >
              {busy === 'ai' ? <Loader2 className="animate-spin" /> : <Sparkles />} Fill with AI
            </Button>
          </div>
        )}
      </Collapsible>

      <Collapsible
        id="info.details"
        variant="title"
        title="Details"
        summary={[authorLine(paper, 2), paper.year].filter(Boolean).join(' · ')}
        className="border-b px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-2"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <FieldShell label="Status">
            <Select value={paper.status} onValueChange={(v) => patchPaper(paper.id, { status: v as ReadingStatus })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unread"><StatusDot className="bg-status-unread" />To read</SelectItem>
                <SelectItem value="reading"><StatusDot className="bg-status-reading" />Reading</SelectItem>
                <SelectItem value="read"><StatusDot className="bg-status-read" />Read</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Type">
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
        <Field label="Title" value={paper.title} multiline onCommit={(v) => v.trim() && edit({ title: v.trim() })} />
        <Field label="Authors" hint="One per line: Family, Given" value={authorsToText(paper.authors)} multiline onCommit={(v) => edit({ authors: textToAuthors(v) })} />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Year" value={paper.year ?? ''} onCommit={(v) => edit({ year: v.trim() || undefined })} />
          <Field label="Pages" value={paper.pages ?? ''} onCommit={(v) => edit({ pages: v.trim() || undefined })} />
        </div>
      </Collapsible>

      <Collapsible
        id="info.publication"
        variant="title"
        title="Publication"
        defaultOpen={false}
        summary={[paper.venue, paper.volume && `vol. ${paper.volume}`, paper.doi && 'DOI'].filter(Boolean).join(' · ') || 'Journal, DOI, link'}
        className="border-b px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-2"
      >
        <Field
          label={paper.type === 'book' || paper.type === 'chapter' ? 'Book / series' : paper.type === 'conference' ? 'Conference' : 'Journal'}
          value={paper.venue ?? ''}
          onCommit={(v) => edit({ venue: v.trim() || undefined })}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Volume" value={paper.volume ?? ''} onCommit={(v) => edit({ volume: v.trim() || undefined })} />
          <Field label="Issue" value={paper.issue ?? ''} onCommit={(v) => edit({ issue: v.trim() || undefined })} />
        </div>
        <Field label="Publisher" value={paper.publisher ?? ''} onCommit={(v) => edit({ publisher: v.trim() || undefined })} />
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <Field label="DOI" value={paper.doi ?? ''} onCommit={(v) => edit({ doi: v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') || undefined })} />
          </div>
          <IconButton label="Fetch details from Crossref" disabled={!paper.doi || !!busy} onClick={() => void runDoi()}>
            {busy === 'doi' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </IconButton>
        </div>
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <Field label="URL" value={paper.url ?? ''} onCommit={(v) => edit({ url: v.trim() || undefined })} />
          </div>
          <IconButton label="Open link" disabled={!paper.url} onClick={() => paper.url && window.api.shell.openExternal(paper.url)}>
            <ExternalLink />
          </IconButton>
        </div>
      </Collapsible>

      <Collapsible
        id="info.more"
        variant="title"
        title="Tags & abstract"
        defaultOpen={false}
        summary={[paper.tags.length ? paper.tags.map((t) => `#${t}`).join(' ') : 'No tags', paper.abstract ? 'abstract' : ''].filter(Boolean).join(' · ')}
        className="border-b px-3.5 py-2"
        contentClassName="flex flex-col gap-3 pt-1.5 pb-2"
      >
        <Field
          label="Tags"
          hint="Comma separated"
          value={paper.tags.join(', ')}
          onCommit={(v) => patchPaper(paper.id, { tags: [...new Set(v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean))] })}
        />
        <Field label="Abstract" value={paper.abstract ?? ''} multiline rows={6} onCommit={(v) => edit({ abstract: v.trim() || undefined })} />
      </Collapsible>

      <section className="flex items-center gap-1 px-2.5 pt-2.5 pb-4">
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => patchPaper(paper.id, { starred: !paper.starred })}>
          <Star className={cn(paper.starred && 'fill-hl-yellow text-hl-yellow')} /> {paper.starred ? 'Starred' : 'Star'}
        </Button>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => window.api.papers.reveal(paper.fileName)}>
          <FolderOpen /> Show in Finder
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => confirm(`Move “${paper.title}” to the Trash?`) && void deletePaper(paper.id)}
        >
          <Trash2 /> Delete
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

function StatusDot({ className }: { className: string }) {
  return <span aria-hidden className={cn('size-2 flex-none rounded-full', className)} />
}

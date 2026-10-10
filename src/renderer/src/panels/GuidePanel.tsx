import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { BookMarked, Brain, Clock, Compass, Highlighter, Loader2, MessageCircleQuestion, NotebookPen, RotateCcw, ScanText, Sparkles, Target } from 'lucide-react'
import { GUIDE_VERSION, type GuideTerm, type PaperGuide, type SectionAdvice, type SkimSentence } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Button as MotionButton } from '@/components/motion/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ThinkingShimmer } from '@/components/agents/loading-states/thinking-shimmer'
import { cn } from '@/lib/utils'
import { EmptyState, Hint, IconButton } from '../components/common'
import { Collapsible } from '../components/Collapsible'
import { askAssistant, jumpTo, jumpToSentence, openRecall, providerLabel, saveAnnotation, toast, useStore } from '../store'
import { RecallView } from './RecallView'
import { ADVICE_LABEL, DEFINITION_COLOR, FACETS, buildGuide, guideDefinitions, highlightDefinitions, readingMinutes, skimMinutes, wordCount } from '../lib/guide'
import { getPaperText } from '../lib/ingest'
import { addQuoteToNote } from '../editor/noteBridge'
import { langShort } from '../lib/translate'
import { timeAgo, uid } from '../lib/util'

// Literal class names so Tailwind picks them up.
const FACET_BAR: Record<SkimSentence['facet'], string> = {
  goal: 'bg-[var(--skim-goal)]',
  method: 'bg-[var(--skim-method)]',
  finding: 'bg-[var(--skim-finding)]',
  limitation: 'bg-[var(--skim-limitation)]',
  definition: 'bg-[var(--skim-definition)]'
}
const ADVICE_DOT: Record<SectionAdvice, string> = { read: 'bg-status-read', skim: 'bg-status-reading', skip: 'bg-faint/60' }
const LEVEL = {
  high: { dot: 'bg-status-read', label: 'Highly relevant' },
  medium: { dot: 'bg-status-reading', label: 'Partly relevant' },
  low: { dot: 'bg-faint/60', label: 'Marginal' }
} as const

/**
 * The reading guide for one paper: what it says, where to spend attention
 * given the thesis, and the key sentences (also marked on the page in skim mode).
 */
export function GuidePanel({ paperId }: { paperId: string }) {
  const guide = useStore((s) => s.guides[paperId])
  const since = useStore((s) => s.guiding[paperId])
  const recalling = useStore((s) => s.recallFor?.paperId === paperId)
  if (recalling) return <RecallView paperId={paperId} />
  if (!guide) return since ? <Building since={since} /> : <Intro paperId={paperId} />
  return <Guide guide={guide} paperId={paperId} rebuilding={!!since} />
}

function Intro({ paperId }: { paperId: string }) {
  const connected = useStore((s) => !!s.account?.connected)
  const provider = useStore((s) => providerLabel(s.settings))
  const textStatus = useStore((s) => s.papers[paperId]?.textStatus)
  const [words, setWords] = useState<number | null>(null)
  useEffect(() => {
    if (textStatus !== 'ready') return
    let alive = true
    void getPaperText(paperId).then((pages) => alive && pages && setWords(pages.reduce((n, p) => n + wordCount(p.text), 0)))
    return () => {
      alive = false
    }
  }, [paperId, textStatus])

  return (
    <EmptyState
      bloom
      icon={<Compass />}
      title="Know where to look before you read"
      description="Get the gist in three lines, see which sections matter for your thesis, and have the key sentences marked on the page."
    >
      {connected ? (
        <MotionButton disabled={textStatus !== 'ready'} onClick={() => void buildGuide(paperId)}>
          <Sparkles className="size-4" /> Build reading guide
        </MotionButton>
      ) : (
        <Button variant="outline" size="sm" onClick={() => useStore.setState({ settingsOpen: true })}>
          Connect {provider} to start
        </Button>
      )}
      <span className="text-[11.5px] text-faint">
        {textStatus === 'pending'
          ? 'Waiting for the text to be extracted…'
          : textStatus === 'error'
            ? 'The text of this PDF could not be read.'
            : words
              ? `Full read: about ${readingMinutes(words)} min`
              : 'Takes about a minute. Keep reading meanwhile.'}
      </span>
      {textStatus === 'ready' && (
        <Button variant="link" size="xs" className="mt-1 text-muted-foreground" onClick={() => openRecall(paperId)}>
          <Brain /> ¿Ya lo leíste? Comprobá lo que recordás
        </Button>
      )}
    </EmptyState>
  )
}

/** Doherty threshold: immediate feedback, then a visible clock. */
function Building({ since }: { since: number }) {
  const secs = useSeconds(since)
  return (
    <div className="flex flex-col gap-3 px-4 pt-5">
      <span className="flex items-center gap-2 text-[13px]">
        <ThinkingShimmer>Mapping the paper…</ThinkingShimmer>
        {secs >= 3 && <span className="text-[11.5px] text-faint tabular-nums">{secs}s</span>}
      </span>
      <p className="text-[12.5px] text-muted-foreground">Usually under a minute. You can keep reading; the guide appears here when it’s ready.</p>
      <div className="mt-2 flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-[94%]" />
        <Skeleton className="h-3.5 w-[60%]" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="h-4 w-12 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-[45%]" />
            <Skeleton className="h-3 w-[85%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function useSeconds(since: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return Math.max(0, Math.round((now - since) / 1000))
}

function Guide({ guide, paperId, rebuilding }: { guide: PaperGuide; paperId: string; rebuilding: boolean }) {
  const skim = useStore((s) => s.skim)
  const advice = (a: SectionAdvice) => guide.sections.filter((s) => s.advice === a).length
  const marked = guide.sentences.filter((s) => s.rects.length).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-6">
      {/* Goal-gradient: the time it takes, and the shortcut that cuts it. */}
      <div className="rounded-xl border bg-background p-3">
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" /> Full read <strong className="font-semibold text-foreground tabular-nums">~{readingMinutes(guide.words)} min</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <ScanText className="size-3.5" /> Skim <strong className="font-semibold text-foreground tabular-nums">~{skimMinutes(guide)} min</strong>
          </span>
        </div>
        <Button
          size="sm"
          variant={skim ? 'secondary' : 'default'}
          className="mt-2.5 w-full"
          disabled={!marked}
          onClick={() => useStore.setState({ skim: !skim })}
        >
          <ScanText /> {skim ? 'Hide key sentences on the page' : `Mark ${marked} key sentences on the page`}
        </Button>
      </div>

      <RecallCard paperId={paperId} />

      {(guide.version ?? 1) < GUIDE_VERSION && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-[12px] leading-snug text-brand-text">
          <Sparkles className="mt-0.5 size-3.5 flex-none" />
          <span className="flex-1">
            {(guide.version ?? 1) < 2
              ? 'Reconstruí la guía para sumar preguntas de repaso, la fila de la matriz y las definiciones del paper.'
              : 'Reconstruí la guía para encontrar y marcar las definiciones que da el paper.'}
          </span>
          <button className="font-semibold underline-offset-2 hover:underline disabled:opacity-50" disabled={rebuilding} onClick={() => void buildGuide(paperId)}>
            {rebuilding ? 'Reconstruyendo…' : 'Reconstruir'}
          </button>
        </div>
      )}

      <p className="mt-4 px-1 font-serif text-[14.5px] leading-relaxed">{guide.tldr}</p>

      {/* Prequestions: knowing what to look for focuses reading (pretesting effect); they come back as the recall check. */}
      {!!guide.recall?.length && (
        <Collapsible
          id="guide:recall"
          title="Leé buscando responder"
          count={guide.recall.length}
          className="mt-4"
          headerClassName="px-1"
          contentClassName="flex flex-col gap-2 px-1 pt-1"
        >
          {guide.recall.map((q, i) => (
            <p key={i} className="flex gap-2 text-[12.5px] leading-snug">
              <Target className="mt-0.5 size-3.5 flex-none text-faint" />
              {q}
            </p>
          ))}
        </Collapsible>
      )}

      <Collapsible id="guide:thesis" title="For your thesis" className="mt-4" headerClassName="px-1" contentClassName="px-1 pt-1">
        <span className="mb-1.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', LEVEL[guide.relevanceLevel].dot)} /> {LEVEL[guide.relevanceLevel].label}
        </span>
        <p className="text-[13px] leading-relaxed">{guide.relevance}</p>
      </Collapsible>

      <Collapsible
        id="guide:roadmap"
        title="Roadmap"
        count={guide.sections.length}
        summary={`Read ${advice('read')} · Skim ${advice('skim')} · Skip ${advice('skip')}`}
        className="mt-3"
        headerClassName="px-1"
      >
        {guide.sections.map((s, i) => (
          <button
            key={i}
            onClick={() => jumpTo(paperId, s.page)}
            className="flex w-full gap-2.5 rounded-lg px-1.5 py-2 text-left outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="mt-px inline-flex h-5 w-[52px] flex-none items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', ADVICE_DOT[s.advice])} /> {ADVICE_LABEL[s.advice]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={cn('min-w-0 text-[13px] font-medium', s.advice === 'skip' && 'text-muted-foreground')}>{s.title}</span>
                <span className="flex-none text-[11px] text-faint tabular-nums">p. {s.page}</span>
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{s.gist}</span>
              {s.why && <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{s.why}</span>}
            </span>
          </button>
        ))}
      </Collapsible>

      <Collapsible
        id="guide:sentences"
        title="Key sentences"
        count={guide.sentences.filter((s) => s.facet !== 'definition').length}
        className="mt-3"
        headerClassName="px-1"
      >
        {FACETS.filter((f) => f.id !== 'definition').map((f) => {
          const items = guide.sentences.filter((s) => s.facet === f.id)
          if (!items.length) return null
          return (
            <div key={f.id} className="mt-1.5">
              <div className="flex items-center gap-1.5 px-1.5 py-1 text-[12px]">
                <span aria-hidden className={cn('h-[3px] w-3 rounded-full', FACET_BAR[f.id])} />
                <span className="font-semibold">{f.label}</span>
                <span className="text-faint tabular-nums">{items.length}</span>
                <span className="truncate text-[11.5px] text-faint">· {f.hint}</span>
              </div>
              {items.map((s, i) => (
                <SentenceRow key={s.id} s={s} paperId={paperId} delay={i} />
              ))}
            </div>
          )
        })}
      </Collapsible>

      {guide.terms.length > 0 && <TermsSection guide={guide} paperId={paperId} />}

      {guide.questions.length > 0 && (
        <Collapsible
          id="guide:questions"
          title="Read with these questions"
          count={guide.questions.length}
          className="mt-3"
          headerClassName="px-1"
          contentClassName="flex flex-col gap-2 px-1 pt-1"
        >
          {guide.questions.map((q, i) => (
            <p key={i} className="flex gap-2 text-[12.5px] leading-snug">
              <MessageCircleQuestion className="mt-0.5 size-3.5 flex-none text-faint" />
              {q}
            </p>
          ))}
        </Collapsible>
      )}

      <div className="mt-5 flex items-center gap-2 px-1 text-[11.5px] text-faint">
        <span className="min-w-0 flex-1 truncate">
          Built {timeAgo(guide.createdAt)} in {langShort(guide.language)}. Check quotes against the page.
        </span>
        <Hint label="Build the guide again (uses your current thesis settings)">
          <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={rebuilding} onClick={() => void buildGuide(paperId)}>
            {rebuilding ? <Loader2 className="animate-spin" /> : <RotateCcw />} {rebuilding ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </Hint>
      </div>
    </div>
  )
}

/** Key terms, and where the paper defines them in its own words (verbatim, located on the page). */
function TermsSection({ guide, paperId }: { guide: PaperGuide; paperId: string }) {
  const defs = guideDefinitions(guide)
  const sentenceOf = new Map(defs.map((d) => [d.term, d.sentence]))
  const onPage = defs.filter((d) => d.sentence.rects.length).length
  const done = useStore((s) => {
    const have = new Set(Object.values(s.annotations).filter((a) => a.paperId === paperId).map((a) => `${a.page}|${a.text}`))
    return defs.every((d) => !d.sentence.rects.length || have.has(`${d.sentence.page}|${d.sentence.text}`))
  })
  return (
    <Collapsible
      id="guide:terms"
      title={defs.length ? 'Key terms & definitions' : 'Key terms'}
      count={guide.terms.length}
      summary={guide.terms.map((t) => t.term).join(', ')}
      className="mt-3"
      headerClassName="px-1"
      contentClassName="flex flex-col gap-1 pt-1"
    >
      {defs.length > 0 ? (
        <div className="mb-1 flex items-center gap-2 px-1 text-[11.5px] text-muted-foreground">
          <span aria-hidden className="h-[3px] w-3 rounded-full bg-[var(--skim-definition)]" />
          <span className="flex-1">
            El paper define {defs.length} {defs.length === 1 ? 'término' : 'términos'}
            {onPage < defs.length && ` (${onPage} marcados en la página)`}
          </span>
          {onPage > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={done}
              onClick={() => {
                const n = highlightDefinitions(paperId)
                toast(n === 1 ? '1 definición resaltada' : `${n} definiciones resaltadas`, undefined, { description: 'En violeta, con el término como comentario.' })
              }}
            >
              <Highlighter /> {done ? 'Resaltadas' : 'Resaltar todas'}
            </Button>
          )}
        </div>
      ) : (
        (guide.version ?? 1) >= GUIDE_VERSION && <p className="mb-1 px-1 text-[11.5px] text-faint">El paper no define explícitamente estos términos; las definiciones son de la guía.</p>
      )}
      {guide.terms.map((t, i) => (
        <TermRow key={i} term={t} sentence={sentenceOf.get(t)} paperId={paperId} />
      ))}
    </Collapsible>
  )
}

function TermRow({ term: t, sentence, paperId }: { term: GuideTerm; sentence?: SkimSentence; paperId: string }) {
  const highlight = () => {
    if (!sentence) return
    const now = Date.now()
    saveAnnotation({ id: uid(), paperId, page: sentence.page, rects: sentence.rects, text: sentence.text, color: DEFINITION_COLOR, comment: `Definición: ${t.term}`, createdAt: now, updatedAt: now })
    toast('Definición resaltada')
  }
  return (
    <div className="group rounded-lg px-1.5 py-1.5 text-[12.5px] leading-snug">
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold">{t.term}</span>
        {t.original && t.original.toLowerCase() !== t.term.toLowerCase() && <span className="truncate text-[11.5px] text-faint italic">{t.original}</span>}
        <button className="ml-auto flex-none text-[11px] text-faint tabular-nums hover:text-foreground" onClick={() => (sentence ? jumpToSentence(paperId, sentence) : jumpTo(paperId, t.page))}>
          p. {t.page}
        </button>
      </div>
      <p className="mt-0.5 text-muted-foreground">{t.definition}</p>
      {sentence && (
        <div
          role="button"
          tabIndex={0}
          title="Ver la definición en el paper"
          onClick={() => jumpToSentence(paperId, sentence)}
          onKeyDown={(e) => e.key === 'Enter' && jumpToSentence(paperId, sentence)}
          className="mt-1.5 flex gap-2 rounded-md p-1.5 transition-colors outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="w-[3px] flex-none rounded-full bg-[var(--skim-definition)]" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-4 font-serif text-[13px] leading-relaxed">{sentence.text}</p>
            <div className="-mb-1 flex h-6 items-center gap-0.5 pt-0.5">
              <span className="mr-1 flex items-center gap-1 text-[11px] text-faint">
                <BookMarked className="size-3" /> Definición del paper{!sentence.rects.length && ' · no marcada en la página'}
              </span>
              <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                {sentence.rects.length > 0 && (
                  <IconButton size="icon-xs" label="Resaltar en el paper" onClick={highlight}>
                    <Highlighter />
                  </IconButton>
                )}
                <IconButton size="icon-xs" label="Agregar a la nota" onClick={() => addQuoteToNote(paperId, sentence.page, sentence.text)}>
                  <NotebookPen />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SentenceRow({ s, paperId, delay }: { s: SkimSentence; paperId: string; delay: number }) {
  const highlight = () => {
    const now = Date.now()
    saveAnnotation({ id: uid(), paperId, page: s.page, rects: s.rects, text: s.text, color: 'yellow', createdAt: now, updatedAt: now })
    toast('Sentence highlighted')
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(delay, 10) * 0.02, type: 'spring', stiffness: 420, damping: 34 }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => jumpToSentence(paperId, s)}
        onKeyDown={(e) => e.key === 'Enter' && jumpToSentence(paperId, s)}
        className="group flex gap-2.5 rounded-lg p-2 transition-colors outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className={cn('w-[3px] flex-none rounded-full', FACET_BAR[s.facet])} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-4 font-serif text-[13.5px] leading-relaxed">{s.text}</p>
          <div className="-mb-1 flex h-6 items-center gap-0.5 pt-0.5">
            <span className="mr-1 text-[11px] text-faint tabular-nums">
              p. {s.page}
              {!s.rects.length && ' · not marked on the page'}
            </span>
            <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              {s.rects.length > 0 && (
                <IconButton size="icon-xs" label="Highlight in the paper" onClick={highlight}>
                  <Highlighter />
                </IconButton>
              )}
              <IconButton size="icon-xs" label="Add to note" onClick={() => addQuoteToNote(paperId, s.page, s.text)}>
                <NotebookPen />
              </IconButton>
              <IconButton
                size="icon-xs"
                label="Ask the assistant about it"
                onClick={() => askAssistant({ chatId: `paper:${paperId}`, quote: { paperId, page: s.page, text: s.text } })}
              >
                <Sparkles />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/** Retrieval practice entry point: when it's due, how the last check went, one click to start. */
function RecallCard({ paperId }: { paperId: string }) {
  const recall = useStore((s) => s.recalls[paperId])
  const status = useStore((s) => s.papers[paperId]?.status)
  const last = recall?.attempts.at(-1)
  const due = recall && recall.dueAt <= Date.now()
  const days = recall ? Math.max(1, Math.round((recall.dueAt - Date.now()) / 86_400_000)) : 0
  const highlight = due || (!recall && status === 'read')
  return (
    <button
      onClick={() => openRecall(paperId)}
      className={cn(
        'mt-3 flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-colors hover:bg-accent/60',
        highlight && 'border-status-read/50 bg-status-read/5'
      )}
    >
      <Brain className={cn('size-4 flex-none', highlight ? 'text-status-read' : 'text-muted-foreground')} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{due ? 'Toca repasar este paper' : 'Comprobá lo que leíste'}</span>
        <span className="block text-[11.5px] text-muted-foreground">
          {last
            ? `Último: ${Math.round(last.score * 100)}% ${timeAgo(last.at)}${due ? '' : ` · repaso en ${days} ${days === 1 ? 'día' : 'días'}`}`
            : 'Respondé de memoria; recordar fija lo leído mucho más que releer'}
        </span>
      </span>
    </button>
  )
}

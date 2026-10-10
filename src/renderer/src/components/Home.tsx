import { useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Brain, Check, FileText, NotebookPen, Sparkles, Upload } from 'lucide-react'
import { createNote, openRecall, openTab, providerLabel, useStore } from '../store'
import { importPapers } from '../lib/ingest'
import { authorLine } from '../lib/citation'
import { mod, timeAgo } from '../lib/util'
import { cn } from '@/lib/utils'
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg'
import { Collapsible } from './Collapsible'

const rise = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.04 * i, type: 'spring' as const, stiffness: 380, damping: 32 }
})

export function Home() {
  const papers = useStore((s) => s.papers)
  const notes = useStore((s) => s.notes)
  const settings = useStore((s) => s.settings)
  const account = useStore((s) => s.account)

  const reading = useMemo(
    () =>
      Object.values(papers)
        .filter((p) => p.status !== 'read' && (p.lastPage ?? 0) > 1)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 3),
    [papers]
  )
  // Spaced review: recall checks that are due, then finished papers never checked.
  const recalls = useStore((s) => s.recalls)
  const review = useMemo(() => {
    const now = Date.now()
    const due = Object.values(recalls)
      .filter((r) => r.dueAt <= now && papers[r.id])
      .sort((a, b) => a.dueAt - b.dueAt)
      .map((r) => ({ paper: papers[r.id], last: r.attempts.at(-1) }))
    const fresh = Object.values(papers)
      .filter((p) => p.status === 'read' && !recalls[p.id])
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((paper) => ({ paper, last: undefined }))
    return [...due, ...fresh].slice(0, 6)
  }, [recalls, papers])
  const recentPapers = useMemo(() => Object.values(papers).sort((a, b) => b.addedAt - a.addedAt).slice(0, 5), [papers])
  const recentNotes = useMemo(() => Object.values(notes).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [notes])

  // Goal-gradient: a short, visible path to a working setup.
  const steps = [
    { done: !!settings.thesisTitle.trim(), label: 'Describe your thesis', hint: 'The assistant tailors every answer to it', run: () => useStore.setState({ settingsOpen: true }) },
    { done: Object.keys(papers).length > 0, label: 'Import your first papers', hint: 'Drop PDFs anywhere in the window', run: () => void importPapers() },
    { done: !!account?.connected, label: `Connect ${providerLabel(settings)}`, hint: 'Uses your existing subscription', run: () => useStore.setState({ settingsOpen: true }) }
  ]
  const doneCount = steps.filter((s) => s.done).length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="drag relative isolate min-h-0 flex-1 overflow-y-auto bg-background">
      <div aria-hidden className="bloom-art inset-x-0 top-0 -z-10 h-[260px]" />
      <div className="no-drag mx-auto flex max-w-[820px] flex-col gap-8 px-10 pt-24 pb-16">
        <motion.header {...rise(0)}>
          <h1 className="font-heading text-[34px] font-medium tracking-tight">{greeting}</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            {settings.thesisTitle.trim() || 'Your thesis workspace. Read, annotate, write.'}
          </p>
        </motion.header>

        {doneCount < steps.length && (
          <motion.div {...rise(1)} className="rounded-xl border bg-card px-4 pt-2.5 pb-2 shadow-xs">
            <Collapsible
              id="home.setup"
              variant="title"
              title="Get set up"
              count={`${doneCount} of ${steps.length}`}
              summary={`Next: ${steps.find((x) => !x.done)?.label}`}
            >
            <div className="mt-1.5 mb-3 h-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-bloom-gradient"
                initial={{ width: 0 }}
                animate={{ width: `${(doneCount / steps.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
            <SharedLayoutBg inset={8} pillClassName="rounded-lg bg-accent">
              {steps.map((s) => (
                <button key={s.label} onClick={s.run} disabled={s.done} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <span
                    className={cn(
                      'grid size-5 flex-none place-items-center rounded-full border-[1.5px] border-input transition-colors',
                      s.done && 'border-status-read bg-status-read text-white'
                    )}
                  >
                    {s.done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="flex flex-1 flex-col">
                    <strong className={cn('font-[550]', s.done && 'text-faint line-through')}>{s.label}</strong>
                    <span className="text-xs text-muted-foreground">{s.hint}</span>
                  </span>
                  {!s.done && <ArrowRight className="size-4 text-faint" />}
                </button>
              ))}
            </SharedLayoutBg>
            </Collapsible>
          </motion.div>
        )}

        {review.length > 0 && (
          <motion.div {...rise(2)}>
            <Collapsible
              id="home.review"
              group="home"
              title="Repaso"
              marker="bg-bloom-lilac"
              count={review.length}
              summary="Recordar lo leído, espaciado en el tiempo, es lo que más lo fija"
              contentClassName="pt-1.5"
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {review.map(({ paper: p, last }) => (
                  <motion.button
                    key={p.id}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    onClick={() => openRecall(p.id)}
                    className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-shadow hover:shadow-md"
                  >
                    <span className="line-clamp-2 font-heading text-[15px] leading-snug font-medium">{p.title}</span>
                    <span className="text-[11.5px] text-muted-foreground">{authorLine(p, 2) || 'Unknown author'}</span>
                    <span className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <Brain className="size-3.5 text-bloom-lilac" />
                      {last ? `Toca repasar · ${Math.round(last.score * 100)}% la última vez` : 'Terminado, nunca comprobado'}
                    </span>
                  </motion.button>
                ))}
              </div>
            </Collapsible>
          </motion.div>
        )}

        {reading.length > 0 && (
          <motion.div {...rise(2)}>
            <Collapsible id="home.reading" group="home" title="Continue reading" marker="bg-status-reading" count={reading.length} contentClassName="pt-1.5">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {reading.map((p) => {
                const pct = p.pageCount ? Math.round(((p.maxPage ?? p.lastPage ?? 1) / p.pageCount) * 100) : 0
                return (
                  <motion.button
                    key={p.id}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    onClick={() => openTab({ kind: 'paper', id: p.id })}
                    className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-shadow hover:shadow-md"
                  >
                    <span className="line-clamp-2 font-heading text-[15px] leading-snug font-medium">{p.title}</span>
                    <span className="text-[11.5px] text-muted-foreground">{authorLine(p, 2) || 'Unknown author'}</span>
                    <span className="mt-2 mb-1 h-[3px] overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-status-reading" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[11.5px] text-muted-foreground tabular-nums">
                      Page {p.lastPage} of {p.pageCount} · {pct}%
                    </span>
                  </motion.button>
                )
              })}
            </div>
            </Collapsible>
          </motion.div>
        )}

        <motion.div {...rise(3)} className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Collapsible id="home.papers" group="home" title="Recent papers" marker="bg-kind-paper" count={recentPapers.length || undefined} contentClassName="pt-1.5">
            {recentPapers.length ? (
              <RecentList
                items={recentPapers.map((p) => ({ id: p.id, icon: <FileText className="text-kind-paper" />, title: p.title, meta: p.year ?? '', open: () => openTab({ kind: 'paper', id: p.id }) }))}
              />
            ) : (
              <DropCard icon={<Upload />} title="Import PDFs" hint={`or drop them here · ${mod}O`} onClick={() => void importPapers()} />
            )}
          </Collapsible>
          <Collapsible id="home.notes" group="home" title="Recent notes" marker="bg-kind-note" count={recentNotes.length || undefined} contentClassName="pt-1.5">
            {recentNotes.length ? (
              <RecentList
                items={recentNotes.map((n) => ({ id: n.id, icon: <NotebookPen className="text-kind-note" />, title: n.title || 'Untitled note', meta: timeAgo(n.updatedAt), open: () => openTab({ kind: 'note', id: n.id }) }))}
              />
            ) : (
              <DropCard icon={<NotebookPen />} title="Start a note" hint={`Outline chapters, collect quotes · ${mod}N`} onClick={() => createNote()} />
            )}
          </Collapsible>
        </motion.div>

        <motion.p {...rise(4)} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-brand" /> Tip: select text in a paper to highlight it, send it to a note, or ask the assistant about it.
        </motion.p>
      </div>
    </div>
  )
}

function RecentList({ items }: { items: { id: string; icon: React.ReactNode; title: string; meta: string; open: () => void }[] }) {
  return (
    <div className="rounded-xl border bg-card p-1.5 shadow-xs">
      <SharedLayoutBg inset={0} pillClassName="rounded-lg bg-accent">
        {items.map((it) => (
          <button key={it.id} onClick={it.open} className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-muted-foreground [&_svg]:size-4">
            {it.icon}
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{it.title}</span>
            <span className="flex-none text-[11.5px]">{it.meta}</span>
          </button>
        ))}
      </SharedLayoutBg>
    </div>
  )
}

function DropCard({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed p-7 text-muted-foreground transition-colors hover:border-primary hover:bg-brand-soft hover:text-brand-text [&_svg]:size-5"
    >
      {icon}
      <strong className="font-[550] text-foreground">{title}</strong>
      <span className="text-xs">{hint}</span>
    </button>
  )
}

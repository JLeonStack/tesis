import { useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Brain, CalendarCheck, CalendarClock, CalendarDays, ChartColumn, Check, Crosshair, FileText, ListPlus, NotebookPen, Sparkles, Upload } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { AGENT_TAB, askAssistant, createNote, openAgent, openAnalysis, openRecall, openResearch, openTab, openTasks, providerLabel, tabKey, useStore } from '../store'
import { PLAN_TODAY, WEEKLY_REVIEW } from '../agent/context'
import { ProgressPanel } from '../progress/ProgressPanel'
import { PHASES, deliveryLabel, fmtDelivery, frameworkChecks, nextDelivery, pairLabel } from '../research/framework'
import { changeCount, createPlan, planChanges } from '../research/plan'
import { bucketOf, compareTasks, dueLabel, endOf, today } from '../tasks/dates'
import { TaskCheck } from '../tasks/TaskCheck'
import { StartPomodoroButton, TaskPomodoroChip } from '../pomodoro/Pomodoro'
import { useFocusByTask } from '../pomodoro/timer'
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
  // What's late, due today or this week.
  const tasks = useStore((s) => s.tasks)
  const focus = useFocusByTask()
  const upcoming = useMemo(() => {
    const now = today()
    return Object.values(tasks)
      .filter((t) => ['overdue', 'today', 'week'].includes(bucketOf(t, now)))
      .sort(compareTasks)
  }, [tasks])
  const recentPapers = useMemo(() => Object.values(papers).sort((a, b) => b.addedAt - a.addedAt).slice(0, 5), [papers])
  const recentNotes = useMemo(() => Object.values(notes).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [notes])

  // Goal-gradient: a short, visible path to a working setup.
  const steps = [
    { done: settings.research.constructs.length === 2, label: 'Elegí tus 2 temas de la cátedra', hint: 'De los 5 del taller, desde la perspectiva del colaborador', run: openResearch },
    { done: !!settings.thesisTitle.trim(), label: 'Describí tu tesis', hint: 'El asistente adapta cada respuesta a ella', run: openResearch },
    { done: Object.keys(papers).length > 0, label: 'Importá tus primeros papers', hint: 'Soltá PDF en cualquier parte de la ventana', run: () => void importPapers() },
    { done: !!settings.analysis.datasetId, label: 'Importá la base de datos de la cátedra', hint: 'El .xlsx de Qualtrics: la app puntúa las escalas y calcula el análisis', run: openAnalysis },
    { done: !!account?.connected, label: `Conectar ${providerLabel(settings)}`, hint: 'Usá tu suscripción actual', run: () => useStore.setState({ settingsOpen: true }) }
  ]
  const doneCount = steps.filter((s) => s.done).length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="drag relative isolate min-h-0 flex-1 overflow-y-auto bg-background">
      <div aria-hidden className="bloom-art inset-x-0 top-0 -z-10 h-[260px]" />
      <div className="no-drag mx-auto flex max-w-[820px] flex-col gap-8 px-10 pt-24 pb-16">
        <motion.header {...rise(0)}>
          <h1 className="font-heading text-[34px] font-medium tracking-tight">{greeting}</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            {settings.thesisTitle.trim() || 'Tu espacio de tesis. Leé, anotá, escribí.'}
          </p>
        </motion.header>

        {/* One place to ask anything or get something done (Jakob's law: a prompt box). */}
        <motion.button
          {...rise(1)}
          onClick={() => openAgent()}
          className="-mt-3 flex h-11 items-center gap-2.5 rounded-xl border bg-card px-3.5 text-left text-muted-foreground shadow-xs transition-[box-shadow,border-color] hover:border-brand/40 hover:shadow-md"
        >
          <Sparkles className="size-4 text-brand" />
          <span className="flex-1 text-[13.5px]">Preguntale al asistente o pedile algo: qué leer, armar una nota, sumar un paper a las candidatas…</span>
          <Kbd>{mod}⌥A</Kbd>
        </motion.button>

        <motion.div {...rise(1)} className="-mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => askAssistant({ chatId: tabKey(AGENT_TAB), prefill: PLAN_TODAY, autoSend: true })}
            className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12.5px] font-medium shadow-xs transition-colors hover:border-brand/40 hover:bg-brand-soft"
            title="El asistente mira tu plan, lo vencido y tu ritmo, propone qué hacer hoy y arranca el pomodoro"
          >
            <CalendarCheck className="size-3.5 text-brand" /> Plan de hoy
          </button>
          <button
            onClick={() => askAssistant({ chatId: tabKey(AGENT_TAB), prefill: WEEKLY_REVIEW, autoSend: true })}
            className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12.5px] font-medium shadow-xs transition-colors hover:border-brand/40 hover:bg-brand-soft"
            title="Qué avanzaste, qué se atrasó y cómo ajustar el plan para llegar"
          >
            <CalendarDays className="size-3.5 text-bloom-pink" /> Revisión semanal
          </button>
          <button
            onClick={openAnalysis}
            className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12.5px] font-medium shadow-xs transition-colors hover:border-brand/40 hover:bg-accent"
          >
            <ChartColumn className="size-3.5 text-bloom-amber" /> Análisis de datos
          </button>
        </motion.div>

        <motion.div {...rise(1)}>
          <ThesisStatus />
        </motion.div>

        <motion.div {...rise(2)}>
          <ProgressPanel />
        </motion.div>

        {doneCount < steps.length && (
          <motion.div {...rise(1)} className="rounded-xl border bg-card px-4 pt-2.5 pb-2 shadow-xs">
            <Collapsible
              id="home.setup"
              variant="title"
              title="Configuración inicial"
              count={`${doneCount} de ${steps.length}`}
              summary={`Siguiente: ${steps.find((x) => !x.done)?.label}`}
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
                    <span className="text-[11.5px] text-muted-foreground">{authorLine(p, 2) || 'Autor desconocido'}</span>
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

        {upcoming.length > 0 && (
          <motion.div {...rise(2)}>
            <Collapsible
              id="home.tasks"
              group="home"
              title="Tareas"
              marker="bg-bloom-pink"
              count={upcoming.length}
              summary="Vencidas, para hoy y para esta semana"
              actions={
                <button onClick={() => openTasks()} className="text-xs text-muted-foreground hover:text-foreground">
                  Ver todas
                </button>
              }
              contentClassName="pt-1"
            >
              <div className="flex flex-col">
                {upcoming.slice(0, 6).map((t) => {
                  const end = endOf(t)!
                  const { text, tone } = dueLabel(end)
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTasks(t.id)}
                      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openTasks(t.id)}
                      className="group flex h-9 items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-accent"
                    >
                      <TaskCheck task={t} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{t.title || 'Sin título'}</span>
                      <StartPomodoroButton task={t} />
                      <TaskPomodoroChip task={t} focus={focus.get(t.id)} />
                      <span className={cn('flex items-center gap-1 text-[11.5px]', tone === 'overdue' ? 'font-medium text-destructive' : tone === 'soon' ? 'font-medium' : 'text-muted-foreground')}>
                        <CalendarDays className="size-3" /> {text}
                      </span>
                    </div>
                  )
                })}
                {upcoming.length > 6 && (
                  <button onClick={() => openTasks()} className="px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
                    y {upcoming.length - 6} más…
                  </button>
                )}
              </div>
            </Collapsible>
          </motion.div>
        )}

        {reading.length > 0 && (
          <motion.div {...rise(2)}>
            <Collapsible id="home.reading" group="home" title="Seguir leyendo" marker="bg-status-reading" count={reading.length} contentClassName="pt-1.5">
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
                    <span className="text-[11.5px] text-muted-foreground">{authorLine(p, 2) || 'Autor desconocido'}</span>
                    <span className="mt-2 mb-1 h-[3px] overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-status-reading" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[11.5px] text-muted-foreground tabular-nums">
                      Página {p.lastPage} de {p.pageCount} · {pct}%
                    </span>
                  </motion.button>
                )
              })}
            </div>
            </Collapsible>
          </motion.div>
        )}

        <motion.div {...rise(3)} className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Collapsible id="home.papers" group="home" title="Papers recientes" marker="bg-kind-paper" count={recentPapers.length || undefined} contentClassName="pt-1.5">
            {recentPapers.length ? (
              <RecentList
                items={recentPapers.map((p) => ({ id: p.id, icon: <FileText className="text-kind-paper" />, title: p.title, meta: p.year ?? '', open: () => openTab({ kind: 'paper', id: p.id }) }))}
              />
            ) : (
              <DropCard icon={<Upload />} title="Importar PDF" hint={`o soltalos acá · ${mod}O`} onClick={() => void importPapers()} />
            )}
          </Collapsible>
          <Collapsible id="home.notes" group="home" title="Notas recientes" marker="bg-kind-note" count={recentNotes.length || undefined} contentClassName="pt-1.5">
            {recentNotes.length ? (
              <RecentList
                items={recentNotes.map((n) => ({ id: n.id, icon: <NotebookPen className="text-kind-note" />, title: n.title || 'Nota sin título', meta: timeAgo(n.updatedAt), open: () => openTab({ kind: 'note', id: n.id }) }))}
              />
            ) : (
              <DropCard icon={<NotebookPen />} title="Crear una nota" hint={`Esquematizá capítulos, juntá citas · ${mod}N`} onClick={() => createNote()} />
            )}
          </Collapsible>
        </motion.div>

        <motion.p {...rise(4)} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-brand" /> Consejo: seleccioná texto en un paper para resaltarlo, mandarlo a una nota o preguntarle al asistente sobre él.
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

/** Where the thesis stands: the topics crossed, the deadline, and the next stage of the plan. */
function ThesisStatus() {
  const settings = useStore((s) => s.settings)
  const tasks = useStore((s) => s.tasks)
  const r = settings.research
  const delivery = nextDelivery()
  const { issues, next, missing } = useMemo(() => {
    const titles = new Map(PHASES.map((p) => [p.title, p]))
    const phaseIds = new Set(PHASES.map((p) => p.id))
    const next = Object.values(tasks)
      .filter((t) => (t.phaseId ? phaseIds.has(t.phaseId) : titles.has(t.title)) && t.status !== 'done')
      .sort((a, b) => (a.start ?? a.due ?? '').localeCompare(b.start ?? b.due ?? ''))[0]
    return {
      issues: frameworkChecks(settings).filter((c) => !c.ok && c.severity !== 'info').length,
      next,
      missing: changeCount(planChanges(settings, Object.values(tasks)))
    }
  }, [settings, tasks])
  const pair = r.constructs.length === 2 ? pairLabel(r) : ''
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <button onClick={openResearch} className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-shadow hover:shadow-md">
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Crosshair className="size-3.5 text-bloom-teal" /> Marco de investigación
        </span>
        <strong className={cn('text-[14px] leading-snug font-[600]', !pair && 'text-destructive')}>{pair || 'Elegí tus 2 temas'}</strong>
        <span className="text-[11.5px] text-muted-foreground">{issues ? `${issues} punto${issues > 1 ? 's' : ''} para revisar` : 'Todo en regla con la cátedra'}</span>
      </button>
      <div className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 shadow-xs">
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <CalendarClock className="size-3.5 text-bloom-pink" /> {delivery ? deliveryLabel(delivery.n) : 'Entregas del taller'}
        </span>
        <strong className={cn('text-[14px] font-[600] tabular-nums', delivery && delivery.left <= 7 && 'text-destructive')}>
          {!delivery ? 'Todas entregadas' : delivery.left ? `Faltan ${delivery.left} día${delivery.left === 1 ? '' : 's'}` : 'Es hoy'}
        </strong>
        {delivery && <span className="text-[11.5px] text-muted-foreground first-letter:uppercase">{fmtDelivery(delivery.date)}</span>}
      </div>
      {next ? (
        <button onClick={() => openTasks(next.id)} className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-shadow hover:shadow-md">
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <ArrowRight className="size-3.5 text-brand" /> Etapa actual
          </span>
          <strong className="line-clamp-2 text-[14px] leading-snug font-[600]">{next.title}</strong>
          {next.due && <span className="text-[11.5px] text-muted-foreground">{dueLabel(next.due).text}</span>}
        </button>
      ) : (
        <button
          onClick={() => createPlan().count > 0 && openTasks()}
          disabled={!missing || !delivery}
          className="flex flex-col gap-1 rounded-xl border border-dashed bg-card p-3.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <ListPlus className="size-3.5 text-brand" /> Plan de la tesis
          </span>
          <strong className="text-[14px] font-[600]">{missing ? 'Armar el plan por entregas' : 'Plan completo'}</strong>
          <span className="text-[11.5px] text-muted-foreground">Etapas de cada entrega del taller, con pomodoros e hitos del tutor</span>
        </button>
      )}
    </div>
  )
}

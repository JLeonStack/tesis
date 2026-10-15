import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChartGantt, Diamond, FileText, Flag, List, ListTodo, Plus, Search, Timer, Trash2, X } from 'lucide-react'
import type { Task, TaskPriority, TaskStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { Collapsible } from '../components/Collapsible'
import { Segmented } from '../components/Segmented'
import { IconButton } from '../components/common'
import { createTask, deleteTask, openTab, patchTask, useStore } from '../store'
import { shortTitle } from '../lib/citation'
import { fold } from '../lib/util'
import { bucketOf, compareTasks, diffDays, dueLabel, endOf, fmtDay, isOverdue, parseQuickAdd, toDay, today, type Bucket } from './dates'
import { Timeline, type Zoom } from './Timeline'
import { TaskCheck, completeTask } from './TaskCheck'
import { PomodoroField, StartPomodoroButton, TaskPomodoroChip } from '../pomodoro/Pomodoro'
import { cleanPlan, startTask, useFocusByTask, type TaskFocus } from '../pomodoro/timer'
import { ProgressPanel } from '../progress/ProgressPanel'

// Tasks for the thesis: a list grouped by when things are due, and a timeline
// (Gantt) to plan the chapters, readings and deadlines against the calendar.

type View = 'list' | 'timeline'

const BUCKETS: { id: Bucket; title: string; marker: string; defaultOpen?: boolean }[] = [
  { id: 'overdue', title: 'Vencidas', marker: 'bg-destructive' },
  { id: 'today', title: 'Hoy', marker: 'bg-bloom-orange' },
  { id: 'week', title: 'Próximos 7 días', marker: 'bg-status-reading' },
  { id: 'later', title: 'Más adelante', marker: 'bg-status-unread' },
  { id: 'undated', title: 'Sin fecha', marker: 'bg-faint' },
  { id: 'done', title: 'Hechas', marker: 'bg-status-read', defaultOpen: false }
]

const PREFS_KEY = 'tasks-view-v1'
function loadPrefs(): { view: View; zoom: Zoom } {
  try {
    return { view: 'list', zoom: 'week', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch {
    return { view: 'list', zoom: 'week' }
  }
}

export function TasksView({ active }: { active: boolean }) {
  const tasks = useStore((s) => s.tasks)
  const papers = useStore((s) => s.papers)
  const selectedId = useStore((s) => s.selectedTask)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [query, setQuery] = useState('')
  const addRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // ignore quota / private mode
    }
  }, [prefs])

  // Opening the tab means you're here to add or check something: be ready to type.
  useEffect(() => {
    if (active && !useStore.getState().selectedTask) addRef.current?.focus()
  }, [active])

  const all = useMemo(() => Object.values(tasks).sort(compareTasks), [tasks])
  const shown = useMemo(() => {
    const q = fold(query.trim())
    if (!q) return all
    return all.filter((t) => fold([t.title, t.notes, t.paperId ? papers[t.paperId]?.title : ''].join(' ')).includes(q))
  }, [all, query, papers])

  const now = today()
  const pending = all.filter((t) => t.status !== 'done')
  const overdue = pending.filter((t) => isOverdue(t, now)).length
  const done = all.length - pending.length
  const selected = selectedId ? tasks[selectedId] : undefined
  const select = (id: string | null) => useStore.setState({ selectedTask: id })

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selected) select(null)
      }}
    >
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2.5">
          <ListTodo className="size-4.5 flex-none text-bloom-pink" />
          <div className="min-w-0">
            <h1 className="text-[14px] leading-tight font-semibold">Tareas</h1>
            <p className="text-[11.5px] text-muted-foreground">
              {all.length === 0 ? (
                'Lo que tenés que hacer para la tesis, con fechas'
              ) : (
                <>
                  {pending.length} {pending.length === 1 ? 'pendiente' : 'pendientes'}
                  {overdue > 0 && <span className="text-destructive"> · {overdue} {overdue === 1 ? 'vencida' : 'vencidas'}</span>} · {done} de {all.length} hechas
                </>
              )}
            </p>
          </div>
        </div>
        <label className="flex h-7 w-52 items-center gap-1.5 rounded-md border bg-card px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <Search className="size-3.5 flex-none text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tareas…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </label>
        {prefs.view === 'timeline' && (
          <Segmented
            size="sm"
            value={prefs.zoom}
            onChange={(zoom) => setPrefs((p) => ({ ...p, zoom }))}
            items={[
              { value: 'day', label: 'Días' },
              { value: 'week', label: 'Semanas' },
              { value: 'month', label: 'Meses' }
            ]}
          />
        )}
        <Segmented
          size="sm"
          value={prefs.view}
          onChange={(view) => setPrefs((p) => ({ ...p, view }))}
          items={[
            { value: 'list', label: 'Lista', icon: <List /> },
            { value: 'timeline', label: 'Cronograma', icon: <ChartGantt /> }
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {prefs.view === 'list' && all.length > 0 && <ProgressPanel className="flex-none px-5 pt-3" />}
          <div className="flex-none px-5 pt-3 pb-2">
            <QuickAdd inputRef={addRef} />
          </div>
          {all.length === 0 ? (
            <div className="grid flex-1 place-content-center gap-1 text-center text-[13px] text-muted-foreground">
              <p>Todavía no hay tareas.</p>
              <p className="text-[12px] text-faint">Escribí una arriba, con la fecha al final: «Entregar capítulo 2 viernes», «Reunión con el tutor 15/11», «Leer Porter 2 pomodoros hoy».</p>
            </div>
          ) : prefs.view === 'list' ? (
            <TaskList tasks={shown} selectedId={selectedId} onSelect={select} />
          ) : (
            <Timeline tasks={shown} zoom={prefs.zoom} selectedId={selectedId} onSelect={select} />
          )}
          {all.length > 0 && shown.length === 0 && <p className="p-8 text-center text-[13px] text-muted-foreground">Ninguna tarea coincide con la búsqueda.</p>}
        </div>
        {selected && <TaskDetail key={selected.id} task={selected} onClose={() => select(null)} />}
      </div>
    </div>
  )
}

// ---------- quick add ----------

function QuickAdd({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseQuickAdd(text), [text])

  const submit = () => {
    if (!parsed.title) return
    createTask({ title: parsed.title, due: parsed.due, priority: parsed.priority ?? 'normal', pomodoro: parsed.pomodoros ? cleanPlan({ sessions: parsed.pomodoros }) : undefined })
    setText('')
  }

  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
      <Plus className="size-4 flex-none text-faint" />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape' && text) {
            e.stopPropagation()
            setText('')
          }
        }}
        placeholder="Agregar una tarea… (al final: «viernes», «15/11», «en 2 semanas»; «3 pomodoros»; «!» prioridad alta)"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
      {parsed.priority === 'high' && <Flag className="size-3.5 flex-none fill-current text-destructive" />}
      {parsed.pomodoros && (
        <span className="flex flex-none items-center gap-1 rounded-md bg-bloom-ember/10 px-1.5 py-0.5 text-[11.5px] font-medium text-bloom-ember tabular-nums">
          <Timer className="size-3" /> {parsed.pomodoros}
        </span>
      )}
      {parsed.due && (
        <span className="flex flex-none items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[11.5px] font-medium">
          <CalendarDays className="size-3" /> {fmtDay(parsed.due)}
        </span>
      )}
      {text.trim() && <kbd className="flex-none text-[11px] text-faint">↩</kbd>}
    </label>
  )
}

// ---------- list ----------

function TaskList({ tasks, selectedId, onSelect }: { tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const now = today()
  const focus = useFocusByTask()
  const groups = useMemo(() => {
    const by = new Map<Bucket, Task[]>()
    for (const t of tasks) {
      const b = bucketOf(t, now)
      by.set(b, [...(by.get(b) ?? []), t])
    }
    // Most recently finished first.
    by.get('done')?.sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt))
    return by
  }, [tasks, now])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3">
        {BUCKETS.map((b) => {
          const list = groups.get(b.id)
          if (!list?.length) return null
          return (
            <Collapsible key={b.id} id={`tasks.${b.id}`} group="tasks" title={b.title} marker={b.marker} count={list.length} defaultOpen={b.defaultOpen} contentClassName="pt-1">
              <div className="flex flex-col">
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} focus={focus.get(t.id)} selected={t.id === selectedId} onSelect={() => onSelect(t.id)} />
                ))}
              </div>
            </Collapsible>
          )
        })}
      </div>
    </div>
  )
}

function TaskRow({ task, focus, selected, onSelect }: { task: Task; focus?: TaskFocus; selected: boolean; onSelect: () => void }) {
  const paper = useStore((s) => (task.paperId ? s.papers[task.paperId] : undefined))
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onSelect()}
          className={cn(
            'group flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
            selected ? 'bg-accent' : 'hover:bg-accent/60'
          )}
        >
          <TaskCheck task={task} />
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', task.status === 'done' && 'text-faint line-through', !task.title && 'text-faint italic')}>
            {task.title || 'Sin título'}
          </span>
          {task.status === 'doing' && <span className="flex-none text-[11px] font-medium text-status-reading">En curso</span>}
          {task.priority === 'high' && task.status !== 'done' && <Flag className="size-3.5 flex-none fill-current text-destructive" aria-label="Prioridad alta" />}
          {paper && (
            <span className="flex max-w-[180px] flex-none items-center gap-1 truncate text-[11.5px] text-muted-foreground" title={paper.title}>
              <FileText className="size-3 flex-none text-kind-paper" />
              <span className="truncate">{shortTitle(paper.title)}</span>
            </span>
          )}
          {task.milestone && <Diamond className="size-3.5 flex-none fill-current text-bloom-pink" aria-label="Hito" />}
          <StartPomodoroButton task={task} />
          <TaskPomodoroChip task={task} focus={focus} />
          <DueChip task={task} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {task.status !== 'done' && <ContextMenuItem onSelect={() => startTask(task.id)}>Empezar pomodoro</ContextMenuItem>}
        <ContextMenuSeparator />
        {task.status !== 'doing' && <ContextMenuItem onSelect={() => patchTask(task.id, { status: 'doing' })}>Marcar en curso</ContextMenuItem>}
        {task.status !== 'done' && <ContextMenuItem onSelect={() => completeTask(task)}>Marcar como hecha</ContextMenuItem>}
        {task.status !== 'todo' && <ContextMenuItem onSelect={() => patchTask(task.id, { status: 'todo' })}>Marcar pendiente</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => patchTask(task.id, { due: today(), start: task.start && task.start > today() ? undefined : task.start })}>Para hoy</ContextMenuItem>
        {(task.start || task.due) && <ContextMenuItem onSelect={() => patchTask(task.id, { start: undefined, due: undefined, milestone: false })}>Quitar fechas</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => deleteTask(task.id)}>
          Eliminar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function DueChip({ task }: { task: Task }) {
  const end = endOf(task)
  if (!end) return null
  const now = today()
  const { text, tone } = dueLabel(end, now)
  const late = isOverdue(task, now)
  // A task that hasn't started yet says when it starts.
  const upcoming = task.start && task.due && task.start > now && task.status !== 'done'
  return (
    <span
      className={cn(
        'flex flex-none items-center gap-1 text-[11.5px] tabular-nums',
        task.status === 'done' ? 'text-faint' : late ? 'font-medium text-destructive' : tone === 'soon' ? 'font-medium text-foreground' : 'text-muted-foreground'
      )}
      title={task.start && task.due && task.start !== task.due ? `${fmtDay(task.start)} → ${fmtDay(task.due)}` : fmtDay(end)}
    >
      <CalendarDays className="size-3" />
      {upcoming ? `${fmtDay(task.start!, { day: 'numeric', month: 'short' })} → ${text}` : text}
    </span>
  )
}

// ---------- detail ----------

const shortDate = (ts: number) => fmtDay(toDay(new Date(ts)), { day: 'numeric', month: 'short' })

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
}

function DateInput({ value, onChange, label }: { value?: string; onChange: (v: string | undefined) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-[12.5px] tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
      {value && (
        <IconButton label={`Quitar ${label.toLowerCase()}`} size="icon-xs" onClick={() => onChange(undefined)}>
          <X />
        </IconButton>
      )}
    </div>
  )
}

function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const papers = useStore((s) => s.papers)
  const paperList = useMemo(() => Object.values(papers).sort((a, b) => a.title.localeCompare(b.title)), [papers])
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const focus = useFocusByTask().get(task.id)

  useEffect(() => {
    if (!task.title) titleRef.current?.focus()
    // Only when a different task opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  /** Keeps start ≤ due: moving one past the other drags the other along. */
  const setDates = (patch: Pick<Task, 'start'> | Pick<Task, 'due'>) => {
    let { start, due } = { start: task.start, due: task.due, ...patch }
    if (start && due && start > due) {
      if ('start' in patch) due = start
      else start = due
    }
    patchTask(task.id, { start, due })
  }

  const span = task.start && task.due ? diffDays(task.start, task.due) + 1 : 0

  return (
    <aside className="flex w-[340px] flex-none flex-col border-l bg-card">
      <div className="flex h-11 flex-none items-center gap-2 border-b px-3">
        <TaskCheck task={task} />
        <span className="flex-1 text-[12px] font-medium text-muted-foreground">{task.status === 'done' && task.doneAt ? `Hecha el ${shortDate(task.doneAt)}` : 'Tarea'}</span>
        <IconButton label="Eliminar tarea" onClick={() => deleteTask(task.id)}>
          <Trash2 />
        </IconButton>
        <IconButton label="Cerrar" keys={['Esc']} onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <textarea
          ref={titleRef}
          value={task.title}
          onChange={(e) => patchTask(task.id, { title: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder="¿Qué hay que hacer?"
          rows={1}
          className={cn(
            'field-sizing-content resize-none bg-transparent font-heading text-[18px] leading-snug font-medium outline-none placeholder:text-faint',
            task.status === 'done' && 'text-muted-foreground line-through'
          )}
        />

        <Field label="Estado">
          <Segmented<TaskStatus>
            size="sm"
            fill
            value={task.status}
            onChange={(status) => patchTask(task.id, { status })}
            items={[
              { value: 'todo', label: 'Por hacer' },
              { value: 'doing', label: 'En curso' },
              { value: 'done', label: 'Hecha' }
            ]}
          />
        </Field>

        <Field label="Prioridad">
          <Segmented<TaskPriority>
            size="sm"
            fill
            value={task.priority}
            onChange={(priority) => patchTask(task.id, { priority })}
            items={[
              { value: 'low', label: 'Baja' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'Alta', icon: <Flag className="text-destructive" /> }
            ]}
          />
        </Field>

        <Field label="Fechas">
          {task.milestone ? (
            <DateInput label="Fecha" value={task.due} onChange={(due) => patchTask(task.id, { due })} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted-foreground">Empieza</span>
                <DateInput label="Inicio" value={task.start} onChange={(start) => setDates({ start })} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted-foreground">Vence</span>
                <DateInput label="Vencimiento" value={task.due} onChange={(due) => setDates({ due })} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={!!task.milestone}
                onChange={(e) =>
                  patchTask(
                    task.id,
                    e.target.checked ? { milestone: true, start: undefined, due: task.due ?? task.start ?? today() } : { milestone: false }
                  )
                }
                className="size-3.5 accent-bloom-pink"
              />
              Hito <span className="text-[11.5px] text-muted-foreground">(una fecha clave, ◆ en el cronograma)</span>
            </label>
            {span > 1 && <span className="text-[11.5px] text-muted-foreground tabular-nums">{span} días</span>}
          </div>
        </Field>

        <Field label="Pomodoro">
          <PomodoroField task={task} focus={focus} />
        </Field>

        <Field label="Paper">
          <div className="flex items-center gap-1.5">
            <select
              value={task.paperId && papers[task.paperId] ? task.paperId : ''}
              onChange={(e) => patchTask(task.id, { paperId: e.target.value || undefined })}
              className="h-8 min-w-0 flex-1 truncate rounded-md border bg-card px-2 text-[12.5px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Ninguno</option>
              {paperList.map((p) => (
                <option key={p.id} value={p.id}>
                  {shortTitle(p.title)}
                </option>
              ))}
            </select>
            {task.paperId && papers[task.paperId] && (
              <Button variant="outline" size="sm" onClick={() => openTab({ kind: 'paper', id: task.paperId! })}>
                <FileText className="text-kind-paper" /> Abrir
              </Button>
            )}
          </div>
        </Field>

        <Field label="Notas">
          <Textarea
            value={task.notes}
            onChange={(e) => patchTask(task.id, { notes: e.target.value })}
            placeholder="Detalles, pasos, links…"
            className="min-h-24 bg-background text-[13px]"
          />
        </Field>

        <p className="mt-auto text-[11px] text-faint">Creada el {shortDate(task.createdAt)}</p>
      </div>
    </aside>
  )
}

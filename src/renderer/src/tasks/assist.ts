import type { Paper, Settings, Task, TaskPriority, TaskStatus } from '@shared/types'
import { createTask, deleteTask, patchTask, restoreTask, useStore } from '../store'
import { thesisBlock } from '../lib/prompts'
import type { QuickAction } from '../lib/prompts'
import { fmtDay, fromDay, toDay, today } from './dates'
import { DEFAULT_PLAN, cleanPlan, focusByTask, timerContext } from '../pomodoro/timer'

// The planning assistant: it reads the task list with every message and, when
// something should change, ends its answer with a ```tasks block of operations.
// The chat shows them as a list of changes the student applies with one click.

type Fields = {
  title?: string
  notes?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  start?: string | null
  due?: string | null
  milestone?: boolean
  paperId?: string | null
  /** Focus sessions planned for the task; null drops the plan. */
  pomodoros?: number | null
  focusMinutes?: number
}

export type TaskOp = ({ op: 'add' } & Fields & { title: string }) | ({ op: 'update'; id: string } & Fields) | { op: 'delete'; id: string }

// ---------- prompt ----------

const STATUS: TaskStatus[] = ['todo', 'doing', 'done']
const PRIORITY: TaskPriority[] = ['low', 'normal', 'high']

export function tasksInstructions(settings: Settings, papers: Paper[]): string {
  const library = papers
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 250)
    .map((p) => `- ${p.id}: "${p.title.replace(/"/g, "'")}"${p.year ? ` (${p.year})` : ''} [${p.status}]`)
    .join('\n')
  return `Sos el asistente de planificación de Thesis Studio, una app de escritorio donde un estudiante de MBA lee papers y escribe su tesis. Lo ayudás a planificar y administrar el trabajo: su lista de tareas y su cronograma (un diagrama de Gantt con las tareas fechadas).

${thesisBlock(settings)}

La lista de tareas actual se adjunta a cada mensaje como <tasks> (un objeto JSON por línea), con la fecha de hoy. Cuando el estudiante tiene una tarea abierta, su id viene en <selected_task>. El estado del timer pomodoro viene como <timer>.

Cómo responder:
- Respondé siempre en español rioplatense, cercano y directo. Sé breve: decí qué proponés y por qué, en unas pocas líneas o viñetas. Sin preámbulos ni ofrecimientos al cierre.
- Cuando el estudiante te pida crear, cambiar, reprogramar, completar o eliminar tareas, o acepte un plan que propusiste, terminá la respuesta con exactamente un bloque de código cercado cuyo lenguaje sea "tasks", con este JSON: {"ops": [ ... ]}. La app lo convierte en una lista de cambios que el estudiante revisa y aplica con un clic. Nunca menciones el bloque, el JSON ni los ids en tu prosa.
- Operaciones:
  {"op":"add","title":"…","start":"YYYY-MM-DD","due":"YYYY-MM-DD","priority":"low|normal|high","milestone":false,"notes":"…","paperId":"…","pomodoros":4,"focusMinutes":25}  (solo "title" es obligatorio)
  {"op":"update","id":"<id de <tasks>>", …solo los campos que cambian…}  ("status":"todo|doing|done"; null borra start, due, notes, paperId o pomodoros)
  {"op":"delete","id":"<id de <tasks>>"}
  {"op":"pomodoro.start","id":"<id de <tasks>>"}  arranca el timer pomodoro en una tarea, con lo que queda de su plan; para una tarea que agregás en este mismo bloque, pasá su "title" exacto en lugar del "id". Corre un solo timer a la vez.
  {"op":"pomodoro.pause"} · {"op":"pomodoro.resume"} · {"op":"pomodoro.skip"} · {"op":"pomodoro.stop"} · {"op":"pomodoro.extend","minutes":5}  controlan el timer en curso
- Las fechas son días de calendario en formato YYYY-MM-DD. "start" es cuándo empieza el trabajo y "due" cuándo tiene que estar terminado; un hito (una entrega, una reunión con el tutor) es una sola fecha: poné "milestone": true y solo "due".
- Los títulos son cortos y empiezan con un verbo ("Escribir…", "Leer…", "Enviar…"). Usá únicamente ids de tareas de <tasks> e ids de papers de la biblioteca de abajo.
- Planificá de manera realista: partí lo grande (capítulos, trabajo de campo, análisis) en pasos de 1 a 14 días, dejá holgura antes de las fechas límite, no amontones muchas tareas en los mismos días y apoyate en lo que ya está hecho o planificado en vez de duplicarlo. Las entregas del taller (una cada 4 semanas; la última es el trabajo final) y qué etapas van en cada una están en el marco de la cátedra: planificá para llegar a cada entrega con sus etapas completas y para que el tutor apruebe el trabajo final al menos una semana antes. Si otra fecha clave (una reunión con el tutor) importa y no la sabés, preguntala antes de planificar.
- Cada tarea puede llevar un plan de pomodoros: "pomodoros" sesiones de foco (1 a 16) de "focusMinutes" cada una (25 por defecto; 50 para escribir, que necesita entrar en calor). En <tasks>, "pomodoro" muestra el plan y cuántas sesiones están hechas. Dimensionalo cuando el estudiante pregunte cuánto lleva algo o te pida armar un día: unas pocas sesiones por día de trabajo, no todo el tramo. Si quiere empezar a trabajar ahora, arrancá el timer en la tarea que va primero.
- Las preguntas que no cambian nada ("¿qué hago hoy?") no llevan bloque, salvo que propongas un cambio.

La biblioteca del estudiante (id del paper: título [estado de lectura]), para vincular tareas con papers:
${library || '(vacía)'}`
}

/** The task list as the model sees it, attached to each message. */
export function tasksContext(tasks: Task[], selectedId: string | null): string {
  const now = today()
  const focus = focusByTask(useStore.getState().sessions)
  const lines = tasks
    .slice()
    .sort((a, b) => (a.start ?? a.due ?? '9999').localeCompare(b.start ?? b.due ?? '9999'))
    .map((t) =>
      JSON.stringify({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        start: t.start ?? null,
        due: t.due ?? null,
        milestone: !!t.milestone,
        paperId: t.paperId ?? null,
        pomodoro: t.pomodoro || focus.has(t.id) ? pomodoroLine(t, focus.get(t.id)?.done ?? 0) : undefined,
        notes: t.notes ? t.notes.slice(0, 400) : undefined
      })
    )
  const sel = selectedId && tasks.some((t) => t.id === selectedId) ? `\n<selected_task id="${selectedId}" />` : ''
  return `\n\n<tasks today="${now}" weekday="${fmtDay(now, { weekday: 'long' })}">\n${lines.join('\n') || '(todavía no hay tareas)'}\n</tasks>${sel}\n${timerContext()}`
}

function pomodoroLine(t: Task, done: number): Record<string, number> {
  return t.pomodoro ? { sessions: t.pomodoro.sessions, focusMinutes: t.pomodoro.focusMinutes, done } : { done }
}

export const TASK_ACTIONS: QuickAction[] = [
  {
    label: 'Planificar la tesis',
    hint: 'Un cronograma por etapas hasta la entrega',
    prompt:
      'Armame un cronograma realista para llegar a cada entrega del taller y terminar la tesis para la entrega final: las etapas de la cátedra (literatura de mis 2 temas, marco teórico e hipótesis, metodología, preparación y análisis de la base de datos, resultados, discusión, introducción y conclusiones al final, lectura integral), tareas concretas con fechas y pomodoros, y los hitos clave (reuniones con el tutor, su aprobación, la entrega). Tené en cuenta las tareas que ya tengo.'
  },
  {
    label: '¿Qué hago hoy?',
    hint: 'Las tareas que más importan ahora',
    prompt: 'Mirando mis tareas, ¿en qué me conviene enfocarme hoy y en lo que queda de la semana? Elegí como máximo 3 y explicá por qué. Si algo está mal priorizado o con fechas irreales, proponé el cambio.'
  },
  {
    label: 'Mi día en pomodoros',
    hint: 'Lo de hoy, en sesiones de foco',
    prompt:
      'Armá mi día en pomodoros: elegí lo que conviene hacer hoy (como mucho 3 tareas), asigná a cada una cuántas sesiones de foco necesita, con 50 minutos para escribir y 25 para el resto, y empezá el timer en la primera.'
  },
  {
    label: 'Reprogramar vencidas',
    hint: 'Nuevas fechas para lo atrasado',
    prompt: 'Reprogramá mis tareas vencidas con fechas realistas a partir de hoy, sin amontonarlas, y corré lo que dependa de ellas.'
  },
  {
    label: 'Dividir en pasos',
    hint: 'La tarea abierta, en pasos concretos',
    prompt:
      'Dividí la tarea que tengo abierta en pasos concretos de 1 a 3 días, con fechas dentro de su plazo, y marcala como en curso si ya debería haber empezado. Si no tengo ninguna abierta, elegí la más grande o vaga.'
  }
]

// ---------- parsing ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/

function cleanFields(o: Record<string, unknown>): Fields {
  const f: Fields = {}
  // A real calendar day only: "2026-02-30" doesn't round-trip.
  const day = (v: unknown) => (v === null ? null : typeof v === 'string' && DAY.test(v) && toDay(fromDay(v)) === v ? v : undefined)
  const str = (v: unknown) => (v === null ? null : typeof v === 'string' ? v.trim() : undefined)
  if (typeof o.title === 'string' && o.title.trim()) f.title = o.title.trim()
  if (str(o.notes) !== undefined) f.notes = str(o.notes)
  if (STATUS.includes(o.status as TaskStatus)) f.status = o.status as TaskStatus
  if (PRIORITY.includes(o.priority as TaskPriority)) f.priority = o.priority as TaskPriority
  if (day(o.start) !== undefined) f.start = day(o.start)
  if (day(o.due) !== undefined) f.due = day(o.due)
  if (typeof o.milestone === 'boolean') f.milestone = o.milestone
  if (str(o.paperId) !== undefined) f.paperId = str(o.paperId) || null
  if (o.pomodoros === null) f.pomodoros = null
  else if (typeof o.pomodoros === 'number' && o.pomodoros >= 1) f.pomodoros = Math.round(o.pomodoros)
  if (typeof o.focusMinutes === 'number' && o.focusMinutes > 0) f.focusMinutes = Math.round(o.focusMinutes)
  return f
}

export function cleanOp(raw: unknown): TaskOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const fields = cleanFields(o)
  if (o.op === 'add') return fields.title ? { op: 'add', ...fields, title: fields.title } : null
  if (typeof o.id !== 'string') return null
  if (o.op === 'delete') return { op: 'delete', id: o.id }
  if (o.op === 'update' && Object.keys(fields).length) return { op: 'update', id: o.id, ...fields }
  return null
}

/** Whether an operation still makes sense against the current list. */
export const opValid = (op: TaskOp, tasks: Record<string, Task>): boolean => op.op === 'add' || !!tasks[op.id]

// ---------- applying ----------

/** Fields → a task patch: nulls clear, start ≤ due, milestones are one date. */
function toPatch(f: Fields, base?: Task): Partial<Task> {
  const patch: Partial<Task> = {}
  if (f.title !== undefined) patch.title = f.title
  if (f.notes !== undefined) patch.notes = f.notes ?? ''
  if (f.status) patch.status = f.status
  if (f.priority) patch.priority = f.priority
  if (f.milestone !== undefined) patch.milestone = f.milestone
  const papers = useStore.getState().papers
  if (f.paperId !== undefined) patch.paperId = f.paperId && papers[f.paperId] ? f.paperId : undefined
  if (f.pomodoros === null) patch.pomodoro = undefined
  else if (f.pomodoros !== undefined || f.focusMinutes !== undefined)
    patch.pomodoro = cleanPlan({ sessions: f.pomodoros ?? undefined, focusMinutes: f.focusMinutes }, base?.pomodoro ?? DEFAULT_PLAN)
  let start = f.start === undefined ? base?.start : f.start ?? undefined
  let due = f.due === undefined ? base?.due : f.due ?? undefined
  if (patch.milestone ?? base?.milestone) {
    due = due ?? start
    start = undefined
  }
  if (start && due && start > due) [start, due] = [due, start]
  if (start !== base?.start) patch.start = start
  if (due !== base?.due) patch.due = due
  return patch
}

/** Applies the operations; returns how to undo them. */
export function applyTaskOps(ops: TaskOp[]): () => void {
  const created: string[] = []
  const before: Task[] = []
  for (const op of ops) {
    const tasks = useStore.getState().tasks
    if (op.op === 'add') {
      created.push(createTask({ priority: 'normal', ...toPatch(op), title: op.title }).id)
    } else if (tasks[op.id]) {
      before.push(tasks[op.id])
      if (op.op === 'delete') deleteTask(op.id, { silent: true })
      else patchTask(op.id, toPatch(op, tasks[op.id]))
    }
  }
  return () => {
    for (const id of created) deleteTask(id, { silent: true })
    // Oldest snapshot last, so a task touched twice ends as it first was.
    for (const t of before.reverse()) restoreTask(t)
  }
}

// ---------- describing ----------

const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'por hacer', doing: 'en curso', done: 'hecha' }
const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'baja', normal: 'normal', high: 'alta' }
function pomodoros(f: Fields, base?: Task): string | null {
  if (f.pomodoros === null) return 'sin pomodoros'
  if (f.pomodoros === undefined && f.focusMinutes === undefined) return null
  const p = cleanPlan({ sessions: f.pomodoros, focusMinutes: f.focusMinutes }, base?.pomodoro ?? DEFAULT_PLAN)
  return `${p.sessions} × ${p.focusMinutes} min`
}
const d = (day: string | null | undefined) => (day ? fmtDay(day, { day: 'numeric', month: 'short' }) : '—')

function when(start?: string | null, due?: string | null, milestone?: boolean): string {
  if (milestone) return `◆ ${d(due ?? start)}`
  if (start && due && start !== due) return `${d(start)} → ${d(due)}`
  if (due) return `vence ${d(due)}`
  if (start) return `desde ${d(start)}`
  return ''
}

/** One line for an operation already applied: what it set (the task itself has changed since). */
export function describeApplied(op: TaskOp, tasks: Record<string, Task>, papers: Record<string, Paper>): { title: string; detail: string } {
  if (op.op === 'add') return describeOp(op, tasks, papers)
  const title = (op.op === 'update' && op.title) || tasks[op.id]?.title || 'Tarea'
  if (op.op === 'delete') return { title, detail: 'eliminada' }
  const bits: string[] = []
  if (op.status) bits.push(STATUS_LABEL[op.status])
  if (op.priority) bits.push(`prioridad ${PRIORITY_LABEL[op.priority]}`)
  if (op.start !== undefined || op.due !== undefined) {
    const t = tasks[op.id]
    bits.push(t ? when(t.start, t.due, t.milestone) || 'sin fecha' : when(op.start, op.due, op.milestone))
  }
  if (op.notes !== undefined) bits.push('notas')
  if (op.paperId !== undefined) bits.push(op.paperId && papers[op.paperId] ? papers[op.paperId].title : 'sin paper')
  // Applied: the task's plan is already the new one.
  const plan = tasks[op.id]?.pomodoro
  if (op.pomodoros === null) bits.push('sin pomodoros')
  else if (plan && (op.pomodoros !== undefined || op.focusMinutes !== undefined)) bits.push(`${plan.sessions} × ${plan.focusMinutes} min`)
  return { title, detail: bits.filter(Boolean).join(' · ') || 'actualizada' }
}

/** One line for what an operation will do, in the student's terms. */
export function describeOp(op: TaskOp, tasks: Record<string, Task>, papers: Record<string, Paper>): { title: string; detail: string } {
  if (op.op === 'add') {
    const bits = [when(op.start, op.due, op.milestone)]
    if (op.priority === 'high') bits.push('prioridad alta')
    if (op.paperId && papers[op.paperId]) bits.push(papers[op.paperId].title)
    bits.push(pomodoros(op) ?? '')
    return { title: op.title, detail: bits.filter(Boolean).join(' · ') }
  }
  const t = tasks[op.id]
  if (!t) return { title: 'Tarea que ya no existe', detail: '' }
  if (op.op === 'delete') return { title: t.title || 'Sin título', detail: 'se elimina' }
  const bits: string[] = []
  if (op.title !== undefined && op.title !== t.title) bits.push(`antes: «${t.title}»`)
  if (op.status && op.status !== t.status) bits.push(`→ ${STATUS_LABEL[op.status]}`)
  if (op.priority && op.priority !== t.priority) bits.push(`prioridad ${PRIORITY_LABEL[op.priority]}`)
  const next = toPatch(op, t)
  const start = 'start' in next ? next.start : t.start
  const due = 'due' in next ? next.due : t.due
  if (start !== t.start || due !== t.due || (op.milestone !== undefined && op.milestone !== !!t.milestone))
    bits.push(`${when(t.start, t.due, t.milestone) || 'sin fecha'} ⇢ ${when(start, due, op.milestone ?? t.milestone) || 'sin fecha'}`)
  if (op.notes !== undefined) bits.push(op.notes ? 'notas nuevas' : 'sin notas')
  if (op.paperId !== undefined) bits.push(op.paperId && papers[op.paperId] ? papers[op.paperId].title : 'sin paper')
  const p = pomodoros(op, t)
  if (p) bits.push(p)
  return { title: op.title ?? t.title ?? 'Sin título', detail: bits.join(' · ') || 'sin cambios' }
}

import type { Settings, Task } from '@shared/types'
import { createTask, deleteTask, patchTask, restoreTask, toast, useStore } from '../store'
import { addDays, diffDays, toDay, today } from '../tasks/dates'
import { PRESETS } from '../pomodoro/timer'
import { APPROVAL, DELIVERIES, PHASES, SUBMISSION_EMAIL, WORKSHOP_START, deliveryLabel } from './framework'

// The thesis plan for the 3rd-term workshop, without the assistant: each of
// the course's stages lands in the delivery it's handed in with (1: the
// project, 2: theory and data, 3: the complete work), spread by weight over
// that delivery's weeks, the last one ending a week early so the tutor can
// approve it. Re-running adds what's missing and moves what drifted.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Phases written (or for these, the reading) at 50 minutes; the rest at 25. */
const DEEP = new Set(['theory', 'method', 'results', 'discussion', 'intro', 'revision', 'analysis'])

export interface PlanItem {
  /** The stage (PHASES id) or milestone it stands for: how re-running knows it's already there, even renamed. */
  phaseId: string
  title: string
  notes: string
  start?: string
  due: string
  milestone?: boolean
  priority?: Task['priority']
  pomodoros?: number
  deep?: boolean
}

export interface PlanChanges {
  /** Stages and milestones not in the task list yet. */
  add: PlanItem[]
  /** Plan tasks whose dates no longer match the deliveries. */
  move: { task: Task; item: PlanItem }[]
  /** Milestones the calendar no longer has (or that a task of the student's already covers). */
  remove: Task[]
}

export const changeCount = (c: PlanChanges) => c.add.length + c.move.length + c.remove.length

/** The whole plan, as it should be from today. */
export function planSchedule(now = today()): PlanItem[] {
  const deliveries = DELIVERIES.map(toDay)
  const approval = toDay(APPROVAL)
  const items: PlanItem[] = []
  deliveries.forEach((day, i) => {
    const n = i + 1
    const phases = PHASES.filter((p) => p.delivery === n)
    // Work runs from the day after the previous delivery up to the day before this one (the last one: up to sending it to the tutor).
    const open = i ? addDays(deliveries[i - 1], 1) : toDay(WORKSHOP_START)
    const from0 = open > now ? open : now
    const end = n === deliveries.length ? addDays(approval, -2) : addDays(day, -1)
    const span = Math.max(1, diffDays(from0, end) + 1)
    const total = phases.reduce((s, p) => s + p.weight, 0)
    let done = 0
    for (const p of phases) {
      const from = Math.floor((done / total) * span)
      done += p.weight
      const to = Math.max(from, Math.ceil((done / total) * span) - 1)
      items.push({ phaseId: p.id, title: p.title, notes: p.detail, start: addDays(from0, from), due: addDays(from0, to), pomodoros: p.pomodoros, deep: DEEP.has(p.id) })
    }
    const stages = phases.map((p) => p.title.toLowerCase()).join('; ')
    if (n < deliveries.length) {
      items.push({ phaseId: `m:delivery-${n}`, title: `${deliveryLabel(n)} del taller`, notes: `Se entrega: ${stages}.`, due: day, milestone: true, priority: 'high' })
      return
    }
    items.push({ phaseId: 'm:tutor', title: 'Enviar el trabajo completo al tutor', notes: 'Para su revisión y aprobación: sin ella no se puede entregar.', due: addDays(approval, -1), milestone: true, priority: 'high' })
    items.push({ phaseId: 'm:approval', title: 'Aprobación del tutor', notes: 'Incorporar sus correcciones antes de la entrega final.', due: approval, milestone: true, priority: 'high' })
    items.push({
      phaseId: 'm:deadline',
      title: `${deliveryLabel(n)} en PDF`,
      notes: `El trabajo completo, con ${stages}. Por correo a ${SUBMISSION_EMAIL}. Fecha fija e inamovible.`,
      due: day,
      milestone: true,
      priority: 'high'
    })
  })
  return items
}

/** What re-running the plan would change in the task list. */
export function planChanges(settings: Settings, tasks: Task[], now = today()): PlanChanges {
  const byPhase = new Map<string, Task>()
  for (const t of tasks) if (t.phaseId) byPhase.set(t.phaseId, t)
  // Tasks from before plans carried their stage are matched by title.
  const byTitle = new Map(tasks.filter((t) => !t.phaseId).map((t) => [fold(t.title), t]))
  // A delivery the student already put in their own tasks (same day, «entrega» in the title) needs no milestone of the plan's.
  const ownDeliveries = new Set(tasks.filter((t) => !t.phaseId && t.due && /entrega/.test(fold(t.title))).map((t) => t.due))
  // Picking the topics is done once the pair and the question are there.
  const scoped = settings.research.constructs.length === 2 && !!settings.researchQuestion.trim()

  const out: PlanChanges = { add: [], move: [], remove: [] }
  const wanted = new Set<string>()
  for (const it of planSchedule(now)) {
    const task = byPhase.get(it.phaseId) ?? byTitle.get(fold(it.title))
    const covered = it.milestone && ownDeliveries.has(it.due) && it.phaseId !== 'm:tutor' && it.phaseId !== 'm:approval'
    if (covered || (it.milestone && it.due < now)) continue
    wanted.add(it.phaseId)
    if (!task) {
      if (!(it.phaseId === 'scope' && scoped)) out.add.push(it)
      continue
    }
    if (task.status === 'done') continue
    if (task.due !== it.due || (!it.milestone && task.start !== it.start)) out.move.push({ task, item: it })
  }
  for (const t of tasks) if (t.phaseId?.startsWith('m:') && !wanted.has(t.phaseId) && t.status !== 'done') out.remove.push(t)
  return out
}

/** Applies the plan's changes, with one Deshacer for all of them; returns how many and how to undo them. */
export function createPlan(opts: { quiet?: boolean } = {}): { count: number; undo: () => void } {
  const { settings, tasks } = useStore.getState()
  const changes = planChanges(settings, Object.values(tasks))
  const count = changeCount(changes)
  if (!count) {
    if (!opts.quiet) toast('El plan ya está al día con las entregas')
    return { count, undo: () => {} }
  }
  const created = changes.add.map((it) =>
    createTask({
      phaseId: it.phaseId,
      title: it.title,
      notes: it.notes,
      start: it.milestone ? undefined : it.start,
      due: it.due,
      milestone: it.milestone,
      priority: it.priority ?? 'normal',
      pomodoro: it.pomodoros ? { ...PRESETS[it.deep ? 1 : 0], sessions: it.pomodoros } : undefined
    })
  )
  for (const { task, item } of changes.move) patchTask(task.id, { phaseId: item.phaseId, start: item.milestone ? undefined : item.start, due: item.due })
  for (const t of changes.remove) deleteTask(t.id, { silent: true })
  const undo = () => {
    created.forEach((t) => deleteTask(t.id, { silent: true }))
    changes.move.forEach(({ task }) => restoreTask(task))
    changes.remove.forEach((t) => restoreTask(t))
  }
  if (!opts.quiet) {
    const parts = [
      created.length && `${created.length} agregada${created.length === 1 ? '' : 's'}`,
      changes.move.length && `${changes.move.length} reprogramada${changes.move.length === 1 ? '' : 's'}`,
      changes.remove.length && `${changes.remove.length} quitada${changes.remove.length === 1 ? '' : 's'}`
    ].filter(Boolean)
    toast(`Plan ajustado a las entregas: ${parts.join(', ')}`, { label: 'Deshacer', run: undo }, { status: 'success' })
  }
  return { count, undo }
}

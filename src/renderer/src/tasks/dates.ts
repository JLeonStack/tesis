import type { Task, TaskPriority } from '@shared/types'
import { fold } from '../lib/util'

// Task days are local calendar days as 'YYYY-MM-DD' strings: no time zone can
// shift a deadline by one, and they sort and compare as plain strings.

const DAY_MS = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')

export const toDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function fromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const today = (): string => toDay(new Date())

export function addDays(day: string, n: number): string {
  const d = fromDay(day)
  d.setDate(d.getDate() + n)
  return toDay(d)
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export const diffDays = (a: string, b: string): number => Math.round((fromDay(b).getTime() - fromDay(a).getTime()) / DAY_MS)

/** The Monday on or before `day`. */
export function startOfWeek(day: string): string {
  const dow = (fromDay(day).getDay() + 6) % 7
  return addDays(day, -dow)
}

export const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string =>
  fromDay(day).toLocaleDateString('es-AR', opts)

/** "Hoy", "Mañana", "vie 18 oct"… and how urgent it reads. */
export function dueLabel(due: string, now = today()): { text: string; tone: 'overdue' | 'soon' | 'later' } {
  const d = diffDays(now, due)
  if (d < 0) return { text: d === -1 ? 'Ayer' : `Hace ${-d} días`, tone: 'overdue' }
  if (d === 0) return { text: 'Hoy', tone: 'soon' }
  if (d === 1) return { text: 'Mañana', tone: 'soon' }
  if (d < 7) {
    const weekday = fmtDay(due, { weekday: 'long' })
    return { text: weekday.charAt(0).toUpperCase() + weekday.slice(1), tone: 'later' }
  }
  return { text: fmtDay(due, { day: 'numeric', month: 'short', year: due.slice(0, 4) === now.slice(0, 4) ? undefined : 'numeric' }), tone: 'later' }
}

/** The last day of a task, for "is it late?": the due date, else the start. */
export const endOf = (t: Task): string | undefined => t.due ?? t.start

export const isOverdue = (t: Task, now = today()): boolean => t.status !== 'done' && !!endOf(t) && endOf(t)! < now

export type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done'

export function bucketOf(t: Task, now = today()): Bucket {
  if (t.status === 'done') return 'done'
  const end = endOf(t)
  if (!end) return 'undated'
  const d = diffDays(now, end)
  if (d < 0) return 'overdue'
  // Started and still running counts as today's work.
  if (d === 0 || (t.start && t.start <= now)) return 'today'
  return d < 7 ? 'week' : 'later'
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

export function compareTasks(a: Task, b: Task): number {
  const ea = endOf(a) ?? '9999'
  const eb = endOf(b) ?? '9999'
  return ea.localeCompare(eb) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt
}

// ---------- quick add ----------

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

/**
 * Reads a date and priority off the end of a typed task (Postel's law):
 * "Entregar capítulo 2 viernes", "Reunión con tutor 15/11", "Leer Popper mañana !".
 */
/** «3 pomodoros», «2 pomos», «4🍅» at the end of a quick-add. */
const POMODOROS = /\s+(\d{1,2})\s*(?:pomodoros?|pomos?|🍅)$/iu

export function parseQuickAdd(input: string, now = today()): { title: string; due?: string; priority?: TaskPriority; pomodoros?: number } {
  let text = input.normalize('NFC').trim()
  let priority: TaskPriority | undefined
  let pomodoros: number | undefined
  if (/(^|\s)!$/.test(text)) {
    priority = 'high'
    text = text.slice(0, -1).trim()
  }
  // Before or after the date: «Leer Porter 3 pomodoros viernes», «Leer Porter viernes 3 pomodoros».
  const takePomodoros = () => {
    const m = text.match(POMODOROS)
    if (!m || m.index === undefined || pomodoros) return
    pomodoros = Math.min(16, Math.max(1, Number(m[1])))
    text = text.slice(0, m.index).trim()
  }
  takePomodoros()
  const f = fold(text)
  const tries: [RegExp, (m: RegExpMatchArray) => string | undefined][] = [
    [/\s(?:para\s+)?hoy$/, () => now],
    [/\s(?:para\s+)?pasado\s+manana$/, () => addDays(now, 2)],
    [/\s(?:para\s+)?manana$/, () => addDays(now, 1)],
    [/\sen\s+(\d{1,3})\s+dias?$/, (m) => addDays(now, Number(m[1]))],
    [/\sen\s+(\d{1,2})\s+semanas?$/, (m) => addDays(now, Number(m[1]) * 7)],
    [
      /\s(?:el\s+|para\s+el\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)$/,
      (m) => {
        const target = WEEKDAYS.indexOf(m[1])
        const ahead = (target - fromDay(now).getDay() + 7) % 7 || 7
        return addDays(now, ahead)
      }
    ],
    [
      /\s(?:el\s+|para\s+el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/,
      (m) => {
        const [d, mo] = [Number(m[1]), Number(m[2])]
        if (d < 1 || d > 31 || mo < 1 || mo > 12) return undefined
        let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : fromDay(now).getFullYear()
        let day = toDay(new Date(y, mo - 1, d))
        // A day-month that already passed this year means next year's.
        if (!m[3] && day < now) day = toDay(new Date(++y, mo - 1, d))
        return day
      }
    ]
  ]
  for (const [re, toDue] of tries) {
    const m = f.match(re)
    const due = m && toDue(m)
    // `fold` keeps the string's length, so the match index maps back onto the original text.
    if (due && m.index !== undefined) {
      text = text.slice(0, m.index).trim()
      takePomodoros()
      return { title: text, due, priority, pomodoros }
    }
  }
  return { title: text, priority, pomodoros }
}

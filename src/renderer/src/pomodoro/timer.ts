import { useMemo } from 'react'
import { create } from 'zustand'
import type { FocusSession, PomodoroPlan } from '@shared/types'
import { deleteSession, patchTask, saveSession, toast, useStore } from '../store'
import { clamp, fold, uid } from '../lib/util'
import { playEarcon } from './earcons'

// The pomodoro timer, ported from Keel's PomodoroTimer. One runs at a time, on one
// task. Time is derived from an end timestamp rather than counted down, so it stays
// right across sleep, stalls and reloads. A task's plan says how many focus sessions
// it gets; a sitting runs what's left of them, with breaks between.

export type Phase = 'focus' | 'short' | 'long'
export type RunState = 'idle' | 'running' | 'paused'

export const PHASE_LABEL: Record<Phase, string> = { focus: 'Foco', short: 'Descanso', long: 'Descanso largo' }

export const PRESETS = [
  { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 },
  { focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 30 },
  { focusMinutes: 90, breakMinutes: 20, longBreakMinutes: 30 }
]
export const DEFAULT_PLAN: PomodoroPlan = { ...PRESETS[0], sessions: 1 }
/** A long break after every this many focus sessions. */
export const LONG_EVERY = 4
export const RANGES = { focusMinutes: [5, 120], breakMinutes: [1, 60], longBreakMinutes: [1, 60], sessions: [1, 16] } as const

/** Focus cut short is logged only past this, so stray clicks don't count. */
const MIN_LOGGED_MS = 60_000

export interface Run {
  taskId: string
  /** The task's title when it started (the task may be renamed or deleted meanwhile). */
  title: string
  plan: PomodoroPlan
  /** Sessions in this sitting: what was left of the plan when it started (at least one). */
  goal: number
  /** Focus sessions finished in this sitting. */
  done: number
  /** Sessions the task had finished before, so long breaks fall right across sittings. */
  before: number
  phase: Phase
  state: RunState
  /** When the phase ends; only while running. */
  endAt: number | null
  /** Time left while idle or paused (ms). */
  left: number
  /** The phase's full length, extra minutes included (ms). */
  length: number
  focusStartedAt: number | null
  runningSince: number | null
  /** Focus time run before the last pause (ms). */
  accumulated: number
}

interface PomodoroState {
  run: Run | null
  /** The clock, advanced once a second while something runs. */
  now: number
  /** Start the next phase on its own when one ends. */
  autoStart: boolean
  sound: boolean
}

const KEY = 'pomodoro-v1'
function load(): Partial<PomodoroState> {
  try {
    const { run, autoStart, sound } = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { run: run ?? null, autoStart: autoStart ?? false, sound: sound ?? true }
  } catch {
    return {}
  }
}

export const usePomodoro = create<PomodoroState>(() => ({ run: null, now: Date.now(), autoStart: false, sound: true, ...load() }))
const set = usePomodoro.setState
const get = usePomodoro.getState

usePomodoro.subscribe((s, prev) => {
  if (s.run === prev.run && s.autoStart === prev.autoStart && s.sound === prev.sound) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ run: s.run, autoStart: s.autoStart, sound: s.sound }))
  } catch {
    // ignore quota / private mode
  }
})

// ---------- derived ----------

export const phaseMs = (plan: PomodoroPlan, phase: Phase): number =>
  (phase === 'focus' ? plan.focusMinutes : phase === 'short' ? plan.breakMinutes : plan.longBreakMinutes) * 60_000

export const remainingMs = (r: Run, now: number): number => (r.state === 'running' && r.endAt ? Math.max(0, r.endAt - now) : r.left)

export const focusElapsed = (r: Run, now: number): number => r.accumulated + (r.runningSince ? Math.max(0, now - r.runningSince) : 0)

/** 1-based session number within the sitting. */
export const currentSession = (r: Run): number => Math.min(r.goal, r.phase === 'focus' ? r.done + 1 : r.done)

/** Wall-clock length of a plan, breaks between sessions included (none after the last). */
export function planMinutes(p: PomodoroPlan): number {
  const breaks = p.sessions - 1
  const long = Math.floor(breaks / LONG_EVERY)
  return p.sessions * p.focusMinutes + (breaks - long) * p.breakMinutes + long * p.longBreakMinutes
}

export function cleanPlan(p: Partial<PomodoroPlan>, base: PomodoroPlan = DEFAULT_PLAN): PomodoroPlan {
  const out = { ...base }
  for (const k of Object.keys(RANGES) as (keyof PomodoroPlan)[]) {
    const v = p[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(Math.round(v), RANGES[k][0], RANGES[k][1])
  }
  return out
}

export interface TaskFocus {
  /** Completed focus sessions. */
  done: number
  /** Focused time, cut-short sessions included. */
  seconds: number
}

export function focusByTask(sessions: Record<string, FocusSession>): Map<string, TaskFocus> {
  const by = new Map<string, TaskFocus>()
  for (const f of Object.values(sessions)) {
    if (!f.taskId) continue
    const t = by.get(f.taskId) ?? { done: 0, seconds: 0 }
    if (f.completed) t.done++
    t.seconds += f.focusedSeconds
    by.set(f.taskId, t)
  }
  return by
}

/** Every task's focus history, recomputed only when a session is logged. */
export function useFocusByTask(): Map<string, TaskFocus> {
  const sessions = useStore((s) => s.sessions)
  return useMemo(() => focusByTask(sessions), [sessions])
}

export function fmtClock(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`
}

// ---------- ticking ----------

let ticker: ReturnType<typeof setInterval> | null = null
let alarm: ReturnType<typeof setTimeout> | null = null

/** A display tick while running, plus one exact timeout at the end (hidden windows throttle intervals). */
function schedule(): void {
  const r = get().run
  const running = r?.state === 'running' && r.endAt
  if (alarm) clearTimeout(alarm)
  alarm = running ? setTimeout(tick, Math.max(0, r.endAt! - Date.now()) + 20) : null
  if (running && !ticker) ticker = setInterval(tick, 250)
  if (!running && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function setRun(run: Run | null): void {
  set({ run, now: Date.now() })
  schedule()
}

function tick(): void {
  const r = get().run
  const now = Date.now()
  if (Math.floor(now / 1000) !== Math.floor(get().now / 1000)) set({ now })
  if (r?.state === 'running' && r.endAt && now >= r.endAt) finishPhase(r)
}

// ---------- logging ----------

/** Logs a focus session; one cut short only past a minute. Returns its id. */
function logFocus(r: Run, end: number, ms: number, completed: boolean): string | null {
  if (r.phase !== 'focus' || (!completed && ms < MIN_LOGGED_MS)) return null
  const session: FocusSession = {
    id: uid(),
    taskId: r.taskId,
    start: r.focusStartedAt ?? end - ms,
    end,
    focusedSeconds: Math.round(ms / 1000),
    completed
  }
  saveSession(session)
  return session.id
}

const logInterrupted = (r: Run): string | null => logFocus(r, Date.now(), focusElapsed(r, Date.now()), false)

/** The same phase, fresh: not started, full length, no focus time yet. */
function freshPhase(r: Run, phase: Phase): Run {
  const length = phaseMs(r.plan, phase)
  return { ...r, phase, state: 'idle', endAt: null, left: length, length, focusStartedAt: null, runningSince: null, accumulated: 0 }
}

function running(r: Run, now = Date.now()): Run {
  if (r.state === 'running') return r
  return {
    ...r,
    state: 'running',
    endAt: now + r.left,
    focusStartedAt: r.phase === 'focus' ? r.focusStartedAt ?? now : r.focusStartedAt,
    runningSince: r.phase === 'focus' ? now : null
  }
}

/** The break after a focus session: long every LONG_EVERY sessions of the task. */
const breakAfter = (completed: number): Phase => (completed > 0 && completed % LONG_EVERY === 0 ? 'long' : 'short')

// ---------- controls ----------

/** Starts a sitting on a task: what's left of its plan, or one more session if it's all done. */
export function startTask(taskId: string): boolean {
  const { tasks, sessions } = useStore.getState()
  const task = tasks[taskId]
  if (!task) return false
  const cur = get().run
  if (cur?.taskId === taskId) {
    if (cur.state !== 'running') resume()
    return true
  }
  if (cur) logInterrupted(cur)
  const plan = task.pomodoro ?? DEFAULT_PLAN
  const before = focusByTask(sessions).get(taskId)?.done ?? 0
  const length = phaseMs(plan, 'focus')
  const run: Run = {
    taskId,
    title: task.title || 'Sin título',
    plan,
    goal: Math.max(1, plan.sessions - before),
    done: 0,
    before,
    phase: 'focus',
    state: 'idle',
    endAt: null,
    left: length,
    length,
    focusStartedAt: null,
    runningSince: null,
    accumulated: 0
  }
  setRun(running(run))
  if (get().sound) playEarcon('focusStart')
  if (task.status === 'todo') patchTask(taskId, { status: 'doing' })
  return true
}

/** The open task with this title (the newest, if several): how the assistant names a task it just added. */
export function taskByTitle(title: string): string | undefined {
  const want = fold(title.trim())
  return Object.values(useStore.getState().tasks)
    .filter((t) => t.status !== 'done' && fold(t.title.trim()) === want)
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.id
}

export function resume(): void {
  const r = get().run
  if (!r || r.state === 'running') return
  if (r.phase === 'focus' && r.state === 'idle' && get().sound) playEarcon('focusStart')
  setRun(running(r))
}

export function pause(): void {
  const r = get().run
  if (!r || r.state !== 'running' || !r.endAt) return
  const now = Date.now()
  setRun({ ...r, state: 'paused', left: Math.max(0, r.endAt - now), endAt: null, accumulated: focusElapsed(r, now), runningSince: null })
}

export function toggle(): void {
  if (get().run?.state === 'running') pause()
  else resume()
}

/** Adds time to the phase (negative takes it away, never below a minute left). */
export function extend(minutes: number): void {
  const r = get().run
  if (!r) return
  const added = Math.max(minutes * 60_000, 60_000 - remainingMs(r, Date.now()))
  setRun({ ...r, left: r.left + added, length: r.length + added, endAt: r.endAt ? r.endAt + added : null })
}

/** Runs `change`, logging any focus it cuts short, and offers Undo: the run and the log go back as they were. */
function undoable(text: string, change: (r: Run) => Run | null): void {
  const r = get().run
  if (!r) return
  const logged = logInterrupted(r)
  const after = change(r)
  setRun(after)
  toast(text, {
    label: 'Deshacer',
    run: () => {
      // Something else happened since (a phase ended, another task started): leave it be.
      if (get().run !== after) return
      if (logged) deleteSession(logged)
      // A running timer keeps its original end, as if nothing happened.
      setRun(r)
      tick()
    }
  })
}

/** Back to the start of the current phase. */
export const reset = (): void => undoable('Fase reiniciada', (r) => freshPhase(r, r.phase))

/** On to the next phase without counting this one. A running timer keeps running. */
export const skip = (): void =>
  undoable('Fase salteada', (r) => {
    const next = freshPhase(r, r.phase === 'focus' ? breakAfter(r.before + r.done) : 'focus')
    return r.state === 'running' ? running(next) : next
  })

export const stop = (): void => undoable('Pomodoro detenido', () => null)

export function setAutoStart(autoStart: boolean): void {
  set({ autoStart })
}

export function setSound(sound: boolean): void {
  set({ sound })
}

// ---------- phase end ----------

/** A system notification when the window isn't in front; the toast covers the rest. */
function notify(title: string, body: string): void {
  if (document.hasFocus() || typeof Notification === 'undefined') return
  try {
    const n = new Notification(title, { body, silent: true })
    n.onclick = () => window.focus()
  } catch {
    // Notifications unavailable: the sound and the toast still say it.
  }
}

function finishPhase(r: Run): void {
  const end = r.endAt ?? Date.now()
  const { sound, autoStart } = get()
  if (r.phase === 'focus') {
    // Credit up to the scheduled end, not "now": after sleep, now may be hours later.
    logFocus(r, end, Math.min(r.length, r.accumulated + (r.runningSince ? Math.max(0, end - r.runningSince) : 0)), true)
    const done = r.done + 1
    if (sound) playEarcon('focusEnd')
    if (done >= r.goal) {
      setRun(null)
      const task = useStore.getState().tasks[r.taskId]
      const total = r.before + done
      const what = r.goal === 1 ? 'Pomodoro terminado' : `${r.goal} pomodoros terminados`
      notify(what, r.title)
      toast(
        what,
        task && task.status !== 'done' ? { label: 'Marcar hecha', run: () => patchTask(r.taskId, { status: 'done' }) } : undefined,
        { status: 'success', description: `«${r.title}» · ${total} en total` }
      )
      return
    }
    const next = freshPhase({ ...r, done }, breakAfter(r.before + done))
    notify('Terminó el foco', `${PHASE_LABEL[next.phase]} de ${Math.round(next.length / 60_000)} min`)
    toast('Terminó el foco', undefined, { status: 'success', description: `${PHASE_LABEL[next.phase]} de ${Math.round(next.length / 60_000)} min` })
    setRun(autoStart ? running(next) : next)
    return
  }
  if (sound) playEarcon('breakEnd')
  const next = freshPhase(r, 'focus')
  const which = `Sesión ${currentSession(next)} de ${next.goal}: «${next.title}»`
  notify('Terminó el descanso', which)
  toast('Terminó el descanso', undefined, { description: which })
  setRun(autoStart ? running(next) : next)
}

// ---------- checkpoints (the assistant's undo) ----------

/** Everything a set of timer actions might change, so one Undo takes all of it back (Keel's Checkpoint). */
export interface TimerCheckpoint {
  run: Run | null
  sessionIds: Set<string>
}

export function timerCheckpoint(): TimerCheckpoint {
  return { run: get().run, sessionIds: new Set(Object.keys(useStore.getState().sessions)) }
}

export function restoreTimer(cp: TimerCheckpoint): void {
  // Sessions logged along the way (a focus set aside to start another) go too.
  for (const id of Object.keys(useStore.getState().sessions)) if (!cp.sessionIds.has(id)) deleteSession(id)
  setRun(cp.run)
  tick()
}

// ---------- for the assistant ----------

const PHASE_EN: Record<Phase, string> = { focus: 'foco', short: 'descanso', long: 'descanso largo' }

/** The timer as the assistant sees it, with each message. */
export function timerContext(): string {
  const r = get().run
  if (!r) return '<timer>No hay ningún pomodoro en curso.</timer>'
  const state = r.state === 'running' ? 'en curso' : r.state === 'paused' ? 'en pausa' : 'esperando a que el estudiante lo inicie'
  const title = r.title.replace(/"/g, "'")
  return `<timer task_id="${r.taskId}" task="${title}">${PHASE_EN[r.phase]}, ${state}, faltan ${fmtClock(remainingMs(r, Date.now()))}. Sesión ${currentSession(r)} de ${r.goal} en esta tanda; plan: ${r.plan.focusMinutes} min de foco / ${r.plan.breakMinutes} min de descanso.</timer>`
}

// Finishing or deleting the task ends its timer: the focus so far is logged as usual.
useStore.subscribe((s, prev) => {
  const r = get().run
  if (!r || s.tasks === prev.tasks) return
  const deleted = !s.tasks[r.taskId] && !!prev.tasks[r.taskId]
  if (deleted || (s.tasks[r.taskId]?.status === 'done' && prev.tasks[r.taskId]?.status !== 'done')) {
    logInterrupted(r)
    setRun(null)
  }
})

/** Picks the timer back up after a reload; a phase that ended meanwhile finishes now. */
export function restorePomodoro(): () => void {
  set({ now: Date.now() })
  schedule()
  tick()
  return () => {
    if (ticker) clearInterval(ticker)
    if (alarm) clearTimeout(alarm)
    ticker = alarm = null
  }
}

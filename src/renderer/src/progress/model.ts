import type { FocusSession, ProgressDay, Task } from '@shared/types'
import { currentThesis, saveProgress, useStore, type State } from '../store'
import { APPROVAL, CONSTRUCTS, DEADLINE, PHASES, chosenPair, daysLeft, deliveryLabel, nextDelivery } from '../research/framework'
import { MIN_CROSS, coverage } from '../research/coverage'
import { addDays, diffDays, today, toDay } from '../tasks/dates'
import { WORD_LIMIT } from '../thesis/template'

// How the thesis is moving: words written per day (one snapshot a day, the last
// one seen), focus time by stage, and the planned pomodoros burning down
// toward the tutor's approval. Shown on Home and in Tasks, and sent to the
// assistant so its daily plan and weekly review rest on facts.

// ---------- recording ----------

let timer: ReturnType<typeof setTimeout> | undefined

/** Snapshot today's word count a few seconds after the thesis stops changing. */
export function watchProgress(): () => void {
  return useStore.subscribe((s, prev) => {
    if (s.theses === prev.theses) return
    clearTimeout(timer)
    timer = setTimeout(() => void snapshot(), 4000)
  })
}

async function snapshot(): Promise<void> {
  const t = currentThesis()
  if (!t) return
  // Loaded lazily: the thesis model pulls in the editor schema.
  const { buildThesisModel, thesisDoc } = await import('../thesis/model')
  const { liveThesis } = await import('../thesis/bridge')
  const live = liveThesis(t.id)
  const m = buildThesisModel(live?.doc ?? thesisDoc(t), t.meta)
  const id = today()
  const prev = useStore.getState().progress[id]
  const bySection = Object.fromEntries(Object.entries(m.words.bySection).map(([k, v]) => [k, v ?? 0]))
  if (prev && prev.words === m.words.total) return
  saveProgress({ id, words: m.words.total, bySection, updatedAt: Date.now() })
}

// ---------- reading ----------

export interface PhaseProgress {
  id: string
  title: string
  done: boolean
  /** Planned focus sessions and minutes actually focused on its tasks. */
  planned: number
  completed: number
  focusMin: number
  start?: string
  due?: string
}

export interface ProgressSummary {
  words: number
  limit: number
  /** Words added in the last 7 days (negative after cutting). */
  wordsWeek: number
  /** One point per day with a snapshot, oldest first (carried forward on days without). */
  wordSeries: { day: string; words: number }[]
  focusToday: number
  focusWeek: number
  phases: PhaseProgress[]
  current: PhaseProgress | null
  /** Planned pomodoros still to do, by day, against a straight line to the tutor's approval. */
  burndown: { day: string; remaining: number | null; ideal: number }[]
  daysLeft: number
  approval: string
  deadline: string
}

const minutes = (sessions: FocusSession[]) => Math.round(sessions.reduce((n, s) => n + s.focusedSeconds, 0) / 60)

export function progressSummary(s: Pick<State, 'progress' | 'sessions' | 'tasks' | 'settings'>): ProgressSummary {
  const now = today()
  const days: ProgressDay[] = Object.values(s.progress).sort((a, b) => a.id.localeCompare(b.id))
  const last = days.at(-1)
  const weekAgo = [...days].reverse().find((d) => d.id <= addDays(now, -7))
  const sessions = Object.values(s.sessions)
  const tasks = Object.values(s.tasks)
  const sessionsByTask = new Map<string, FocusSession[]>()
  for (const x of sessions) if (x.taskId) sessionsByTask.set(x.taskId, [...(sessionsByTask.get(x.taskId) ?? []), x])

  const phases: PhaseProgress[] = PHASES.flatMap((p) => {
    const ts = tasks.filter((t) => t.phaseId === p.id)
    if (!ts.length) return []
    const ss = ts.flatMap((t) => sessionsByTask.get(t.id) ?? [])
    return [
      {
        id: p.id,
        title: p.title,
        done: ts.every((t) => t.status === 'done'),
        planned: ts.reduce((n, t) => n + (t.pomodoro?.sessions ?? 0), 0),
        completed: ss.filter((x) => x.completed).length,
        focusMin: minutes(ss),
        start: ts.map((t) => t.start).filter(Boolean).sort()[0],
        due: ts.map((t) => t.due).filter(Boolean).sort().at(-1)
      }
    ]
  })
  const current = phases.find((p) => !p.done && (p.start ?? '') <= now) ?? phases.find((p) => !p.done) ?? null

  // Word series: carried forward over the last 30 days.
  const wordSeries: { day: string; words: number }[] = []
  if (days.length) {
    let i = 0
    let w = 0
    for (let d = addDays(now, -29); d <= now; d = addDays(d, 1)) {
      while (i < days.length && days[i].id <= d) w = days[i++].words
      wordSeries.push({ day: d, words: w })
    }
  }

  return {
    words: last?.words ?? 0,
    limit: WORD_LIMIT,
    wordsWeek: (last?.words ?? 0) - (weekAgo?.words ?? 0),
    wordSeries,
    focusToday: minutes(sessions.filter((x) => toDay(new Date(x.start)) === now)),
    focusWeek: minutes(sessions.filter((x) => toDay(new Date(x.start)) > addDays(now, -7))),
    phases,
    current,
    burndown: burndown(tasks, sessions),
    daysLeft: daysLeft(),
    approval: toDay(APPROVAL),
    deadline: toDay(DEADLINE)
  }
}

/** Remaining planned sessions of the plan's tasks at the end of each day, from the plan's first day to the approval. */
function burndown(tasks: Task[], sessions: FocusSession[]): ProgressSummary['burndown'] {
  const plan = tasks.filter((t) => t.phaseId && !t.phaseId.startsWith('m:') && t.pomodoro)
  if (!plan.length) return []
  const total = plan.reduce((n, t) => n + (t.pomodoro?.sessions ?? 0), 0)
  const ids = new Set(plan.map((t) => t.id))
  const start = plan.map((t) => t.start ?? toDay(new Date(t.createdAt))).sort()[0]
  const end = toDay(APPROVAL)
  const span = Math.max(1, diffDays(start, end))
  const done = sessions.filter((x) => x.completed && x.taskId && ids.has(x.taskId)).map((x) => toDay(new Date(x.end))).sort()
  const now = today()
  const out: ProgressSummary['burndown'] = []
  let j = 0
  for (let d = start, i = 0; d <= end; d = addDays(d, 1), i++) {
    while (j < done.length && done[j] <= d) j++
    out.push({ day: d, remaining: d <= now ? Math.max(0, total - j) : null, ideal: Math.max(0, total - (total * i) / span) })
  }
  return out
}

function deliveryLine(): string[] {
  const next = nextDelivery()
  return next && !next.final ? [`Próxima entrega del taller: ${deliveryLabel(next.n).toLowerCase()}, ${next.left ? `en ${next.left} días` : 'hoy'} (${toDay(next.date)}).`] : []
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`)

/** For the assistant, with each message. */
export function progressContext(s: Pick<State, 'progress' | 'sessions' | 'tasks' | 'settings' | 'papers' | 'guides'> = useStore.getState()): string {
  const p = progressSummary(s)
  const lines = [
    `Entrega final en ${p.daysLeft} días (${p.deadline}); aprobación del tutor planificada para ${p.approval}.`,
    ...deliveryLine(),
    `Tesis: ${p.words.toLocaleString('es-AR')} palabras de un máximo de ${p.limit.toLocaleString('es-AR')}; ${p.wordsWeek >= 0 ? '+' : ''}${p.wordsWeek} en los últimos 7 días.`,
    `Foco: ${hm(p.focusToday)} hoy, ${hm(p.focusWeek)} en los últimos 7 días.`
  ]
  if (p.current) lines.push(`Etapa actual del plan: «${p.current.title}» (${p.current.completed}/${p.current.planned} pomodoros${p.current.due ? `, hasta ${p.current.due}` : ''}).`)
  if (p.phases.length) lines.push(`Etapas: ${p.phases.map((x) => `${x.title} ${x.done ? '✓' : `${x.completed}/${x.planned}`}`).join('; ')}.`)
  const b = p.burndown.filter((x) => x.remaining != null).at(-1)
  if (b) lines.push(`Pomodoros del plan pendientes: ${b.remaining} (la línea ideal hoy: ${Math.round(b.ideal)}) → ${b.remaining! > b.ideal + 2 ? 'atrasado' : 'en ritmo'}.`)
  const pair = chosenPair(s.settings.research)
  if (pair.length === 2) {
    const c = coverage(Object.values(s.papers), s.guides, s.settings.research)
    lines.push(
      `Biblioteca: ${c.total} papers; ${pair.map((x) => `${c.by[x.id]} sobre ${CONSTRUCTS[x.id].short}`).join(', ')}; ${c.cross} cruzan los dos temas${c.cross < MIN_CROSS ? ` (menos de ${MIN_CROSS}: falta literatura del vínculo entre ambos)` : ''}.`
    )
  }
  return `<progress>\n${lines.join('\n')}\n</progress>`
}

import { useEffect, useState } from 'react'
import { Bell, BellOff, Minus, Pause, Play, Plus, RotateCcw, SkipForward } from 'lucide-react'
import type { PomodoroPlan, Task } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Hint, IconButton } from '../components/common'
import { Segmented } from '../components/Segmented'
import { openTasks, patchTask, useStore } from '../store'
import {
  DEFAULT_PLAN,
  LONG_EVERY,
  PHASE_LABEL,
  PRESETS,
  RANGES,
  cleanPlan,
  currentSession,
  extend,
  fmtClock,
  fmtDuration,
  planMinutes,
  remainingMs,
  reset,
  setAutoStart,
  setSound,
  skip,
  startTask,
  stop,
  toggle,
  usePomodoro,
  type Phase,
  type Run,
  type TaskFocus
} from './timer'

// The timer's faces: a pill in the tab bar (visible from anywhere), the Pomodoro
// section of a task's detail, and a chip on each task row. Each phase has a color:
// ember for focus, teal for a short break, sky for a long one.

const PHASE_TEXT: Record<Phase, string> = { focus: 'text-bloom-ember', short: 'text-bloom-teal', long: 'text-bloom-sky' }
const PHASE_BG: Record<Phase, string> = { focus: 'bg-bloom-ember', short: 'bg-bloom-teal', long: 'bg-bloom-sky' }
/** A phase waiting for you to start it stays lit, like Keel's notch, until you notice. */
const PHASE_WAITING: Record<Phase, string> = {
  focus: 'border-bloom-ember/40 bg-bloom-ember/10',
  short: 'border-bloom-teal/40 bg-bloom-teal/10',
  long: 'border-bloom-sky/40 bg-bloom-sky/10'
}

function useTimer(): { run: Run; left: number; progress: number } | null {
  const run = usePomodoro((s) => s.run)
  const now = usePomodoro((s) => s.now)
  if (!run) return null
  const left = remainingMs(run, now)
  return { run, left, progress: run.length ? Math.min(1, Math.max(0, 1 - left / run.length)) : 0 }
}

function Ring({ value, size = 16, stroke = 2.25, className }: { value: number; size?: number; stroke?: number; className?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('flex-none -rotate-90', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        className="transition-[stroke-dashoffset] duration-300 ease-linear"
      />
    </svg>
  )
}

/** One bar per session: done, the one in progress, still to do. */
function Sessions({ total, done, current, className }: { total: number; done: number; current?: number; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)} aria-label={`${done} de ${total} sesiones`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-3.5 rounded-full transition-colors',
            i < done ? 'bg-bloom-ember' : i === current ? 'bg-bloom-ember/45' : 'bg-foreground/10'
          )}
        />
      ))}
    </div>
  )
}

/** A small on/off switch. */
function Switch({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; hint: string }) {
  return (
    <Hint label={hint} side="bottom">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2 rounded-md py-0.5 text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className={cn('relative h-4 w-7 flex-none rounded-full transition-colors', checked ? 'bg-bloom-ember' : 'bg-foreground/15')}>
          <span className={cn('absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-3')} />
        </span>
        {children}
      </button>
    </Hint>
  )
}

/** Big numerals and every control: in the tab-bar popover and in the running task's detail. */
function TimerPanel({ showTitle }: { showTitle?: boolean }) {
  const t = useTimer()
  const autoStart = usePomodoro((s) => s.autoStart)
  const sound = usePomodoro((s) => s.sound)
  const taskExists = useStore((s) => (t ? !!s.tasks[t.run.taskId] : false))
  if (!t) return null
  const { run, left, progress } = t
  const running = run.state === 'running'
  const primary = running ? 'Pausar' : run.state === 'paused' ? 'Seguir' : run.phase === 'focus' ? 'Empezar foco' : 'Empezar descanso'
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('font-mono text-[10.5px] font-semibold tracking-wider uppercase', PHASE_TEXT[run.phase])}>
          {PHASE_LABEL[run.phase]}
          {run.goal > 1 && ` · ${currentSession(run)}/${run.goal}`}
        </span>
        {run.state !== 'running' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{run.state === 'paused' ? 'En pausa' : 'Te espera'}</span>
        )}
      </div>
      {showTitle &&
        (taskExists ? (
          <button onClick={() => openTasks(run.taskId)} className="-mt-1.5 truncate text-left text-[13px] font-medium hover:underline" title="Abrir la tarea">
            {run.title}
          </button>
        ) : (
          <span className="-mt-1.5 truncate text-[13px] font-medium text-muted-foreground">{run.title}</span>
        ))}
      <div className="flex items-end justify-between gap-3">
        <div className={cn('font-heading text-[46px] leading-[0.9] font-medium tracking-tight tabular-nums transition-colors', !running && 'text-muted-foreground')}>{fmtClock(left)}</div>
        {run.goal > 1 && <Sessions total={run.goal} done={run.done} current={run.phase === 'focus' ? run.done : undefined} className="mb-1 max-w-28 justify-end" />}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
        <div className={cn('h-full rounded-full transition-[width] duration-300 ease-linear', PHASE_BG[run.phase])} style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex items-center gap-0.5">
        <Button size="sm" onClick={toggle} className="mr-1 min-w-0 flex-1 justify-start">
          {running ? <Pause /> : <Play />}
          {primary}
        </Button>
        <IconButton label="Reiniciar fase" onClick={reset}>
          <RotateCcw />
        </IconButton>
        <IconButton label={run.phase === 'focus' ? 'Saltar al descanso' : 'Saltar el descanso'} onClick={skip}>
          <SkipForward />
        </IconButton>
        <Hint label="Sumar 5 minutos a esta fase">
          <Button variant="ghost" size="sm" className="px-2 text-[12px] text-muted-foreground tabular-nums hover:text-foreground" onClick={() => extend(5)}>
            +5
          </Button>
        </Hint>
      </div>
      <div className="flex items-center gap-1 border-t pt-2.5">
        <Switch checked={autoStart} onChange={setAutoStart} hint={autoStart ? 'Cuando termina una fase, empieza la siguiente' : 'Cada fase espera a que la empieces'}>
          Encadenar fases
        </Switch>
        <Button variant="ghost" size="xs" className="ml-auto text-[11.5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={stop}>
          Detener
        </Button>
        <IconButton label={sound ? 'Silenciar sonidos' : 'Activar sonidos'} size="icon-xs" onClick={() => setSound(!sound)}>
          {sound ? <Bell /> : <BellOff />}
        </IconButton>
      </div>
    </div>
  )
}

// ---------- tab bar ----------

/** The running timer, from anywhere in the app: the clock opens every control; ▶/❚❚ right on it. */
export function TimerPill() {
  const t = useTimer()
  const [open, setOpen] = useState(false)
  if (!t) return null
  const { run, left, progress } = t
  const waiting = run.state === 'idle'
  return (
    <div className={cn('mr-1 flex h-7 items-center rounded-lg border bg-card shadow-xs transition-colors', waiting && PHASE_WAITING[run.phase])}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn('flex h-full max-w-[210px] min-w-0 items-center gap-2 rounded-l-[7px] pr-1.5 pl-2 text-[12px] outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/40', open && 'bg-foreground/5')}
            aria-label={`${PHASE_LABEL[run.phase]}: ${fmtClock(left)} · ${run.title}`}
          >
            <span className={cn('relative grid flex-none place-items-center', PHASE_TEXT[run.phase])}>
              <Ring value={progress} />
              {waiting && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-25" />}
            </span>
            <span className={cn('flex-none font-semibold tabular-nums', waiting ? PHASE_TEXT[run.phase] : run.state === 'paused' && 'text-muted-foreground')}>
              {waiting ? PHASE_LABEL[run.phase] : fmtClock(left)}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">{run.title}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-[320px] rounded-xl p-4">
          <TimerPanel showTitle />
        </PopoverContent>
      </Popover>
      <span className="h-4 w-px bg-border" />
      <IconButton label={run.state === 'running' ? 'Pausar' : waiting ? `Empezar ${PHASE_LABEL[run.phase].toLowerCase()}` : 'Seguir'} size="icon-xs" className="mx-0.5" onClick={toggle}>
        {run.state === 'running' ? <Pause /> : <Play />}
      </IconButton>
    </div>
  )
}

// ---------- task rows ----------

/** Progress on the task's pomodoros, or its live clock while it runs. */
export function TaskPomodoroChip({ task, focus }: { task: Task; focus?: TaskFocus }) {
  const run = usePomodoro((s) => (s.run?.taskId === task.id ? s.run : null))
  const now = usePomodoro((s) => (s.run?.taskId === task.id ? s.now : 0))
  if (run) {
    const left = remainingMs(run, now)
    return (
      <span className={cn('flex flex-none items-center gap-1 text-[11.5px] font-medium tabular-nums', PHASE_TEXT[run.phase])} title={`${PHASE_LABEL[run.phase]} en curso`}>
        <Ring value={run.length ? 1 - left / run.length : 0} size={13} stroke={2} />
        {run.state === 'idle' ? PHASE_LABEL[run.phase] : fmtClock(left)}
      </span>
    )
  }
  const done = focus?.done ?? 0
  if (!task.pomodoro && !done) return null
  const complete = !!task.pomodoro && done >= task.pomodoro.sessions
  return (
    <span
      className={cn('flex flex-none items-center gap-1.5 text-[11.5px] tabular-nums', complete ? 'text-status-read' : 'text-muted-foreground')}
      title={`${done} pomodoro${done === 1 ? '' : 's'} hechos${focus?.seconds ? ` · ${fmtDuration(focus.seconds)} de foco` : ''}`}
    >
      {task.pomodoro && task.pomodoro.sessions <= 8 ? (
        <span className="flex gap-0.5" aria-hidden>
          {Array.from({ length: task.pomodoro.sessions }, (_, i) => (
            <span key={i} className={cn('size-1.5 rounded-full', i < done ? (complete ? 'bg-status-read' : 'bg-bloom-ember') : 'bg-foreground/15')} />
          ))}
        </span>
      ) : null}
      {task.pomodoro ? `${done}/${task.pomodoro.sessions}` : `${done} 🍅`}
    </span>
  )
}

/** ▶ on a row, shown on hover: a pomodoro on this task right away. */
export function StartPomodoroButton({ task }: { task: Task }) {
  const isRunning = usePomodoro((s) => s.run?.taskId === task.id)
  if (isRunning || task.status === 'done') return null
  return (
    <IconButton
      label="Empezar pomodoro"
      size="icon-xs"
      className="flex-none text-bloom-ember opacity-0 group-hover:opacity-100 hover:bg-bloom-ember/10 hover:text-bloom-ember focus-visible:opacity-100"
      onClick={(e) => {
        e.stopPropagation()
        startTask(task.id)
      }}
    >
      <Play className="fill-current" />
    </IconButton>
  )
}

// ---------- task detail ----------

/** A number that clamps when you're done typing, not on every keystroke. */
function MinutesInput({ value, onChange, label, range }: { value: number; onChange: (v: number) => void; label: string; range: readonly [number, number] }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (text.trim() && Number.isFinite(n)) onChange(n)
    else setText(String(value))
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex h-7 items-center rounded-md border bg-card pr-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <input
          type="number"
          inputMode="numeric"
          min={range[0]}
          max={range[1]}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-full min-w-0 bg-transparent pl-2 text-[12.5px] tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-faint">min</span>
      </span>
    </label>
  )
}

/** The task's plan (how long, how many sessions), its progress, and the timer when it's this task's. */
export function PomodoroField({ task, focus }: { task: Task; focus?: TaskFocus }) {
  const isRunning = usePomodoro((s) => s.run?.taskId === task.id)
  const otherRunning = usePomodoro((s) => !!s.run && s.run.taskId !== task.id)
  const plan = task.pomodoro ?? DEFAULT_PLAN
  const preset = PRESETS.findIndex((p) => p.focusMinutes === plan.focusMinutes && p.breakMinutes === plan.breakMinutes)
  const [custom, setCustom] = useState(preset < 0)
  const done = focus?.done ?? 0
  const left = plan.sessions - done
  const setPlan = (patch: Partial<PomodoroPlan>) => patchTask(task.id, { pomodoro: cleanPlan(patch, plan) })

  const startLabel = left <= 0 ? 'Una sesión más' : done > 0 ? (left === 1 ? 'Seguir: última sesión' : `Seguir: ${left} sesiones`) : left === 1 ? 'Empezar pomodoro' : `Empezar ${left} sesiones`

  return (
    <div className="flex flex-col gap-3">
      {isRunning && (
        <div className="rounded-xl border bg-background p-3.5 shadow-xs">
          <TimerPanel />
        </div>
      )}

      <Segmented
        size="sm"
        fill
        value={custom ? 'custom' : String(Math.max(0, preset))}
        onChange={(v) => {
          if (v === 'custom') return setCustom(true)
          setCustom(false)
          setPlan(PRESETS[Number(v)])
        }}
        items={[
          ...PRESETS.map((p, i) => ({ value: String(i), label: `${p.focusMinutes}/${p.breakMinutes}`, title: `${p.focusMinutes} min de foco, ${p.breakMinutes} de descanso` })),
          { value: 'custom', label: 'Otro' }
        ]}
      />
      {custom && (
        <div className={cn('grid gap-2', plan.sessions > LONG_EVERY ? 'grid-cols-3' : 'grid-cols-2')}>
          <MinutesInput label="Foco" value={plan.focusMinutes} range={RANGES.focusMinutes} onChange={(focusMinutes) => setPlan({ focusMinutes })} />
          <MinutesInput label="Descanso" value={plan.breakMinutes} range={RANGES.breakMinutes} onChange={(breakMinutes) => setPlan({ breakMinutes })} />
          {plan.sessions > LONG_EVERY && (
            <MinutesInput label="Descanso largo" value={plan.longBreakMinutes} range={RANGES.longBreakMinutes} onChange={(longBreakMinutes) => setPlan({ longBreakMinutes })} />
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <div className="flex h-7 items-center rounded-md border bg-card">
          <IconButton label="Una sesión menos" size="icon-xs" disabled={plan.sessions <= RANGES.sessions[0]} onClick={() => setPlan({ sessions: plan.sessions - 1 })}>
            <Minus />
          </IconButton>
          <span className="w-5 text-center text-[12.5px] font-semibold tabular-nums">{plan.sessions}</span>
          <IconButton label="Una sesión más" size="icon-xs" disabled={plan.sessions >= RANGES.sessions[1]} onClick={() => setPlan({ sessions: plan.sessions + 1 })}>
            <Plus />
          </IconButton>
        </div>
        <span className="text-[12px] text-muted-foreground">
          {plan.sessions === 1 ? 'sesión' : 'sesiones'} de {plan.focusMinutes} min
        </span>
        <span className="ml-auto text-[11.5px] text-faint tabular-nums" title="Con los descansos entre sesiones">
          ≈ {fmtDuration(planMinutes(plan) * 60)}
        </span>
      </div>

      {!isRunning && (done > 0 || !!focus?.seconds) && (
        <div className="flex items-center gap-2.5">
          <Sessions total={Math.max(plan.sessions, Math.min(done, RANGES.sessions[1]))} done={done} />
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {done}/{plan.sessions}
            {focus?.seconds ? ` · ${fmtDuration(focus.seconds)} de foco` : ''}
          </span>
        </div>
      )}

      {(!isRunning && task.status !== 'done') || task.pomodoro ? (
        <div className="flex items-center gap-2">
          {!isRunning && task.status !== 'done' && (
            <Hint label={otherRunning ? 'Deja de lado el pomodoro en curso' : `${plan.focusMinutes} min de foco`}>
              <Button size="sm" variant="outline" className="border-bloom-ember/30 hover:border-bloom-ember/50 hover:bg-bloom-ember/10" onClick={() => startTask(task.id)}>
                <Play className="fill-current text-bloom-ember" />
                {startLabel}
              </Button>
            </Hint>
          )}
          {task.pomodoro && (
            <button className="ml-auto text-[11.5px] text-faint hover:text-foreground" onClick={() => patchTask(task.id, { pomodoro: undefined })}>
              Quitar plan
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

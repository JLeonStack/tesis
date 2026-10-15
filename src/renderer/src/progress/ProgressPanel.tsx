import { useMemo } from 'react'
import { Flame, PenLine, TrendingDown } from 'lucide-react'
import { useStore } from '../store'
import { cn } from '@/lib/utils'
import { fmtDay } from '../tasks/dates'
import { progressSummary } from './model'

// Where the thesis stands, at a glance: words toward the limit, focus time
// and the plan's pomodoros burning down to the tutor's approval.

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn('h-8 w-full', className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function Burndown({ data }: { data: { remaining: number | null; ideal: number }[] }) {
  if (data.length < 2) return null
  const max = Math.max(1, ...data.map((d) => Math.max(d.ideal, d.remaining ?? 0)))
  const x = (i: number) => (i / (data.length - 1)) * 100
  const y = (v: number) => 30 - (v / max) * 28
  const actual = data.flatMap((d, i) => (d.remaining == null ? [] : [`${x(i)},${y(d.remaining)}`])).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <line x1="0" y1={y(data[0].ideal)} x2="100" y2={y(0)} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polyline points={actual} fill="none" className="stroke-brand" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`)

export function ProgressPanel({ className }: { className?: string }) {
  const progress = useStore((s) => s.progress)
  const sessions = useStore((s) => s.sessions)
  const tasks = useStore((s) => s.tasks)
  const settings = useStore((s) => s.settings)
  const p = useMemo(() => progressSummary({ progress, sessions, tasks, settings }), [progress, sessions, tasks, settings])
  const last = p.burndown.filter((d) => d.remaining != null).at(-1)
  const behind = last ? last.remaining! - last.ideal : 0
  const pct = Math.min(100, (p.words / p.limit) * 100)

  return (
    <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3', className)}>
      <div className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 shadow-xs">
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <PenLine className="size-3.5 text-brand" /> Palabras de la tesis
        </span>
        <strong className={cn('text-[14px] font-[600] tabular-nums', p.words > p.limit && 'text-destructive')}>
          {p.words.toLocaleString('es-AR')} <span className="font-normal text-muted-foreground">/ {p.limit.toLocaleString('es-AR')} máx.</span>
        </strong>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', p.words > p.limit ? 'bg-destructive' : 'bg-brand')} style={{ width: `${pct}%` }} />
        </div>
        <Sparkline values={p.wordSeries.map((d) => d.words)} className="text-brand" />
        <span className="text-[11.5px] text-muted-foreground">{p.wordSeries.length ? `${p.wordsWeek >= 0 ? '+' : ''}${p.wordsWeek.toLocaleString('es-AR')} en 7 días` : 'Se registra al escribir en la tesis'}</span>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 shadow-xs">
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Flame className="size-3.5 text-bloom-pink" /> Foco
        </span>
        <strong className="text-[14px] font-[600] tabular-nums">
          {hm(p.focusToday)} hoy <span className="font-normal text-muted-foreground">· {hm(p.focusWeek)} en 7 días</span>
        </strong>
        <ul className="mt-1 flex flex-col gap-1">
          {p.phases
            .filter((ph) => !ph.done || ph.focusMin)
            .slice(0, 4)
            .map((ph) => (
              <li key={ph.id} className="flex items-center gap-2 text-[11.5px]">
                <span className={cn('min-w-0 flex-1 truncate', ph.id === p.current?.id ? 'font-medium text-foreground' : 'text-muted-foreground')} title={ph.title}>
                  {ph.title}
                </span>
                <span className="text-faint tabular-nums">
                  {ph.completed}/{ph.planned}
                </span>
              </li>
            ))}
          {!p.phases.length && <li className="text-[11.5px] text-muted-foreground">Armá el plan para ver el foco por etapa.</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 shadow-xs">
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <TrendingDown className="size-3.5 text-bloom-teal" /> Ritmo del plan
        </span>
        {last ? (
          <>
            <strong className={cn('text-[14px] font-[600]', behind > 2 ? 'text-destructive' : 'text-success')}>
              {behind > 2 ? `Atrasado ${Math.round(behind)} pomodoros` : 'En ritmo'}
            </strong>
            <Burndown data={p.burndown} />
            <span className="text-[11.5px] text-muted-foreground">
              {last.remaining} pomodoros pendientes · aprobación del tutor el {fmtDay(p.approval, { day: 'numeric', month: 'short' })}
            </span>
          </>
        ) : (
          <>
            <strong className="text-[14px] font-[600]">Sin plan todavía</strong>
            <span className="text-[11.5px] text-muted-foreground">El plan reparte las etapas hasta la aprobación del tutor, con pomodoros.</span>
          </>
        )}
      </div>
    </div>
  )
}

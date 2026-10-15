import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Flag } from 'lucide-react'
import type { Task } from '@shared/types'
import { cn } from '@/lib/utils'
import { patchTask, useStore } from '../store'
import { APPROVAL, DEADLINE, DELIVERIES, deliveryLabel, fmtDelivery } from '../research/framework'
import { addDays, compareTasks, diffDays, fmtDay, fromDay, isOverdue, startOfWeek, toDay, today } from './dates'
import { TaskCheck } from './TaskCheck'

// The timeline: dated tasks as bars on the calendar (milestones as diamonds).
// Drag a bar to move it, drag its ends to change when it starts or is due.

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export type Zoom = 'day' | 'week' | 'month'
const DAY_W: Record<Zoom, number> = { day: 34, week: 14, month: 5 }
/** Calendar shown past the last task, so there's room to drag things later. */
const AHEAD: Record<Zoom, number> = { day: 35, week: 91, month: 240 }
const ROW_H = 36
const LEFT_W = 260

type DragMode = 'move' | 'start' | 'end'
interface Drag {
  id: string
  mode: DragMode
  x0: number
  delta: number
}

/** The days a task covers on the timeline, with an in-progress drag applied. */
function spanOf(t: Task, drag: Drag | null): [string, string] {
  let s = t.milestone ? t.due! : (t.start ?? t.due)!
  let e = t.milestone ? t.due! : (t.due ?? t.start)!
  if (drag?.id === t.id && drag.delta) {
    if (drag.mode === 'move') [s, e] = [addDays(s, drag.delta), addDays(e, drag.delta)]
    else if (drag.mode === 'start') s = addDays(s, drag.delta) > e ? e : addDays(s, drag.delta)
    else e = addDays(e, drag.delta) < s ? s : addDays(e, drag.delta)
  }
  return [s, e]
}

export function Timeline({ tasks, zoom, selectedId, onSelect }: { tasks: Task[]; zoom: Zoom; selectedId: string | null; onSelect: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const now = today()
  const deadlines = useMemo(
    () => [
      ...DELIVERIES.slice(0, -1).map((d, i) => ({ day: toDay(d), short: `Entrega ${i + 1}`, label: `${deliveryLabel(i + 1)} del taller: ${fmtDelivery(d)}`, strong: false })),
      { day: toDay(APPROVAL), short: 'Tutor', label: 'Aprobación del tutor (planificada una semana antes)', strong: false },
      { day: toDay(DEADLINE), short: 'Final', label: `${deliveryLabel(DELIVERIES.length)}: ${fmtDelivery(DEADLINE)}`, strong: true }
    ],
    []
  )
  const dw = DAY_W[zoom]

  const dated = useMemo(
    () =>
      tasks
        .filter((t) => (t.milestone ? t.due : t.start || t.due))
        .sort((a, b) => spanOf(a, null)[0].localeCompare(spanOf(b, null)[0]) || compareTasks(a, b)),
    [tasks]
  )
  const undated = useMemo(() => tasks.filter((t) => !dated.includes(t)), [tasks, dated])

  // The calendar: from a Monday before the earliest task (or last week) to well past the latest.
  const { from, n } = useMemo(() => {
    let min = addDays(now, -7)
    let max = addDays(now, AHEAD[zoom])
    // The deadline is always in view, while it's ahead.
    for (const d of deadlines) if (d.day >= now && addDays(d.day, 7) > max) max = addDays(d.day, 7)
    for (const t of dated) {
      const [s, e] = spanOf(t, null)
      if (s < min) min = s
      if (addDays(e, 21) > max) max = addDays(e, 21)
    }
    const from = startOfWeek(addDays(min, -7))
    return { from, n: diffDays(from, max) + 1 }
  }, [dated, now, zoom, deadlines])
  const width = n * dw
  const x = (day: string) => diffDays(from, day) * dw

  // Open on today; when the calendar grows to the left, keep the view where it was.
  const shown = useRef<{ from: string; zoom: Zoom } | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const prev = shown.current
    if (!prev || prev.zoom !== zoom) el.scrollLeft = x(now) - (el.clientWidth - LEFT_W) / 4
    else if (prev.from !== from) el.scrollLeft += diffDays(from, prev.from) * dw
    shown.current = { from, zoom }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, zoom])

  const months = useMemo(() => {
    const out: { left: number; width: number; label: string }[] = []
    let day = from
    while (diffDays(from, day) < n) {
      const d = fromDay(day)
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      const len = Math.min(diffDays(day, `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`), n - diffDays(from, day))
      out.push({
        left: diffDays(from, day) * dw,
        width: len * dw,
        label: capitalize(d.toLocaleDateString('es-AR', zoom === 'month' ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' }))
      })
      day = addDays(day, len)
    }
    return out
  }, [from, n, dw, zoom])

  // Day numbers when there's room, otherwise the date of each Monday.
  const ticks = useMemo(() => {
    if (zoom === 'month') return []
    const step = zoom === 'day' ? 1 : 7
    return Array.from({ length: Math.ceil(n / step) }, (_, i) => addDays(from, i * step))
  }, [from, n, zoom])

  const grid = [
    // Week lines (the calendar starts on a Monday), then day lines and weekends when there's room.
    `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${7 * dw}px)`,
    zoom === 'day' ? `repeating-linear-gradient(to right, color-mix(in oklab, var(--border) 45%, transparent) 0 1px, transparent 1px ${dw}px)` : '',
    zoom !== 'month' ? `repeating-linear-gradient(to right, transparent 0 ${5 * dw}px, color-mix(in oklab, var(--muted) 70%, transparent) ${5 * dw}px ${7 * dw}px)` : ''
  ]
    .filter(Boolean)
    .join(', ')

  const commit = (t: Task, d: Drag) => {
    const [s, e] = spanOf(t, d)
    if (t.milestone) return patchTask(t.id, { due: e })
    // A one-day task with only a due date stays that way when moved.
    patchTask(t.id, { start: s !== e || t.start ? s : undefined, due: s !== e || t.due ? e : undefined })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, t: Task) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const mode = ((e.target as HTMLElement).dataset.mode as DragMode | undefined) ?? 'move'
    setDrag({ id: t.id, mode, x0: e.clientX, delta: 0 })
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const delta = Math.round((e.clientX - drag.x0) / dw)
    if (delta !== drag.delta) setDrag({ ...drag, delta })
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>, t: Task) => {
    if (!drag) return
    if (drag.delta) commit(t, drag)
    else if (Math.abs(e.clientX - drag.x0) < 4) onSelect(t.id)
    setDrag(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto border-t">
        <div className="relative" style={{ width: LEFT_W + width }}>
          {/* Header: months, then days or weeks. */}
          <div className="sticky top-0 z-20 flex border-b bg-background">
            <div className="sticky left-0 z-30 flex flex-none items-end border-r bg-background px-3 pb-1.5 text-[11px] font-medium text-muted-foreground" style={{ width: LEFT_W }}>
              {dated.length} con fecha
            </div>
            <div className="relative h-[46px] flex-none" style={{ width }}>
              {months.map((m) => (
                <div key={m.left} className="absolute top-0 h-[22px] border-l pt-1 text-[11.5px] font-semibold" style={{ left: m.left, width: m.width }}>
                  {/* Stays in view while its month is on screen. */}
                  <span className="sticky block w-max max-w-full truncate px-1.5" style={{ left: LEFT_W }}>
                    {m.label}
                  </span>
                </div>
              ))}
              {ticks.map((d) => {
                const isToday = zoom === 'day' ? d === now : diffDays(d, now) >= 0 && diffDays(d, now) < 7
                return (
                  <div
                    key={d}
                    className={cn('absolute top-[24px] text-center text-[10.5px] tabular-nums', isToday ? 'font-semibold text-bloom-ember' : 'text-muted-foreground')}
                    style={{ left: x(d), width: zoom === 'day' ? dw : 7 * dw }}
                    title={fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                  >
                    {zoom === 'day' ? (
                      <>
                        <span className="block text-[9px] leading-none uppercase opacity-70">{fmtDay(d, { weekday: 'narrow' })}</span>
                        {fromDay(d).getDate()}
                      </>
                    ) : (
                      <span className="block pt-1.5 pl-1 text-left">{fromDay(d).getDate()}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Rows: titles on the left, bars on the calendar. */}
          <div className="flex">
            <div className="sticky left-0 z-10 flex-none border-r bg-background" style={{ width: LEFT_W }}>
              {dated.map((t) => (
                <div
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  className={cn('flex cursor-default items-center gap-2 border-b border-border/50 px-3', t.id === selectedId ? 'bg-accent' : 'hover:bg-accent/60')}
                  style={{ height: ROW_H }}
                >
                  <TaskCheck task={t} />
                  <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', t.status === 'done' && 'text-faint line-through', isOverdue(t, now) && 'text-destructive')}>
                    {t.title || 'Sin título'}
                  </span>
                </div>
              ))}
            </div>
            <div className="relative flex-none" style={{ width, height: Math.max(dated.length * ROW_H, 120), backgroundImage: grid }}>
              {dated.map((t, i) => (
                <div
                  key={t.id}
                  className={cn('absolute inset-x-0 border-b border-border/50', t.id === selectedId && 'bg-accent/50')}
                  style={{ top: i * ROW_H, height: ROW_H }}
                />
              ))}
              {/* Today */}
              <div className="pointer-events-none absolute inset-y-0 z-[5] w-[2px] bg-bloom-ember/80" style={{ left: x(now) + dw / 2 - 1 }} />
              {/* The tutor's approval and the fixed submission deadline */}
              {deadlines.map((d) => (
                <div key={d.day} className="pointer-events-none absolute inset-y-0 z-[5]" style={{ left: x(d.day) + dw / 2 - 1 }} title={d.label}>
                  <div className={cn('h-full w-0 border-l-2', d.strong ? 'border-destructive/80' : 'border-dashed border-brand/60')} />
                  <span className={cn('absolute top-1 left-1 rounded px-1 text-[10.5px] font-semibold whitespace-nowrap', d.strong ? 'bg-destructive/10 text-destructive' : 'bg-brand-soft text-brand-text')}>
                    {d.short}
                  </span>
                </div>
              ))}

              {dated.map((t, i) => {
                const [s, e] = spanOf(t, drag)
                const left = x(s)
                const w = (diffDays(s, e) + 1) * dw
                const dragging = drag?.id === t.id
                const tone = t.status === 'done' ? 'done' : isOverdue(t, now) ? 'late' : t.status
                const label = (
                  <span className={cn('sticky truncate text-[11.5px] font-medium', t.status === 'done' && 'line-through')} style={{ left: LEFT_W + 8 }}>
                    {t.priority === 'high' && t.status !== 'done' && <Flag className="mr-1 inline size-3 fill-current align-[-1px] text-destructive" />}
                    {t.title || 'Sin título'}
                  </span>
                )
                const inside = !t.milestone && w >= 96
                return (
                  <div key={t.id} className="absolute inset-x-0" style={{ top: i * ROW_H, height: ROW_H }}>
                    <div
                      role="button"
                      aria-label={`${t.title || 'Sin título'}: ${fmtDay(s)}${s !== e ? ` a ${fmtDay(e)}` : ''}`}
                      onPointerDown={(ev) => onPointerDown(ev, t)}
                      onPointerMove={onPointerMove}
                      onPointerUp={(ev) => onPointerUp(ev, t)}
                      onPointerCancel={() => setDrag(null)}
                      className={cn(
                        'group absolute top-1/2 z-[6] flex -translate-y-1/2 touch-none items-center',
                        dragging ? 'cursor-grabbing' : 'cursor-grab',
                        t.milestone
                          ? 'justify-center'
                          : cn(
                              'h-[22px] rounded-md border px-2 shadow-xs transition-shadow hover:shadow-md',
                              tone === 'todo' && 'border-bloom-sky/60 bg-bloom-sky/20',
                              tone === 'doing' && 'border-bloom-amber/70 bg-bloom-amber/25',
                              tone === 'late' && 'border-destructive/60 bg-destructive/15',
                              tone === 'done' && 'border-status-read/40 bg-status-read/15 text-muted-foreground'
                            ),
                        t.id === selectedId && !t.milestone && 'ring-2 ring-ring/60',
                        dragging && 'shadow-lg'
                      )}
                      style={t.milestone ? { left: left + dw / 2 - 9, width: 18, height: 18 } : { left, width: Math.max(w, 6) }}
                    >
                      {t.milestone ? (
                        <span
                          className={cn(
                            'size-3 rotate-45 rounded-[2px] border-2',
                            tone === 'done' ? 'border-status-read bg-status-read' : tone === 'late' ? 'border-destructive bg-destructive/30' : 'border-bloom-pink bg-bloom-pink/30',
                            t.id === selectedId && 'ring-2 ring-ring/60 ring-offset-1'
                          )}
                        />
                      ) : (
                        <>
                          {inside && label}
                          {w >= 3 * dw && (
                            <>
                              <span data-mode="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md group-hover:bg-foreground/10" />
                              <span data-mode="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md group-hover:bg-foreground/10" />
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {!inside && (
                      <span
                        className="pointer-events-none absolute top-1/2 z-[6] flex max-w-[260px] -translate-y-1/2"
                        style={{ left: t.milestone ? left + dw / 2 + 14 : left + Math.max(w, 6) + 6 }}
                      >
                        {label}
                      </span>
                    )}
                    {dragging && (
                      <span
                        className="pointer-events-none absolute -top-1 z-30 rounded bg-popover px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap shadow-md ring-1 ring-border tabular-nums"
                        style={{ left }}
                      >
                        {fmtDay(s, { weekday: 'short', day: 'numeric', month: 'short' })}
                        {s !== e && ` → ${fmtDay(e, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                      </span>
                    )}
                  </div>
                )
              })}
              {dated.length === 0 && (
                <p className="absolute top-10 max-w-sm text-[13px] text-muted-foreground" style={{ left: x(now) + 16 }}>
                  Ninguna tarea tiene fecha todavía. Abrí una de abajo y ponele inicio y vencimiento.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div className="flex max-h-[30%] flex-none flex-wrap items-center gap-1.5 overflow-y-auto border-t px-5 py-2.5">
          <span className="mr-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sin fecha · {undated.length}</span>
          {undated.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={cn(
                'flex max-w-[240px] items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors',
                t.id === selectedId ? 'border-ring bg-accent' : 'bg-card hover:bg-accent',
                t.status === 'done' && 'text-faint line-through'
              )}
            >
              <span className="truncate">{t.title || 'Sin título'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { AnimatePresence, Reorder, motion } from 'motion/react'
import { BookOpenText, Sparkles, FileText, NotebookPen, X, Columns2, GraduationCap, ListTodo, Shapes, Table2, Crosshair, ChartColumn } from 'lucide-react'
import { closeTab, reorderTabs, tabKey, toggleSideNote, useStore } from '../store'
import { shortTitle } from '../lib/citation'
import { mod } from '../lib/util'
import { cn } from '@/lib/utils'
import { IconButton } from './common'
import { TimerPill } from '../pomodoro/Pomodoro'

const SPRING = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 } as const

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const papers = useStore((s) => s.papers)
  const notes = useStore((s) => s.notes)
  const theses = useStore((s) => s.theses)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const sideNoteId = useStore((s) => s.sideNoteId)
  const activeIsPaper = active?.startsWith('paper:')

  return (
    // Panel toggles live on the panels and their rails (Occam's razor); the collapsed
    // sidebar rail is narrower than the traffic lights, hence the extra left padding.
    <div className={cn('drag flex h-[46px] flex-none items-center gap-1.5 border-b bg-background pr-2 pl-2.5', !sidebarOpen && 'pl-6')}>
      {/* Drag a tab sideways to reorder; layoutScroll keeps drag math right while the strip is scrolled. */}
      <Reorder.Group
        as="div"
        axis="x"
        values={tabs}
        onReorder={reorderTabs}
        layoutScroll
        role="tablist"
        className="no-drag scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-x-auto"
      >
        <AnimatePresence initial={false}>
          {tabs.map((t) => {
            const key = tabKey(t)
            const on = key === active
            const title =
              t.kind === 'paper'
                ? papers[t.id]?.title ?? 'Paper'
                : t.kind === 'thesis'
                  ? theses[t.id]?.meta.title || 'Tesis'
                  : t.kind === 'board'
                    ? 'Pizarra'
                    : t.kind === 'matrix'
                      ? 'Matriz de literatura'
                      : t.kind === 'tasks'
                        ? 'Tareas'
                        : t.kind === 'wiki'
                          ? 'Wiki'
                          : t.kind === 'agent'
                            ? 'Asistente'
                            : t.kind === 'research'
                              ? 'Marco de investigación'
                              : t.kind === 'analysis'
                                ? 'Análisis de datos'
                                : notes[t.id]?.title || 'Nota sin título'
            const Icon = t.kind === 'paper' ? FileText : t.kind === 'thesis' ? GraduationCap : t.kind === 'board' ? Shapes : t.kind === 'matrix' ? Table2 : t.kind === 'tasks' ? ListTodo : t.kind === 'wiki' ? BookOpenText : t.kind === 'agent' ? Sparkles : t.kind === 'research' ? Crosshair : t.kind === 'analysis' ? ChartColumn : NotebookPen
            return (
              <Reorder.Item
                as="div"
                key={key}
                value={t}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
                transition={SPRING}
                role="tab"
                aria-selected={on}
                title={title}
                onMouseDown={(e) => {
                  if (e.button === 1) return closeTab(key)
                  useStore.setState({ active: key })
                }}
                className={cn(
                  'group relative flex h-[30px] max-w-[220px] min-w-[96px] flex-[0_1_auto] items-center gap-2 rounded-lg pr-1.5 pl-2.5',
                  on ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/70'
                )}
              >
                {on && (
                  <motion.span
                    layoutId="active-tab"
                    transition={SPRING}
                    className="absolute inset-0 rounded-lg bg-card shadow-xs ring-1 ring-border"
                  />
                )}
                <Icon className={cn('relative size-3.5 flex-none transition-opacity', t.kind === 'paper' ? 'text-kind-paper' : t.kind === 'thesis' ? 'text-brand' : t.kind === 'board' ? 'text-bloom-lilac' : t.kind === 'matrix' ? 'text-bloom-teal' : t.kind === 'tasks' ? 'text-bloom-pink' : t.kind === 'wiki' ? 'text-bloom-amber' : t.kind === 'agent' ? 'text-brand' : t.kind === 'research' ? 'text-bloom-teal' : t.kind === 'analysis' ? 'text-bloom-amber' : 'text-kind-note', !on && 'opacity-60')} />
                <span className="relative min-w-0 flex-1 truncate text-[12.5px] font-medium">{shortTitle(title)}</span>
                <button
                  aria-label="Cerrar pestaña"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => closeTab(key)}
                  className={cn(
                    'relative grid size-[18px] flex-none place-items-center rounded text-faint hover:bg-accent hover:text-foreground',
                    on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X className="size-3" />
                </button>
              </Reorder.Item>
            )
          })}
        </AnimatePresence>
      </Reorder.Group>
      <div className="no-drag flex items-center gap-0.5">
        <TimerPill />
        {activeIsPaper && (
          <IconButton label="Nota lateral" keys={[mod, '⇧', 'N']} active={!!sideNoteId} onClick={toggleSideNote}>
            <Columns2 />
          </IconButton>
        )}
      </div>
    </div>
  )
}

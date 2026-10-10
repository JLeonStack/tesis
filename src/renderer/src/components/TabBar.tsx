import { AnimatePresence, motion } from 'motion/react'
import { FileText, NotebookPen, X, Columns2, GraduationCap, Shapes, Table2 } from 'lucide-react'
import { closeTab, tabKey, toggleSideNote, useStore } from '../store'
import { shortTitle } from '../lib/citation'
import { mod } from '../lib/util'
import { cn } from '@/lib/utils'
import { IconButton } from './common'

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
      <div role="tablist" className="no-drag scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-x-auto">
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
                    ? 'Whiteboard'
                    : t.kind === 'matrix'
                      ? 'Literature matrix'
                      : notes[t.id]?.title || 'Untitled note'
            const Icon = t.kind === 'paper' ? FileText : t.kind === 'thesis' ? GraduationCap : t.kind === 'board' ? Shapes : t.kind === 'matrix' ? Table2 : NotebookPen
            return (
              <motion.div
                key={key}
                layout="position"
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
                <Icon className={cn('relative size-3.5 flex-none transition-opacity', t.kind === 'paper' ? 'text-kind-paper' : t.kind === 'thesis' ? 'text-brand' : t.kind === 'board' ? 'text-bloom-lilac' : t.kind === 'matrix' ? 'text-bloom-teal' : 'text-kind-note', !on && 'opacity-60')} />
                <span className="relative min-w-0 flex-1 truncate text-[12.5px] font-medium">{shortTitle(title)}</span>
                <button
                  aria-label="Close tab"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => closeTab(key)}
                  className={cn(
                    'relative grid size-[18px] flex-none place-items-center rounded text-faint hover:bg-accent hover:text-foreground',
                    on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <div className="no-drag flex items-center gap-0.5">
        {activeIsPaper && (
          <IconButton label="Side note" keys={[mod, '⇧', 'N']} active={!!sideNoteId} onClick={toggleSideNote}>
            <Columns2 />
          </IconButton>
        )}
      </div>
    </div>
  )
}

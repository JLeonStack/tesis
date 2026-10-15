import { useEffect, useId, useState, type MouseEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { setCollapsed, useStore } from '../store'
import { cn } from '@/lib/utils'

/*
 * One disclosure pattern for the whole app (law of similarity, Jakob's law:
 * Finder-style chevrons). Collapsed headers keep a count and a short summary
 * visible so nothing has to be remembered (working memory, Zeigarnik).
 * ⌥-click toggles every section in the same group, like macOS outlines.
 */

type GroupEvent = { group: string; collapsed: boolean }
const groupListeners = new Set<(e: GroupEvent) => void>()

export interface CollapsibleProps {
  /** Persisted open state key. Omit (or pass `local`) for session-only state. */
  id?: string
  local?: boolean
  /** Sections sharing a group can be toggled together with ⌥-click. */
  group?: string
  defaultOpen?: boolean
  title: ReactNode
  /** `label`: uppercase eyebrow for lists. `title`: sentence-case heading for cards and forms. */
  variant?: 'label' | 'title'
  /** Conduit category pill, e.g. `bg-kind-paper`. */
  marker?: string
  icon?: ReactNode
  count?: ReactNode
  /** Shown next to the title only while collapsed. */
  summary?: ReactNode
  /** Controls at the right end of the header (kept outside the toggle button). */
  actions?: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
}

export function Collapsible({
  id,
  local,
  group,
  defaultOpen = true,
  title,
  variant = 'label',
  marker,
  icon,
  count,
  summary,
  actions,
  className,
  headerClassName,
  contentClassName,
  children
}: CollapsibleProps) {
  const persisted = !!id && !local
  const stored = useStore((s) => (persisted ? s.collapsed[id!] : undefined))
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const open = persisted ? (stored === undefined ? defaultOpen : !stored) : localOpen
  const contentId = useId()

  const apply = (next: boolean) => (persisted ? setCollapsed(id!, !next) : setLocalOpen(next))

  useEffect(() => {
    if (!group) return
    const on = (e: GroupEvent) => e.group === group && apply(!e.collapsed)
    groupListeners.add(on)
    return () => void groupListeners.delete(on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, id, persisted])

  const toggle = (e: MouseEvent) => {
    if (e.altKey && group) {
      for (const l of groupListeners) l({ group, collapsed: open })
      return
    }
    apply(!open)
  }

  return (
    <section className={className}>
      <div className={cn('flex min-h-7 items-center gap-1', headerClassName)}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
          title={group ? '⌥-clic para alternar todas' : undefined}
          className={cn(
            'group/toggle -ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1 pl-1 text-left outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/40',
            variant === 'label'
              ? 'text-[11px] font-semibold tracking-[0.06em] text-faint uppercase hover:text-muted-foreground'
              : 'text-[13px] font-semibold text-foreground'
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 flex-none text-faint transition-transform duration-200 group-hover/toggle:text-foreground',
              open && 'rotate-90'
            )}
          />
          {marker && <span aria-hidden className={cn('h-3 w-[3px] flex-none rounded-full', marker)} />}
          {icon && <span className="flex flex-none [&_svg]:size-3.5">{icon}</span>}
          <span className="min-w-0 truncate">{title}</span>
          {count != null && <span className="flex-none text-[11px] font-medium tracking-normal text-faint tabular-nums normal-case">{count}</span>}
          {!open && summary && (
            <span className="min-w-0 shrink-[1000] truncate text-[11.5px] font-normal tracking-normal text-muted-foreground normal-case">· {summary}</span>
          )}
        </button>
        {actions && <div className="flex flex-none items-center gap-0.5">{actions}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={contentId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 42, opacity: { duration: 0.14 } }}
            // clip (not hidden) + a clip margin keeps focus rings and card shadows intact.
            style={{ overflow: 'clip', overflowClipMargin: 8 }}
          >
            <div className={contentClassName}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

import type { ReactNode } from 'react'
import { Hint } from './common'
import { cn } from '@/lib/utils'

/*
 * Collapsed panels shrink to an icon rail instead of disappearing, so their
 * content stays one click away (Zeigarnik: visible signifiers of more) and
 * the targets sit on the window edge (Fitts's law).
 */

export function Rail({ side, children, className }: { side: 'left' | 'right'; children: ReactNode; className?: string }) {
  return (
    <nav
      aria-label={side === 'left' ? 'Library' : 'Assistant and paper tools'}
      className={cn(
        'flex min-h-0 flex-col items-center gap-1 pb-2.5',
        side === 'left' ? 'border-r border-sidebar-border bg-sidebar' : 'border-l bg-card',
        className
      )}
    >
      {children}
    </nav>
  )
}

export function RailButton({
  label,
  keys,
  icon,
  onClick,
  active,
  badge,
  dot,
  side
}: {
  label: string
  keys?: string[]
  icon: ReactNode
  onClick: () => void
  active?: boolean
  /** Small count (e.g. highlights). */
  badge?: number
  /** `busy` pulses while the assistant writes; `new` marks an unseen answer. */
  dot?: 'busy' | 'new' | null
  side: 'left' | 'right'
}) {
  const status = dot === 'busy' ? ', writing' : dot === 'new' ? ', new answer' : badge ? `, ${badge}` : ''
  return (
    <Hint label={label} keys={keys} side={side === 'left' ? 'right' : 'left'}>
      <button
        type="button"
        aria-label={label + status}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'relative grid size-9 flex-none place-items-center rounded-lg text-muted-foreground transition-colors outline-none [&_svg]:size-[17px]',
          'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
          active && 'bg-accent text-foreground'
        )}
      >
        {icon}
        {!!badge && !dot && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[9.5px] font-semibold text-background tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {dot && (
          <span aria-hidden className="absolute top-1 right-1 flex size-2">
            {dot === 'busy' && <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-60" />}
            <span className="relative size-2 rounded-full bg-brand ring-2 ring-card" />
          </span>
        )}
      </button>
    </Hint>
  )
}

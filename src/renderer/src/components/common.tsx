import { forwardRef, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

/**
 * Tooltip that also teaches the shortcut (Paradox of the Active User:
 * people learn shortcuts where they already look).
 */
export function Hint({
  label,
  keys,
  side = 'bottom',
  children
}: {
  label: ReactNode
  keys?: string[]
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className="flex items-center gap-2">
        <span>{label}</span>
        {keys?.length ? (
          <KbdGroup>
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </KbdGroup>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

interface IconButtonProps extends React.ComponentProps<typeof Button> {
  label: string
  keys?: string[]
  active?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, keys, active, side, className, children, size = 'icon-sm', ...props },
  ref
) {
  return (
    <Hint label={label} keys={keys} side={side}>
      <Button
        ref={ref}
        variant="ghost"
        size={size}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'text-muted-foreground hover:text-foreground',
          active && 'bg-brand-soft text-brand-text hover:bg-brand-soft hover:text-brand-text',
          className
        )}
        {...props}
      >
        {children}
      </Button>
    </Hint>
  )
})

export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
  bloom
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  children?: ReactNode
  className?: string
  /** Brand flower tile instead of the neutral one (AI surfaces). */
  bloom?: boolean
}) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center', className)}>
      <div className={cn('mb-1 grid size-11 place-items-center rounded-xl [&_svg]:size-5', bloom ? 'bloom-tile' : 'bg-muted text-muted-foreground')}>{icon}</div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-64 text-[12.5px] text-muted-foreground">{description}</p>}
      {children && <div className="mt-2 flex flex-col items-center gap-2">{children}</div>}
    </div>
  )
}

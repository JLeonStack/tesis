import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/motion/tabs'
import { cn } from '@/lib/utils'

export interface SegmentItem<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  count?: number
  title?: string
}

/**
 * macOS-style segmented control built on beUI's spring tabs: a raised surface
 * glides to the selected segment. `fill` stretches segments to equal widths.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  size = 'md',
  fill,
  className
}: {
  value: T
  onChange: (v: T) => void
  items: SegmentItem<T>[]
  size?: 'sm' | 'md'
  fill?: boolean
  className?: string
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} variant="segment" className={cn(fill && 'w-full', className)}>
      <TabsList
        wrapperClassName={cn(fill && 'w-full')}
        className={cn(
          'rounded-lg bg-muted p-0.5 [--primary-foreground:var(--foreground)]',
          fill && 'flex w-full [&>div]:flex-1'
        )}
      >
        {items.map((it) => (
          <TabsTrigger
            key={it.value}
            value={it.value}
            indicatorClassName="bg-card shadow-sm ring-1 ring-black/[0.04] dark:bg-accent dark:ring-white/5"
            className={cn(
              'gap-1.5 font-medium [&_svg]:size-3.5',
              size === 'sm' ? 'h-6 px-2.5 text-[11.5px]' : 'h-7 px-3 text-[12.5px]',
              fill && 'w-full'
            )}
          >
            <span className="flex items-center gap-1.5" title={it.title}>
              {it.icon}
              {it.label}
              {it.count != null && <span className="text-[11px] text-faint tabular-nums">{it.count}</span>}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

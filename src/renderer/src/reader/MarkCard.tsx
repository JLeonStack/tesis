import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { BookMarked, Quote } from 'lucide-react'
import type { Paper } from '@shared/types'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { authorLine } from '../lib/citation'
import type { PageMark } from '../lib/marks'

const WIDTH = 320
const STATUS: Record<Paper['status'], { label: string; dot: string }> = {
  unread: { label: 'Sin leer', dot: 'bg-status-unread' },
  reading: { label: 'Leyendo', dot: 'bg-status-reading' },
  read: { label: 'Leído', dot: 'bg-status-read' }
}

/**
 * What a mark means, next to it: a key term's definition from the reading
 * guide, or which library paper a citation points to. Read-only, so it never
 * gets in the way of selecting text.
 */
export function MarkCard({ mark, box, paperId }: { mark: PageMark; box: DOMRect; paperId: string }) {
  const term = useStore((s) => (mark.kind === 'term' ? s.guides[paperId]?.terms[mark.term] : undefined))
  const defined = useStore((s) => (term?.sentenceId ? s.guides[paperId]?.sentences.find((x) => x.id === term.sentenceId) : undefined))
  const cited = useStore((s) => (mark.kind === 'cite' ? s.papers[mark.paperId] : undefined))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 120
    const left = Math.min(Math.max(8, box.left + box.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8)
    const below = box.bottom + 8
    setPos({ left, top: below + h > window.innerHeight - 8 ? Math.max(8, box.top - h - 8) : below })
  }, [box])

  if (!term && !cited) return null
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
      className="pointer-events-none fixed z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      {term ? (
        <>
          <div className="flex items-baseline gap-2">
            <BookMarked className="size-3.5 flex-none translate-y-0.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold">{term.term}</span>
            {term.original && term.original.toLowerCase() !== term.term.toLowerCase() && (
              <span className="truncate text-[12px] text-faint italic">{term.original}</span>
            )}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-snug">{term.definition}</p>
          {defined ? (
            <>
              <p className="mt-2 line-clamp-4 border-l-2 border-[var(--skim-definition)] pl-2 font-serif text-[12.5px] leading-snug text-muted-foreground">
                {defined.text}
              </p>
              <p className="mt-1.5 text-[11px] text-faint">Definición del paper, p. {defined.page}
                {defined.rects.length > 0 && ' · clic para ir'}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] text-faint">p. {term.page} · Guía de lectura</p>
          )}
        </>
      ) : (
        cited && (
          <>
            <div className="flex items-start gap-2">
              <Quote className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
              <span className="line-clamp-3 text-[13px] leading-snug font-semibold">{cited.title}</span>
            </div>
            <p className="mt-1 truncate pl-5.5 text-[12px] text-muted-foreground">
              {authorLine(cited)}
              {cited.year ? ` · ${cited.year}` : ''}
              {cited.venue ? ` · ${cited.venue}` : ''}
            </p>
            <div className="mt-2 flex items-center gap-1.5 pl-5.5 text-[11.5px] text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', STATUS[cited.status].dot)} />
              En tu biblioteca · {STATUS[cited.status].label}
              <span className="flex-1" />
              <span className="text-faint">Clic para abrir</span>
            </div>
          </>
        )
      )}
    </motion.div>
  )
}

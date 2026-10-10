import type { Annotation } from '@shared/types'
import { cn } from '@/lib/utils'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { retryHighlightTranslation, useTranslationState, wantsTranslation } from '../lib/highlightTranslate'

/**
 * A highlight's text the way notes show quotes: the Spanish translation first,
 * the original below it, smaller. Shows the original alone while translating.
 */
export function HighlightText({ a, clamp = true, className }: { a: Annotation; clamp?: boolean; className?: string }) {
  const state = useTranslationState(a.id)
  if (!a.translation)
    return (
      <div className={className}>
        <p className={cn('font-serif text-[13.5px] leading-relaxed', clamp && 'line-clamp-5')}>{a.text}</p>
        {wantsTranslation(a) && state === 'pending' && (
          <TextShimmer duration={1.6} className="mt-1 text-[11.5px] font-medium">
            Traduciendo…
          </TextShimmer>
        )}
        {wantsTranslation(a) && state === 'failed' && (
          <button
            className="mt-1 text-[11.5px] text-faint underline-offset-2 hover:text-foreground hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              retryHighlightTranslation(a.id)
            }}
          >
            No se pudo traducir · Reintentar
          </button>
        )}
      </div>
    )
  return (
    <div className={className}>
      <p className={cn('font-serif text-[13.5px] leading-relaxed', clamp && 'line-clamp-5')}>{a.translation}</p>
      <p className={cn('mt-1 font-serif text-[12px] leading-snug text-muted-foreground italic', clamp && 'line-clamp-3')}>
        <span className="font-sans font-semibold not-italic">Original:</span> “{a.text}”
      </p>
    </div>
  )
}

import type { ConstructId } from '@shared/types'
import { patchPaper, useStore } from '../store'
import { cn } from '@/lib/utils'
import { CONSTRUCTS, CONSTRUCT_ORDER } from './framework'
import { paperConstructs } from './coverage'

// A paper's course topics: compact badges in the matrix, toggles in the paper's info.

export function TopicBadges({ ids, className }: { ids: ConstructId[]; className?: string }) {
  if (!ids.length) return null
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {ids.map((id) => (
        <span key={id} className={cn('rounded px-1.5 py-px text-[10.5px] font-medium', CONSTRUCTS[id].tone)}>
          {CONSTRUCTS[id].short}
        </span>
      ))}
    </span>
  )
}

/** Toggles; the first edit freezes the tags so a rebuilt guide doesn't overwrite them. */
export function TopicToggles({ paperId }: { paperId: string }) {
  const paper = useStore((s) => s.papers[paperId])
  const guide = useStore((s) => s.guides[paperId])
  const chosen = useStore((s) => s.settings.research.constructs)
  if (!paper) return null
  const ids = paperConstructs(paper, guide)
  const source = paper.constructsManual ? 'tus etiquetas' : guide?.constructs ? 'la guía de lectura' : 'el título y el resumen'
  const toggle = (id: ConstructId) => patchPaper(paper.id, { constructs: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], constructsManual: true })
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {CONSTRUCT_ORDER.map((id) => {
          const on = ids.includes(id)
          return (
            <button
              key={id}
              aria-pressed={on}
              onClick={() => toggle(id)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11.5px] font-medium transition-colors',
                on ? cn('border-transparent', CONSTRUCTS[id].tone) : 'border-dashed text-muted-foreground hover:text-foreground',
                chosen.includes(id) && 'ring-1 ring-brand/40'
              )}
              title={chosen.includes(id) ? 'Uno de tus 2 temas' : undefined}
            >
              {CONSTRUCTS[id].short}
            </button>
          )
        })}
      </div>
      <span className="text-[11px] text-faint">
        Según {source}.
        {paper.constructsManual && (
          <button className="ml-1 text-brand-text hover:underline" onClick={() => patchPaper(paper.id, { constructs: undefined, constructsManual: false })}>
            Volver a lo automático
          </button>
        )}
      </span>
    </div>
  )
}

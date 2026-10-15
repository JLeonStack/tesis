import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Copy, MessageSquareText, NotebookPen, Sparkles, Lightbulb, Languages } from 'lucide-react'
import type { HighlightColor } from '@shared/types'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Hint } from '../components/common'
import { useStore } from '../store'
import { langShort, prewarmTranslator } from '../lib/translate'

export const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']
/** Spanish names of the highlight colors, for labels and tooltips. */
export const COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: 'amarillo',
  green: 'verde',
  blue: 'azul',
  pink: 'rosa',
  purple: 'violeta'
}
export const COLOR_VAR: Record<HighlightColor, string> = {
  yellow: 'var(--hl-yellow-solid)',
  green: 'var(--hl-green-solid)',
  blue: 'var(--hl-blue-solid)',
  pink: 'var(--hl-pink-solid)',
  purple: 'var(--hl-purple-solid)'
}

interface Actions {
  highlight: (c: HighlightColor) => void
  comment: () => void
  toNote: () => void
  ask: () => void
  explain: () => void
  translate: () => void
  copy: () => void
}

function ToolButton({ label, keys, onClick, accent, children }: { label: string; keys?: string[]; onClick: () => void; accent?: boolean; children: React.ReactNode }) {
  return (
    <Hint label={label} keys={keys} side="top">
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={onClick}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-[15px]',
          accent ? 'text-brand-text hover:bg-brand-soft' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        {children}
      </motion.button>
    </Hint>
  )
}

/** Floats right above the selection so every action is one short move away (Fitts). */
export function SelectionToolbar({ box, actions }: { box: DOMRect; actions: Actions }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const lang = useStore((s) => s.settings.translateTo)

  // Selecting text is a strong hint a translation may follow; warm the thread now.
  useEffect(() => prewarmTranslator(), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let top = box.top - h - 10
    const below = top < 60
    if (below) top = box.bottom + 10
    setPos({ left: Math.min(Math.max(8, box.left + box.width / 2 - w / 2), innerWidth - w - 8), top, below })
  }, [box])

  return (
    <motion.div
      ref={ref}
      className="sel-toolbar fixed z-[60] flex items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-xl shadow-black/10"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      initial={{ opacity: 0, scale: 0.94, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1 px-1">
        {COLORS.map((c, i) => (
          <Hint key={c} label={i === 0 ? 'Resaltar' : `Resaltar en ${COLOR_LABELS[c]}`} keys={i === 0 ? ['H'] : undefined} side="top">
            <motion.button
              aria-label={`Resaltar en ${COLOR_LABELS[c]}`}
              whileHover={{ scale: 1.18 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 600, damping: 20 }}
              onClick={() => actions.highlight(c)}
              className="size-[18px] rounded-full border-2 border-popover ring-1 ring-foreground/10"
              style={{ background: COLOR_VAR[c] }}
            />
          </Hint>
        ))}
      </div>
      <Separator orientation="vertical" className="mx-1 !h-4" />
      <ToolButton label="Resaltar con comentario" onClick={actions.comment}>
        <MessageSquareText />
      </ToolButton>
      <ToolButton label="Agregar la cita textual a una nota" keys={['N']} onClick={actions.toNote}>
        <NotebookPen /> Nota
      </ToolButton>
      <ToolButton label={`Traducir a ${langShort(lang)}`} keys={['T']} onClick={actions.translate}>
        <Languages /> Traducir
      </ToolButton>
      <ToolButton label="Explicar esto" keys={['E']} onClick={actions.explain}>
        <Lightbulb /> Explicar
      </ToolButton>
      <ToolButton label="Preguntar al asistente" keys={['A']} onClick={actions.ask} accent>
        <Sparkles /> Preguntar
      </ToolButton>
      <ToolButton label="Copiar" onClick={actions.copy}>
        <Copy />
      </ToolButton>
    </motion.div>
  )
}

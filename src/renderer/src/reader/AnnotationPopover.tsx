import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Copy, NotebookPen, Sparkles, Trash2 } from 'lucide-react'
import type { HighlightColor } from '@shared/types'
import { askAssistant, deleteAnnotation, saveAnnotation, useStore } from '../store'
import { COLORS, COLOR_VAR } from './SelectionToolbar'
import { addQuoteToNote } from '../editor/noteBridge'
import { inText } from '../lib/citation'
import { copyText } from '../lib/exporting'
import { ColorSelector, ColorSelectorItem, ColorSelectorList } from '@/components/motion/color-selector'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { IconButton } from '../components/common'
import { HighlightText } from './HighlightText'

export function AnnotationPopover({
  annotationId,
  x,
  y,
  focusComment,
  onClose
}: {
  annotationId: string
  x: number
  y: number
  focusComment?: boolean
  onClose: () => void
}) {
  const a = useStore((s) => s.annotations[annotationId])
  const paper = useStore((s) => (a ? s.papers[a.paperId] : undefined))
  const style = useStore((s) => s.settings.citationStyle)
  const [comment, setComment] = useState(a?.comment ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y + 12, above: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const above = y + 14 + h > innerHeight
    setPos({ left: Math.min(Math.max(8, x - w / 2), innerWidth - w - 8), top: above ? y - h - 14 : y + 14, above })
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element
      // Radix tooltips render in a portal; treat them as part of the popover.
      if (!ref.current?.contains(t) && !t.closest?.('[data-slot=tooltip-content]')) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  // Persist the comment when leaving.
  const latest = useRef(comment)
  latest.current = comment
  useEffect(
    () => () => {
      const cur = useStore.getState().annotations[annotationId]
      const next = latest.current.trim() || undefined
      if (cur && cur.comment !== next) saveAnnotation({ ...cur, comment: next, updatedAt: Date.now() })
    },
    [annotationId]
  )

  if (!a) return null
  return (
    <motion.div
      ref={ref}
      className="ann-popover fixed z-[60] flex w-[300px] flex-col gap-2 rounded-xl border bg-popover p-2.5 shadow-xl shadow-black/10"
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.above ? 'bottom center' : 'top center' }}
      initial={{ opacity: 0, scale: 0.95, y: pos.above ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
    >
      <HighlightText a={a} clamp={false} className="max-h-44 overflow-y-auto px-1 pt-0.5" />
      <ColorSelector value={a.color} onValueChange={(c) => saveAnnotation({ ...a, color: c as HighlightColor, updatedAt: Date.now() })}>
        <ColorSelectorList className="gap-1.5 p-0.5">
          {COLORS.map((c) => (
            <ColorSelectorItem key={c} value={c} color={COLOR_VAR[c]} label={c} className="size-7 border-0 bg-transparent [&>span:last-child]:size-4" />
          ))}
        </ColorSelectorList>
      </ColorSelector>
      <Textarea
        placeholder="Add a comment…"
        value={comment}
        autoFocus={focusComment}
        className="min-h-14 resize-none text-[13px]"
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onClose()
        }}
      />
      <div className="-mx-1 -mb-1 flex items-center gap-0.5">
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => (addQuoteToNote(a.paperId, a.page, a.text, a.id), onClose())}>
          <NotebookPen /> Note
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-brand-text hover:bg-brand-soft hover:text-brand-text"
          onClick={() => {
            askAssistant({ chatId: `paper:${a.paperId}`, quote: { paperId: a.paperId, page: a.page, text: a.text } })
            onClose()
          }}
        >
          <Sparkles /> Ask
        </Button>
        <IconButton
          size="icon-xs"
          label="Copy quote with citation"
          onClick={() => paper && void copyText(`“${a.text}” ${inText(paper, style, a.page)}`, 'Quote copied with citation')}
        >
          <Copy />
        </IconButton>
        <span className="flex-1" />
        <IconButton size="icon-xs" label="Delete highlight" className="hover:text-destructive" onClick={() => (deleteAnnotation(a.id), onClose())}>
          <Trash2 />
        </IconButton>
      </div>
    </motion.div>
  )
}

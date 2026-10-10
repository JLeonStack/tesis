import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Copy, Highlighter, Languages, NotebookPen, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { IconButton } from '../components/common'
import { useStore } from '../store'
import { copyText } from '../lib/exporting'
import { translate, type TranslationState } from '../lib/translate'

const WIDTH = 400
const MIN_SPACE = 240

/**
 * Streams a translation of the selected passage right next to it, so the
 * reader's eyes never leave the page (proximity, Doherty threshold).
 */
export function TranslationCard({
  text,
  box,
  onClose,
  onHighlight,
  onToNote
}: {
  text: string
  box: DOMRect
  onClose: () => void
  onHighlight: (translation: string) => void
  onToNote: (translation: string) => void
}) {
  const lang = useStore((s) => s.settings.translateTo)
  const [state, setState] = useState<TranslationState>({ text: '', done: false })
  const [attempt, setAttempt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setState({ text: '', done: false })
    return translate(text, setState)
  }, [text, lang, attempt])

  // Below the selection when there's room, otherwise above it (growing upward).
  const [place] = useState(() => {
    const left = Math.min(Math.max(8, box.left + box.width / 2 - WIDTH / 2), innerWidth - WIDTH - 8)
    const below = innerHeight - box.bottom - 12
    return below >= MIN_SPACE || below >= box.top - 60
      ? { left, top: box.bottom + 10, maxHeight: below - 16, above: false }
      : { left, bottom: innerHeight - box.top + 10, maxHeight: box.top - 70, above: true }
  })

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element
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

  // Keep the newest streamed words in view for long passages.
  const body = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = body.current
    if (el && !state.done) el.scrollTop = el.scrollHeight
  }, [state.text, state.done])

  const ready = state.done && !state.error && !!state.text

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={`Translation to ${lang}`}
      className="tr-card fixed z-[60] flex flex-col overflow-hidden rounded-xl border bg-popover shadow-xl shadow-black/10"
      style={{
        width: WIDTH,
        left: place.left,
        top: place.top,
        bottom: place.bottom,
        maxHeight: Math.max(160, place.maxHeight),
        transformOrigin: place.above ? 'bottom center' : 'top center'
      }}
      initial={{ opacity: 0, scale: 0.96, y: place.above ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      onMouseDown={(e) => {
        // Keep the PDF selection visible while using the card, but let text inside be selectable.
        if (!(e.target as Element).closest('.tr-body')) e.preventDefault()
      }}
    >
      <div className="flex h-9 flex-none items-center gap-1.5 border-b pr-1 pl-3">
        <Languages className="size-3.5 text-brand-text" />
        <span className="text-xs font-semibold">{lang}</span>
        <span className="flex-1" />
        {state.done && (
          <IconButton size="icon-xs" label="Translate again" onClick={() => setAttempt((n) => n + 1)}>
            <RotateCcw />
          </IconButton>
        )}
        <IconButton size="icon-xs" label="Close" keys={['esc']} onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div ref={body} className="tr-body min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {state.error ? (
          <div className="flex flex-col items-start gap-2 text-[13px] text-muted-foreground">
            <p>{state.error}</p>
            {useStore.getState().account?.connected ? (
              <Button variant="outline" size="xs" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCcw /> Try again
              </Button>
            ) : (
              <Button variant="outline" size="xs" onClick={() => (onClose(), useStore.setState({ settingsOpen: true }))}>
                Open Settings
              </Button>
            )}
          </div>
        ) : state.text ? (
          <p className="font-serif text-[14.5px] leading-relaxed whitespace-pre-wrap select-text">
            {state.text}
            {!state.done && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-primary" />}
          </p>
        ) : (
          <div className="flex flex-col gap-2 py-0.5">
            <TextShimmer duration={1.6} className="text-xs font-medium">
              Translating…
            </TextShimmer>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[70%]" />
          </div>
        )}
      </div>

      <motion.div
        className="flex flex-none items-center gap-1 border-t bg-muted/40 px-2 py-1.5"
        animate={{ opacity: ready ? 1 : 0.5 }}
      >
        <Button variant="ghost" size="xs" disabled={!ready} onClick={() => onToNote(state.text)}>
          <NotebookPen /> Add to note
        </Button>
        <Button variant="ghost" size="xs" disabled={!ready} onClick={() => onHighlight(state.text)}>
          <Highlighter /> Save on highlight
        </Button>
        <span className="flex-1" />
        <IconButton size="icon-xs" label="Copy translation" disabled={!ready} onClick={() => void copyText(state.text, 'Translation copied')}>
          <Copy />
        </IconButton>
      </motion.div>
    </motion.div>
  )
}

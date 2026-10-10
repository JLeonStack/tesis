import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Highlighter, NotebookPen, Copy, Trash2, FileOutput, MessageSquareText } from 'lucide-react'
import type { HighlightColor } from '@shared/types'
import { createNote, deleteAnnotation, jumpTo, useStore } from '../store'
import { COLORS, COLOR_VAR } from '../reader/SelectionToolbar'
import { addQuoteToNote, autoQuote } from '../editor/noteBridge'
import { copyText } from '../lib/exporting'
import { inText } from '../lib/citation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ColorSelector, ColorSelectorItem, ColorSelectorList } from '@/components/motion/color-selector'
import { EmptyState, Hint, IconButton } from '../components/common'
import { Collapsible } from '../components/Collapsible'
import { HighlightText } from '../reader/HighlightText'
import type { Annotation } from '@shared/types'

const ALL = 'conic-gradient(var(--hl-yellow-solid), var(--hl-green-solid), var(--hl-blue-solid), var(--hl-purple-solid), var(--hl-pink-solid), var(--hl-yellow-solid))'

export function HighlightsPanel({ paperId }: { paperId: string }) {
  const annotations = useStore((s) => s.annotations)
  const paper = useStore((s) => s.papers[paperId])
  const style = useStore((s) => s.settings.citationStyle)
  const selected = useStore((s) => s.selectedAnnotation)
  const [color, setColor] = useState<HighlightColor | 'all'>('all')

  const all = useMemo(() => Object.values(annotations).filter((a) => a.paperId === paperId), [annotations, paperId])
  const list = useMemo(
    () =>
      all
        .filter((a) => color === 'all' || a.color === color)
        .sort((a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0)),
    [all, color]
  )

  if (!all.length) {
    return <EmptyState icon={<Highlighter />} title="No highlights yet" description="Select text in the paper and pick a color, or press H." />
  }

  const exportToNote = () => {
    // Every quote starts translating now (one batch); each fills in when ready.
    const quotes = list.map((a) => ({ a, q: autoQuote(a.paperId, a.page, a.text, a.id) }))
    const content = quotes.flatMap(({ a, q }) => [
      ...q.content,
      ...(a.comment ? [{ type: 'paragraph', content: [{ type: 'text', text: a.comment }] }] : [])
    ])
    const note = createNote({
      title: `Highlights: ${paper?.title ?? ''}`,
      paperIds: [paperId],
      content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key passages' }] }, ...content] }
    })
    for (const { q } of quotes) q.bind(note.id)
  }

  // Chunking: highlights grouped by page; each page folds (⌥-click folds them all).
  const pages: [number, Annotation[]][] = []
  for (const a of list) {
    const last = pages[pages.length - 1]
    if (last && last[0] === a.page) last[1].push(a)
    else pages.push([a.page, [a]])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ColorSelector value={color} onValueChange={(v) => setColor(v as HighlightColor | 'all')}>
          <ColorSelectorList className="gap-0.5 p-0">
            <ColorSelectorItem value="all" color={ALL} ringColor="color-mix(in oklab, var(--foreground) 35%, transparent)" label="All colors" className="size-7 border-0 bg-transparent [&>span:last-child]:size-3.5" />
            {COLORS.map((c) => (
              <ColorSelectorItem key={c} value={c} color={COLOR_VAR[c]} label={`Only ${c}`} className="size-7 border-0 bg-transparent [&>span:last-child]:size-3.5" />
            ))}
          </ColorSelectorList>
        </ColorSelector>
        <span className="flex-1" />
        <Hint label="Create a note with every highlight, cited">
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={exportToNote}>
            <FileOutput /> To note
          </Button>
        </Hint>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-5">
        {pages.map(([page, items], gi) => (
          <Collapsible
            key={page}
            local
            group={`highlights:${paperId}`}
            title={`Page ${page}`}
            count={items.length}
            summary={(items[0].translation ?? items[0].text).slice(0, 60)}
            headerClassName="px-1 pt-2"
          >
            {items.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(gi + i, 12) * 0.02, type: 'spring', stiffness: 420, damping: 34 }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => jumpTo(a.paperId, a.page, a.id)}
                onKeyDown={(e) => e.key === 'Enter' && jumpTo(a.paperId, a.page, a.id)}
                className={cn('group flex gap-2.5 rounded-lg p-2.5 transition-colors outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40', selected === a.id && 'bg-accent')}
              >
                <span className="w-[3px] flex-none rounded-full" style={{ background: COLOR_VAR[a.color] }} />
                <div className="min-w-0 flex-1">
                  <HighlightText a={a} />
                  {a.comment && (
                    <p className="mt-1.5 flex gap-1.5 text-[12.5px] text-muted-foreground">
                      <MessageSquareText className="mt-0.5 size-3 flex-none" /> {a.comment}
                    </p>
                  )}
                  <div className="-mb-1 -ml-1.5 flex gap-0.5 pt-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="icon-xs" label="Add to note" onClick={() => addQuoteToNote(a.paperId, a.page, a.text, a.id)}>
                      <NotebookPen />
                    </IconButton>
                    <IconButton
                      size="icon-xs"
                      label="Copy with citation"
                      onClick={() => paper && void copyText(`“${a.text}” ${inText(paper, style, a.page)}`, 'Quote copied with citation')}
                    >
                      <Copy />
                    </IconButton>
                    <IconButton size="icon-xs" label="Delete" className="hover:text-destructive" onClick={() => deleteAnnotation(a.id)}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
              </div>
            </motion.div>
            ))}
          </Collapsible>
        ))}
      </div>
    </div>
  )
}

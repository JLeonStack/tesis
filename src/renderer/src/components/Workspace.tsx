import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { tabKey, useStore, type Tab } from '../store'
import { PdfReader } from '../reader/PdfReader'
import { NoteEditor } from '../editor/NoteEditor'
import { ThesisEditor } from '../thesis/ThesisEditor'
import { Whiteboard } from '../board/Whiteboard'
import { LiteratureMatrix } from '../matrix/LiteratureMatrix'
import { Home } from './Home'
import { Resizer } from './Resizer'
import { clamp } from '../lib/util'
import { cn } from '@/lib/utils'

const KEEP_ALIVE = 4

/**
 * Keeps the most recent tabs mounted (invisible) so switching back is instant:
 * no re-parsing, scroll position and undo history preserved.
 */
export function Workspace() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const sideNoteId = useStore((s) => s.sideNoteId)
  const splitRatio = useStore((s) => s.splitRatio)
  const [recent, setRecent] = useState<string[]>([])
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    setRecent((r) => [active, ...r.filter((k) => k !== active)].slice(0, KEEP_ALIVE))
  }, [active])

  // Stable DOM order (the tab bar's): reordering would move nodes, and a moved
  // <webview> (the whiteboard) reloads.
  const mounted = tabs.map(tabKey).filter((k) => recent.includes(k))
  const byKey = new Map(tabs.map((t) => [tabKey(t), t]))
  const activeTab = active ? byKey.get(active) : undefined
  const showSide = activeTab?.kind === 'paper' && !!sideNoteId && sideNoteId !== activeTab.id

  if (!activeTab) return <Home />

  return (
    <div className="flex min-h-0 flex-1" ref={hostRef}>
      <div
        className="relative flex min-h-0 min-w-0 flex-[1_1_0] flex-col overflow-hidden"
        style={showSide ? { flex: `0 0 ${splitRatio * 100}%` } : undefined}>
        {mounted.map((key) => {
          const t = byKey.get(key) as Tab
          return (
            // Background tabs stay laid out (invisible, inert) rather than display:none,
            // which would throw away their scroll position and size.
            <div
              key={key}
              className={cn('flex min-h-0 flex-col', key === active ? 'flex-1' : 'invisible absolute inset-0')}
              inert={key !== active}
            >
              {t.kind === 'paper' ? (
                <PdfReader paperId={t.id} active={key === active} />
              ) : t.kind === 'thesis' ? (
                <ThesisEditor thesisId={t.id} />
              ) : t.kind === 'board' ? (
                <Whiteboard active={key === active} />
              ) : t.kind === 'matrix' ? (
                <LiteratureMatrix />
              ) : (
                <NoteEditor noteId={t.id} />
              )}
            </div>
          )
        })}
      </div>
      {showSide && (
        <>
          <Resizer
            onResize={(dx) => {
              const w = hostRef.current?.clientWidth ?? 1000
              useStore.setState((s) => ({ splitRatio: clamp(s.splitRatio + dx / w, 0.3, 0.75) }))
            }}
          />
          <motion.div
            key={sideNoteId}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="relative flex min-h-0 min-w-[300px] flex-[1_1_0] flex-col overflow-hidden border-l bg-card"
          >
            <NoteEditor noteId={sideNoteId!} side />
          </motion.div>
        </>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { PageText } from '@shared/types'
import { getPaperText } from '../lib/ingest'
import { fold } from '../lib/util'
import { IconButton } from '../components/common'

interface Hit {
  page: number
  snippet: [string, string, string]
}

export function FindBar({ paperId, onClose, onGo }: { paperId: string; onClose: () => void; onGo: (page: number) => void }) {
  const [q, setQ] = useState('')
  const [pages, setPages] = useState<PageText[] | null>(null)
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getPaperText(paperId).then(setPages)
    input.current?.focus()
  }, [paperId])

  const hits = useMemo<Hit[]>(() => {
    const needle = fold(q.trim())
    if (needle.length < 2 || !pages) return []
    const out: Hit[] = []
    for (const p of pages) {
      const hay = fold(p.text)
      let from = 0
      let idx: number
      while ((idx = hay.indexOf(needle, from)) >= 0 && out.length < 500) {
        const t = p.text
        out.push({
          page: p.page,
          snippet: [
            t.slice(Math.max(0, idx - 40), idx).replace(/\s+/g, ' '),
            t.slice(idx, idx + needle.length),
            t.slice(idx + needle.length, idx + needle.length + 60).replace(/\s+/g, ' ')
          ]
        })
        from = idx + needle.length
      }
    }
    return out
  }, [q, pages])

  useEffect(() => setI(0), [q])
  useEffect(() => {
    if (hits[i]) onGo(hits[i].page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, hits])

  const step = (d: number) => hits.length && setI((v) => (v + d + hits.length) % hits.length)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 480, damping: 34 }}
      className="absolute top-12 right-4 z-30 w-[380px] rounded-xl border bg-popover p-1.5 shadow-xl shadow-black/10"
    >
      <div className="flex items-center gap-0.5">
        <Search className="mx-1.5 size-4 text-faint" />
        <input
          ref={input}
          value={q}
          placeholder={pages ? 'Buscar en el paper' : 'Preparando el texto…'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') onClose()
          }}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <span className="px-1.5 text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">
          {q.trim().length >= 2 ? (hits.length ? `${i + 1} / ${hits.length}` : 'Sin resultados') : ''}
        </span>
        <IconButton size="icon-xs" label="Anterior" keys={['⇧', '↩']} onClick={() => step(-1)}>
          <ChevronUp />
        </IconButton>
        <IconButton size="icon-xs" label="Siguiente" keys={['↩']} onClick={() => step(1)}>
          <ChevronDown />
        </IconButton>
        <IconButton size="icon-xs" label="Cerrar" keys={['esc']} onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {hits[i] && (
        <div className="mt-1.5 border-t px-2 pt-1.5 pb-0.5 text-xs text-muted-foreground">
          <span className="mr-1.5 font-semibold text-foreground">p. {hits[i].page}</span>…{hits[i].snippet[0]}
          <mark className="rounded-sm bg-[var(--hl-yellow)] text-foreground">{hits[i].snippet[1]}</mark>
          {hits[i].snippet[2]}…
        </div>
      )}
    </motion.div>
  )
}

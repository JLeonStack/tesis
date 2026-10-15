import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Minus, Plus, Search, MoonStar, Sparkles, ArrowLeftRight, ScanText, Loader2, BookMarked, Eye, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Hint, IconButton } from '../components/common'
import type { Annotation, HighlightColor, Rect, SkimSentence } from '@shared/types'
import { hasPrintedPages, printedPage } from '../lib/pages'
import { acquirePdf, releasePdf, type PDFDocumentProxy } from '../lib/pdf'
import { askAssistant, jumpToSentence, openTab, patchPaper, saveAnnotation, toast, useStore } from '../store'
import { PdfPage } from './PdfPage'
import { readSelection, pointInRects, type PageSelection } from './selection'
import { SelectionToolbar } from './SelectionToolbar'
import { AnnotationPopover } from './AnnotationPopover'
import { FindBar } from './FindBar'
import { TranslationCard } from './TranslationCard'
import { SkimBar } from './SkimBar'
import { MarkCard } from './MarkCard'
import { usePageMarks } from './usePageMarks'
import type { PageMark } from '../lib/marks'
import { buildGuide } from '../lib/guide'
import { locateAll } from '../lib/locate'
import { clamp, mod, uid } from '../lib/util'
import { addQuoteToNote } from '../editor/noteBridge'
import { explainPrompt } from '../lib/prompts'

const GAP = 16 // px between pages
const PAD_TOP = 20
const MAX_FIT_WIDTH = 980
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

interface Size {
  w: number
  h: number
}

export function PdfReader({ paperId, active }: { paperId: string; active: boolean }) {
  const paper = useStore((s) => s.papers[paperId])
  const allAnnotations = useStore((s) => s.annotations)
  const selectedAnnotation = useStore((s) => s.selectedAnnotation)
  const jump = useStore((s) => (s.jump?.paperId === paperId ? s.jump : null))

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sizes, setSizes] = useState<Size[]>([])
  const [containerW, setContainerW] = useState(0)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]))
  const [page, setPage] = useState(paper?.lastPage ?? 1)
  const [selection, setSelection] = useState<PageSelection | null>(null)
  const [popover, setPopover] = useState<{ id: string; x: number; y: number; focusComment?: boolean } | null>(null)
  const [translation, setTranslation] = useState<PageSelection | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [night, setNight] = useState(() => localStorage.getItem('night-reading') === '1')
  const [flashId, setFlashId] = useState<string | null>(null)
  const guide = useStore((s) => s.guides[paperId])
  const guiding = useStore((s) => !!s.guiding[paperId])
  const skimOn = useStore((s) => s.skim)
  const skimFacets = useStore((s) => s.skimFacets)
  const [skimPos, setSkimPos] = useState<number | null>(null)
  const marksOn = useStore((s) => s.marks)
  const hidden = useStore((s) => s.recallFor?.paperId === paperId && s.recallFor.hidePaper)
  const [hot, setHot] = useState<{ mark: PageMark; box: DOMRect } | null>(null)

  const scroller = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const anchor = useRef<{ page: number; frac: number } | null>(null)

  // ---------- load document ----------
  useEffect(() => {
    if (!paper) return
    let alive = true
    acquirePdf(paper)
      .then(async (d) => {
        if (!alive) return
        const first = (await d.getPage(1)).getViewport({ scale: 1 })
        setSizes(Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height })))
        setDoc(d)
        if (!paper.pageCount) patchPaper(paper.id, { pageCount: d.numPages })
        // Refine per-page sizes in the background (mixed page sizes are rare).
        const real: Size[] = []
        for (let i = 1; i <= d.numPages && alive; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 })
          real.push({ w: vp.width, h: vp.height })
          if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0))
        }
        if (alive && real.some((s) => s.w !== first.width || s.h !== first.height)) setSizes(real)
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
      releasePdf(paperId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])

  // ---------- layout ----------
  // Width only matters while the tab is shown: a background tab skips resizes
  // (e.g. the whiteboard hiding the side panel) and catches up when it returns.
  const activeRef = useRef(active)
  activeRef.current = active
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => activeRef.current && el.clientWidth && setContainerW(el.clientWidth)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (active && scroller.current?.clientWidth) setContainerW(scroller.current.clientWidth)
  }, [active])

  const maxW = useMemo(() => sizes.reduce((m, s) => Math.max(m, s.w), 0) || 612, [sizes])
  const fitScale = containerW ? Math.min(containerW - 48, MAX_FIT_WIDTH) / maxW : 1
  const scale = zoom === 'fit' ? fitScale : zoom

  const tops = useMemo(() => {
    const t: number[] = []
    let y = PAD_TOP
    for (const s of sizes) {
      t.push(y)
      y += s.h * scale + GAP
    }
    t.push(y)
    return t
  }, [sizes, scale])

  const pageAt = useCallback(
    (y: number) => {
      let lo = 0
      let hi = sizes.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (tops[mid] <= y) lo = mid
        else hi = mid - 1
      }
      return lo + 1
    },
    [tops, sizes.length]
  )

  const scrollToPage = useCallback(
    (n: number, yFrac = 0, smooth = false) => {
      const el = scroller.current
      if (!el || !sizes.length) return
      const i = clamp(n, 1, sizes.length) - 1
      const top = tops[i] + yFrac * sizes[i].h * scale - (yFrac ? el.clientHeight * 0.3 : PAD_TOP / 2)
      el.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
    },
    [tops, sizes, scale]
  )

  // Restore last position once the layout is known.
  useLayoutEffect(() => {
    if (restored.current || !doc || !containerW || !sizes.length) return
    restored.current = true
    if ((paper?.lastPage ?? 1) > 1) scrollToPage(paper!.lastPage!)
  }, [doc, containerW, sizes.length, paper, scrollToPage])

  // Keep the reading position stable while zooming or resizing (the anchor follows every scroll).
  useLayoutEffect(() => {
    const a = anchor.current
    const el = scroller.current
    if (!a || !el || !sizes.length) return
    const i = a.page - 1
    el.scrollTop = tops[i] + a.frac * (sizes[i].h * scale + GAP) - el.clientHeight / 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  const rememberAnchor = () => {
    const el = scroller.current
    if (!el || !sizes.length) return
    const mid = el.scrollTop + el.clientHeight / 2
    const p = pageAt(mid)
    anchor.current = { page: p, frac: (mid - tops[p - 1]) / (sizes[p - 1].h * scale + GAP) }
  }

  // ---------- visibility & progress ----------
  const saveProgress = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onScroll = useCallback(() => {
    const el = scroller.current
    // Not laid out (never shown yet): nothing to measure, and no progress to save.
    if (!el || !sizes.length || !el.clientHeight) return
    const top = el.scrollTop
    const bottom = top + el.clientHeight
    const margin = el.clientHeight * 1.2
    const first = pageAt(top - margin)
    const last = pageAt(bottom + margin)
    setVisible((prev) => {
      if (prev.size === last - first + 1 && prev.has(first) && prev.has(last)) return prev
      const next = new Set<number>()
      for (let i = first; i <= last; i++) next.add(i)
      return next
    })
    const current = pageAt(top + el.clientHeight * 0.35)
    setPage(current)
    const mid = top + el.clientHeight / 2
    const at = pageAt(mid)
    anchor.current = { page: at, frac: (mid - tops[at - 1]) / (sizes[at - 1].h * scale + GAP) }
    clearTimeout(saveProgress.current)
    saveProgress.current = setTimeout(() => {
      const p = useStore.getState().papers[paperId]
      if (!p) return
      const maxPage = Math.max(p.maxPage ?? 0, current)
      const status = maxPage >= sizes.length ? 'read' : current > 1 && p.status === 'unread' ? 'reading' : p.status
      if (p.lastPage !== current || p.maxPage !== maxPage || p.status !== status)
        patchPaper(paperId, { lastPage: current, maxPage, status })
    }, 800)
  }, [pageAt, sizes, tops, scale, paperId])

  useEffect(() => {
    onScroll()
  }, [onScroll, scale])

  // ---------- jumps from highlights, assistant citations, search ----------
  const handledJump = useRef(0)
  useEffect(() => {
    // Once per jump: zooming re-creates scrollToPage and must not scroll back here.
    if (!jump || !doc || !sizes.length || handledJump.current === jump.nonce) return
    handledJump.current = jump.nonce
    const s = useStore.getState()
    const a = jump.annotationId ? s.annotations[jump.annotationId] : null
    const sentence = jump.sentenceId ? s.guides[paperId]?.sentences.find((x) => x.id === jump.sentenceId) : null
    const target = a ?? sentence
    scrollToPage(jump.page, target ? target.rects[0]?.y ?? 0 : 0, false)
    if (sentence) setSkimPos(indexOrNull(skimList, sentence.id))
    if (target) flash(target.id)
    // A quote backing the thesis: find it in the page's text and mark it for a few seconds.
    if (jump.quote && !target) {
      const nonce = jump.nonce
      void locateAll(doc, [{ page: jump.page, text: jump.quote }]).then(([found]) => {
        if (!found || handledJump.current !== nonce) return
        const id = `quote:${nonce}`
        setQuoteMark({ id, facet: 'finding', page: found.page, text: jump.quote!, rects: found.rects })
        scrollToPage(found.page, found.rects[0]?.y ?? 0, false)
        flash(id)
        clearTimeout(quoteTimer.current)
        quoteTimer.current = setTimeout(() => setQuoteMark(null), 8000)
      })
    }
  }, [jump, doc, sizes.length, scrollToPage])
  const [quoteMark, setQuoteMark] = useState<SkimSentence | null>(null)
  const quoteTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(quoteTimer.current), [])

  // ---------- zoom ----------
  const setZoomKeep = useCallback(
    (z: number | 'fit') => {
      rememberAnchor()
      setZoom(z)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tops, sizes, scale]
  )
  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const cur = scale
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01)
      if (next) setZoomKeep(next)
    },
    [scale, setZoomKeep]
  )

  // Trackpad pinch (ctrl+wheel) zoom.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      rememberAnchor()
      setZoom((z) => clamp((z === 'fit' ? fitScale : z) * Math.exp(-e.deltaY * 0.01), 0.4, 4))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitScale, tops, sizes, scale])

  // Skim mode needs a reading guide; the first toggle builds one.
  const toggleSkim = useCallback(() => {
    const s = useStore.getState()
    if (s.guides[paperId]) return useStore.setState({ skim: !s.skim })
    // No guide yet: build it, and show the marks as soon as it lands.
    useStore.setState({ skim: true, rightOpen: true, rightTab: 'guide' })
    void buildGuide(paperId)
  }, [paperId])

  // Menu commands (only the active reader responds).
  useEffect(() => {
    if (!active) return
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail
      if (cmd === 'zoom-in') zoomBy(1)
      else if (cmd === 'zoom-out') zoomBy(-1)
      else if (cmd === 'zoom-fit') setZoomKeep('fit')
      else if (cmd === 'find') setFindOpen(true)
      else if (cmd === 'skim') toggleSkim()
    }
    window.addEventListener('reader-command', onCmd)
    return () => window.removeEventListener('reader-command', onCmd)
  }, [active, zoomBy, setZoomKeep, toggleSkim])

  // ---------- selection & highlights ----------
  const annotationsByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>()
    for (const a of Object.values(allAnnotations)) {
      if (a.paperId !== paperId) continue
      const arr = m.get(a.page) ?? []
      arr.push(a)
      m.set(a.page, arr)
    }
    return m
  }, [allAnnotations, paperId])

  // ---------- skim mode (reading guide) ----------
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flash = (id: string) => {
    setFlashId(id)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashId(null), 1600)
  }
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const skimVisible = skimOn && !!guide
  /** Marked sentences in reading order (the ones J / K step through). */
  const skimList = useMemo(
    () => (skimVisible ? guide!.sentences.filter((s) => s.rects.length && skimFacets.includes(s.facet)) : EMPTY_SKIM),
    [skimVisible, guide, skimFacets]
  )
  const skimByPage = useMemo(() => {
    const m = new Map<number, SkimSentence[]>()
    const add = (s: SkimSentence) => m.set(s.page, [...(m.get(s.page) ?? []), s])
    for (const s of skimList) add(s)
    // A sentence opened from the guide panel shows (and flashes) even when skim mode is off.
    const flashing = !skimList.some((s) => s.id === flashId) && guide?.sentences.find((s) => s.id === flashId && s.rects.length)
    if (flashing) add(flashing)
    if (quoteMark) add(quoteMark)
    return m
  }, [skimList, guide, flashId, quoteMark])

  // ---------- reading marks: key terms and library citations ----------
  const marksByPage = usePageMarks(doc, paperId, visible)

  const markAt = (e: { clientX: number; clientY: number; target: EventTarget | null }) => {
    const pageEl = (e.target as Element | null)?.closest<HTMLElement>('.pdf-page')
    if (!pageEl) return null
    const r = pageEl.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const mark = (marksByPage.get(Number(pageEl.dataset.page)) ?? []).find((m) => pointInRects(x, y, m.rects))
    return mark ? { mark, box: clientBox(r, mark.rects) } : null
  }
  const hoverFrame = useRef(0)
  const onMouseMove = (e: React.MouseEvent) => {
    const ev = { clientX: e.clientX, clientY: e.clientY, target: e.target, buttons: e.buttons }
    cancelAnimationFrame(hoverFrame.current)
    hoverFrame.current = requestAnimationFrame(() => {
      // Not while dragging out a selection, nor over a selection's toolbar.
      const next = ev.buttons || selection ? null : markAt(ev)
      setHot((h) => (h?.mark.id === next?.mark.id ? h : next))
    })
  }
  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), [])
  useEffect(() => setHot(null), [marksByPage, active])
  // Citations open their paper; terms jump to the paper's definition, when it gives one.
  const hotTerm = hot?.mark.kind === 'term' ? guide?.terms[hot.mark.term] : undefined
  const hotClickable = hot?.mark.kind === 'cite' || (!!hotTerm?.sentenceId && !!guide?.sentences.some((s) => s.id === hotTerm.sentenceId && s.rects.length))

  const stepSkim = (dir: 1 | -1) => {
    const list = skimList
    if (!list.length) return
    const cur = skimPos != null ? list[skimPos] : undefined
    let next: number
    // Keep walking from the last sentence unless the reader has scrolled away from it.
    if (cur && Math.abs(cur.page - page) <= 1) next = skimPos! + dir
    else if (dir > 0) {
      const j = list.findIndex((s) => s.page >= page)
      next = j < 0 ? list.length - 1 : j
    } else {
      const j = list.findLastIndex((s) => s.page <= page)
      next = j < 0 ? 0 : j
    }
    next = clamp(next, 0, list.length - 1)
    const s = list[next]
    setSkimPos(next)
    scrollToPage(s.page, s.rects[0]?.y ?? 0, true)
    flash(s.id)
  }

  // Listen for the release on window: drags often end outside the reader
  // (over the side note or the assistant), and the selection still counts.
  const onMouseUpRef = useRef<(e: MouseEvent) => void>(() => {})
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    window.addEventListener('mouseup', (ev) => onMouseUpRef.current(ev), { once: true, capture: true })
  }
  onMouseUpRef.current = (e: MouseEvent) => {
    if ((e.target as Element).closest('.sel-toolbar, .ann-popover, .tr-card')) return
    // Let the browser finalize the selection first.
    requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      const sel = readSelection(el)
      if (sel) {
        setPopover(null)
        setSelection(sel)
        return
      }
      setSelection(null)
      // A plain click: did it land on a highlight?
      const pageEl = (e.target as Element).closest<HTMLElement>('.pdf-page')
      if (!pageEl) return setPopover(null)
      const r = pageEl.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      const n = Number(pageEl.dataset.page)
      const hit = (annotationsByPage.get(n) ?? []).find((a) => pointInRects(x, y, a.rects))
      const mark = hit ? null : (marksByPage.get(n) ?? []).find((m) => pointInRects(x, y, m.rects))
      const defId = mark?.kind === 'term' ? guide?.terms[mark.term]?.sentenceId : undefined
      const definition = defId ? guide?.sentences.find((s) => s.id === defId && s.rects.length) : undefined
      const sentence = hit || mark?.kind === 'cite' || definition ? null : (skimByPage.get(n) ?? []).find((s) => pointInRects(x, y, s.rects))
      if (mark?.kind === 'cite') {
        // A citation of a paper you have: open it.
        setPopover(null)
        setHot(null)
        openTab({ kind: 'paper', id: mark.paperId })
      } else if (definition) {
        // A key term: go to where the paper defines it.
        setPopover(null)
        setHot(null)
        jumpToSentence(paperId, definition)
      } else if (hit) {
        setPopover({ id: hit.id, x: e.clientX, y: e.clientY })
        useStore.setState({ selectedAnnotation: hit.id })
      } else if (sentence) {
        // A key sentence acts like a ready-made selection: highlight, note, explain, ask.
        setPopover(null)
        setSelection({ page: n, text: sentence.text, rects: sentence.rects, box: clientBox(r, sentence.rects) })
        setSkimPos(indexOrNull(skimList, sentence.id))
      } else {
        setPopover(null)
        if (useStore.getState().selectedAnnotation) useStore.setState({ selectedAnnotation: null })
      }
    })
  }

  const createHighlight = (color: HighlightColor, comment?: string, sel = selection, translation?: string): Annotation | null => {
    if (!sel) return null
    const now = Date.now()
    const a: Annotation = {
      id: uid(),
      paperId,
      page: sel.page,
      rects: sel.rects,
      text: sel.text,
      color,
      comment,
      translation,
      createdAt: now,
      updatedAt: now
    }
    saveAnnotation(a)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    return a
  }

  const closeTranslation = useCallback(() => setTranslation(null), [])

  const selectionActions = {
    highlight: (c: HighlightColor) => createHighlight(c),
    comment: () => {
      const a = createHighlight('yellow')
      if (a && selection) setPopover({ id: a.id, x: selection.box.left + selection.box.width / 2, y: selection.box.bottom, focusComment: true })
    },
    toNote: () => {
      if (!selection) return
      const a = createHighlight('blue')
      addQuoteToNote(paperId, selection.page, selection.text, a?.id)
    },
    ask: () => {
      if (!selection) return
      askAssistant({ chatId: `paper:${paperId}`, quote: { paperId, page: selection.page, text: selection.text } })
      window.getSelection()?.removeAllRanges()
      setSelection(null)
    },
    explain: () => {
      if (!selection) return
      askAssistant({ chatId: `paper:${paperId}`, prefill: explainPrompt(selection.text, selection.page), autoSend: true })
      window.getSelection()?.removeAllRanges()
      setSelection(null)
    },
    translate: () => {
      if (!selection) return
      // Keep the text visibly selected under the card; hide the toolbar.
      setTranslation(selection)
      setSelection(null)
    },
    copy: async () => {
      if (!selection) return
      await navigator.clipboard.writeText(selection.text)
      setSelection(null)
    }
  }

  // Keyboard shortcuts while a selection is active (Fitts: no pointer travel).
  useEffect(() => {
    if (!active || !selection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'h') selectionActions.highlight('yellow')
      else if (k === 'n') selectionActions.toNote()
      else if (k === 'a') selectionActions.ask()
      else if (k === 'e') selectionActions.explain()
      else if (k === 't') selectionActions.translate()
      else if (k === 'escape') {
        window.getSelection()?.removeAllRanges()
        setSelection(null)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Page keys when nothing is focused; J / K step through key sentences in skim mode.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') scrollToPage(page + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') scrollToPage(page - 1)
      else if (skimVisible && !selection && !e.altKey && (e.key === 'j' || e.key === 'k')) stepSkim(e.key === 'j' ? 1 : -1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!paper) return null
  const total = sizes.length
  const progress = total ? page / total : 0

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col bg-canvas', night && 'reader-night')}>
      <div className="relative flex h-10 flex-none items-center gap-3 border-b bg-background pr-2 pl-4">
        <motion.div
          className="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-primary/80"
          animate={{ scaleX: progress }}
          transition={{ type: 'spring', stiffness: 140, damping: 24 }}
        />
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-[550] text-muted-foreground" title={paper.title}>
          {paper.title}
        </div>
        <div className="flex items-center gap-0.5">
          <PageInput page={page} total={total} printed={hasPrintedPages(paper) ? printedPage(paper, page) : undefined} onGo={(n) => scrollToPage(n)} />
          <Separator orientation="vertical" className="mx-1.5 !h-4" />
          <IconButton label="Alejar" keys={[mod, '−']} onClick={() => zoomBy(-1)}>
            <Minus />
          </IconButton>
          <Hint label="Ajustar al ancho" keys={[mod, '0']}>
            <button
              onClick={() => setZoomKeep('fit')}
              className="h-7 min-w-11 rounded-md px-1.5 text-xs font-medium text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
            >
              {zoom === 'fit' ? 'Ancho' : `${Math.round(scale * 100)}%`}
            </button>
          </Hint>
          <IconButton label="Acercar" keys={[mod, '+']} onClick={() => zoomBy(1)}>
            <Plus />
          </IconButton>
          <Separator orientation="vertical" className="mx-1.5 !h-4" />
          <IconButton label="Buscar en el paper" keys={[mod, 'F']} active={findOpen} onClick={() => setFindOpen((v) => !v)}>
            <Search />
          </IconButton>
          <IconButton
            label={
              guiding
                ? 'Armando la guía de lectura…'
                : guide
                  ? 'Lectura rápida: oraciones clave marcadas por tipo'
                  : 'Lectura rápida: primero arma una guía de lectura'
            }
            keys={[mod, '⌥', 'S']}
            active={skimVisible}
            onClick={toggleSkim}
          >
            {guiding ? <Loader2 className="animate-spin" /> : <ScanText />}
          </IconButton>
          <IconButton
            label={marksOn ? 'Ocultar definiciones de términos y citas de la biblioteca' : 'Mostrar definiciones de términos y citas de la biblioteca'}
            active={marksOn}
            onClick={() => useStore.setState({ marks: !marksOn })}
          >
            <BookMarked />
          </IconButton>
          <IconButton
            label="Lectura nocturna"
            active={night}
            onClick={() =>
              setNight((v) => {
                localStorage.setItem('night-reading', v ? '0' : '1')
                return !v
              })
            }
          >
            <MoonStar />
          </IconButton>
          <Hint label="Preguntar al asistente" keys={[mod, 'J']}>
            <Button
              variant="ghost"
              size="sm"
              className="ml-1 h-7 gap-1.5 px-2.5 text-brand-text hover:bg-brand-soft hover:text-brand-text"
              onClick={() => useStore.setState({ rightOpen: true, rightTab: 'assistant' })}
            >
              <Sparkles className="size-3.5" /> Preguntar
            </Button>
          </Hint>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {skimVisible && (
          <SkimBar
            guide={guide!}
            position={skimPos != null && skimPos < skimList.length ? skimPos : null}
            total={skimList.length}
            onStep={stepSkim}
            onClose={() => useStore.setState({ skim: false })}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {findOpen && <FindBar paperId={paperId} onClose={() => setFindOpen(false)} onGo={(n) => scrollToPage(n)} />}
      </AnimatePresence>

      <div
        className={cn('relative min-h-0 flex-1 overflow-auto overscroll-contain', hotClickable && 'reader-marks-hot')}
        ref={scroller}
        onScroll={() => {
          onScroll()
          if (hot) setHot(null)
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={() => {
          cancelAnimationFrame(hoverFrame.current)
          setHot(null)
        }}
      >
        {error ? (
          <div className="grid h-full place-content-center gap-1.5 text-center text-muted-foreground">
            <strong className="text-foreground">No se pudo abrir este PDF.</strong>
            <span>{error}</span>
          </div>
        ) : !doc ? (
          <div className="flex flex-col items-center gap-4 pt-5">
            <Skeleton className="aspect-[8.5/11] w-[min(760px,calc(100%-48px))] rounded-[3px] bg-card/70" />
          </div>
        ) : (
          <div className="flex min-w-min flex-col items-center gap-4 px-6" style={{ paddingTop: PAD_TOP, height: tops[tops.length - 1] + PAD_TOP }}>
            {sizes.map((s, i) => (
              <PdfPage
                key={i}
                doc={doc}
                n={i + 1}
                width={Math.floor(s.w * scale)}
                height={Math.floor(s.h * scale)}
                scale={scale}
                render={visible.has(i + 1)}
                annotations={annotationsByPage.get(i + 1) ?? EMPTY}
                selectedId={selectedAnnotation}
                flashId={flashId}
                skim={skimByPage.get(i + 1) ?? EMPTY_SKIM}
                marks={marksByPage.get(i + 1) ?? EMPTY_MARKS}
                hotMark={hot?.mark.id ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {hidden && <RecallCover />}
      <AnimatePresence>{hot && active && !selection && !hidden && <MarkCard key={hot.mark.id} mark={hot.mark} box={hot.box} paperId={paperId} />}</AnimatePresence>
      <AnimatePresence>
        {selection && active && <SelectionToolbar key={`${selection.page}-${selection.text.length}`} box={selection.box} actions={selectionActions} />}
      </AnimatePresence>
      <AnimatePresence>
        {translation && active && (
          <TranslationCard
            key={`${translation.page}-${translation.box.top}-${translation.text.length}`}
            text={translation.text}
            box={translation.box}
            onClose={closeTranslation}
            onHighlight={(t) => {
              // A Spanish translation is the highlight's own; any other language goes in the comment.
              if (/^spanish/i.test(useStore.getState().settings.translateTo)) createHighlight('yellow', undefined, translation, t)
              else createHighlight('yellow', t, translation)
              setTranslation(null)
              toast('Traducción guardada en el resaltado')
            }}
            onToNote={(t) => {
              const a = createHighlight('blue', undefined, translation)
              addQuoteToNote(paperId, translation.page, translation.text, a?.id, t)
              setTranslation(null)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {popover && active && (
          <AnnotationPopover
            key={popover.id}
            annotationId={popover.id}
            x={popover.x}
            y={popover.y}
            focusComment={popover.focusComment}
            onClose={() => {
              setPopover(null)
              useStore.setState({ selectedAnnotation: null })
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {total > 0 && zoom !== 'fit' && scale * maxW > containerW && (
          <motion.button
            initial={{ opacity: 0, y: 8, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 8, x: '-50%' }}
            onClick={() => setZoomKeep('fit')}
            className="absolute bottom-4 left-1/2 flex h-7 items-center gap-1.5 rounded-full border bg-popover px-3 text-xs font-medium shadow-md"
          >
            <ArrowLeftRight className="size-3.5" /> Ajustar al ancho
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

const EMPTY: Annotation[] = []
const EMPTY_SKIM: SkimSentence[] = []
const EMPTY_MARKS: PageMark[] = []

/** During a recall check the paper is out of sight: answering from memory is the point. */
function RecallCover() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-x-0 top-10 bottom-0 z-20 grid place-items-center bg-canvas/70 backdrop-blur-xl"
    >
      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <Brain className="size-6 text-muted-foreground" />
        <strong className="text-[14px]">Respondé de memoria</strong>
        <span className="text-[12.5px] leading-snug text-muted-foreground">
          El paper queda oculto mientras respondés. Intentar recordar, aunque cueste, es lo que lo fija.
        </span>
        <Button
          variant="outline"
          size="sm"
          className="mt-1"
          onClick={() => useStore.setState((s) => ({ recallFor: s.recallFor && { ...s.recallFor, hidePaper: false } }))}
        >
          <Eye /> Ver el paper
        </Button>
      </div>
    </motion.div>
  )
}

const indexOrNull = (list: SkimSentence[], id: string) => {
  const i = list.findIndex((s) => s.id === id)
  return i < 0 ? null : i
}

/** Client-space box around page-relative rects, for anchoring the selection toolbar. */
function clientBox(page: DOMRect, rects: Rect[]): DOMRect {
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return new DOMRect(page.left + x0 * page.width, page.top + y0 * page.height, (x1 - x0) * page.width, (y1 - y0) * page.height)
}

function PageInput({ page, total, printed, onGo }: { page: number; total: number; printed?: number; onGo: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <input
        value={draft ?? String(page)}
        onFocus={(e) => {
          setDraft(String(page))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = Number(draft)
            if (n) onGo(n)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
        aria-label="Número de página"
        className="h-6 w-10 rounded-md border bg-card text-center text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
      <span>/ {total || '–'}</span>
      {printed != null && printed !== page && (
        <span className="text-faint" title="Página impresa del artículo: la que va en las citas">
          · p. {printed}
        </span>
      )}
    </span>
  )
}

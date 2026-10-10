import { memo, useEffect, useRef } from 'react'
import type { Annotation, SkimSentence } from '@shared/types'
import { pdfjs, type PDFDocumentProxy } from '../lib/pdf'
import type { PageMark } from '../lib/marks'

interface Props {
  doc: PDFDocumentProxy
  n: number
  width: number // CSS px at current scale
  height: number
  scale: number
  render: boolean
  annotations: Annotation[]
  selectedId: string | null
  flashId: string | null
  /** Key sentences from the reading guide (skim mode). */
  skim: SkimSentence[]
  /** Key terms and library citations on this page. */
  marks: PageMark[]
  hotMark: string | null
}

/**
 * One page: canvas (rendered only while near the viewport), a pdf.js text
 * layer for native selection, and a highlight layer underneath the text
 * (user highlights over skim-mode key sentences).
 */
export const PdfPage = memo(function PdfPage({ doc, n, width, height, scale, render, annotations, selectedId, flashId, skim, marks, hotMark }: Props) {
  const canvasHost = useRef<HTMLDivElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  const renderedScale = useRef(0)

  // Canvas: render into a fresh canvas, then swap, so zooming never flashes blank.
  useEffect(() => {
    const host = canvasHost.current
    if (!host) return
    if (!render) {
      host.replaceChildren()
      renderedScale.current = 0
      return
    }
    if (renderedScale.current === scale) return
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
    let cancelled = false
    void doc.getPage(n).then((page) => {
      if (cancelled) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const vp = page.getViewport({ scale: scale * dpr })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      task = page.render({ canvas, viewport: vp })
      task.promise.then(
        () => {
          if (cancelled) return
          host.replaceChildren(canvas)
          renderedScale.current = scale
        },
        () => {}
      )
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, n, scale, render])

  // Text layer: built once per scale while visible.
  useEffect(() => {
    const host = textHost.current
    if (!host || !render) return
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null
    let cancelled = false
    void doc.getPage(n).then((page) => {
      if (cancelled) return
      const div = document.createElement('div')
      div.className = 'textLayer'
      layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: div,
        viewport: page.getViewport({ scale })
      })
      layer.render().then(
        () => {
          if (cancelled) return
          const end = document.createElement('div')
          end.className = 'endOfContent'
          div.append(end)
          host.replaceChildren(div)
        },
        () => {}
      )
    })
    return () => {
      cancelled = true
      layer?.cancel()
    }
  }, [doc, n, scale, render])

  return (
    <div
      className="pdf-page"
      data-page={n}
      style={
        {
          width,
          height,
          '--scale-factor': scale,
          '--user-unit': 1,
          '--total-scale-factor': 'calc(var(--scale-factor) * var(--user-unit))',
          '--scale-round-x': '1px',
          '--scale-round-y': '1px'
        } as React.CSSProperties
      }
    >
      <div className="page-canvas" ref={canvasHost} />
      <div className="hl-layer">
        {marks.map((m) =>
          m.rects.map((r, i) => (
            <div
              key={`${m.id}-${i}`}
              className={`mark-${m.kind} ${m.kind === 'cite' && m.read ? 'read' : ''} ${m.id === hotMark ? 'hot' : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            />
          ))
        )}
        {skim.map((s) =>
          s.rects.map((r, i) => (
            <div
              key={`${s.id}-${i}`}
              className={`skim skim-${s.facet} ${s.id === flashId ? 'flash' : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            />
          ))
        )}
        {annotations.map((a) =>
          a.rects.map((r, i) => (
            <div
              key={`${a.id}-${i}`}
              className={`hl hl-${a.color} ${a.id === selectedId ? 'selected' : ''} ${a.id === flashId ? 'flash' : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            />
          ))
        )}
      </div>
      <div className="text-host" ref={textHost} />
      {annotations
        .filter((a) => a.comment)
        .map((a) => (
          <span key={`c-${a.id}`} className={`comment-mark hl-${a.color}`} style={{ top: `${(a.rects[0]?.y ?? 0) * 100}%` }} />
        ))}
      {!render && <div className="absolute inset-0 grid place-items-center text-3xl font-light text-neutral-300">{n}</div>}
    </div>
  )
})

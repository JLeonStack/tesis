import type { Rect } from '@shared/types'

export interface PageSelection {
  page: number
  text: string
  rects: Rect[]
  /** Bounding box in client coordinates, for positioning the toolbar. */
  box: DOMRect
}

/** Merge per-glyph-run rects into one rect per line. */
export function mergeLines(rects: Rect[]): Rect[] {
  const sorted = rects.slice().sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Rect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5
    if (sameLine && r.x <= last.x + last.w + 0.02) {
      const x = Math.min(last.x, r.x)
      const y = Math.min(last.y, r.y)
      last.w = Math.max(last.x + last.w, r.x + r.w) - x
      last.h = Math.max(last.y + last.h, r.y + r.h) - y
      last.x = x
      last.y = y
    } else out.push({ ...r })
  }
  return out
}

/**
 * Reads the current DOM selection inside the reader and converts it into
 * page-relative, normalized rects. Selections spanning pages are clipped to
 * the page where the selection starts.
 */
export function readSelection(root: HTMLElement): PageSelection | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as Element | null
  const pageEl = startEl?.closest<HTMLElement>('.pdf-page')
  if (!pageEl || !root.contains(pageEl)) return null
  const text = sel.toString().replace(/\s+\n/g, '\n').replace(/(\w)-\n(\w)/g, '$1$2').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const pr = pageEl.getBoundingClientRect()
  const raw: Rect[] = []
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue
    // Clip to this page.
    const top = Math.max(r.top, pr.top)
    const bottom = Math.min(r.bottom, pr.bottom)
    if (bottom - top < 1 || r.right < pr.left || r.left > pr.right) continue
    // Ignore the huge rects some browsers emit for whole text-layer divs.
    if (r.height > pr.height * 0.2) continue
    raw.push({
      x: (r.left - pr.left) / pr.width,
      y: (top - pr.top) / pr.height,
      w: r.width / pr.width,
      h: (bottom - top) / pr.height
    })
  }
  if (!raw.length) return null
  return { page: Number(pageEl.dataset.page), text, rects: mergeLines(raw), box: range.getBoundingClientRect() }
}

export function pointInRects(x: number, y: number, rects: Rect[], pad = 0.002): boolean {
  return rects.some((r) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad)
}

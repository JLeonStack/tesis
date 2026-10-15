import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// Each section is one tall sheet in the DOM; this cuts it into Letter pages
// the way Word shows them. When the text passes the bottom margin, a seam is
// drawn (bottom margin, the desk, the next page's top margin) and the rest
// flows onto the next page: paragraphs split between lines, headings move
// along with the line that follows, tables and figures move whole, and the
// rows of the reference list and the table of contents split too. Purely
// visual: the Word and PDF exports paginate on their own.

const PX_IN = 96
const SHEET_W = 8.5 * PX_IN
const PAGE_H = 11 * PX_IN
const MARGIN = PX_IN // 2.54 cm
const BODY_H = PAGE_H - 2 * MARGIN
/** The gap between sheets on the desk (.thesis-pages). */
const DESK_GAP = 28
const SEAM = 2 * MARGIN + DESK_GAP

/** Atom blocks drawn by the app whose rows can go on different pages. */
const ROWS = '.reference-list, .toc-block'

interface Gap {
  /** Doc position (decorations) or the row it goes before (inside an atom). */
  pos: number
  row?: HTMLElement
  inline: boolean
  filler: number
}

const key = new PluginKey<DecorationSet>('thesisPages')

function seamDOM(filler: number, inline: boolean): HTMLElement {
  const el = document.createElement(inline ? 'span' : 'div')
  el.className = 'page-gap'
  el.contentEditable = 'false'
  el.dataset.filler = String(filler)
  el.style.height = `${filler + SEAM}px`
  el.innerHTML = '<span class="page-seam"><span class="page-desk"></span></span>'
  return el
}

interface Line {
  /** Where the line starts in the DOM (posAtCoords only sees what's on screen; this works for any line). */
  node: Text
  offset: number
  mid: number
  /** Natural position of the line box, in CSS px from the top of the body. */
  top: number
}

/** The line boxes of a block, from the rects of its text. */
function lineBoxes(el: HTMLElement, natural: (y: number) => number, lineH: number, scale: number): Line[] {
  const lines: Omit<Line, 'top'>[] = []
  const tol = (lineH * scale) / 2
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  const charMid = (t: Text, o: number) => {
    range.setStart(t, o)
    range.setEnd(t, o + 1)
    const r = range.getClientRects()[0]
    return r ? (r.top + r.bottom) / 2 : -Infinity
  }
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (!t.data || t.parentElement?.closest('.page-gap')) continue
    range.selectNodeContents(t)
    const rects = [...range.getClientRects()].filter((r) => r.width)
    for (const [k, r] of rects.entries()) {
      const mid = (r.top + r.bottom) / 2
      if (lines.some((l) => Math.abs(l.mid - mid) < tol)) continue
      // The first character of this text node that sits on this line.
      let offset = 0
      if (k) {
        let lo = 0
        let hi = t.data.length - 1
        while (lo < hi) {
          const m = (lo + hi) >> 1
          if (charMid(t, m) > mid - tol) hi = m
          else lo = m + 1
        }
        offset = lo
      }
      lines.push({ node: t, offset, mid })
    }
  }
  return lines.sort((a, b) => a.mid - b.mid).map((l) => ({ ...l, top: natural(l.mid) - lineH / 2 }))
}

function measure(view: EditorView): { gaps: Gap[]; sheets: [HTMLElement, number][] } {
  const gaps: Gap[] = []
  const sheets: [HTMLElement, number][] = []
  view.state.doc.forEach((section, secPos) => {
    const sheet = view.nodeDOM(secPos)
    const body = sheet instanceof HTMLElement ? sheet.querySelector<HTMLElement>(':scope > .sheet-body') : null
    if (!(sheet instanceof HTMLElement) || !body) return
    const sheetRect = sheet.getBoundingClientRect()
    // The desk zoom scales client rects; the page math is in unzoomed CSS px.
    const scale = sheetRect.width / SHEET_W
    if (!scale) return
    const bodyRect = body.getBoundingClientRect()
    const seams = [...body.querySelectorAll<HTMLElement>('.page-gap')].map((g) => {
      const r = g.getBoundingClientRect()
      return { top: r.top, h: r.height / scale }
    })
    /** Where a client y would sit without the seams. */
    const natural = (y: number) => seams.reduce((v, s) => (s.top < y - 0.5 ? v - s.h : v), (y - bodyRect.top) / scale)
    const lineH = parseFloat(getComputedStyle(body).lineHeight) || 35.8

    // Natural coordinates plus the filler of every break so far: page n ends at `boundary`.
    let shift = 0
    let pageStart = 0
    let boundary = BODY_H - ((bodyRect.top - sheetRect.top) / scale - MARGIN)
    let pages = 1
    const breakAt = (gap: Omit<Gap, 'filler'>, at: number) => {
      const start = Math.max(boundary, at)
      const filler = Math.round(start - at)
      gaps.push({ ...gap, filler })
      shift += filler
      pageStart = start
      boundary = start + BODY_H
      pages++
    }
    const fits = (bottom: number) => bottom <= boundary + 0.5

    let end = 0
    section.forEach((child, off) => {
      const pos = secPos + 1 + off
      const el = view.nodeDOM(pos)
      if (!(el instanceof HTMLElement)) return
      const r = el.getBoundingClientRect()
      const top = natural(r.top) + shift
      const bottom = natural(r.bottom) + shift
      const atTop = top <= pageStart + 1
      end = bottom

      if (fits(bottom)) {
        // A heading never ends a page: it goes with the line after it.
        if (child.type.name === 'heading' && !atTop && !fits(bottom + lineH)) breakAt({ pos, inline: false }, top)
        else if (child.type.name === 'pageBreak') breakAt({ pos: pos + child.nodeSize, inline: false }, bottom)
        end = natural(r.bottom) + shift
        return
      }

      if (!child.isAtom) {
        const lines = lineBoxes(el, natural, lineH, scale)
        if (!lines.length && !atTop) breakAt({ pos, inline: false }, top)
        for (const [i, line] of lines.entries()) {
          if (fits(line.top + shift + lineH)) continue
          let at: number | undefined
          try {
            at = i ? view.posAtDOM(line.node, line.offset) : undefined
          } catch {
            // A line inside something ProseMirror doesn't map: the block moves whole instead.
          }
          if (at != null && at > pos + 1 && at < pos + child.nodeSize - 1) breakAt({ pos: at, inline: true }, line.top + shift)
          else if (!(line.top + shift <= pageStart + 1)) breakAt({ pos, inline: false }, top)
        }
      } else if (el.matches(ROWS)) {
        const rows = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('page-gap'))
        for (const [i, row] of rows.entries()) {
          const rr = row.getBoundingClientRect()
          const rowTop = natural(rr.top) + shift
          if (fits(natural(rr.bottom) + shift) || rowTop <= pageStart + 1) continue
          if (i) breakAt({ pos, row, inline: false }, rowTop)
          else breakAt({ pos, inline: false }, top)
        }
      } else if (!atTop) {
        breakAt({ pos, inline: false }, top)
      }
      end = natural(r.bottom) + shift
    })

    // Footnotes close the section: if they don't fit, they start a page of their own.
    const notes = sheet.querySelector<HTMLElement>(':scope > .sheet-notes')
    if (notes && !notes.hidden && section.childCount) {
      const nh = (notes.getBoundingClientRect().bottom - bodyRect.bottom) / scale
      if (!fits(end + nh) && end > pageStart + 1) breakAt({ pos: secPos + section.nodeSize - 1, inline: false }, end)
    }
    sheets.push([sheet, pages])
  })
  return { gaps, sheets }
}

/** Seams inside atoms are plain DOM (their node views ignore mutations); rebuilt only when they change. */
function placeRowGaps(view: EditorView, gaps: Gap[]): void {
  const want = new Map<HTMLElement, Gap[]>()
  for (const g of gaps) if (g.row?.parentElement) want.set(g.row.parentElement, [...(want.get(g.row.parentElement) ?? []), g])
  for (const atom of view.dom.querySelectorAll<HTMLElement>(ROWS)) {
    const list = want.get(atom) ?? []
    const have = [...atom.querySelectorAll<HTMLElement>(':scope > .page-gap')]
    const same = have.length === list.length && have.every((h, i) => h.nextElementSibling === list[i].row && h.dataset.filler === String(list[i].filler))
    if (same) continue
    have.forEach((h) => h.remove())
    for (const g of list) atom.insertBefore(seamDOM(g.filler, false), g.row!)
  }
}

const sig = (from: number, inline: boolean, filler: number) => `${from}:${inline ? 1 : 0}:${filler}`

export const Pagination = Extension.create({
  name: 'thesisPagination',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(key) ?? set.map(tr.mapping, tr.doc)
        },
        props: {
          decorations: (state) => key.getState(state)
        },
        view(view) {
          let frame = 0
          const run = () => {
            frame = 0
            if (view.isDestroyed || !view.dom.isConnected) return
            const { gaps, sheets } = measure(view)
            for (const [sheet, pages] of sheets) {
              // Even the last page is a whole sheet.
              const h = `${pages * PAGE_H + (pages - 1) * DESK_GAP}px`
              if (sheet.style.minHeight !== h) sheet.style.minHeight = h
            }
            placeRowGaps(view, gaps)
            const decos = gaps.filter((g) => !g.row)
            const next = decos.map((g) => sig(g.pos, g.inline, g.filler)).join(' ')
            const current = (key.getState(view.state)?.find() ?? []).map((d) => sig(d.from, d.spec.inline, d.spec.filler)).join(' ')
            if (next === current) return
            const set = DecorationSet.create(
              view.state.doc,
              decos.map((g) =>
                Decoration.widget(g.pos, () => seamDOM(g.filler, g.inline), { side: -1, ignoreSelection: true, key: sig(g.pos, g.inline, g.filler), inline: g.inline, filler: g.filler })
              )
            )
            view.dispatch(view.state.tr.setMeta(key, set).setMeta('addToHistory', false))
          }
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(run)
          }
          // Layout changes the doc doesn't announce: fonts, images, zoom, the panels opening.
          const ro = new ResizeObserver(schedule)
          ro.observe(view.dom)
          void document.fonts?.ready.then(schedule)
          schedule()
          return {
            update: (v, prev) => {
              if (v.state.doc !== prev.doc) schedule()
            },
            destroy: () => {
              cancelAnimationFrame(frame)
              ro.disconnect()
            }
          }
        }
      })
    ]
  }
})

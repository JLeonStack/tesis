// What the assistant draws on the whiteboard, turned into Excalidraw elements.
// The assistant writes a small skeleton (boxes with labels, text, arrows between
// boxes by id); this builds complete elements so Excalidraw needs to guess nothing.

export type ShapeType = 'rectangle' | 'ellipse' | 'diamond'
export type BoardColor = 'blue' | 'green' | 'yellow' | 'red' | 'violet' | 'orange' | 'teal' | 'gray' | 'none'

export type Skeleton =
  | { type: ShapeType; id?: string; x: number; y: number; width?: number; height?: number; label?: string; color?: BoardColor; dashed?: boolean }
  | { type: 'text'; id?: string; x: number; y: number; text: string; fontSize?: number; color?: BoardColor }
  | { type: 'arrow' | 'line'; id?: string; from?: string; to?: string; points?: [number, number][]; x?: number; y?: number; label?: string; dashed?: boolean; color?: BoardColor }

export type Element = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number }

/** Excalidraw's own palette: pastel fills with a matching stroke for text and arrows. */
const COLORS: Record<Exclude<BoardColor, 'none'>, { fill: string; stroke: string }> = {
  blue: { fill: '#a5d8ff', stroke: '#1971c2' },
  green: { fill: '#b2f2bb', stroke: '#2f9e44' },
  yellow: { fill: '#ffec99', stroke: '#f08c00' },
  red: { fill: '#ffc9c9', stroke: '#e03131' },
  violet: { fill: '#d0bfff', stroke: '#6741d9' },
  orange: { fill: '#ffd8a8', stroke: '#e8590c' },
  teal: { fill: '#96f2d7', stroke: '#0c8599' },
  gray: { fill: '#e9ecef', stroke: '#495057' }
}
const INK = '#1e1e1e'
const FONT = 5 // Excalifont, the hand-drawn default
const LINE_HEIGHT = 1.25

let counter = 0
const newId = () => `ts${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const seed = () => Math.floor(Math.random() * 2 ** 31)

function base(type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): Element {
  return {
    id: newId(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra
  }
}

/** Rough size of text in Excalifont: wide enough that nothing clips. */
export function measure(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.split('\n')
  const longest = Math.max(1, ...lines.map((l) => [...l].length))
  return { width: Math.ceil(longest * fontSize * 0.58), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) }
}

/** Breaks a long label into lines of about `max` characters. */
export function wrap(text: string, max = 22): string {
  return text
    .split('\n')
    .map((para) => {
      const out: string[] = []
      let line = ''
      for (const word of para.split(/\s+/)) {
        if (line && (line + ' ' + word).length > max) {
          out.push(line)
          line = word
        } else line = line ? `${line} ${word}` : word
      }
      if (line) out.push(line)
      return out.join('\n')
    })
    .join('\n')
}

function textElement(text: string, x: number, y: number, fontSize: number, extra: Record<string, unknown> = {}): Element {
  const { width, height } = measure(text, fontSize)
  return base('text', x, y, width, height, {
    text,
    originalText: text,
    fontSize,
    fontFamily: FONT,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    ...extra
  })
}

/** Text centered in a box or on an arrow, bound to it so they move together. */
function boundLabel(label: string, container: Element, cx: number, cy: number): Element {
  const fontSize = 20
  const { width, height } = measure(label, fontSize)
  const t = textElement(label, cx - width / 2, cy - height / 2, fontSize, { containerId: container.id, textAlign: 'center', verticalAlign: 'middle', autoResize: true })
  container.boundElements = [...((container.boundElements as unknown[]) ?? []), { type: 'text', id: t.id }]
  return t
}

/** Where the segment from a box's center toward (tx, ty) leaves the box (ellipses and diamonds approximated). */
function edgePoint(b: Element, tx: number, ty: number, gap = 6): [number, number] {
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return [cx, cy]
  const hw = b.width / 2 + gap
  const hh = b.height / 2 + gap
  let t: number
  if (b.type === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
  else if (b.type === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return [cx + dx * t, cy + dy * t]
}

/** Builds Excalidraw elements from the assistant's skeleton. Arrows refer to boxes by their skeleton id. */
export function toElements(skeleton: Skeleton[]): Element[] {
  const out: Element[] = []
  const byId = new Map<string, Element>()

  for (const s of skeleton) {
    if (s.type !== 'rectangle' && s.type !== 'ellipse' && s.type !== 'diamond') continue
    const color = s.color && s.color !== 'none' ? COLORS[s.color] : null
    const label = s.label ? wrap(s.label) : ''
    const size = label ? measure(label, 20) : { width: 0, height: 0 }
    // Ellipses and diamonds need more room around the same text.
    const pad = s.type === 'rectangle' ? 1 : 1.5
    const width = Math.max(s.width ?? 0, size.width * pad + 40, 120)
    const height = Math.max(s.height ?? 0, size.height * pad + 30, 60)
    const box = base(s.type, s.x, s.y, width, height, {
      backgroundColor: color?.fill ?? 'transparent',
      strokeStyle: s.dashed ? 'dashed' : 'solid',
      roundness: s.type === 'rectangle' ? { type: 3 } : { type: 2 }
    })
    out.push(box)
    if (s.id) byId.set(s.id, box)
    if (label) out.push(boundLabel(label, box, box.x + width / 2, box.y + height / 2))
  }

  for (const s of skeleton) {
    if (s.type === 'text') {
      const color = s.color && s.color !== 'none' ? COLORS[s.color].stroke : INK
      out.push(textElement(s.text, s.x, s.y, s.fontSize ?? 20, { strokeColor: color }))
      continue
    }
    if (s.type !== 'arrow' && s.type !== 'line') continue
    const from = s.from ? byId.get(s.from) : undefined
    const to = s.to ? byId.get(s.to) : undefined
    let start: [number, number]
    let end: [number, number]
    let middle: [number, number][] = []
    if (from && to) {
      start = edgePoint(from, to.x + to.width / 2, to.y + to.height / 2)
      end = edgePoint(to, from.x + from.width / 2, from.y + from.height / 2)
    } else if (s.points && s.points.length >= 2) {
      const ox = s.x ?? 0
      const oy = s.y ?? 0
      const abs = s.points.map(([px, py]) => [ox + px, oy + py] as [number, number])
      start = abs[0]
      end = abs[abs.length - 1]
      middle = abs.slice(1, -1)
    } else continue
    const pts = [start, ...middle, end].map(([px, py]) => [px - start[0], py - start[1]])
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const color = s.color && s.color !== 'none' ? COLORS[s.color].stroke : INK
    const arrow = base(s.type, start[0], start[1], Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      strokeColor: color,
      strokeStyle: s.dashed ? 'dashed' : 'solid',
      roundness: { type: 2 },
      points: pts,
      lastCommittedPoint: null,
      startBinding: from && to ? { elementId: from.id, focus: 0, gap: 6 } : null,
      endBinding: from && to ? { elementId: to.id, focus: 0, gap: 6 } : null,
      startArrowhead: null,
      endArrowhead: s.type === 'arrow' ? 'arrow' : null,
      elbowed: false
    })
    out.push(arrow)
    for (const b of [from, to]) if (b && from && to) b.boundElements = [...((b.boundElements as unknown[]) ?? []), { type: 'arrow', id: arrow.id }]
    if (s.label) {
      const mid = pts[Math.floor(pts.length / 2)]
      const half = pts.length % 2 ? mid : [(pts[pts.length / 2 - 1][0] + mid[0]) / 2, (pts[pts.length / 2 - 1][1] + mid[1]) / 2]
      out.push(boundLabel(wrap(s.label, 18), arrow, start[0] + half[0], start[1] + half[1]))
    }
  }
  return out
}

// ---------- reading ----------

/** Spanish names of the shapes, for the assistant's reading of the board (the text it shows the model). */
const KIND: Record<string, string> = { rectangle: 'rectángulo', ellipse: 'elipse', diamond: 'rombo' }

/** The board as the assistant reads it: boxes by their labels, loose text, and what points to what. */
export function describeBoard(elements: Element[], limit = 80): string {
  const live = elements.filter((e) => !e.isDeleted)
  if (!live.length) return 'La pizarra está vacía.'
  const byId = new Map(live.map((e) => [e.id, e]))
  const labelOf = (id: unknown): string | undefined => {
    const e = typeof id === 'string' ? byId.get(id) : undefined
    if (!e) return undefined
    const bound = (e.boundElements as { type: string; id: string }[] | null)?.find((b) => b.type === 'text')
    const t = bound ? byId.get(bound.id) : undefined
    return ((t?.text as string) || (e.text as string) || '').replace(/\s+/g, ' ').trim() || undefined
  }
  const lines: string[] = []
  for (const e of live) {
    if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
      const label = labelOf(e.id)
      if (label) lines.push(`- ${KIND[e.type]} "${label}" en (${Math.round(e.x)}, ${Math.round(e.y)})`)
    } else if (e.type === 'text' && !e.containerId) {
      lines.push(`- texto "${String(e.text).replace(/\s+/g, ' ').trim()}" en (${Math.round(e.x)}, ${Math.round(e.y)})`)
    } else if (e.type === 'arrow' || e.type === 'line') {
      const from = labelOf((e.startBinding as { elementId?: string } | null)?.elementId)
      const to = labelOf((e.endBinding as { elementId?: string } | null)?.elementId)
      const label = labelOf(e.id)
      if (from || to) lines.push(`- "${from ?? '?'}" ${e.type === 'arrow' ? '→' : '—'} "${to ?? '?'}"${label ? ` (${label})` : ''}`)
    }
  }
  const others = live.length - lines.length
  const shown = lines.slice(0, limit)
  return `${live.length} elementos${others > 0 ? ` (${others} sin texto: dibujos, imágenes, formas o etiquetas sin rótulo)` : ''}:\n${shown.join('\n')}${lines.length > limit ? `\n…y ${lines.length - limit} más` : ''}`
}

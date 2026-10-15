import { openBoard } from '../store'
import { describeBoard, toElements, type Element, type Skeleton } from './elements'

// How the app reaches into the whiteboard. Excalidraw runs as excalidraw.com in a
// <webview>, so there is no API: the assistant's drawings go in the way a person's
// would, by pasting (Mermaid code, or Excalidraw's own clipboard JSON), which keeps
// Excalidraw's ⌘Z. What's on the board is read from the scene it saves in its
// localStorage. Moving what was pasted to free space goes through that storage too:
// excalidraw.com reloads it when the window regains focus (its tab sync).

let board: WebviewElement | null = null
/** What the board held the last time it was read, for when it isn't loaded. */
let lastSeen: string | null = null

/** The Whiteboard tab registers its webview once Excalidraw has loaded (null when it goes away). */
export function registerBoard(wv: WebviewElement | null): void {
  board = wv
}

const run = <T>(code: string): Promise<T> => board!.executeJavaScript(code) as Promise<T>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Opens the whiteboard tab and waits until Excalidraw is up. */
async function ready(): Promise<void> {
  openBoard()
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (board) {
      try {
        if (await run<boolean>(`!!document.querySelector('.excalidraw')`)) return
      } catch {
        // Still navigating.
      }
    }
    await sleep(250)
  }
  throw new Error('La pizarra no terminó de abrir (¿sin conexión a excalidraw.com?)')
}

const readScene = () => run<Element[]>(`JSON.parse(localStorage.getItem('excalidraw') || '[]')`)

/**
 * Writes the scene back and lets excalidraw.com pick it up, as it does when another
 * tab changed it. With `frame`, the view also moves to that area, with nothing selected
 * (a selection would open Excalidraw's style panel over the drawing).
 */
async function writeScene(elements: Element[], frame?: { x: number; y: number; right: number; bottom: number }): Promise<void> {
  const stamp = await run<string>(`(() => {
    localStorage.setItem('excalidraw', ${JSON.stringify(JSON.stringify(elements))})
    const frame = ${JSON.stringify(frame ?? null)}
    if (frame) {
      const state = JSON.parse(localStorage.getItem('excalidraw-state') || '{}')
      const vw = window.innerWidth, vh = window.innerHeight
      const w = frame.right - frame.x, h = frame.bottom - frame.y
      // Room for Excalidraw's toolbars around the drawing; never zoomed in past 100%.
      const zoom = Math.max(0.25, Math.min(1, (vw - 160) / w, (vh - 220) / h))
      Object.assign(state, {
        zoom: { value: zoom },
        scrollX: vw / (2 * zoom) - (frame.x + w / 2),
        scrollY: vh / (2 * zoom) - (frame.y + h / 2) + 20 / zoom,
        selectedElementIds: {},
        selectedGroupIds: {},
        editingGroupId: null
      })
      localStorage.setItem('excalidraw-state', JSON.stringify(state))
    }
    const stamp = String(Date.now())
    localStorage.setItem('version-dataState', stamp)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    return stamp
  })()`)
  // Excalidraw took it once it saves the scene again (a newer version stamp). Otherwise
  // its copy in memory would overwrite ours on its next save: nudge it again.
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(250)
    const now = await run<string | null>(`localStorage.getItem('version-dataState')`)
    if (now !== stamp) return
    if (attempt % 3 === 2) await run(`window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))`)
  }
  throw new Error('La pizarra no tomó el cambio. Volvé a intentarlo con la pizarra a la vista.')
}

function paste(text: string): Promise<void> {
  return run(`(() => {
    const target = document.querySelector('.excalidraw')
    target && target.focus()
    const data = new DataTransfer()
    data.setData('text/plain', ${JSON.stringify(text)})
    ;(document.activeElement || document).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })()`)
}

const live = (els: Element[]) => els.filter((e) => !e.isDeleted)

function bounds(els: Element[]): { x: number; y: number; right: number; bottom: number } {
  return {
    x: Math.min(...els.map((e) => e.x)),
    y: Math.min(...els.map((e) => e.y)),
    right: Math.max(...els.map((e) => e.x + e.width)),
    bottom: Math.max(...els.map((e) => e.y + e.height))
  }
}

/** The board as the assistant sees it; the last reading when the board isn't loaded. */
export async function readBoard(): Promise<string | null> {
  if (!board) return lastSeen
  try {
    lastSeen = describeBoard(await readScene())
  } catch {
    // The board is reloading: fall back to what it last held.
  }
  return lastSeen
}

export interface Drawing {
  /** Mermaid code (flowchart, sequenceDiagram, classDiagram): Excalidraw lays it out. */
  mermaid?: string
  /** Shapes, text and arrows at the assistant's own positions. */
  elements?: Skeleton[]
  /** A heading written above the drawing. */
  title?: string
}

/**
 * Draws on the whiteboard: pastes the drawing, moves it below whatever was already
 * there, adds its heading and brings it into view. Returns the new elements' ids.
 */
export async function drawOnBoard(d: Drawing): Promise<string[]> {
  await ready()
  const before = live(await readScene())
  const known = new Set(before.map((e) => e.id))
  const text = d.mermaid?.trim() || JSON.stringify({ type: 'excalidraw/clipboard', elements: toElements(d.elements ?? []), files: {} })
  await paste(text)

  // Excalidraw saves a moment later; Mermaid also has to load its parser the first time.
  let scene: Element[] = []
  let added: Element[] = []
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await sleep(400)
    scene = await readScene()
    added = live(scene).filter((e) => !known.has(e.id))
    if (added.length) {
      // Let a big paste finish saving.
      await sleep(400)
      scene = await readScene()
      added = live(scene).filter((e) => !known.has(e.id))
      break
    }
  }
  if (!added.length) throw new Error(d.mermaid ? 'Excalidraw no pudo leer el diagrama Mermaid' : 'Excalidraw no aceptó el dibujo')

  // Below what's there (left-aligned with it), with room for the heading.
  const box = bounds(added)
  const heading = d.title?.trim()
  const top = before.length ? bounds(before).bottom + (heading ? 160 : 120) : box.y
  const left = before.length ? bounds(before).x : box.x
  const dx = left - box.x
  const dy = top - box.y
  const ids = new Set(added.map((e) => e.id))
  const now = Date.now()
  const moved = scene.map((e) =>
    ids.has(e.id) ? { ...e, x: e.x + dx, y: e.y + dy, version: ((e.version as number) ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now } : e
  )
  if (heading) {
    const [title] = toElements([{ type: 'text', x: left, y: top - 70, text: heading, fontSize: 36 }])
    moved.push(title)
    ids.add(title.id)
  }
  await writeScene(moved, bounds(moved.filter((e) => ids.has(e.id))))
  lastSeen = describeBoard(moved)
  return [...ids]
}

/** Takes a drawing back off the board (the assistant's Undo). */
export async function eraseFromBoard(ids: string[]): Promise<void> {
  await ready()
  const gone = new Set(ids)
  const now = Date.now()
  const scene = await readScene()
  await writeScene(scene.map((e) => (gone.has(e.id) ? { ...e, isDeleted: true, version: ((e.version as number) ?? 1) + 1, updated: now } : e)))
  lastSeen = describeBoard(scene.filter((e) => !gone.has(e.id)))
}

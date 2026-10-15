import { generateJSON, generateText, type JSONContent } from '@tiptap/core'
import type { Annotation, CitationStyle, ConstructId, Note, Paper, PaperList, ReadingStatus, ResearchSettings, Settings, Task } from '@shared/types'
import { addToList, createNote, deleteNote, deleteTask, listByName, openTab, openTasks, openThesis, openWiki, openMatrix, openBoard, openResearch, openAnalysis, showInMatrix, clearMatrixFilter, patchPaper, patchResearch, patchSettings, restoreList, savePaper, saveNote, saveAnnotation, toast, useStore, removeFromList, jumpTo } from '../store'
import { CONSTRUCTS, CONSTRUCT_ORDER, DEMOGRAPHICS } from '../research/framework'
import { changeCount, createPlan, planChanges } from '../research/plan'
import { ANALYSIS_TABLES, analysisTable, type AnalysisTableId } from '../analysis/tables'
import { liveThesis, withThesisEditor } from '../thesis/bridge'
import { citeFixTransaction, manualReferences, planCiteFix, referenceTransaction, referenceValid, type CiteFix } from '../thesis/citeFix'
import { THESIS_CITE, thesisLeaf } from '../thesis/references'
import type { Transaction } from '@tiptap/pm/state'
import type { CitedSource } from '../editor/extensions'
import { applyTaskOps, cleanOp, describeApplied, describeOp, opValid, type TaskOp } from '../tasks/assist'
import { markdownToHtml } from '../lib/markdown'
import { buildExtensions } from '../editor/extensions'
import { getEditor } from '../editor/noteBridge'
import { buildGuide } from '../lib/guide'
import { inText, inTextGroup, shortLabel } from '../lib/citation'
import { today } from '../tasks/dates'
import { drawOnBoard, eraseFromBoard } from '../board/bridge'
import type { BoardColor, ShapeType, Skeleton } from '../board/elements'
import { DEFAULT_PLAN, extend, pause, resume, skip, startTask, stop, taskByTitle, timerCheckpoint, restoreTimer, usePomodoro } from '../pomodoro/timer'

// What the assistant can do in the app. It ends an answer with a fenced
// ```actions block (```tasks in the planning chat); the chat shows the changes
// as a checklist the student applies, and can undo. `open` becomes a button,
// and `read` asks the app for a paper's or note's full text.

export type View = 'tasks' | 'wiki' | 'thesis' | 'matrix' | 'board' | 'research' | 'analysis'
type SettingsPatch = Partial<Pick<Settings, 'thesisTitle' | 'researchQuestion' | 'citationStyle'>>

export type PomodoroCmd = 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'extend'

export type Action =
  | { op: 'task'; task: TaskOp }
  /** The timer: `start` names a task by id, or by title for one added in the same block. */
  | { op: 'pomodoro'; cmd: PomodoroCmd; taskId?: string; title?: string; minutes?: number }
  /** A diagram on the whiteboard: Mermaid laid out by Excalidraw, or shapes at given positions. */
  | { op: 'board.draw'; title?: string; mermaid?: string; elements?: Skeleton[] }
  | { op: 'list.add' | 'list.remove'; paperId: string; list: string }
  | { op: 'paper.update'; paperId: string; status?: ReadingStatus; starred?: boolean; addTags?: string[]; removeTags?: string[]; constructs?: ConstructId[] }
  | { op: 'note.create'; title: string; markdown: string; paperIds: string[] }
  | { op: 'note.append'; noteId: string; markdown: string }
  | { op: 'note.update'; noteId: string; title?: string; pinned?: boolean; addPaperIds?: string[] }
  | { op: 'highlight.comment'; annotationId: string; comment: string }
  | { op: 'settings.update'; patch: SettingsPatch }
  /** The student's choices in the course framework: the 2 topics, demographics, hypotheses, term. */
  | { op: 'research.update'; patch: Partial<ResearchSettings> }
  /** The course's stages as dated tasks up to the deadline (only what's missing). */
  | { op: 'plan.create' }
  /** An APA table from the computed analysis, inserted where the caret is in the thesis. */
  | { op: 'analysis.insert'; table: AnalysisTableId }
  | { op: 'guide.build'; paperId: string }
  | { op: 'open'; paperId?: string; page?: number; noteId?: string; annotationId?: string; view?: View }
  | { op: 'read'; paperId?: string; noteId?: string; thesis?: boolean }
  /** A view, not a change: the matrix narrowed to these papers, best first. */
  | { op: 'matrix.show'; label: string; papers: { paperId: string; why: string }[] }
  | { op: 'matrix.clear' }
  /** A citation of the thesis corrected, or a missing one added: only the citation changes. */
  | { op: 'cite.fix'; fix: CiteFix }
  /** A reference written by hand in «Referencias bibliográficas», for a work outside the library. */
  | { op: 'reference.add'; apa: string; why?: string }

/** Actions that change something, and so go through the checklist. */
export const isChange = (a: Action): boolean => a.op !== 'open' && a.op !== 'read' && a.op !== 'matrix.show' && a.op !== 'matrix.clear'

// ---------- prompt ----------

/**
 * How to act, for the system prompt. The general assistant can also ask to
 * read; side chats get everything that doesn't need the task list. The
 * matrix chat is a side chat that can also read and drive the matrix.
 */
export function actionsProtocol(scope: 'agent' | 'side' | 'matrix'): string {
  const agent = scope === 'agent'
  const reads = scope !== 'side'
  return `Cómo actuar en la app:
- Podés cambiar cosas en la app por el estudiante. Cuando te lo pida (o acepte algo que sugeriste), terminá tu respuesta con exactamente un bloque de código delimitado cuyo lenguaje sea "actions", con JSON: {"actions": [ ... ]}. La app lo muestra como una lista de cambios que el estudiante revisa y aplica con un clic, y se pueden deshacer. Nunca menciones el bloque, el JSON ni los ids en el texto: decí brevemente qué proponés.
- Acciones disponibles (solo los campos que se muestran; los opcionales se pueden omitir):
  {"op":"list.add","paperId":"…","list":"Candidatas para la tesis"}  agrega un paper a una lista de lectura; la lista se crea si no existe. "Candidatas para la tesis" es la preselección de papers para la investigación de la tesis: usala cuando el estudiante hable de candidatos, de preseleccionar o de mandar un paper a su investigación. Otras listas ("Capítulo 2", "Para profundizar"…) están bien cuando lo pida.
  {"op":"list.remove","paperId":"…","list":"…"}
  {"op":"paper.update","paperId":"…","status":"unread|reading|read","starred":true,"addTags":["…"],"removeTags":["…"],"constructs":["attachment|empathy|tfl|security|ocb"]}  solo lo que cambia; "unread" significa "por leer"; "constructs" son los temas de la cátedra que trata el paper (reemplaza los que tenía)
  {"op":"task.add","title":"…","start":"YYYY-MM-DD","due":"YYYY-MM-DD","priority":"low|normal|high","milestone":false,"notes":"…","paperId":"…","pomodoros":4,"focusMinutes":25}  (los títulos empiezan con un verbo: "Leer…", "Escribir…"; "pomodoros" planifica las sesiones de foco de la tarea, "focusMinutes" es 25 por defecto)${
    agent ? `\n  {"op":"task.update","id":"…", …solo los campos que cambian…}  ("status":"todo|doing|done"; null borra un campo)\n  {"op":"task.delete","id":"…"}` : ''
  }
  {"op":"pomodoro.start",${agent ? '"taskId":"…"' : '"title":"…"'}}  inicia el temporizador pomodoro en una tarea, con lo que le queda de su plan (ajustá su tamaño con "pomodoros" y "focusMinutes" en la tarea). ${agent ? 'Para una tarea que agregues en este mismo bloque, poné su "title" exacto en lugar de "taskId".' : 'Nombrá una tarea que agregues en este mismo bloque por su título exacto.'} Corre un solo temporizador a la vez: iniciar otro aparta el actual.
  {"op":"pomodoro.pause"} · {"op":"pomodoro.resume"} · {"op":"pomodoro.skip"} · {"op":"pomodoro.stop"} · {"op":"pomodoro.extend","minutes":5}  controlan el temporizador en marcha (su estado llega en <timer>)
  {"op":"board.draw","title":"…","mermaid":"flowchart TD\n  A[…] --> B[…]"}  dibuja un diagrama en la pizarra (en Excalidraw, abierta para el estudiante), con disposición automática: procesos, jerarquías, cadenas causales, la estructura de la tesis. Solo "flowchart" (TD o LR, se permiten subgraph), "sequenceDiagram" y "classDiagram" se convierten en formas editables. Etiquetas cortas; entre comillas las que tengan puntuación: A["Teoría (2010)"].
  {"op":"board.draw","title":"…","elements":[{"id":"a","type":"rectangle","x":0,"y":0,"label":"…","color":"blue"},{"id":"b","type":"ellipse","x":340,"y":0,"label":"…"},{"type":"arrow","from":"a","to":"b","label":"…"},{"type":"text","x":0,"y":200,"text":"…"}]}  para diseños donde la posición tiene significado: mapas conceptuales, matrices de 2×2, líneas de tiempo, comparaciones lado a lado. Los tipos de forma son rectangle, ellipse o diamond, con el tamaño de su etiqueta (indicá width/height para las regiones); "text" es texto suelto ("fontSize" 20 por defecto); "arrow" o "line" unen ids de formas con "from"/"to" (o toman "points" [[x,y],…]). Colores: blue, green, yellow, red, violet, orange, teal, gray; "dashed": true. Distribuí las formas en una grilla de unos 340 px en horizontal y 180 en vertical para que no se superpongan.
  Los dibujos se ubican debajo de lo que ya hay en la pizarra. Cuando pidan un diagrama, un mapa, un esquema o "dibujá…", dibujalo en lugar de describirlo, y mantenelo en lo que entra en una sola pantalla (hasta unas 15 formas).
  {"op":"note.create","title":"…","markdown":"…","paperIds":["…"]}  una nota nueva; cuerpo en Markdown (títulos, viñetas, citas con >)
  {"op":"note.append","noteId":"…","markdown":"…"}
  {"op":"note.update","noteId":"…","title":"…","pinned":true,"addPaperIds":["…"]}  renombra, fija o vincula papers a una nota (solo lo que cambia)${
    agent
      ? `\n  {"op":"research.update","constructs":["attachment|empathy|tfl|security|ocb", "…"],"demographics":["${DEMOGRAPHICS.map((d) => d.id).join('|')}"],"hypotheses":"…"}  guarda las elecciones del estudiante en el marco de la cátedra: exactamente 2 temas, las variables demográficas a cruzar y sus hipótesis (en sus palabras) (solo lo que cambia, cuando lo decida o acepte tu propuesta)
  {"op":"plan.create"}  arma o reajusta el plan de la tesis por entregas del taller: cada etapa de la cátedra como tarea con fechas y pomodoros dentro de la entrega en que se presenta, más los hitos de cada entrega y del tutor (agrega lo que falta y reprograma lo que quedó con otras fechas)
  {"op":"highlight.comment","annotationId":"…","comment":"…"}  pone el comentario en uno de sus resaltados (lo reemplaza; si estás sumando algo, conservá el suyo)\n  {"op":"settings.update","thesisTitle":"…","researchQuestion":"…","citationStyle":"apa|harvard|mla|chicago"}  el tema de su tesis, su pregunta de investigación o su estilo de citas (solo lo que cambia, cuando lo pida)`
      : ''
  }
  {"op":"analysis.insert","table":"${ANALYSIS_TABLES.join('|')}"}  inserta en la tesis, donde está el cursor, una tabla APA con los resultados calculados (muestra, confiabilidad, descriptivos, correlaciones, apego por vínculo, comparaciones por grupo, regresión o moderación); solo si hay resultados en <analysis>
  {"op":"guide.build","paperId":"…"}  arma la guía de lectura de un paper (mapa, oraciones clave, glosario)
  {"op":"open","paperId":"…","page":12} o {"op":"open","annotationId":"…"} o {"op":"open","noteId":"…"} o {"op":"open","view":"tasks|wiki|thesis|matrix|board|research|analysis"}  un botón para ir ahí: agregá uno por cada paper, resaltado o nota que recomiendes, así el estudiante lo abre con un clic${
    reads
      ? `\n  {"op":"matrix.show","label":"…","papers":[{"paperId":"…","why":"…"}]}  muestra en la matriz de literatura solo esos papers, en ese orden (el más pertinente primero), con "why" (una razón corta, de hasta 15 palabras) junto a cada uno. "label" nombra el filtro en pocas palabras ("Liderazgo transformacional", "Estudios cuantitativos en LatAm"). No es un cambio: se aplica al instante si la matriz está abierta, y si no queda como botón. Usalo cuando el estudiante pida encontrar, filtrar o rankear papers por un tema o criterio, junto con tu respuesta.\n  {"op":"matrix.clear"}  quita ese filtro y vuelve a mostrar toda la matriz`
      : ''
  }${
    reads
      ? `\n  {"op":"read","paperId":"…"} o {"op":"read","noteId":"…"} o {"op":"read","thesis":true}  lee el texto completo de un paper, el contenido completo de una nota o el borrador de su tesis. Usalo cuando responder necesite más de lo que ves (qué dice realmente un paper, citas, páginas; revisar su borrador): respondé con una línea breve que diga qué vas a leer y un bloque con solo acciones "read" (como máximo 3). La app te envía el texto de inmediato y seguís en el turno siguiente.`
      : ''
  }
- Cuando el estudiante quiera ponerse a trabajar en algo ahora ("arranquemos", "quiero escribir una hora", "poneme un pomodoro"), dimensioná la sesión en pomodoros (25 min por defecto, 50 para escribir) e iniciá el temporizador, en una tarea existente si encaja o en una que agregues.
- Usá solo los ids que aparezcan en tu contexto. Las fechas van en formato YYYY-MM-DD; hoy es ${today()}.`
}

// ---------- parsing ----------

const FENCE = /```(actions|tasks)[^\n]*\n([\s\S]*?)(```|$)/
const VIEWS: View[] = ['tasks', 'wiki', 'thesis', 'matrix', 'board', 'research', 'analysis']
const STYLES: CitationStyle[] = ['apa', 'harvard', 'mla', 'chicago']
const STATUSES: ReadingStatus[] = ['unread', 'reading', 'read']

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const tags = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map((t) => (typeof t === 'string' ? t.replace(/^#/, '').trim() : '')).filter(Boolean) : undefined

function cleanAction(raw: unknown, legacyTasks: boolean): Action | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const op = typeof o.op === 'string' ? o.op : ''
  if (op.startsWith('pomodoro.')) return cleanPomodoro(o, op.slice('pomodoro.'.length))
  if (op === 'board.draw') return cleanDrawing(o)
  // The planning chat's ```tasks block: plain add / update / delete.
  if (legacyTasks || op.startsWith('task.')) {
    const task = cleanOp({ ...o, op: op.replace(/^task\./, '') })
    return task ? { op: 'task', task } : null
  }
  const paperId = str(o.paperId)
  const noteId = str(o.noteId)
  switch (op) {
    case 'cite.fix': {
      const context = str(o.context)
      const sources = (Array.isArray(o.sources) ? o.sources : [])
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
        .flatMap((x) => (str(x.paperId) ? [{ paperId: str(x.paperId)!, page: typeof x.page === 'number' && x.page > 0 ? Math.round(x.page) : null }] : []))
      const text = str(o.text)
      return context && (sources.length || text) ? { op, fix: { context, wrong: str(o.wrong), sources, text, why: str(o.why) } } : null
    }
    case 'reference.add':
      return str(o.apa) ? { op, apa: str(o.apa)!, why: str(o.why) } : null
    case 'list.add':
    case 'list.remove':
      return paperId && str(o.list) ? { op, paperId, list: str(o.list)! } : null
    case 'paper.update': {
      if (!paperId) return null
      const a: Action = { op, paperId }
      if (STATUSES.includes(o.status as ReadingStatus)) a.status = o.status as ReadingStatus
      if (typeof o.starred === 'boolean') a.starred = o.starred
      if (tags(o.addTags)?.length) a.addTags = tags(o.addTags)
      if (tags(o.removeTags)?.length) a.removeTags = tags(o.removeTags)
      if (Array.isArray(o.constructs)) a.constructs = constructIds(o.constructs)
      return Object.keys(a).length > 2 ? a : null
    }
    case 'note.create':
      return str(o.markdown) || str(o.title)
        ? { op, title: str(o.title) ?? 'Nota del asistente', markdown: str(o.markdown) ?? '', paperIds: (Array.isArray(o.paperIds) ? o.paperIds : []).filter((x): x is string => typeof x === 'string') }
        : null
    case 'note.append':
      return noteId && str(o.markdown) ? { op, noteId, markdown: str(o.markdown)! } : null
    case 'note.update': {
      if (!noteId) return null
      const a: Action = { op, noteId }
      if (str(o.title)) a.title = str(o.title)
      if (typeof o.pinned === 'boolean') a.pinned = o.pinned
      const ids = Array.isArray(o.addPaperIds) ? o.addPaperIds.filter((x): x is string => typeof x === 'string') : []
      if (ids.length) a.addPaperIds = ids
      return Object.keys(a).length > 2 ? a : null
    }
    case 'highlight.comment': {
      const annotationId = str(o.annotationId)
      return annotationId && typeof o.comment === 'string' ? { op, annotationId, comment: o.comment.trim() } : null
    }
    case 'settings.update': {
      const patch: SettingsPatch = {}
      if (typeof o.thesisTitle === 'string') patch.thesisTitle = o.thesisTitle.trim()
      if (typeof o.researchQuestion === 'string') patch.researchQuestion = o.researchQuestion.trim()
      if (STYLES.includes(o.citationStyle as CitationStyle)) patch.citationStyle = o.citationStyle as CitationStyle
      return Object.keys(patch).length ? { op, patch } : null
    }
    case 'research.update': {
      const patch: Partial<ResearchSettings> = {}
      if (Array.isArray(o.constructs)) {
        const ids = constructIds(o.constructs)
        if (ids.length === 2) patch.constructs = ids
      }
      if (Array.isArray(o.demographics)) patch.demographics = o.demographics.filter((d): d is string => typeof d === 'string' && DEMOGRAPHICS.some((x) => x.id === d))
      if (typeof o.hypotheses === 'string') patch.hypotheses = o.hypotheses.trim()
      return Object.keys(patch).length ? { op, patch } : null
    }
    case 'plan.create':
      return { op }
    case 'analysis.insert':
      return ANALYSIS_TABLES.includes(o.table as AnalysisTableId) ? { op, table: o.table as AnalysisTableId } : null
    case 'guide.build':
      return paperId ? { op, paperId } : null
    case 'open': {
      const view = VIEWS.includes(o.view as View) ? (o.view as View) : undefined
      const page = typeof o.page === 'number' && o.page > 0 ? Math.round(o.page) : undefined
      const annotationId = str(o.annotationId)
      return paperId || noteId || annotationId || view ? { op, paperId, noteId, annotationId, view, page } : null
    }
    case 'read':
      return paperId || noteId || o.thesis === true ? { op, paperId, noteId, thesis: o.thesis === true || undefined } : null
    case 'matrix.show': {
      const seen = new Set<string>()
      const papers = (Array.isArray(o.papers) ? o.papers : []).flatMap((x) => {
        const r = (x ?? {}) as Record<string, unknown>
        const id = typeof x === 'string' ? x.trim() : str(r.paperId)
        if (!id || seen.has(id)) return []
        seen.add(id)
        return [{ paperId: id, why: str(r.why) ?? '' }]
      })
      return papers.length ? { op, label: str(o.label) ?? 'Selección del asistente', papers } : null
    }
    case 'matrix.clear':
      return { op }
  }
  return null
}

/** Valid topic ids, deduplicated, in model order. */
const constructIds = (v: unknown[]): ConstructId[] => CONSTRUCT_ORDER.filter((id) => v.includes(id))

const SHAPES: ShapeType[] = ['rectangle', 'ellipse', 'diamond']
const BOARD_COLORS: BoardColor[] = ['blue', 'green', 'yellow', 'red', 'violet', 'orange', 'teal', 'gray', 'none']
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function cleanSkeleton(raw: unknown): Skeleton | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const color = BOARD_COLORS.includes(o.color as BoardColor) ? (o.color as BoardColor) : undefined
  const id = str(o.id)
  if (SHAPES.includes(o.type as ShapeType)) {
    const x = num(o.x) ?? 0
    const y = num(o.y) ?? 0
    return { type: o.type as ShapeType, id, x, y, width: num(o.width), height: num(o.height), label: str(o.label) ?? str(o.text), color, dashed: o.dashed === true }
  }
  if (o.type === 'text') {
    const text = str(o.text) ?? str(o.label)
    return text ? { type: 'text', id, x: num(o.x) ?? 0, y: num(o.y) ?? 0, text, fontSize: num(o.fontSize), color } : null
  }
  if (o.type === 'arrow' || o.type === 'line') {
    const points = Array.isArray(o.points) ? o.points.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number')) : undefined
    const from = str(o.from)
    const to = str(o.to)
    if (!(from && to) && !(points && points.length >= 2)) return null
    return { type: o.type, id, from, to, points, x: num(o.x), y: num(o.y), label: str(o.label), dashed: o.dashed === true, color }
  }
  return null
}

function cleanDrawing(o: Record<string, unknown>): Action | null {
  const title = str(o.title)
  const mermaid = str(o.mermaid)
  if (mermaid) return { op: 'board.draw', title, mermaid }
  const elements = (Array.isArray(o.elements) ? o.elements : []).map(cleanSkeleton).filter((e): e is Skeleton => !!e).slice(0, 80)
  return elements.length ? { op: 'board.draw', title, elements } : null
}

const CMDS: PomodoroCmd[] = ['start', 'pause', 'resume', 'skip', 'stop', 'extend']

function cleanPomodoro(o: Record<string, unknown>, cmd: string): Action | null {
  if (!CMDS.includes(cmd as PomodoroCmd)) return null
  if (cmd === 'start') {
    const taskId = str(o.taskId) ?? str(o.id)
    const title = str(o.title)
    return taskId || title ? { op: 'pomodoro', cmd, taskId, title } : null
  }
  if (cmd === 'extend') {
    const minutes = typeof o.minutes === 'number' && o.minutes > 0 ? Math.min(60, Math.round(o.minutes)) : 5
    return { op: 'pomodoro', cmd, minutes }
  }
  return { op: 'pomodoro', cmd: cmd as PomodoroCmd }
}

/** Splits an answer into prose and actions; `pending` while the block is still streaming in. */
export function parseActions(text: string): { prose: string; actions: Action[] | null; pending: boolean } {
  const m = text.match(FENCE)
  if (!m || m.index === undefined) return { prose: text, actions: null, pending: false }
  const prose = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim()
  if (m[3] !== '```') return { prose, actions: null, pending: true }
  try {
    const raw = JSON.parse(m[2]) as Record<string, unknown> | unknown[]
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.actions) ? raw.actions : Array.isArray(raw.ops) ? raw.ops : []
    return { prose, actions: list.map((x) => cleanAction(x, m[1] === 'tasks')).filter((a): a is Action => !!a), pending: false }
  } catch {
    return { prose, actions: [], pending: false }
  }
}

// ---------- validity & description ----------

type World = { papers: Record<string, Paper>; notes: Record<string, Note>; tasks: Record<string, Task>; lists: Record<string, PaperList>; annotations: Record<string, Annotation> }

export function actionValid(a: Action, w: World): boolean {
  switch (a.op) {
    case 'task':
      return opValid(a.task, w.tasks) && (a.task.op !== 'add' || !a.task.paperId || !!w.papers[a.task.paperId])
    case 'list.add':
      return !!w.papers[a.paperId]
    case 'list.remove':
      return !!w.papers[a.paperId] && !!listByName(a.list)?.paperIds.includes(a.paperId)
    case 'paper.update':
    case 'guide.build':
      return !!w.papers[a.paperId]
    case 'note.append':
    case 'note.update':
      return !!w.notes[a.noteId]
    case 'highlight.comment':
      return !!w.annotations[a.annotationId]
    case 'pomodoro': {
      const run = usePomodoro.getState().run
      if (a.cmd === 'start') {
        const t = a.taskId ? w.tasks[a.taskId] : undefined
        // A title may name a task added in the same block, which doesn't exist yet.
        return t ? t.status !== 'done' : !a.taskId && !!a.title
      }
      if (a.cmd === 'pause') return run?.state === 'running'
      if (a.cmd === 'resume') return !!run && run.state !== 'running'
      return !!run
    }
    case 'open':
      return a.annotationId ? !!w.annotations[a.annotationId] : a.paperId ? !!w.papers[a.paperId] : a.noteId ? !!w.notes[a.noteId] : true
    case 'matrix.show':
      return a.papers.some((p) => w.papers[p.paperId])
    case 'plan.create':
      return changeCount(planChanges(useStore.getState().settings, Object.values(w.tasks))) > 0
    case 'analysis.insert':
      return !!analysisTable(a.table)
    case 'cite.fix':
      return a.fix.sources!.every((c) => !!w.papers[c.paperId]) && citePlan(a.fix).ok
    case 'reference.add': {
      const live = liveThesis()
      return !!live && referenceValid(a.apa) && !manualReferences(live.doc).some((r) => r.replace(/\s+/g, ' ') === a.apa.replace(/\*/g, '').replace(/\s+/g, ' ').trim())
    }
    default:
      return true
  }
}

const STATUS_LABEL: Record<ReadingStatus, string> = { unread: 'por leer', reading: 'leyendo', read: 'leído' }
const paperName = (w: World, id?: string) => (id && w.papers[id] ? shortLabel(w.papers[id]) : 'paper')
const firstLine = (md: string) => md.replace(/^[#>\-*\s]+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 140)

export type Kind = 'add' | 'edit' | 'remove' | 'done' | 'list' | 'note' | 'guide' | 'highlight' | 'settings' | 'timer' | 'board'

/** One line for what an action does (or did, once applied). */
export function describeAction(a: Action, w: World, applied: boolean): { title: string; detail: string; kind: Kind } {
  switch (a.op) {
    case 'task': {
      const d = applied ? describeApplied(a.task, w.tasks, w.papers) : describeOp(a.task, w.tasks, w.papers)
      const kind = a.task.op === 'add' ? 'add' : a.task.op === 'delete' ? 'remove' : a.task.status === 'done' ? 'done' : 'edit'
      return { title: d.title, detail: `Tarea · ${d.detail}`.replace(/ · $/, ''), kind }
    }
    case 'list.add': {
      const fresh = !listByName(a.list)
      return { title: w.papers[a.paperId]?.title ?? 'Paper', detail: `→ lista «${a.list}»${fresh && !applied ? ' (nueva)' : ''}`, kind: 'list' }
    }
    case 'list.remove':
      return { title: w.papers[a.paperId]?.title ?? 'Paper', detail: `sale de «${a.list}»`, kind: 'remove' }
    case 'paper.update': {
      const bits: string[] = []
      if (a.status) bits.push(`→ ${STATUS_LABEL[a.status]}`)
      if (a.starred !== undefined) bits.push(a.starred ? '★ destacado' : 'sin destacar')
      if (a.addTags) bits.push(a.addTags.map((t) => `+#${t}`).join(' '))
      if (a.removeTags) bits.push(a.removeTags.map((t) => `−#${t}`).join(' '))
      if (a.constructs) bits.push(`temas: ${a.constructs.map((c) => CONSTRUCTS[c].short).join(', ') || 'ninguno'}`)
      return { title: w.papers[a.paperId]?.title ?? 'Paper', detail: bits.join(' · '), kind: 'edit' }
    }
    case 'note.create':
      return { title: a.title, detail: `Nota nueva${a.paperIds.length ? ` · ${a.paperIds.map((id) => paperName(w, id)).join(', ')}` : ''} · ${firstLine(a.markdown)}`, kind: 'note' }
    case 'note.append':
      return { title: `Agregar a «${w.notes[a.noteId]?.title || 'nota'}»`, detail: firstLine(a.markdown), kind: 'note' }
    case 'note.update': {
      const bits: string[] = []
      if (a.title) bits.push(`→ «${a.title}»`)
      if (a.pinned !== undefined) bits.push(a.pinned ? 'fijada' : 'sin fijar')
      if (a.addPaperIds) bits.push(`+ ${a.addPaperIds.map((id) => paperName(w, id)).join(', ')}`)
      return { title: w.notes[a.noteId]?.title || 'Nota sin título', detail: bits.join(' · '), kind: 'note' }
    }
    case 'highlight.comment': {
      const h = w.annotations[a.annotationId]
      return { title: h ? `«${h.text.replace(/\s+/g, ' ').slice(0, 90)}»` : 'Resaltado', detail: `${h ? `${paperName(w, h.paperId)}, p. ${h.page} · ` : ''}${a.comment ? `comentario: ${firstLine(a.comment)}` : 'sin comentario'}`, kind: 'highlight' }
    }
    case 'settings.update': {
      const p = a.patch
      const bits = [p.thesisTitle !== undefined && `Tema: ${p.thesisTitle || '(vacío)'}`, p.researchQuestion !== undefined && `Pregunta: ${p.researchQuestion || '(vacía)'}`, p.citationStyle && `Estilo de citas: ${p.citationStyle.toUpperCase()}`].filter(Boolean)
      return { title: 'Ajustes de la tesis', detail: bits.join(' · '), kind: 'settings' }
    }
    case 'research.update': {
      const p = a.patch
      const bits = [
        p.constructs && `Temas: ${p.constructs.map((c) => CONSTRUCTS[c].label).join(' × ')}`,
        p.demographics && `Demografía: ${p.demographics.map((d) => DEMOGRAPHICS.find((x) => x.id === d)?.label).join(', ') || 'ninguna'}`,
        p.hypotheses !== undefined && `Hipótesis: ${firstLine(p.hypotheses) || '(vacías)'}`
      ].filter(Boolean)
      return { title: 'Marco de investigación', detail: bits.join(' · '), kind: 'settings' }
    }
    case 'plan.create': {
      const n = changeCount(planChanges(useStore.getState().settings, Object.values(w.tasks)))
      return { title: 'Plan de la tesis por entregas', detail: applied ? 'Cronograma ajustado a las entregas' : `${n} tareas e hitos para agregar o reprogramar`, kind: 'add' }
    }
    case 'analysis.insert': {
      const t = analysisTable(a.table)
      return { title: t?.title ?? 'Tabla de resultados', detail: `Tesis · ${applied ? 'tabla APA insertada' : 'insertar tabla APA donde está el cursor'}`, kind: 'note' }
    }
    case 'guide.build':
      return { title: w.papers[a.paperId]?.title ?? 'Paper', detail: 'Armar la guía de lectura', kind: 'guide' }
    case 'pomodoro':
      return describePomodoro(a, w, applied)
    case 'board.draw': {
      const shapes = a.mermaid
        ? `diagrama ${a.mermaid.trim().split(/\s/)[0]} (${new Set(a.mermaid.match(/\b[\w-]+(?=[\[({])/g) ?? []).size} nodos)`
        : `${a.elements!.filter((e) => e.type !== 'arrow' && e.type !== 'line').length} formas, ${a.elements!.filter((e) => e.type === 'arrow' || e.type === 'line').length} conexiones`
      return { title: a.title || 'Diagrama', detail: `Pizarra · ${applied ? 'dibujado' : 'dibujar'} · ${shapes}`, kind: 'board' }
    }
    case 'cite.fix': {
      const f = a.fix
      const cite = f.text?.trim() || citeLabel(f.sources ?? [], w)
      const plan = applied ? null : citePlan(f)
      const missing = f.sources?.some((c) => !w.papers[c.paperId])
      const where = plan?.ok === false ? plan.reason : missing ? 'El paper no está en tu biblioteca' : f.why || 'Tesis'
      return f.wrong?.trim()
        ? { title: `Cita: ${f.wrong.trim()} → ${cite}`, detail: where, kind: 'edit' }
        : { title: `Citar ${cite} en «…${f.context.trim().split(/\s+/).slice(-6).join(' ')}»`, detail: where, kind: 'add' }
    }
    case 'reference.add': {
      const why = a.why ? ` · ${a.why}` : ''
      return { title: a.apa.replace(/\*/g, ''), detail: `Referencias bibliográficas · ${applied ? 'agregada' : 'agregar'}${why}`, kind: 'add' }
    }
    default:
      return { title: '', detail: '', kind: 'edit' }
  }
}

const citePlan = (f: CiteFix) => {
  const live = liveThesis()
  return live ? planCiteFix(live.doc, f, thesisLeaf) : ({ ok: false, reason: 'Abrí tu tesis' } as const)
}

const citeLabel = (sources: CitedSource[], w: World) =>
  inTextGroup(
    sources.flatMap((c) => (w.papers[c.paperId] ? [{ paper: w.papers[c.paperId], page: c.page }] : [])),
    THESIS_CITE.style,
    THESIS_CITE.locale
  ) || 'la cita'

/** Citation fixes and references, in one step of the thesis's undo history. */
function applyToThesis(fixes: CiteFix[], refs: string[]): () => void {
  let applied = false
  void withThesisEditor((editor) => {
    const tr = editor.state.tr
    let state = editor.state
    const part = (c: CitedSource) => {
      const p = useStore.getState().papers[c.paperId]
      return p ? inText(p, THESIS_CITE.style, c.page ?? undefined, THESIS_CITE.locale).slice(1, -1) : ''
    }
    const take = (t: Transaction | null) => {
      if (!t) return
      for (const step of t.steps) tr.step(step)
      state = editor.state.apply(tr)
    }
    for (const f of fixes) take(citeFixTransaction(state, f, thesisLeaf, part))
    for (const apa of refs) take(referenceTransaction(state, apa))
    if (!tr.steps.length) {
      toast('No pude aplicar los cambios en la tesis: el texto cambió.', undefined, { status: 'error' })
      return true
    }
    editor.view.dispatch(tr.scrollIntoView())
    applied = true
    return true
  })
  return () => {
    if (applied) void withThesisEditor((editor) => void editor.commands.undo())
  }
}

const CMD_LABEL: Record<Exclude<PomodoroCmd, 'start'>, [string, string]> = {
  pause: ['Pausar el pomodoro', 'pausado'],
  resume: ['Seguir con el pomodoro', 'en marcha'],
  skip: ['Saltar a la próxima fase', 'salteada'],
  stop: ['Detener el pomodoro', 'detenido'],
  extend: ['Sumar tiempo al pomodoro', '']
}

function describePomodoro(a: Extract<Action, { op: 'pomodoro' }>, w: World, applied: boolean): { title: string; detail: string; kind: Kind } {
  if (a.cmd === 'start') {
    const t = a.taskId ? w.tasks[a.taskId] : undefined
    const plan = t?.pomodoro ?? (t ? DEFAULT_PLAN : undefined)
    const size = plan ? ` · ${plan.sessions === 1 ? '1 sesión' : `${plan.sessions} sesiones`} de ${plan.focusMinutes} min` : ''
    return { title: t?.title || a.title || 'Tarea', detail: `Pomodoro · ${applied ? 'empezado' : 'empezar ahora'}${size}`, kind: 'timer' }
  }
  const run = usePomodoro.getState().run
  const [title, done] = CMD_LABEL[a.cmd]
  const extra = a.cmd === 'extend' ? `+${a.minutes ?? 5} min` : applied ? done : run?.title ?? ''
  return { title, detail: `Pomodoro${extra ? ` · ${extra}` : ''}`, kind: 'timer' }
}

/** The label of a jump button. */
export function openLabel(a: Extract<Action, { op: 'open' }>, w: World): string {
  if (a.annotationId && w.annotations[a.annotationId]) {
    const h = w.annotations[a.annotationId]
    return `${paperName(w, h.paperId)} · p. ${h.page} · resaltado`
  }
  if (a.paperId) return `${paperName(w, a.paperId)}${a.page ? ` · p. ${a.page}` : ''}`
  if (a.noteId) return w.notes[a.noteId]?.title || 'Nota'
  return { tasks: 'Tareas', wiki: 'Conocimiento', thesis: 'Tesis', matrix: 'Matriz', board: 'Pizarra', research: 'Marco de investigación', analysis: 'Análisis de datos' }[a.view!]
}

/** Shows the assistant's pick in the matrix (papers removed since are left out). */
export function runMatrix(a: Extract<Action, { op: 'matrix.show' | 'matrix.clear' }>): void {
  if (a.op === 'matrix.clear') return clearMatrixFilter()
  const { papers } = useStore.getState()
  const picked = a.papers.filter((p) => papers[p.paperId])
  if (!picked.length) return
  showInMatrix({ label: a.label, ids: picked.map((p) => p.paperId), why: Object.fromEntries(picked.map((p) => [p.paperId, p.why])) })
}

export function runOpen(a: Extract<Action, { op: 'open' }>): void {
  const h = a.annotationId ? useStore.getState().annotations[a.annotationId] : undefined
  if (h) return jumpTo(h.paperId, h.page, h.id)
  if (a.paperId) return a.page ? jumpTo(a.paperId, a.page) : openTab({ kind: 'paper', id: a.paperId })
  if (a.noteId) return openTab({ kind: 'note', id: a.noteId })
  if (a.view === 'tasks') return openTasks()
  if (a.view === 'wiki') return openWiki()
  if (a.view === 'matrix') return openMatrix()
  if (a.view === 'board') return openBoard()
  if (a.view === 'research') return openResearch()
  if (a.view === 'analysis') return openAnalysis()
  if (a.view === 'thesis') void openThesis()
}

// ---------- applying ----------

function markdownDoc(md: string): { content: JSONContent[]; plain: string } {
  const exts = buildExtensions('')
  const doc = generateJSON(markdownToHtml(md), exts)
  return { content: doc.content ?? [], plain: generateText(doc, exts, { blockSeparator: '\n' }) }
}

/** Applies the actions in order; returns how to undo what can be undone, and the notes it created. */
export function applyActions(actions: Action[]): { undo: () => void; notes: string[] } {
  const undo: (() => void)[] = []
  const created: string[] = []
  const tasks: TaskOp[] = []
  const timer: Extract<Action, { op: 'pomodoro' }>[] = []
  const fixes: CiteFix[] = []
  const refs: string[] = []
  for (const a of actions) {
    const s = useStore.getState()
    switch (a.op) {
      case 'task':
        tasks.push(a.task)
        break
      case 'list.add': {
        const prev = listByName(a.list)
        const next = addToList(a.list, a.paperId)
        undo.push(() => restoreList(next.id, prev))
        break
      }
      case 'list.remove': {
        const prev = listByName(a.list)
        if (!prev) break
        removeFromList(prev.id, a.paperId)
        undo.push(() => restoreList(prev.id, prev))
        break
      }
      case 'paper.update': {
        const p = s.papers[a.paperId]
        if (!p) break
        let tagList = p.tags
        if (a.addTags) tagList = [...tagList, ...a.addTags.filter((t) => !tagList.some((x) => x.toLowerCase() === t.toLowerCase()))]
        if (a.removeTags) tagList = tagList.filter((x) => !a.removeTags!.some((t) => t.toLowerCase() === x.toLowerCase()))
        patchPaper(p.id, { ...(a.status && { status: a.status }), ...(a.starred !== undefined && { starred: a.starred }), ...(a.constructs && { constructs: a.constructs, constructsManual: true }), tags: tagList })
        undo.push(() => savePaper(p))
        break
      }
      case 'note.create': {
        const { content, plain } = markdownDoc(a.markdown)
        const paperIds = a.paperIds.filter((id) => s.papers[id])
        const note = createNote({ title: a.title, content: { type: 'doc', content }, plain, paperIds }, { quiet: true })
        created.push(note.id)
        undo.push(() => deleteNote(note.id, { silent: true }))
        break
      }
      case 'note.append': {
        const n = s.notes[a.noteId]
        if (!n) break
        const { content, plain } = markdownDoc(a.markdown)
        const editor = getEditor(n.id)
        // An open editor owns the note's content: append through it (its own ⌘Z undoes it).
        if (editor && !editor.isDestroyed) {
          editor.chain().insertContentAt(editor.state.doc.content.size, content).run()
          break
        }
        const doc = (n.content as { type: string; content?: JSONContent[] } | null) ?? { type: 'doc', content: [] }
        saveNote({ ...n, content: { ...doc, content: [...(doc.content ?? []), ...content] }, plain: `${n.plain}\n${plain}`.trim(), updatedAt: Date.now() })
        undo.push(() => saveNote(n))
        break
      }
      case 'note.update': {
        const n = s.notes[a.noteId]
        if (!n) break
        const paperIds = a.addPaperIds ? [...new Set([...n.paperIds, ...a.addPaperIds.filter((id) => s.papers[id])])] : n.paperIds
        saveNote({ ...n, ...(a.title && { title: a.title }), ...(a.pinned !== undefined && { pinned: a.pinned }), paperIds, updatedAt: Date.now() })
        undo.push(() => saveNote(n))
        break
      }
      case 'highlight.comment': {
        const h = s.annotations[a.annotationId]
        if (!h) break
        saveAnnotation({ ...h, comment: a.comment || undefined, updatedAt: Date.now() })
        undo.push(() => saveAnnotation(h))
        break
      }
      case 'settings.update': {
        const prev = s.settings
        patchSettings(a.patch)
        undo.push(() => patchSettings({ thesisTitle: prev.thesisTitle, researchQuestion: prev.researchQuestion, citationStyle: prev.citationStyle }))
        break
      }
      case 'research.update': {
        const prev = s.settings.research
        patchResearch(a.patch)
        undo.push(() => patchResearch(prev))
        break
      }
      case 'plan.create': {
        undo.push(createPlan({ quiet: true }).undo)
        break
      }
      case 'analysis.insert': {
        const t = analysisTable(a.table)
        if (t) void withThesisEditor((ed) => ed.chain().focus().insertApaTable(t).run())
        break
      }
      case 'guide.build':
        void buildGuide(a.paperId)
        break
      case 'cite.fix':
        fixes.push(a.fix)
        break
      case 'reference.add':
        refs.push(a.apa)
        break
      case 'pomodoro':
        timer.push(a)
        break
      case 'board.draw': {
        const drawn = drawOnBoard(a).catch((e: Error) => {
          toast(e.message, undefined, { status: 'error' })
          return [] as string[]
        })
        undo.push(() =>
          void drawn.then((ids) => (ids.length ? eraseFromBoard(ids) : undefined)).catch((e: Error) => toast(e.message, undefined, { status: 'error' }))
        )
        break
      }
    }
  }
  if (tasks.length) undo.push(applyTaskOps(tasks))
  if (fixes.length || refs.length) undo.push(applyToThesis(fixes, refs))
  // After the tasks: a timer may start on one this same answer added.
  if (timer.length) {
    const cp = timerCheckpoint()
    for (const a of timer) runPomodoro(a)
    undo.push(() => restoreTimer(cp))
  }
  return {
    notes: created,
    undo: () => {
      for (const u of undo.reverse()) u()
      toast('Cambios deshechos')
    }
  }
}

function runPomodoro(a: Extract<Action, { op: 'pomodoro' }>): void {
  switch (a.cmd) {
    case 'start': {
      const id = a.taskId && useStore.getState().tasks[a.taskId] ? a.taskId : a.title ? taskByTitle(a.title) : undefined
      if (!id || !startTask(id)) toast('No encontré la tarea para el pomodoro')
      return
    }
    case 'pause':
      return pause()
    case 'resume':
      return resume()
    case 'skip':
      return skip()
    case 'stop':
      return stop()
    case 'extend':
      return extend(a.minutes ?? 5)
  }
}

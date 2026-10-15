import { create } from 'zustand'
import type {
  AiAccount,
  AiEffort,
  AiModel,
  AiProvider,
  AiUse,
  Annotation,
  Chat,
  ChatMessage,
  CollectionName,
  Collections,
  ConstructId,
  Dataset,
  FocusSession,
  Note,
  Paper,
  PaperGuide,
  PaperList,
  PaperRecall,
  ProgressDay,
  Settings,
  SkimFacet,
  SkimSentence,
  Task,
  Thesis,
  ThesisVersion
} from '@shared/types'
import { uid } from './lib/util'
import { DEFAULT_VOICE } from './lib/voice'
import { AI_PROVIDERS, DEFAULT_EFFORT, DEFAULT_PROVIDER, resolveEffort, resolveModel } from '@shared/ai'
import { defaultMeta, fullTitle, templateDoc } from './thesis/template'
import { warm } from './assistant/threads'

export type TabKind = 'paper' | 'note' | 'thesis' | 'board' | 'matrix' | 'tasks' | 'wiki' | 'agent' | 'research' | 'analysis'
export interface Tab {
  kind: TabKind
  id: string
}
export const tabKey = (t: Tab) => `${t.kind}:${t.id}`

export type RightTab = 'assistant' | 'guide' | 'highlights' | 'info' | 'outline' | 'checks' | 'support'
export type SidebarView = 'library' | 'notes'

export interface LastSelection {
  text: string
  paperId?: string
  page?: number
  noteId?: string
  thesis?: boolean
  at: number
}

export interface ToastOptions {
  action?: { label: string; run: () => void }
  status?: 'neutral' | 'info' | 'loading' | 'success' | 'error'
  description?: string
}

/** A request for the reader to scroll somewhere; `nonce` makes repeats fire. */
export interface JumpTarget {
  paperId: string
  page: number
  annotationId?: string
  /** A reading-guide key sentence to scroll to and flash. */
  sentenceId?: string
  /** A passage to find on the page and flash (a quote backing the thesis). */
  quote?: string
  nonce: number
}

/** Text the user wants to ask the assistant about. */
export interface Composer {
  chatId: string
  quote?: ChatMessage['quote']
  prefill?: string
  autoSend?: boolean
  nonce: number
}

/** Papers the assistant picked for the matrix, best first, each with why. */
export interface MatrixFilter {
  label: string
  ids: string[]
  why: Record<string, string>
}

/** How the literature matrix is showing: shared with the assistant, so it knows what "these papers" are. */
export interface MatrixView {
  query: string
  level: 'all' | 'high' | 'medium'
  /** A course topic, or "pair": papers that cross both chosen topics. */
  topic: 'all' | 'pair' | ConstructId
  sort: 'rank' | 'relevance' | 'year' | 'author'
  selected: string[]
  filter: MatrixFilter | null
}

const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  thesisTitle: '',
  researchQuestion: '',
  research: { constructs: [], demographics: [], hypotheses: '' },
  aiDrafts: 'warn',
  analysis: { datasetId: null, reverse: {}, winsorize: false, method: 'auto', correction: 'fdr', directions: {}, outcome: null, moderator: null, compare: [], dropSpeeders: false, dropNoBoss: false },
  citationStyle: 'apa',
  provider: DEFAULT_PROVIDER,
  model: null,
  effort: DEFAULT_EFFORT,
  theme: 'system',
  translateTo: 'Spanish',
  onboarded: false,
  voice: DEFAULT_VOICE
}

interface UiPrefs {
  sidebarOpen: boolean
  rightOpen: boolean
  rightTab: RightTab
  sidebarView: SidebarView
  tabs: Tab[]
  active: string | null
  sideNoteId: string | null
  sidebarW: number
  rightW: number
  splitRatio: number
  /** Collapsible sections the user closed or opened, by section id (true = collapsed). */
  collapsed: Record<string, boolean>
  /** Skim mode: key sentences marked on the page, by facet. */
  skim: boolean
  skimFacets: SkimFacet[]
  /** Definitions on hover and library citations, marked in the PDF. */
  marks: boolean
  /** The side panel's assistant: about what's open ('here'), or the general one, shared with its tab. */
  assistantScope: 'here' | 'general'
}

const PREFS_KEY = 'ui-prefs-v1'
function loadPrefs(): Partial<UiPrefs> {
  try {
    const p: Partial<UiPrefs> = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    // Definitions came later: show them to anyone who hadn't turned facets off.
    if (p.skimFacets?.length === 4 && !p.skimFacets.includes('definition')) p.skimFacets = [...p.skimFacets, 'definition']
    return p
  } catch {
    return {}
  }
}

export interface State extends UiPrefs {
  papers: Record<string, Paper>
  guides: Record<string, PaperGuide>
  /** Reading guides being built: paper id → start time. */
  guiding: Record<string, number>
  recalls: Record<string, PaperRecall>
  /** The paper whose recall check is open in the Guide panel; `hidePaper` blurs the PDF while answering. */
  recallFor: { paperId: string; hidePaper: boolean } | null
  annotations: Record<string, Annotation>
  notes: Record<string, Note>
  chats: Record<string, Chat>
  theses: Record<string, Thesis>
  /** Saved states of the thesis (version history). */
  versions: Record<string, ThesisVersion>
  tasks: Record<string, Task>
  /** Focus sessions (pomodoros), finished or cut short. */
  sessions: Record<string, FocusSession>
  lists: Record<string, PaperList>
  /** Imported survey data (the course's Qualtrics export). */
  datasets: Record<string, Dataset>
  /** Words written per day. */
  progress: Record<string, ProgressDay>
  /** Every use of AI on the thesis text. */
  ailog: Record<string, AiUse>
  /** The paper or note looked at most recently: what "this paper" means to the general assistant. */
  focus: { kind: 'paper' | 'note'; id: string } | null
  /** The last text the student selected in a paper or note: what "this" means to the general assistant. */
  selection: LastSelection | null
  /** The task open in the Tasks tab's detail pane. */
  selectedTask: string | null
  settings: Settings
  libraryDir: string

  paletteOpen: boolean
  paletteMode: 'all' | 'cite' | 'link'
  paletteNoteId: string | null
  settingsOpen: boolean
  findOpen: boolean
  jump: JumpTarget | null
  composer: Composer | null
  selectedAnnotation: string | null
  matrix: MatrixView

  account: AiAccount | null
  streaming: Record<string, boolean>
  /** An answer finished while the assistant was out of view (Zeigarnik / selective attention). */
  assistantUnseen: boolean
}

export const useStore = create<State>(() => ({
  papers: {},
  guides: {},
  guiding: {},
  recalls: {},
  recallFor: null,
  annotations: {},
  notes: {},
  chats: {},
  theses: {},
  versions: {},
  tasks: {},
  sessions: {},
  lists: {},
  datasets: {},
  progress: {},
  ailog: {},
  focus: null,
  selection: null,
  selectedTask: null,
  settings: DEFAULT_SETTINGS,
  libraryDir: '',
  sidebarOpen: true,
  rightOpen: true,
  rightTab: 'assistant',
  sidebarView: 'library',
  tabs: [],
  active: null,
  sideNoteId: null,
  sidebarW: 272,
  rightW: 380,
  splitRatio: 0.56,
  collapsed: {},
  skim: false,
  skimFacets: ['goal', 'method', 'finding', 'limitation', 'definition'],
  marks: true,
  assistantScope: 'general',
  paletteOpen: false,
  paletteMode: 'all',
  paletteNoteId: null,
  settingsOpen: false,
  findOpen: false,
  jump: null,
  composer: null,
  selectedAnnotation: null,
  matrix: { query: '', level: 'all', topic: 'all', sort: 'relevance', selected: [], filter: null },
  account: null,
  streaming: {},
  assistantUnseen: false,
  ...loadPrefs()
}))

const set = useStore.setState
const get = useStore.getState

// Persist UI prefs (cheap, local only).
useStore.subscribe((s, prev) => {
  if (
    s.tabs === prev.tabs &&
    s.active === prev.active &&
    s.sidebarOpen === prev.sidebarOpen &&
    s.rightOpen === prev.rightOpen &&
    s.rightTab === prev.rightTab &&
    s.sidebarView === prev.sidebarView &&
    s.sideNoteId === prev.sideNoteId &&
    s.sidebarW === prev.sidebarW &&
    s.rightW === prev.rightW &&
    s.splitRatio === prev.splitRatio &&
    s.collapsed === prev.collapsed &&
    s.skim === prev.skim &&
    s.skimFacets === prev.skimFacets &&
    s.marks === prev.marks &&
    s.assistantScope === prev.assistantScope
  )
    return
  const prefs: UiPrefs = {
    tabs: s.tabs,
    active: s.active,
    sidebarOpen: s.sidebarOpen,
    rightOpen: s.rightOpen,
    rightTab: s.rightTab,
    sidebarView: s.sidebarView,
    sideNoteId: s.sideNoteId,
    sidebarW: s.sidebarW,
    rightW: s.rightW,
    splitRatio: s.splitRatio,
    collapsed: s.collapsed,
    skim: s.skim,
    skimFacets: s.skimFacets,
    marks: s.marks,
    assistantScope: s.assistantScope
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota / private mode
  }
})

// ---------- persistence ----------

type MapKey = 'papers' | 'guides' | 'recalls' | 'annotations' | 'notes' | 'chats' | 'theses' | 'versions' | 'tasks' | 'sessions' | 'lists' | 'datasets' | 'progress' | 'ailog'

function save<K extends MapKey>(col: K, doc: Collections[K]): void {
  set((s) => ({ [col]: { ...s[col], [doc.id]: doc } }) as Partial<State>)
  window.api.db.put(col as CollectionName, doc)
}

function drop(col: MapKey, id: string): void {
  set((s) => {
    const next = { ...s[col] }
    delete next[id]
    return { [col]: next } as Partial<State>
  })
  window.api.db.remove(col, id)
}

// ---------- boot ----------

export async function boot(): Promise<void> {
  const snap = await window.api.db.load()
  const byId = <T extends { id: string }>(arr: T[]) => Object.fromEntries(arr.map((d) => [d.id, d]))
  const papers = byId(snap.papers)
  const notes = byId(snap.notes)
  const theses = byId(snap.theses ?? [])
  // Drop tabs whose documents disappeared.
  const tabs = get().tabs.filter((t) =>
    t.kind === 'board' || t.kind === 'matrix' || t.kind === 'tasks' || t.kind === 'wiki' || t.kind === 'agent' || t.kind === 'research' || t.kind === 'analysis' ? true : t.kind === 'paper' ? papers[t.id] : t.kind === 'thesis' ? theses[t.id] : notes[t.id]
  )
  const active = tabs.some((t) => tabKey(t) === get().active) ? get().active : tabs[0] ? tabKey(tabs[0]) : null
  set({
    papers,
    notes,
    theses,
    versions: byId(snap.versions ?? []),
    tasks: byId(snap.tasks ?? []),
    sessions: byId(snap.sessions ?? []),
    lists: byId(snap.lists ?? []),
    datasets: byId(snap.datasets ?? []),
    progress: byId(snap.progress ?? []),
    ailog: byId(snap.ailog ?? []),
    guides: byId(snap.guides ?? []),
    recalls: byId(snap.recalls ?? []),
    annotations: byId(snap.annotations),
    chats: byId(snap.chats.map(repairInterrupted)),
    settings: migrateSettings(snap.settings[0]),
    libraryDir: snap.libraryDir,
    tabs,
    active,
    sideNoteId: get().sideNoteId && notes[get().sideNoteId!] ? get().sideNoteId : null
  })
  // Restored tabs: the active paper or note is what the general assistant starts focused on.
  const [fk, fid] = (active ?? '').split(':')
  if ((fk === 'paper' && papers[fid]) || (fk === 'note' && notes[fid])) set({ focus: { kind: fk as 'paper' | 'note', id: fid } })
  applyTheme(get().settings.theme)

  window.api.ai.onEvent((e) => {
    if (e.type === 'status') return e.account.provider === get().settings.provider ? set({ account: e.account }) : undefined
    // An answer still arriving for a conversation that was set aside: let it go.
    if (abandoned.has(e.chatId)) {
      if (e.type !== 'delta') {
        abandoned.delete(e.chatId)
        set((s) => ({ streaming: { ...s.streaming, [e.chatId]: false } }))
      }
      return
    }
    const chat = get().chats[e.chatId]
    if (!chat) return
    const msgs = chat.messages.slice()
    const last = msgs[msgs.length - 1]
    if (!last || last.role !== 'assistant') return
    if (e.type === 'delta') {
      msgs[msgs.length - 1] = { ...last, text: last.text + e.delta, partial: true }
      const next = { ...chat, messages: msgs }
      // Saved every second or so while it streams: quitting mid-answer keeps what arrived.
      if (Date.now() - (persistedAt.get(chat.id) ?? 0) > STREAM_SAVE_MS) {
        persistedAt.set(chat.id, Date.now())
        save('chats', next)
      } else set((s) => ({ chats: { ...s.chats, [chat.id]: next } }))
      return
    }
    if (e.type === 'done') msgs[msgs.length - 1] = { ...last, text: e.text || last.text, partial: undefined }
    if (e.type === 'error') msgs[msgs.length - 1] = { ...last, text: last.text || e.message, error: !last.text, partial: undefined }
    set((s) => ({
      streaming: { ...s.streaming, [chat.id]: false },
      assistantUnseen: s.assistantUnseen || !assistantInView(s, chat.id)
    }))
    save('chats', { ...chat, messages: msgs, updatedAt: Date.now() })
    if (e.type === 'error' && last.text) toast(e.message)
  })

  void refreshAccount()
}

export async function refreshAccount(): Promise<void> {
  const provider = get().settings.provider
  const account = await window.api.ai.account(provider)
  // The user may have switched providers while this was in flight.
  if (provider === get().settings.provider) set({ account })
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
darkQuery.addEventListener('change', () => applyTheme(get().settings.theme))

export function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && darkQuery.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

// ---------- toasts ----------

type ToastSink = (text: string, opts: ToastOptions) => void
let toastSink: ToastSink | null = null
/** The toast host registers itself here; calls before it mounts are dropped. */
export function setToastSink(sink: ToastSink | null): void {
  toastSink = sink
}

export function toast(text: string, action?: ToastOptions['action'], opts: Omit<ToastOptions, 'action'> = {}): void {
  toastSink?.(text, { ...opts, action })
}

// ---------- tabs ----------

export function openTab(tab: Tab, opts: { background?: boolean } = {}): void {
  const key = tabKey(tab)
  set((s) => ({
    tabs: s.tabs.some((t) => tabKey(t) === key) ? s.tabs : [...s.tabs, tab],
    active: opts.background ? s.active ?? key : key
  }))
}

export function closeTab(key: string): void {
  set((s) => {
    const i = s.tabs.findIndex((t) => tabKey(t) === key)
    if (i < 0) return {}
    const tabs = s.tabs.filter((_, j) => j !== i)
    let active = s.active
    if (s.active === key) {
      const n = tabs[Math.min(i, tabs.length - 1)]
      active = n ? tabKey(n) : null
    }
    return { tabs, active }
  })
}

/** Applies a new tab order from dragging in the tab bar. */
export function reorderTabs(tabs: Tab[]): void {
  set({ tabs })
}

export function activeTab(s: State = get()): Tab | null {
  return s.tabs.find((t) => tabKey(t) === s.active) ?? null
}

export function jumpTo(paperId: string, page: number, annotationId?: string): void {
  openTab({ kind: 'paper', id: paperId })
  set({ jump: { paperId, page, annotationId, nonce: Date.now() }, selectedAnnotation: annotationId ?? null })
}

/** Opens a paper on a page and flashes a passage of it, found in the page's text. */
export function jumpToQuote(paperId: string, page: number, quote: string): void {
  openTab({ kind: 'paper', id: paperId })
  set({ jump: { paperId, page, quote, nonce: Date.now() } })
}

export function jumpToSentence(paperId: string, s: SkimSentence): void {
  openTab({ kind: 'paper', id: paperId })
  set({ jump: { paperId, page: s.page, sentenceId: s.rects.length ? s.id : undefined, nonce: Date.now() } })
}

// ---------- papers ----------

export function savePaper(p: Paper): void {
  save('papers', { ...p, updatedAt: Date.now() })
}

export function patchPaper(id: string, patch: Partial<Paper>): void {
  const p = get().papers[id]
  if (!p) return
  save('papers', { ...p, ...patch, updatedAt: Date.now() })
  // Peak-end + goal-gradient: finishing a paper is a moment worth marking.
  if (patch.status === 'read' && p.status !== 'read') {
    const all = Object.values(get().papers)
    const read = all.filter((x) => x.status === 'read').length
    // Retrieval practice while it's fresh: the strongest step for remembering a paper.
    toast(
      `Terminaste “${p.title.length > 36 ? `${p.title.slice(0, 36)}…` : p.title}”`,
      { label: 'Comprobá lo que leíste', run: () => openRecall(id) },
      { status: 'success', description: `${read} de ${all.length} papers leídos` }
    )
  }
}

export async function deletePaper(id: string): Promise<void> {
  const p = get().papers[id]
  if (!p) return
  closeTab(`paper:${id}`)
  for (const a of Object.values(get().annotations)) if (a.paperId === id) drop('annotations', a.id)
  drop('papers', id)
  if (get().guides[id]) drop('guides', id)
  if (get().recalls[id]) drop('recalls', id)
  if (get().chats[`paper:${id}`]) drop('chats', `paper:${id}`)
  for (const l of listsFor(id)) removeFromList(l.id, id)
  await window.api.papers.trash(p.fileName)
  toast('Paper movido a la papelera')
}

// ---------- reading guides ----------

export function saveGuide(g: PaperGuide): void {
  save('guides', g)
}

// ---------- recall check ----------

export function saveRecall(r: PaperRecall): void {
  save('recalls', r)
}

/** Opens the recall check for a paper: its tab, the Guide panel, and the PDF hidden while you answer. */
export function openRecall(paperId: string): void {
  openTab({ kind: 'paper', id: paperId })
  set({ rightOpen: true, rightTab: 'guide', recallFor: { paperId, hidePaper: true } })
}

// ---------- annotations ----------

export function saveAnnotation(a: Annotation): void {
  save('annotations', a)
}

export function deleteAnnotation(id: string): void {
  const a = get().annotations[id]
  if (!a) return
  drop('annotations', id)
  toast('Resaltado eliminado', { label: 'Deshacer', run: () => save('annotations', a) })
}

// ---------- notes ----------

export function createNote(init: Partial<Note> = {}, opts: { side?: boolean; quiet?: boolean } = {}): Note {
  const now = Date.now()
  const note: Note = {
    id: uid(),
    title: '',
    content: null,
    plain: '',
    paperIds: [],
    createdAt: now,
    updatedAt: now,
    ...init
  }
  save('notes', note)
  if (opts.side) set({ sideNoteId: note.id })
  else if (!opts.quiet) openTab({ kind: 'note', id: note.id })
  return note
}

export function saveNote(n: Note): void {
  save('notes', n)
}

export function deleteNote(id: string, opts: { silent?: boolean } = {}): void {
  const n = get().notes[id]
  if (!n) return
  closeTab(`note:${id}`)
  if (get().sideNoteId === id) set({ sideNoteId: null })
  drop('notes', id)
  if (get().chats[`note:${id}`]) drop('chats', `note:${id}`)
  if (!opts.silent) toast('Nota eliminada', { label: 'Deshacer', run: () => save('notes', n) })
}

// ---------- thesis ----------

/** The thesis (one per library): opened as a tab, created from the UCEMA template on first use. */
export function currentThesis(): Thesis | null {
  return Object.values(get().theses).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
}

export function openThesis(): Thesis {
  let t = currentThesis()
  if (!t) {
    const now = Date.now()
    t = { id: uid(), meta: defaultMeta(), content: templateDoc(), plain: '', createdAt: now, updatedAt: now }
    save('theses', t)
  }
  openTab({ kind: 'thesis', id: t.id })
  return t
}

export function saveThesis(t: Thesis): void {
  save('theses', t)
  // The assistant reads the thesis title from settings.
  const title = fullTitle(t.meta)
  if (title && title !== get().settings.thesisTitle) patchSettings({ thesisTitle: title })
}

/** Saves a version of the thesis (see thesis/versions.ts for when and how many). */
export function saveVersion(v: ThesisVersion): void {
  save('versions', v)
}

export function dropVersion(id: string): void {
  drop('versions', id)
}

// ---------- whiteboard ----------

/** The Excalidraw whiteboard: one per app; its drawing lives in Excalidraw's own persistent storage. */
export const BOARD_TAB: Tab = { kind: 'board', id: 'excalidraw' }

export function openBoard(): void {
  openTab(BOARD_TAB)
}

// ---------- literature matrix ----------

export const MATRIX_TAB: Tab = { kind: 'matrix', id: 'library' }

export function openMatrix(): void {
  openTab(MATRIX_TAB)
}

export function patchMatrix(patch: Partial<MatrixView>): void {
  set((s) => ({ matrix: { ...s.matrix, ...patch } }))
}

/** The assistant's pick, shown in the matrix in its order. */
export function showInMatrix(filter: MatrixFilter): void {
  openMatrix()
  patchMatrix({ filter, sort: 'rank', level: 'all', topic: 'all', query: '' })
}

export function clearMatrixFilter(): void {
  set((s) => ({ matrix: { ...s.matrix, filter: null, sort: s.matrix.sort === 'rank' ? 'relevance' : s.matrix.sort } }))
}

// ---------- research framework ----------

export const RESEARCH_TAB: Tab = { kind: 'research', id: 'framework' }

/** The course's research framework, the student's choices and the live checks. */
export function openResearch(): void {
  openTab(RESEARCH_TAB)
}

// ---------- data analysis ----------

export const ANALYSIS_TAB: Tab = { kind: 'analysis', id: 'data' }

/** The course dataset: scoring, reliability, descriptives and the tests for the student's pair. */
export function openAnalysis(): void {
  openTab(ANALYSIS_TAB)
}

export function saveDataset(d: Dataset): void {
  save('datasets', d)
}

export function deleteDataset(id: string): void {
  drop('datasets', id)
  if (get().settings.analysis.datasetId === id) patchAnalysis({ datasetId: null })
}

/** Changes how the data is analysed (merged into what's there). */
export function patchAnalysis(patch: Partial<Settings['analysis']>): void {
  patchSettings({ analysis: { ...get().settings.analysis, ...patch } })
}

// ---------- progress ----------

export function saveProgress(p: ProgressDay): void {
  save('progress', p)
}

// ---------- AI use log ----------

export function logAiUse(init: Omit<AiUse, 'id' | 'at'> & { id?: string }): AiUse {
  const entry: AiUse = { id: uid(), at: Date.now(), ...init }
  save('ailog', entry)
  return entry
}

export function patchAiUse(id: string, patch: Partial<AiUse>): void {
  const e = get().ailog[id]
  if (e) save('ailog', { ...e, ...patch })
}

// ---------- tasks ----------

export const TASKS_TAB: Tab = { kind: 'tasks', id: 'all' }

/** Opens the Tasks tab, optionally with one task open in its detail pane. */
export function openTasks(taskId?: string): void {
  openTab(TASKS_TAB)
  if (taskId) set({ selectedTask: taskId })
}

export function createTask(init: Partial<Task> = {}): Task {
  const now = Date.now()
  const task: Task = { id: uid(), title: '', notes: '', status: 'todo', priority: 'normal', createdAt: now, updatedAt: now, ...init }
  save('tasks', task)
  return task
}

export function patchTask(id: string, patch: Partial<Task>): void {
  const t = get().tasks[id]
  if (!t) return
  const next = { ...t, ...patch, updatedAt: Date.now() }
  if (patch.status && patch.status !== t.status) next.doneAt = patch.status === 'done' ? Date.now() : undefined
  save('tasks', next)
}

/** Puts a task back exactly as it was (undo). */
export function restoreTask(t: Task): void {
  save('tasks', t)
}

export function deleteTask(id: string, opts: { silent?: boolean } = {}): void {
  const t = get().tasks[id]
  if (!t) return
  if (get().selectedTask === id) set({ selectedTask: null })
  drop('tasks', id)
  if (!opts.silent) toast('Tarea eliminada', { label: 'Deshacer', run: () => save('tasks', t) })
}

// ---------- focus sessions ----------

export function saveSession(f: FocusSession): void {
  save('sessions', f)
}

export function deleteSession(id: string): void {
  drop('sessions', id)
}

// ---------- reading lists ----------

/** The shortlist of papers the thesis research may build on. */
export const CANDIDATES_LIST = 'Candidatas para la tesis'

export function listByName(name: string): PaperList | undefined {
  const key = name.trim().toLowerCase()
  return Object.values(get().lists).find((l) => l.name.trim().toLowerCase() === key)
}

export function saveList(l: PaperList): void {
  save('lists', { ...l, updatedAt: Date.now() })
}

/** Restores a list exactly as it was, or removes it when it didn't exist (undo). */
export function restoreList(id: string, prev: PaperList | undefined): void {
  if (prev) save('lists', prev)
  else if (get().lists[id]) drop('lists', id)
}

/** Adds a paper to the list with that name, creating the list if needed. */
export function addToList(name: string, paperId: string): PaperList {
  const now = Date.now()
  const l = listByName(name) ?? { id: uid(), name: name.trim(), paperIds: [], createdAt: now, updatedAt: now }
  const next = l.paperIds.includes(paperId) ? l : { ...l, paperIds: [...l.paperIds, paperId] }
  saveList(next)
  return next
}

export function removeFromList(listId: string, paperId: string): void {
  const l = get().lists[listId]
  if (l) saveList({ ...l, paperIds: l.paperIds.filter((id) => id !== paperId) })
}

export function deleteList(id: string): void {
  const l = get().lists[id]
  if (!l) return
  drop('lists', id)
  toast(`Lista «${l.name}» eliminada`, { label: 'Deshacer', run: () => save('lists', l) })
}

export const listsFor = (paperId: string, s: State = get()): PaperList[] => Object.values(s.lists).filter((l) => l.paperIds.includes(paperId))

// ---------- general assistant ----------

export const AGENT_TAB: Tab = { kind: 'agent', id: 'main' }

/** Opens the general assistant, optionally with text waiting in its composer. */
export function openAgent(prefill?: string): void {
  openTab(AGENT_TAB)
  if (prefill) set({ composer: { chatId: tabKey(AGENT_TAB), prefill, nonce: Date.now() } })
}

/** Whether a chat is on screen: its own tab, or the side panel showing it. */
function assistantInView(s: State, chatId: string): boolean {
  if (s.active === chatId) return true
  if (!s.rightOpen || s.rightTab !== 'assistant') return false
  return chatId === tabKey(AGENT_TAB) ? s.assistantScope === 'general' || !s.active : s.assistantScope === 'here' && s.active === chatId
}

// What "this paper" means: the last paper or note that was in front of the student.
useStore.subscribe((s, prev) => {
  if (s.active === prev.active || !s.active) return
  const [kind, id] = s.active.split(':')
  if ((kind === 'paper' || kind === 'note') && (s.focus?.kind !== kind || s.focus.id !== id)) set({ focus: { kind, id } })
})

// What "this" means: the last passage selected in the reader or an editor (kept after the selection is gone).
if (typeof document !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | undefined
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const sel = window.getSelection()
      const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? ''
      if (!sel || sel.isCollapsed || text.length < 3) return
      const node = sel.anchorNode
      const el = node instanceof Element ? node : node?.parentElement
      if (!el) return
      const [kind, id] = (get().active ?? '').split(':')
      const page = el.closest<HTMLElement>('.pdf-page[data-page]')
      const at = Date.now()
      const clipped = text.slice(0, 2000)
      if (page && kind === 'paper') return set({ selection: { text: clipped, paperId: id, page: Number(page.dataset.page) || undefined, at } })
      if (!el.closest('.ProseMirror')) return
      if (kind === 'thesis') return set({ selection: { text: clipped, thesis: true, at } })
      const noteId = kind === 'note' ? id : get().sideNoteId
      if (noteId) set({ selection: { text: clipped, noteId, at } })
    }, 250)
  })
}

// ---------- knowledge wiki ----------

export const WIKI_TAB: Tab = { kind: 'wiki', id: 'all' }

export function openWiki(): void {
  openTab(WIKI_TAB)
}

/** Tabs that use the whole width: the side panel has nothing for them. */
export const isFullWidth = (active: string | null | undefined) => !!active && active.startsWith('agent:')

// ---------- settings ----------

export function patchSettings(patch: Partial<Settings>): void {
  const settings = { ...get().settings, ...patch }
  set({ settings })
  window.api.db.put('settings', settings)
  if (patch.theme) applyTheme(patch.theme)
}

/** Settings saved before providers existed used a Fast/Balanced/Thorough scale: start them on the new default effort. */
function migrateSettings(saved: Partial<Settings> | undefined): Settings {
  // The research framework came later: fill in whatever an older file lacks.
  const research = { ...DEFAULT_SETTINGS.research, ...saved?.research }
  const analysis = { ...DEFAULT_SETTINGS.analysis, ...saved?.analysis }
  const voice = { ...DEFAULT_SETTINGS.voice, ...saved?.voice }
  if (saved && !saved.provider) return { ...DEFAULT_SETTINGS, ...saved, research, analysis, voice, provider: DEFAULT_PROVIDER, model: null, effort: DEFAULT_EFFORT }
  return { ...DEFAULT_SETTINGS, ...saved, research, analysis, voice }
}

/** Changes the research framework choices (merged into what's there). */
export function patchResearch(patch: Partial<Settings['research']>): void {
  patchSettings({ research: { ...get().settings.research, ...patch } })
}

/** Changes the writing voice (merged into what's there). */
export function patchVoice(patch: Partial<Settings['voice']>): void {
  patchSettings({ voice: { ...get().settings.voice, ...patch } })
}

/** Switches the subscription the assistant runs on; the model falls back to that provider's default. */
export function setProvider(provider: AiProvider): void {
  if (provider === get().settings.provider) return
  patchSettings({ provider, model: null })
  set({ account: null })
  void refreshAccount()
}

export const providerLabel = (s: Settings = get().settings) => AI_PROVIDERS[s.provider].label

/** The model the assistant uses now; its id also tells main which provider to call. */
export function aiModel(s: Settings = get().settings): AiModel {
  return resolveModel(s.provider, s.model)
}

/** The chat effort, clamped to what the current model supports. */
export function aiEffort(s: Settings = get().settings): AiEffort {
  return resolveEffort(aiModel(s), s.effort)
}

// ---------- chats ----------

const STREAM_SAVE_MS = 1000
const persistedAt = new Map<string, number>()
/** Chats whose in-flight answer belongs to a conversation that went to the history. */
const abandoned = new Set<string>()

function stopStreaming(chatId: string): void {
  if (!get().streaming[chatId]) return
  abandoned.add(chatId)
  void window.api.ai.interrupt(chatId)
}

/** An answer cut off when the app closed: keep what arrived, and say so if nothing did. */
function repairInterrupted(chat: Chat): Chat {
  const last = chat.messages.at(-1)
  if (!last || last.role !== 'assistant' || last.text.trim() || last.error) return chat
  return { ...chat, messages: [...chat.messages.slice(0, -1), { ...last, text: 'La respuesta se interrumpió (la app se cerró antes de terminar).', error: true }] }
}

/** A conversation's name in the history: its first real question. */
export function conversationTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && !m.auto && m.text.trim()) ?? messages.find((m) => m.role === 'user')
  const text = (first?.text || first?.quote?.text || 'Conversación').replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 78)}…` : text
}

/** Past conversations of a context, newest first. */
export function conversationsOf(chatId: string, chats: Record<string, Chat> = get().chats): Chat[] {
  return Object.values(chats)
    .filter((c) => c.archivedFrom === chatId && c.messages.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Moves the live conversation into the history; returns the archived copy. */
function archive(chatId: string): Chat | null {
  const cur = get().chats[chatId]
  if (!cur?.messages.length) return null
  const copy: Chat = {
    id: `${chatId}@${Date.now()}`,
    archivedFrom: chatId,
    title: cur.branch?.name ?? conversationTitle(cur.messages),
    branch: cur.branch,
    messages: cur.messages,
    updatedAt: cur.updatedAt || Date.now()
  }
  save('chats', copy)
  drop('chats', chatId)
  return copy
}

/** The model forgets the thread; the next message replays whatever conversation is live then. */
function forgetThread(chatId: string): void {
  warm.delete(chatId)
  void window.api.ai.reset(chatId)
}

/** Starts a fresh conversation; the current one is kept in the history, not deleted. */
export function newConversation(chatId: string): void {
  stopStreaming(chatId)
  const saved = archive(chatId)
  forgetThread(chatId)
  if (saved)
    toast('Conversación guardada en el historial', {
      label: 'Volver a ella',
      run: () => openConversation(chatId, saved.id)
    })
}

/** Brings a past conversation back as the live one (the current one goes to the history). */
export function openConversation(chatId: string, archivedId: string): void {
  const past = get().chats[archivedId]
  if (!past) return
  stopStreaming(chatId)
  archive(chatId)
  drop('chats', archivedId)
  save('chats', { id: chatId, messages: past.messages, branch: past.branch, updatedAt: Date.now() })
  forgetThread(chatId)
}

/**
 * Forks the live conversation at one of its answers: a branch with everything
 * up to there, to follow that thread on its own. Kept in the history for later,
 * or opened right away (the current conversation then goes to the history).
 */
export function forkConversation(chatId: string, messageId: string, name: string, open: boolean): void {
  const cur = get().chats[chatId]
  const idx = cur?.messages.findIndex((m) => m.id === messageId) ?? -1
  if (!cur || idx < 0) return
  const messages = cur.messages.slice(0, idx + 1)
  const now = Date.now()
  const branch = { name: name.trim() || conversationTitle(messages), from: cur.branch?.name ?? conversationTitle(cur.messages), at: now }
  if (open) {
    stopStreaming(chatId)
    archive(chatId)
    save('chats', { id: chatId, messages, branch, updatedAt: now })
    forgetThread(chatId)
    toast(`Estás en la rama «${branch.name}»`, undefined, { description: 'La conversación original quedó en el historial.' })
    return
  }
  const id = `${chatId}@${now}`
  save('chats', { id, archivedFrom: chatId, title: branch.name, branch, messages, updatedAt: now })
  toast(`Rama «${branch.name}» guardada`, { label: 'Abrir ahora', run: () => openConversation(chatId, id) }, { status: 'success' })
}

export function deleteConversation(id: string): void {
  const c = get().chats[id]
  if (!c) return
  drop('chats', id)
  toast('Conversación eliminada', { label: 'Deshacer', run: () => save('chats', c) })
}

export function appendMessages(chatId: string, ...messages: ChatMessage[]): Chat {
  const prev = get().chats[chatId] ?? { id: chatId, messages: [], updatedAt: 0 }
  const chat = { ...prev, messages: [...prev.messages, ...messages], updatedAt: Date.now() }
  save('chats', chat)
  return chat
}


export function patchMessage(chatId: string, messageId: string, patch: Partial<ChatMessage>): void {
  const chat = get().chats[chatId]
  if (!chat) return
  save('chats', { ...chat, messages: chat.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) })
}

export function setStreaming(chatId: string, on: boolean): void {
  set((s) => ({ streaming: { ...s.streaming, [chatId]: on } }))
}

export function askAssistant(c: Omit<Composer, 'nonce'>): void {
  // The side panel set to "General" takes the question: it's the same assistant, and it knows what's open.
  const chatId = get().assistantScope === 'general' ? tabKey(AGENT_TAB) : c.chatId
  set({ rightOpen: true, rightTab: 'assistant', composer: { ...c, chatId, nonce: Date.now() } })
}

/** Show/hide a note beside the active paper; picks or creates the paper's note. */
export function toggleSideNote(): void {
  const s = get()
  const tab = activeTab()
  if (tab?.kind !== 'paper') return
  if (s.sideNoteId) return set({ sideNoteId: null })
  set({ sideNoteId: notesForPaper(tab.id)[0]?.id ?? createNote(paperNoteInit(tab.id), { side: true }).id })
}

export function notesForPaper(paperId: string): Note[] {
  return Object.values(get().notes)
    .filter((n) => n.paperIds.includes(paperId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export const paperNoteInit = (paperId: string): Partial<Note> => ({
  title: `Notas sobre ${get().papers[paperId]?.title ?? 'paper'}`,
  paperIds: [paperId]
})

// ---------- collapsible sections ----------

export function isCollapsed(id: string, defaultOpen = true, s: State = get()): boolean {
  return s.collapsed[id] ?? !defaultOpen
}

export function setCollapsed(ids: string | string[], collapsed: boolean): void {
  set((s) => {
    const next = { ...s.collapsed }
    for (const id of Array.isArray(ids) ? ids : [ids]) next[id] = collapsed
    return { collapsed: next }
  })
}

export function openPalette(mode: State['paletteMode'] = 'all', noteId: string | null = null): void {
  set({ paletteOpen: true, paletteMode: mode, paletteNoteId: noteId })
}

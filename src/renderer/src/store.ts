import { create } from 'zustand'
import type {
  AiAccount,
  AiEffort,
  AiModel,
  AiProvider,
  Annotation,
  Chat,
  ChatMessage,
  CollectionName,
  Collections,
  Note,
  Paper,
  PaperGuide,
  PaperRecall,
  Settings,
  SkimFacet,
  SkimSentence,
  Thesis
} from '@shared/types'
import { uid } from './lib/util'
import { AI_PROVIDERS, DEFAULT_EFFORT, DEFAULT_PROVIDER, resolveEffort, resolveModel } from '@shared/ai'
import { defaultMeta, fullTitle, templateDoc } from './thesis/template'

export type TabKind = 'paper' | 'note' | 'thesis' | 'board' | 'matrix'
export interface Tab {
  kind: TabKind
  id: string
}
export const tabKey = (t: Tab) => `${t.kind}:${t.id}`

export type RightTab = 'assistant' | 'guide' | 'highlights' | 'info' | 'outline' | 'checks'
export type SidebarView = 'library' | 'notes'

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

const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  thesisTitle: '',
  researchQuestion: '',
  citationStyle: 'apa',
  provider: DEFAULT_PROVIDER,
  model: null,
  effort: DEFAULT_EFFORT,
  theme: 'system',
  translateTo: 'Spanish',
  onboarded: false
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
  paletteOpen: false,
  paletteMode: 'all',
  paletteNoteId: null,
  settingsOpen: false,
  findOpen: false,
  jump: null,
  composer: null,
  selectedAnnotation: null,
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
    s.marks === prev.marks
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
    marks: s.marks
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota / private mode
  }
})

// ---------- persistence ----------

type MapKey = 'papers' | 'guides' | 'recalls' | 'annotations' | 'notes' | 'chats' | 'theses'

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
    t.kind === 'board' || t.kind === 'matrix' ? true : t.kind === 'paper' ? papers[t.id] : t.kind === 'thesis' ? theses[t.id] : notes[t.id]
  )
  const active = tabs.some((t) => tabKey(t) === get().active) ? get().active : tabs[0] ? tabKey(tabs[0]) : null
  set({
    papers,
    notes,
    theses,
    guides: byId(snap.guides ?? []),
    recalls: byId(snap.recalls ?? []),
    annotations: byId(snap.annotations),
    chats: byId(snap.chats),
    settings: migrateSettings(snap.settings[0]),
    libraryDir: snap.libraryDir,
    tabs,
    active,
    sideNoteId: get().sideNoteId && notes[get().sideNoteId!] ? get().sideNoteId : null
  })
  applyTheme(get().settings.theme)

  window.api.ai.onEvent((e) => {
    if (e.type === 'status') return e.account.provider === get().settings.provider ? set({ account: e.account }) : undefined
    const chat = get().chats[e.chatId]
    if (!chat) return
    const msgs = chat.messages.slice()
    const last = msgs[msgs.length - 1]
    if (!last || last.role !== 'assistant') return
    if (e.type === 'delta') {
      msgs[msgs.length - 1] = { ...last, text: last.text + e.delta }
      set((s) => ({ chats: { ...s.chats, [chat.id]: { ...chat, messages: msgs } } }))
      return
    }
    if (e.type === 'done') msgs[msgs.length - 1] = { ...last, text: e.text || last.text }
    if (e.type === 'error') msgs[msgs.length - 1] = { ...last, text: last.text || e.message, error: !last.text }
    set((s) => ({
      streaming: { ...s.streaming, [chat.id]: false },
      assistantUnseen: s.assistantUnseen || !(s.rightOpen && s.rightTab === 'assistant' && s.active === chat.id)
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

export function activeTab(s: State = get()): Tab | null {
  return s.tabs.find((t) => tabKey(t) === s.active) ?? null
}

export function jumpTo(paperId: string, page: number, annotationId?: string): void {
  openTab({ kind: 'paper', id: paperId })
  set({ jump: { paperId, page, annotationId, nonce: Date.now() }, selectedAnnotation: annotationId ?? null })
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
      `Finished “${p.title.length > 36 ? `${p.title.slice(0, 36)}…` : p.title}”`,
      { label: 'Comprobá lo que leíste', run: () => openRecall(id) },
      { status: 'success', description: `${read} of ${all.length} papers read` }
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
  await window.api.papers.trash(p.fileName)
  toast('Paper moved to Trash')
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
  toast('Highlight removed', { label: 'Undo', run: () => save('annotations', a) })
}

// ---------- notes ----------

export function createNote(init: Partial<Note> = {}, opts: { side?: boolean } = {}): Note {
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
  else openTab({ kind: 'note', id: note.id })
  return note
}

export function saveNote(n: Note): void {
  save('notes', n)
}

export function deleteNote(id: string): void {
  const n = get().notes[id]
  if (!n) return
  closeTab(`note:${id}`)
  if (get().sideNoteId === id) set({ sideNoteId: null })
  drop('notes', id)
  if (get().chats[`note:${id}`]) drop('chats', `note:${id}`)
  toast('Note deleted', { label: 'Undo', run: () => save('notes', n) })
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

/** Tabs that use the whole width: the side panel has nothing for them. */
export const isFullWidth = (active: string | null | undefined) => !!active && (active.startsWith('board:') || active.startsWith('matrix:'))

// ---------- settings ----------

export function patchSettings(patch: Partial<Settings>): void {
  const settings = { ...get().settings, ...patch }
  set({ settings })
  window.api.db.put('settings', settings)
  if (patch.theme) applyTheme(patch.theme)
}

/** Settings saved before providers existed used a Fast/Balanced/Thorough scale: start them on the new default effort. */
function migrateSettings(saved: Partial<Settings> | undefined): Settings {
  if (saved && !saved.provider) return { ...DEFAULT_SETTINGS, ...saved, provider: DEFAULT_PROVIDER, model: null, effort: DEFAULT_EFFORT }
  return { ...DEFAULT_SETTINGS, ...saved }
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

export function appendMessages(chatId: string, ...messages: ChatMessage[]): Chat {
  const prev = get().chats[chatId] ?? { id: chatId, messages: [], updatedAt: 0 }
  const chat = { ...prev, messages: [...prev.messages, ...messages], updatedAt: Date.now() }
  save('chats', chat)
  return chat
}

/** Clears a conversation; the toast offers Undo (the transcript is replayed on the next message). */
export function clearChat(chatId: string): void {
  const prev = get().chats[chatId]
  if (prev) drop('chats', chatId)
  void window.api.ai.reset(chatId)
  if (prev?.messages.length) toast('Conversation cleared', { label: 'Undo', run: () => save('chats', prev) })
}

export function setStreaming(chatId: string, on: boolean): void {
  set((s) => ({ streaming: { ...s.streaming, [chatId]: on } }))
}

export function askAssistant(c: Omit<Composer, 'nonce'>): void {
  set({ rightOpen: true, rightTab: 'assistant', composer: { ...c, nonce: Date.now() } })
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
  title: `Notes on ${get().papers[paperId]?.title ?? 'paper'}`,
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

// Domain types shared by the main process, preload and renderer.

export interface Author {
  given: string
  family: string
}

export type PaperType = 'article' | 'book' | 'chapter' | 'report' | 'thesis' | 'conference' | 'web'
export type ReadingStatus = 'unread' | 'reading' | 'read'

export interface Paper {
  id: string
  fileName: string
  title: string
  authors: Author[]
  year?: string
  type: PaperType
  venue?: string // journal, book title or conference
  volume?: string
  issue?: string
  pages?: string
  /** Journals that number articles instead of pages (e1234, 1158992): APA cites «Artículo e1234». */
  articleNumber?: string
  /** Editors of the book a chapter or conference paper is in. */
  editors?: Author[]
  publisher?: string
  doi?: string
  url?: string
  abstract?: string
  tags: string[]
  status: ReadingStatus
  starred?: boolean
  pageCount?: number
  /** Printed page = PDF page + offset (APA cites the page printed on the article). offset null: checked, not found. */
  printedPages?: { offset: number | null; source: 'auto' | 'manual' }
  lastPage?: number
  maxPage?: number
  textStatus: 'pending' | 'ready' | 'error'
  metaSource?: 'pdf' | 'crossref' | 'ai' | 'manual'
  /** Which of the course's five topics the paper is about: from its guide, its title or abstract, or set by hand. */
  constructs?: ConstructId[]
  /** True once the student edited `constructs`: guides stop overwriting them. */
  constructsManual?: boolean
  addedAt: number
  updatedAt: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export interface Rect {
  x: number // normalized 0..1 relative to page width
  y: number
  w: number
  h: number
}

export interface Annotation {
  id: string
  paperId: string
  page: number // 1-based
  rects: Rect[]
  text: string
  color: HighlightColor
  comment?: string
  /** Spanish translation of `text` (absent when the text is already Spanish). */
  translation?: string
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  title: string
  content: unknown // TipTap JSON document
  plain: string // plain-text mirror for search & AI context
  paperIds: string[]
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  quote?: { paperId: string; page: number; text: string }
  error?: boolean
  /** The changes this answer proposed that were applied (indexes into its actions), and when. */
  applied?: { at: number; ops: number[] }
  /** Saved while it was still arriving; still set if the app closed before it finished. */
  partial?: boolean
  /** Sent by the app, not typed: material the assistant asked to read. Shown as one line. */
  auto?: { label: string }
  /** Paper ids of the chat's sources when it was sent: what its [S1], [S2]… point to, whatever the list is later. */
  sources?: string[]
  createdAt: number
}

export interface Chat {
  id: string // context key: "paper:<id>" | "note:<id>"; archived: "<key>@<timestamp>"
  messages: ChatMessage[]
  updatedAt: number
  /** Set on a past conversation kept in the history: the context it belongs to. */
  archivedFrom?: string
  /** What it was about (its first question), for the history list. */
  title?: string
  /** Set on a branch: a copy of another conversation up to one answer, kept to pick that thread up later. */
  branch?: ChatBranch
}

export interface ChatBranch {
  /** The student's name for it (defaults to the question it continues). */
  name: string
  /** The conversation it was forked from, by title. */
  from: string
  at: number
}

export type CitationStyle = 'apa' | 'harvard' | 'mla' | 'chicago'

/** The five research topics set by the course; each student crosses two. */
export type ConstructId = 'attachment' | 'empathy' | 'tfl' | 'security' | 'ocb'

/** The student's choices inside the course's research framework (see renderer/src/research/framework.ts). */
export interface ResearchSettings {
  /** The two topics crossed, in the order picked. */
  constructs: ConstructId[]
  /** Demographic variables used as additional crosses. */
  demographics: string[]
  /** The student's own working hypotheses, in their words. */
  hypotheses: string
}

export interface Settings {
  id: 'settings'
  thesisTitle: string
  researchQuestion: string
  research: ResearchSettings
  citationStyle: CitationStyle
  /** Which subscription answers: ChatGPT (Codex CLI) or Claude (Claude Code CLI). */
  provider: AiProvider
  /** A model of `provider`; null uses that provider's default. */
  model: string | null
  /** Reasoning effort for the assistant chat; helpers pick their own. */
  effort: AiEffort
  theme: 'system' | 'light' | 'dark'
  /** Target language for the reader's Translate action. */
  translateTo: string
  onboarded: boolean
  /** May the thesis assistant propose draft paragraphs? Always marked, logged and warned about (Turnitin). */
  aiDrafts: 'off' | 'warn'
  analysis: AnalysisSettings
  /** How the student writes: the writing helpers match it (Ajustes → Tu voz). */
  voice: VoiceProfile
}

/** The student's own writing voice, built up over time from what they describe and what they wrote. */
export interface VoiceProfile {
  enabled: boolean
  /** In the student's words: how they want to sound. */
  description: string
  /** Grammatical subject of the prose. */
  person: 'impersonal' | 'nosotros' | 'yo' | 'mixto'
  sentences: 'cortas' | 'variadas' | 'largas'
  /** Words, phrasings and connectors the student uses (one per line). */
  prefer: string
  /** Words and phrasings to keep out (one per line). */
  avoid: string
  /** Paragraphs the student wrote: the reference for their voice. */
  samples: VoiceSample[]
  /** What the analysis of the samples found (editable). */
  traits: string
  analyzedAt: number | null
}

export interface VoiceSample {
  id: string
  text: string
  source: 'pegado' | 'tesis'
  addedAt: number
}

/** How the course dataset is analysed (see renderer/src/analysis). */
export interface AnalysisSettings {
  datasetId: string | null
  /** Reverse-keyed items per scale key id (1-based item numbers), when the student changed the defaults. */
  reverse: Record<string, number[]>
  /** Clamp |z| > 3 to ±3 SD before testing. */
  winsorize: boolean
  /** Correlation and group tests: chosen from the skewness, or forced. */
  method: 'auto' | 'parametric' | 'nonparametric'
  /** How the correlation matrix's p values are corrected for multiple tests. */
  correction: 'fdr' | 'bonferroni'
  /** Hypothesized sign per pair of variables ("idA|idB", ids sorted): tested one-tailed when set. */
  directions: Record<string, '+' | '-'>
  /** Which of the pair's topics is the regression's outcome (null: the second). */
  outcome: ConstructId | null
  /** Demographic id tested as a moderator of the regression's predictors. */
  moderator: string | null
  /** Two correlations to compare ("idA|idB" each), as the guide's section 7. */
  compare: string[]
  /** Leave out responses faster than a third of the median duration. */
  dropSpeeders: boolean
  /** Leave out owners/founders (Q2.5): they have no direct boss to describe in the TFL and LSPS. */
  dropNoBoss?: boolean
}

// ---------- data analysis ----------

export type Cell = number | string | null

/** The course's Qualtrics export, as imported: one row per response. */
export interface Dataset {
  id: string
  name: string
  /** Column codes (Q3.1_1…) from the first row. */
  columns: string[]
  /** Question text per column (Qualtrics' second row), when present. */
  questions: string[]
  rows: Cell[][]
  /** Exported with value labels ("Con etiquetas") rather than numeric codes. */
  labeled: boolean
  importedAt: number
}

// ---------- progress ----------

/** One day of work on the thesis (id = 'YYYY-MM-DD'): the last word count seen that day. */
export interface ProgressDay {
  id: string
  words: number
  bySection: Record<string, number>
  updatedAt: number
}

// ---------- AI use log ----------

export type AiUseKind = 'draft' | 'assist' | 'autocomplete'

/** One use of AI on the thesis text, kept for transparency with the tutor (UCEMA pautas, 8.e). */
export interface AiUse {
  id: string
  at: number
  kind: AiUseKind
  /** What was asked: the helper's name, or the request that produced a draft. */
  label: string
  chars: number
  /** Inserted into the thesis (false: proposed and dismissed). */
  accepted: boolean
  /** Drafts only: the student confirmed they reviewed and rewrote it. */
  reviewedAt?: number
}

/** Yes/no answers for the three publication authorizations (null = not chosen yet). */
export interface ThesisAuthorizations {
  repositorio: boolean | null
  catalogo: boolean | null
  web: boolean | null
}

/** Cover page and last page data; everything else lives in the TipTap document. */
export interface ThesisMeta {
  title: string
  subtitle: string
  author: string
  tutorDegree: string
  tutor: string
  date: string // ISO yyyy-mm-dd
  dni: string
  auth: ThesisAuthorizations
}

export interface Thesis {
  id: string
  meta: ThesisMeta
  content: unknown // TipTap JSON document (sections)
  plain: string // plain-text mirror for the assistant
  createdAt: number
  updatedAt: number
}

/** A saved state of the thesis, to compare against or go back to. */
export interface ThesisVersion {
  id: string
  thesisId: string
  at: number
  content: unknown // TipTap JSON document
  meta: ThesisMeta
  words: number
  /** Named by the student (or by the app, before a restore): never pruned. Unnamed ones are taken every few minutes of writing and thinned out with age. */
  label?: string
}

// ---------- reading guide ----------

/** What a key sentence does in the paper's argument (skim mode colors). */
export type SkimFacet = 'goal' | 'method' | 'finding' | 'limitation' | 'definition'

export interface SkimSentence {
  id: string
  facet: SkimFacet
  page: number // 1-based; corrected to where the text was actually found
  text: string // verbatim from the paper
  /** Where the sentence sits on its page; empty when it could not be located. */
  rects: Rect[]
}

export type SectionAdvice = 'read' | 'skim' | 'skip'

export interface GuideSection {
  title: string
  page: number
  gist: string
  advice: SectionAdvice
  /** Why that advice, given the student's thesis. */
  why: string
}

export interface GuideTerm {
  term: string
  /** The term exactly as printed in the paper (for definitions on hover); absent in v1 guides. */
  original?: string
  definition: string
  page: number
  /** The key sentence (facet "definition") where the paper itself defines the term, when it does. */
  sentenceId?: string
}

/** One row of the literature matrix: the paper in comparable, short fields (Spanish). */
export interface MatrixFields {
  question: string
  theory: string
  method: string
  context: string // sample, setting, data
  findings: string
  limitations: string
}

/** 1: original guide; 2: recall questions, matrix row, terms as printed; 3: the paper's own definitions. (Course topics came later as an optional field: older guides fall back to matching the title and abstract.) */
export const GUIDE_VERSION = 3

/** A map of one paper for faster, purposeful reading. One per paper (id = paper id). */
export interface PaperGuide {
  id: string
  tldr: string
  /** How the paper bears on the student's thesis. */
  relevance: string
  relevanceLevel: 'high' | 'medium' | 'low'
  sections: GuideSection[]
  sentences: SkimSentence[]
  terms: GuideTerm[]
  /** Questions to keep in mind while reading. */
  questions: string[]
  /** Core questions to read for, then answer from memory (recall check). */
  recall?: string[]
  /** The course topics the paper is about (newer guides only). */
  constructs?: ConstructId[]
  matrix?: MatrixFields
  version?: number
  language: string
  words: number
  createdAt: number
}

// ---------- recall check ----------

export type RecallVerdict = 'right' | 'partial' | 'missed'

export interface RecallAnswer {
  question: string
  answer: string // the student's own words
  verdict: RecallVerdict
  feedback: string
  pages: number[]
}

export interface RecallAttempt {
  at: number
  answers: RecallAnswer[]
  summary: string
  score: number // 0..1
}

/** Answering a paper's questions from memory, spaced over time. One per paper (id = paper id). */
export interface PaperRecall {
  id: string
  attempts: RecallAttempt[]
  /** Days until the next review, and when it falls due. */
  interval: number
  dueAt: number
}

// ---------- tasks ----------

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'

/** Something to do for the thesis, optionally placed on the timeline. Days are local 'YYYY-MM-DD'. */
export interface Task {
  id: string
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  /** First day of work; with `due`, the task spans a bar on the timeline. */
  start?: string
  due?: string
  /** A single point in time (a submission, a meeting with the advisor): a diamond on the timeline. */
  milestone?: boolean
  paperId?: string
  /** How the task is meant to be worked: focus sessions with breaks between. */
  pomodoro?: PomodoroPlan
  /** The thesis stage it belongs to (research/framework.ts PHASES), set by the plan. */
  phaseId?: string
  createdAt: number
  updatedAt: number
  doneAt?: number
}

// ---------- pomodoro ----------

/** `sessions` focus blocks, a short break between them and a long one every few. */
export interface PomodoroPlan {
  focusMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  sessions: number
}

/** One focus session, run to zero or cut short (logged only past a minute). */
export interface FocusSession {
  id: string
  taskId?: string
  start: number
  end: number
  /** Time actually running, pauses excluded. */
  focusedSeconds: number
  /** True when the timer ran to zero; false when it was stopped, reset or skipped part-way. */
  completed: boolean
}

// ---------- reading lists ----------

/** A named, ordered set of papers ("Candidatas para la tesis", "Capítulo 2"…). */
export interface PaperList {
  id: string
  name: string
  paperIds: string[]
  createdAt: number
  updatedAt: number
}

export interface Collections {
  papers: Paper
  guides: PaperGuide
  recalls: PaperRecall
  annotations: Annotation
  notes: Note
  chats: Chat
  theses: Thesis
  versions: ThesisVersion
  tasks: Task
  sessions: FocusSession
  lists: PaperList
  datasets: Dataset
  progress: ProgressDay
  ailog: AiUse
  settings: Settings
}
export type CollectionName = keyof Collections

export type LibrarySnapshot = { [K in CollectionName]: Collections[K][] }

export interface PageText {
  page: number
  text: string
}

// ---------- AI bridge ----------

export type AiProvider = 'chatgpt' | 'claude'

export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export interface AiAccount {
  provider: AiProvider
  connected: boolean
  email?: string | null
  plan?: string | null
  error?: string
}

export interface AiModel {
  id: string
  label: string
  provider: AiProvider
  /** Effort levels the model accepts, lowest first. */
  efforts: AiEffort[]
}

export type AiEvent =
  | { type: 'delta'; chatId: string; delta: string }
  | { type: 'done'; chatId: string; text: string }
  | { type: 'error'; chatId: string; message: string }
  | { type: 'status'; account: AiAccount }

export interface CrossrefWork {
  title?: string
  authors: Author[]
  year?: string
  type?: PaperType
  venue?: string
  volume?: string
  issue?: string
  pages?: string
  articleNumber?: string
  editors?: Author[]
  publisher?: string
  doi?: string
  url?: string
  abstract?: string
}

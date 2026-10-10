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
  publisher?: string
  doi?: string
  url?: string
  abstract?: string
  tags: string[]
  status: ReadingStatus
  starred?: boolean
  pageCount?: number
  lastPage?: number
  maxPage?: number
  textStatus: 'pending' | 'ready' | 'error'
  metaSource?: 'pdf' | 'crossref' | 'ai' | 'manual'
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
  createdAt: number
}

export interface Chat {
  id: string // context key: "paper:<id>" | "note:<id>"
  messages: ChatMessage[]
  updatedAt: number
}

export type CitationStyle = 'apa' | 'harvard' | 'mla' | 'chicago'

export interface Settings {
  id: 'settings'
  thesisTitle: string
  researchQuestion: string
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

/** 1: original guide; 2: recall questions, matrix row, terms as printed; 3: the paper's own definitions. */
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

export interface Collections {
  papers: Paper
  guides: PaperGuide
  recalls: PaperRecall
  annotations: Annotation
  notes: Note
  chats: Chat
  theses: Thesis
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
  publisher?: string
  doi?: string
  url?: string
  abstract?: string
}

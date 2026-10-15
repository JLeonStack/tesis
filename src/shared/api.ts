import type {
  AiAccount,
  AiEffort,
  AiEvent,
  AiProvider,
  CollectionName,
  Collections,
  CrossrefWork,
  LibrarySnapshot,
  PageText,
  Paper
} from './types'

/** Regular, bold, italic and bold italic font files. */
export type ThesisFontFiles = Record<'regular' | 'bold' | 'italic' | 'boldItalic', Uint8Array>

export interface ChatStartOptions {
  chatId: string
  instructions: string
  /** Picks the provider too (see `providerOf`); null means ChatGPT's default. */
  model?: string | null
  effort?: string
}

export interface ExtractOptions {
  /** Developer instructions for the one-shot thread (defaults to a strict extractor). */
  instructions?: string
  model?: string | null
  effort?: AiEffort
}

/** Surface exposed to the renderer as `window.api`. */
export interface Api {
  platform: NodeJS.Platform
  db: {
    load(): Promise<LibrarySnapshot & { libraryDir: string }>
    put<K extends CollectionName>(col: K, doc: Collections[K]): void
    remove(col: CollectionName, id: string): void
  }
  papers: {
    /** Opens a file picker when `paths` is omitted. */
    import(paths?: string[]): Promise<Paper[]>
    read(fileName: string): Promise<Uint8Array>
    reveal(fileName: string): void
    trash(fileName: string): Promise<void>
    pathForFile(file: File): string
  }
  text: {
    save(id: string, pages: PageText[]): Promise<void>
    get(id: string): Promise<PageText[] | null>
  }
  meta: {
    byDoi(doi: string): Promise<CrossrefWork | null>
    byTitle(title: string): Promise<CrossrefWork | null>
  }
  ai: {
    account(provider: AiProvider): Promise<AiAccount>
    login(provider: AiProvider): Promise<AiAccount>
    /** Ensures a warm thread for this chat with the given instructions. */
    prepare(opts: ChatStartOptions): Promise<void>
    send(opts: ChatStartOptions & { text: string }): Promise<void>
    interrupt(chatId: string): Promise<void>
    reset(chatId: string): Promise<void>
    /** One-shot structured extraction. Resolves with parsed JSON. */
    extract(prompt: string, schema: object, opts?: ExtractOptions): Promise<unknown>
    /** Fast structured request on a warm thread (writing helpers). Rejects with "CANCELLED" when superseded. */
    assist(opts: { instructions: string; prompt: string; schema: object; model?: string | null; channel?: 'writing' | 'complete' | 'evidence-terms' | 'evidence-check'; effort?: AiEffort | 'none' }): Promise<unknown>
    onEvent(cb: (e: AiEvent) => void): () => void
  }
  shell: {
    openExternal(url: string): void
    saveFile(defaultName: string, content: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null>
    saveBinary(defaultName: string, bytes: Uint8Array, filters?: { name: string; extensions: string[] }[]): Promise<string | null>
  }
  thesis: {
    /** Paginates a standalone Paged.js HTML document and saves it as PDF. Resolves with the saved path. */
    exportPdf(html: string, defaultName: string): Promise<string | null>
    /** Calibri from a local Microsoft Office install (never bundled: it isn't redistributable), or null. */
    calibri(): Promise<ThesisFontFiles | null>
  }
  onMenu(cb: (action: string) => void): () => void
}

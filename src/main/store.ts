import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CollectionName, LibrarySnapshot } from '../shared/types'

const COLLECTIONS: CollectionName[] = ['papers', 'guides', 'recalls', 'annotations', 'notes', 'chats', 'theses', 'versions', 'tasks', 'sessions', 'lists', 'datasets', 'progress', 'ailog', 'settings']
const WRITE_DELAY_MS = 250

type Doc = { id: string }

/**
 * Tiny document store: every collection lives in memory and is persisted to
 * one JSON file with debounced, atomic writes (tmp file + rename). A thesis
 * library is a few MB at most, so this is both simpler and faster than a DB.
 */
export class Store {
  private data = new Map<CollectionName, Map<string, Doc>>()
  private timers = new Map<CollectionName, NodeJS.Timeout>()
  private writing = new Map<CollectionName, Promise<void>>()

  constructor(private dir: string) {}

  async load(): Promise<LibrarySnapshot> {
    await mkdir(this.dir, { recursive: true })
    await Promise.all(
      COLLECTIONS.map(async (col) => {
        let docs: Doc[] = []
        try {
          docs = JSON.parse(await readFile(this.file(col), 'utf8'))
        } catch {
          // Missing or unreadable file: start empty.
        }
        this.data.set(col, new Map(docs.map((d) => [d.id, d])))
      })
    )
    return Object.fromEntries(COLLECTIONS.map((c) => [c, [...this.data.get(c)!.values()]])) as unknown as LibrarySnapshot
  }

  put(col: CollectionName, doc: Doc): void {
    this.data.get(col)?.set(doc.id, doc)
    this.schedule(col)
  }

  remove(col: CollectionName, id: string): void {
    this.data.get(col)?.delete(id)
    this.schedule(col)
  }

  all<T extends Doc>(col: CollectionName): T[] {
    return [...(this.data.get(col)?.values() ?? [])] as T[]
  }

  async flush(): Promise<void> {
    const pending = [...this.timers.keys()]
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    await Promise.all([...pending.map((c) => this.write(c)), ...this.writing.values()])
  }

  private file(col: CollectionName): string {
    return join(this.dir, `${col}.json`)
  }

  private schedule(col: CollectionName): void {
    clearTimeout(this.timers.get(col))
    this.timers.set(
      col,
      setTimeout(() => {
        this.timers.delete(col)
        void this.write(col)
      }, WRITE_DELAY_MS)
    )
  }

  private async write(col: CollectionName): Promise<void> {
    // Serialize writes per collection so renames never interleave.
    const prev = this.writing.get(col) ?? Promise.resolve()
    const next = prev.then(async () => {
      const json = JSON.stringify([...(this.data.get(col)?.values() ?? [])])
      const tmp = `${this.file(col)}.tmp`
      await writeFile(tmp, json, 'utf8')
      await rename(tmp, this.file(col))
    })
    this.writing.set(col, next.catch(() => {}))
    return next
  }
}

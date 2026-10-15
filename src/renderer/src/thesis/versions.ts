import type { Node as PMNode } from '@tiptap/pm/model'
import type { Thesis, ThesisMeta, ThesisVersion } from '@shared/types'
import { dropVersion, saveThesis, saveVersion, toast, useStore } from '../store'
import { uid } from '../lib/util'
import { buildThesisModel, thesisSchema } from './model'
import { thesisEditor, thesisMetaHandle } from './bridge'

// Version history of the thesis. While the student writes, a version is kept
// every few minutes; older ones are thinned out (hourly after a couple of hours,
// daily after two days) so the history stays useful without growing forever.
// Named versions are kept until deleted.

const AUTO_EVERY_MS = 10 * 60_000
const HOUR = 3_600_000
const KEEP_ALL_MS = 2 * HOUR
const KEEP_HOURLY_MS = 48 * HOUR
const MAX_AUTO = 60

/** Versions of a thesis, newest first. */
export function versionsOf(thesisId: string, versions: Record<string, ThesisVersion> = useStore.getState().versions): ThesisVersion[] {
  return Object.values(versions)
    .filter((v) => v.thesisId === thesisId)
    .sort((a, b) => b.at - a.at)
}

export function versionDoc(v: { content: unknown }): PMNode {
  return thesisSchema().nodeFromJSON(v.content as object)
}

export const docText = (doc: PMNode) => doc.textBetween(0, doc.content.size, '\n', ' ')

/** The thesis as it is right now, including edits the open editor hasn't saved yet. */
export function currentState(thesisId: string): { content: unknown; meta: ThesisMeta; doc: PMNode } | null {
  const t = useStore.getState().theses[thesisId]
  if (!t) return null
  const ed = thesisEditor(thesisId)
  const meta = thesisMetaHandle(thesisId)?.get() ?? t.meta
  return ed ? { content: ed.getJSON(), meta, doc: ed.state.doc } : { content: t.content, meta, doc: versionDoc(t) }
}

const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function make(thesisId: string, content: unknown, meta: ThesisMeta, doc: PMNode, label?: string): ThesisVersion {
  return { id: uid(), thesisId, at: Date.now(), content, meta, words: buildThesisModel(doc, meta).words.total, ...(label ? { label } : {}) }
}

/** Saves the thesis as it is now under a name. */
export function saveNamedVersion(thesisId: string, label: string): ThesisVersion | null {
  const cur = currentState(thesisId)
  if (!cur) return null
  const v = make(thesisId, cur.content, cur.meta, cur.doc, label.trim() || 'Versión sin nombre')
  saveVersion(v)
  return v
}

/** Called on every save: keeps a version when the last one is a while old and the text changed since. */
export function maybeAutoVersion(t: Thesis): void {
  const last = versionsOf(t.id)[0]
  if (last && Date.now() - last.at < AUTO_EVERY_MS) return
  if (last && sameContent(last.content, t.content) && sameContent(last.meta, t.meta)) return
  saveVersion(make(t.id, t.content, t.meta, versionDoc(t)))
  prune(t.id)
}

/** Thins out unnamed versions: all of the last hours, one per hour for two days, then one per day. */
function prune(thesisId: string): void {
  const now = Date.now()
  const seen = new Set<string>()
  let kept = 0
  for (const v of versionsOf(thesisId)) {
    if (v.label) continue
    const age = now - v.at
    const bucket = age < KEEP_ALL_MS ? v.id : age < KEEP_HOURLY_MS ? `h${Math.floor(v.at / HOUR)}` : `d${new Date(v.at).toDateString()}`
    if (seen.has(bucket) || kept >= MAX_AUTO) dropVersion(v.id)
    else {
      seen.add(bucket)
      kept++
    }
  }
}

export function renameVersion(v: ThesisVersion, label: string): void {
  saveVersion({ ...v, label: label.trim() || undefined })
}

export function deleteVersion(v: ThesisVersion): void {
  dropVersion(v.id)
  toast('Versión eliminada', { label: 'Deshacer', run: () => saveVersion(v) })
}

/**
 * Brings the thesis back to a version. The current state is saved first (as
 * "Antes de restaurar…"), so a restore can always be undone.
 */
export function restoreVersion(v: ThesisVersion, opts: { backup?: boolean } = {}): void {
  const t = useStore.getState().theses[v.thesisId]
  const cur = currentState(v.thesisId)
  if (!t || !cur) return
  const backup = opts.backup === false ? null : make(t.id, cur.content, cur.meta, cur.doc, `Antes de restaurar «${versionName(v)}»`)
  if (backup) saveVersion(backup)

  const ed = thesisEditor(t.id)
  const meta = thesisMetaHandle(t.id)
  if (ed && meta) {
    // Through the editor: it saves as usual, and ⌘Z undoes the restore too.
    meta.set(v.meta)
    ed.commands.setContent(v.content as object, { emitUpdate: true })
  } else {
    saveThesis({ ...t, content: v.content, meta: v.meta, plain: docText(versionDoc(v)), updatedAt: Date.now() })
  }
  toast(`Se restauró «${versionName(v)}»`, backup ? { label: 'Deshacer', run: () => restoreVersion(backup, { backup: false }) } : undefined, { status: 'success' })
}

const timeFmt = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

export function versionTime(v: ThesisVersion): string {
  return timeFmt.format(v.at)
}

/** "Hoy", "Ayer" or the date: how the history groups versions. */
export function versionDay(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  const s = dayFmt.format(d)
  return s[0].toUpperCase() + s.slice(1)
}

export function versionName(v: ThesisVersion): string {
  return v.label ?? `${versionDay(v.at)}, ${versionTime(v)}`
}

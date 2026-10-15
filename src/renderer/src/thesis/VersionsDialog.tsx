import { Fragment, useMemo, useState, type ReactNode } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Bookmark, BookmarkPlus, History, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { ThesisVersion } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { EmptyState, IconButton } from '../components/common'
import { Segmented } from '../components/Segmented'
import { toast, useStore } from '../store'
import { diffStats, diffText, type ParagraphDiff } from './diff'
import { currentState, deleteVersion, renameVersion, restoreVersion, saveNamedVersion, versionDay, versionDoc, versionName, versionTime, versionsOf } from './versions'

type Mode = 'now' | 'prev' | 'text'

interface Block {
  text: string
  heading: boolean
}

/** The document's paragraphs and headings, in order. */
function blocksOf(doc: PMNode): Block[] {
  const out: Block[] = []
  doc.descendants((node) => {
    if (!node.isTextblock) return true
    const text = node.textContent.trim()
    if (text) out.push({ text, heading: node.type.name === 'heading' })
    return false
  })
  return out
}
const textOf = (blocks: Block[]) => blocks.map((b) => b.text).join('\n')

const fmt = (n: number) => n.toLocaleString('es-AR')

export function VersionsDialog({ thesisId, open, onOpenChange }: { thesisId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,88vh)] w-[min(1120px,calc(100%-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        {open && <Versions thesisId={thesisId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Versions({ thesisId, onDone }: { thesisId: string; onDone: () => void }) {
  const all = useStore((s) => s.versions)
  const versions = useMemo(() => versionsOf(thesisId, all), [thesisId, all])
  // The text as it is when the dialog opens: what restoring or comparing is measured against.
  const [now, setNow] = useState(() => {
    const cur = currentState(thesisId)
    const blocks = cur ? blocksOf(cur.doc) : []
    return { blocks, text: textOf(blocks), content: JSON.stringify(cur?.content ?? null) }
  })
  const [selectedId, setSelectedId] = useState<string | null>(() => versions[0]?.id ?? null)
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null
  const [name, setName] = useState('')

  const save = () => {
    const v = saveNamedVersion(thesisId, name)
    if (!v) return
    setName('')
    setSelectedId(v.id)
    const cur = currentState(thesisId)
    const blocks = cur ? blocksOf(cur.doc) : []
    setNow({ blocks, text: textOf(blocks), content: JSON.stringify(cur?.content ?? null) })
    toast(`Versión «${v.label}» guardada`, undefined, { status: 'success' })
  }

  const groups = useMemo(() => {
    const out: { day: string; items: ThesisVersion[] }[] = []
    for (const v of versions) {
      const day = versionDay(v.at)
      if (out.at(-1)?.day === day) out.at(-1)!.items.push(v)
      else out.push({ day, items: [v] })
    }
    return out
  }, [versions])

  return (
    <>
      <div className="flex flex-none items-start gap-3 border-b px-5 py-4 pr-12">
        <History className="mt-0.5 size-5 flex-none text-brand" />
        <div className="min-w-0">
          <DialogTitle className="text-[15px]">Historial de versiones</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12.5px]">
            Mientras escribís se guarda una versión cada 10 minutos. Las que nombrás se conservan siempre; las demás se espacian con el tiempo.
          </DialogDescription>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[290px_1fr]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/30">
          <form
            className="flex flex-none gap-1.5 border-b p-3"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre: «Entrega al tutor»…" className="h-8 text-[12.5px]" />
            <Button type="submit" size="sm" className="h-8">
              <BookmarkPlus /> Guardar
            </Button>
          </form>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {groups.map((g) => (
              <Fragment key={g.day}>
                <p className="px-2 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.day}</p>
                {g.items.map((v) => {
                  const older = versions[versions.indexOf(v) + 1]
                  const delta = older ? v.words - older.words : null
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedId(v.id)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                        v.id === selected?.id ? 'bg-brand-soft text-brand-text' : 'hover:bg-accent'
                      )}
                    >
                      <span className="flex w-full min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
                        {v.label && <Bookmark className="size-3 flex-none fill-current" />}
                        <span className="truncate">{v.label ?? versionTime(v)}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {v.label ? `${versionTime(v)} · ` : ''}
                        {fmt(v.words)} palabras
                        {delta ? <span className={delta > 0 ? 'text-success' : 'text-destructive'}> · {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))}</span> : null}
                      </span>
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </aside>
        {selected ? (
          <VersionView key={selected.id} version={selected} previous={versions[versions.indexOf(selected) + 1] ?? null} now={now} onRestored={onDone} />
        ) : (
          <EmptyState
            icon={<History />}
            title="Todavía no hay versiones"
            description="Aparecen solas mientras escribís. También podés guardar la versión actual con un nombre."
          />
        )}
      </div>
    </>
  )
}

function VersionView({
  version,
  previous,
  now,
  onRestored
}: {
  version: ThesisVersion
  previous: ThesisVersion | null
  now: { blocks: Block[]; text: string; content: string }
  onRestored: () => void
}) {
  const [mode, setMode] = useState<Mode>('now')
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(version.label ?? '')
  const blocks = useMemo(() => blocksOf(versionDoc(version)), [version])
  const text = useMemo(() => textOf(blocks), [blocks])
  const prevText = useMemo(() => (previous ? textOf(blocksOf(versionDoc(previous))) : ''), [previous])
  const changes = useMemo(() => (mode === 'now' ? diffText(text, now.text) : mode === 'prev' ? diffText(prevText, text) : []), [mode, text, now.text, prevText])
  const stats = diffStats(changes)
  const isCurrent = JSON.stringify(version.content) === now.content

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex flex-none items-center gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                renameVersion(version, label)
                setRenaming(false)
              }}
            >
              <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre de la versión" className="h-7 max-w-72 text-[13px]" />
              <Button type="submit" size="xs">
                Listo
              </Button>
            </form>
          ) : (
            <h3 className="flex items-center gap-1 truncate text-[14px] font-semibold">
              {versionName(version)}
              <IconButton label={version.label ? 'Renombrar' : 'Ponerle nombre (se conserva siempre)'} size="icon-xs" onClick={() => setRenaming(true)}>
                <Pencil />
              </IconButton>
            </h3>
          )}
          <p className="text-[11.5px] text-muted-foreground tabular-nums">
            {versionDay(version.at)}, {versionTime(version)} · {fmt(version.words)} palabras
          </p>
        </div>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          items={[
            { value: 'now', label: 'Cambios hasta hoy', title: 'Lo que cambió desde esta versión hasta el texto actual' },
            { value: 'prev', label: 'Cambios en esta versión', title: 'Lo que cambió respecto de la versión anterior' },
            { value: 'text', label: 'Texto' }
          ]}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {mode === 'text' ? (
          <div className="mx-auto flex max-w-[68ch] flex-col gap-2.5 font-serif text-[14.5px] leading-relaxed">
            {blocks.map((b, i) => (b.heading ? <h4 key={i} className="mt-3 font-sans text-[14px] font-semibold">{b.text}</h4> : <p key={i}>{b.text}</p>))}
          </div>
        ) : mode === 'prev' && !previous ? (
          <p className="text-center text-[13px] text-muted-foreground">Es la primera versión guardada: no hay una anterior con qué compararla.</p>
        ) : stats.added + stats.removed === 0 ? (
          <p className="text-center text-[13px] text-muted-foreground">{mode === 'now' ? 'El texto no cambió desde esta versión.' : 'Sin cambios en el texto respecto de la versión anterior.'}</p>
        ) : (
          <DiffView changes={changes} />
        )}
      </div>

      <footer className="flex flex-none items-center gap-2 border-t px-5 py-3">
        {mode !== 'text' && stats.added + stats.removed > 0 && (
          <span className="text-[12px] text-muted-foreground tabular-nums">
            <span className="text-success">+{fmt(stats.added)}</span> · <span className="text-destructive">−{fmt(stats.removed)}</span> palabras
            {mode === 'now' ? ' desde esta versión' : ''}
          </span>
        )}
        <span className="flex-1" />
        <IconButton label="Eliminar versión" onClick={() => deleteVersion(version)}>
          <Trash2 />
        </IconButton>
        <Button
          size="sm"
          disabled={isCurrent}
          title={isCurrent ? 'Es igual al texto actual' : undefined}
          onClick={() => {
            restoreVersion(version)
            onRestored()
          }}
        >
          <RotateCcw /> Restaurar esta versión
        </Button>
      </footer>
    </section>
  )
}

/** Changes in reading order; long stretches without changes fold to one line. */
function DiffView({ changes }: { changes: ParagraphDiff[] }) {
  const CONTEXT = 1
  const near = (i: number) => changes.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((c) => c.type !== 'same')
  const out: ReactNode[] = []
  let folded = 0
  const flush = (key: string) => {
    if (folded) out.push(<p key={key} className="py-1 text-center text-[11.5px] text-faint">· · · {folded} {folded === 1 ? 'párrafo' : 'párrafos'} sin cambios · · ·</p>)
    folded = 0
  }
  changes.forEach((c, i) => {
    if (c.type === 'same' && !near(i)) return void folded++
    flush(`f${i}`)
    if (c.type === 'same') out.push(<p key={i} className="text-muted-foreground">{c.text}</p>)
    else if (c.type === 'add') out.push(<p key={i} className="rounded-md bg-success/10 px-2 py-1 text-foreground">{c.text}</p>)
    else if (c.type === 'del') out.push(<p key={i} className="rounded-md bg-destructive/8 px-2 py-1 text-muted-foreground line-through decoration-destructive/50">{c.text}</p>)
    else
      out.push(
        <p key={i}>
          {c.words.map((w, j) =>
            w.type === 'same' ? (
              <span key={j}>{w.value}</span>
            ) : w.type === 'add' ? (
              <ins key={j} className="rounded-sm bg-success/15 text-foreground no-underline">{w.value}</ins>
            ) : (
              <del key={j} className="rounded-sm bg-destructive/10 text-muted-foreground decoration-destructive/50">{w.value}</del>
            )
          )}
        </p>
      )
  })
  flush('end')
  return <div className="mx-auto flex max-w-[68ch] flex-col gap-2.5 font-serif text-[14.5px] leading-relaxed">{out}</div>
}

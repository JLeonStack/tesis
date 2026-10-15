import { useState } from 'react'
import { ArrowUpRight, Check, Compass, Shapes, Table2, X, GraduationCap, Highlighter, ListPlus, NotebookPen, Pencil, Plus, RotateCcw, Timer, Trash2, Wand2 } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Button } from '@/components/ui/button'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { cn } from '@/lib/utils'
import { clearMatrixFilter, openMatrix, openTab, patchMessage, toast, useStore, MATRIX_TAB, tabKey } from '../store'
import { actionValid, applyActions, describeAction, isChange, openLabel, runMatrix, runOpen, type Action, type Kind } from './actions'
import { usePomodoro } from '../pomodoro/timer'

// Undo for changes applied in this session, by message id, and when they were applied.
const undos = new Map<string, { run: () => void; at: number }>()

const ICON: Record<Kind, { icon: React.ReactNode; tone: string }> = {
  add: { icon: <Plus />, tone: 'text-status-read' },
  edit: { icon: <Pencil />, tone: 'text-status-reading' },
  remove: { icon: <Trash2 />, tone: 'text-destructive' },
  done: { icon: <Check />, tone: 'text-status-read' },
  list: { icon: <ListPlus />, tone: 'text-bloom-pink' },
  note: { icon: <NotebookPen />, tone: 'text-kind-note' },
  guide: { icon: <Compass />, tone: 'text-brand' },
  highlight: { icon: <Highlighter />, tone: 'text-bloom-amber' },
  settings: { icon: <GraduationCap />, tone: 'text-brand' },
  timer: { icon: <Timer />, tone: 'text-bloom-ember' },
  board: { icon: <Shapes />, tone: 'text-bloom-lilac' }
}

/**
 * What an answer proposes to do, as a checklist: nothing changes until the
 * student applies it, and applying can be undone. Jump buttons sit below.
 */
export function ActionsCard({ chatId, messageId, actions, pending, applied }: { chatId: string; messageId: string; actions: Action[] | null; pending: boolean; applied?: ChatMessage['applied'] }) {
  const papers = useStore((s) => s.papers)
  const notes = useStore((s) => s.notes)
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const annotations = useStore((s) => s.annotations)
  // Timer actions are valid or not depending on what the timer is doing.
  usePomodoro((s) => s.run)
  const world = { papers, notes, tasks, lists, annotations }
  const [off, setOff] = useState<Set<number>>(new Set())

  if (pending)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[12.5px]">
        <Wand2 className="size-3.5 text-brand" />
        <TextShimmer duration={1.6}>Preparando los cambios…</TextShimmer>
      </div>
    )
  if (!actions) return null
  if (!actions.length)
    return <p className="rounded-xl border border-dashed px-3 py-2 text-[12px] text-muted-foreground">No pude leer los cambios propuestos. Pedime que los vuelva a armar.</p>

  // Indexes into `actions`, so what was applied survives a restart.
  const changes = actions.map((a, i) => ({ a, i })).filter(({ a }) => isChange(a))
  const opens = actions.filter((a): a is Extract<Action, { op: 'open' }> => a.op === 'open' && actionValid(a, world))
  const views = actions.filter((a): a is Extract<Action, { op: 'matrix.show' | 'matrix.clear' }> => (a.op === 'matrix.show' || a.op === 'matrix.clear') && actionValid(a, world))
  const picked = changes.filter(({ a, i }) => !off.has(i) && actionValid(a, world)).map(({ i }) => i)

  const apply = () => {
    const { undo, notes: created } = applyActions(picked.map((i) => actions[i]))
    undos.set(messageId, { run: undo, at: Date.now() })
    patchMessage(chatId, messageId, { applied: { at: Date.now(), ops: picked } })
    const n = picked.length
    toast(
      `${n} ${n === 1 ? 'cambio aplicado' : 'cambios aplicados'}`,
      created.length === 1 ? { label: 'Abrir la nota', run: () => openTab({ kind: 'note', id: created[0] }) } : undefined,
      { status: 'success' }
    )
  }
  const undo = () => {
    const u = undos.get(messageId)
    // A double-click on "Aplicar" mustn't undo what it just did.
    if (!u || Date.now() - u.at < 800) return
    u.run()
    undos.delete(messageId)
    patchMessage(chatId, messageId, { applied: undefined })
  }

  return (
    <div className="flex flex-col gap-2">
      {changes.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-background">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px] font-medium">
            <Wand2 className="size-3.5 text-brand" />
            <span className="flex-1">{applied ? 'Cambios aplicados' : 'Cambios propuestos'}</span>
            <span className="text-faint tabular-nums">{applied ? `${applied.ops.length} de ${changes.length}` : changes.length}</span>
          </div>
          <ul className="max-h-[340px] overflow-y-auto py-1">
            {changes.map(({ a, i }) => {
              const done = !!applied?.ops.includes(i)
              const valid = applied ? done : actionValid(a, world)
              const { title, detail, kind } = describeAction(a, world, done)
              const on = !off.has(i) && valid
              return (
                <li key={i}>
                  <label className={cn('flex items-start gap-2.5 px-3 py-1.5', !applied && valid && 'cursor-pointer hover:bg-accent/60', !valid && 'opacity-50')}>
                    {!applied && (
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!valid}
                        onChange={() =>
                          setOff((s) => {
                            const next = new Set(s)
                            if (next.has(i)) next.delete(i)
                            else next.add(i)
                            return next
                          })
                        }
                        className="mt-1 size-3.5 flex-none accent-brand"
                      />
                    )}
                    <span className={cn('mt-0.5 flex-none [&_svg]:size-3.5', ICON[kind].tone)}>{ICON[kind].icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[12.5px] leading-snug', kind === 'remove' && valid && 'line-through')}>{title}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{applied && !done ? 'no aplicado' : !valid && a.op !== 'cite.fix' && a.op !== 'reference.add' ? 'ya no existe' : detail}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center gap-2 border-t px-3 py-2">
            {applied ? (
              // Undo sits on the other side from "Aplicar", out of the way of a repeated click.
              <>
                {undos.has(messageId) && (
                  <Button variant="ghost" size="xs" className="-ml-1.5" onClick={undo}>
                    <RotateCcw /> Deshacer
                  </Button>
                )}
                <span className="ml-auto flex items-center gap-1.5 text-[12px] text-status-read">
                  <Check className="size-3.5" /> Aplicado
                </span>
              </>
            ) : (
              <>
                <span className="flex-1 text-[11.5px] text-faint">Revisá y destildá lo que no quieras</span>
                <Button size="xs" disabled={!picked.length} onClick={apply}>
                  <Check /> Aplicar{picked.length === changes.length ? '' : ` ${picked.length} de ${changes.length}`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {views.map((a, i) => (
        <MatrixButton key={i} action={a} />
      ))}
      {opens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {opens.map((a, i) => (
            <button
              key={i}
              onClick={() => runOpen(a)}
              className="flex h-7 max-w-full items-center gap-1 rounded-full border bg-background px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text"
            >
              <span className="truncate">{openLabel(a, world)}</span>
              <ArrowUpRight className="size-3 flex-none" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The assistant's pick for the matrix: applied when the answer lands on the matrix, a button otherwise. */
function MatrixButton({ action: a }: { action: Extract<Action, { op: 'matrix.show' | 'matrix.clear' }> }) {
  const papers = useStore((s) => s.papers)
  const shown = useStore((s) => {
    const f = s.matrix.filter
    return a.op === 'matrix.show' && !!f && s.active === tabKey(MATRIX_TAB) && f.label === a.label && f.ids.join() === a.papers.filter((p) => papers[p.paperId]).map((p) => p.paperId).join()
  })
  if (a.op === 'matrix.clear')
    return (
      <button
        onClick={() => {
          clearMatrixFilter()
          openMatrix()
        }}
        className="flex h-7 items-center gap-1.5 self-start rounded-full border bg-background px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text"
      >
        <Table2 className="size-3.5 text-bloom-teal" /> Mostrar toda la matriz
      </button>
    )
  const n = a.papers.filter((p) => papers[p.paperId]).length
  return (
    <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2', shown ? 'border-bloom-teal/40 bg-bloom-teal/8' : 'bg-background')}>
      <Table2 className="size-3.5 flex-none text-bloom-teal" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] leading-snug font-medium">{a.label}</span>
        <span className="block text-[11.5px] text-muted-foreground">
          {n} {n === 1 ? 'paper' : 'papers'}, del más al menos pertinente{shown ? ' · en la matriz' : ''}
        </span>
      </span>
      {shown ? (
        <Button variant="ghost" size="xs" onClick={clearMatrixFilter}>
          <X /> Quitar filtro
        </Button>
      ) : (
        <Button variant="outline" size="xs" onClick={() => runMatrix(a)}>
          Ver en la matriz <ArrowUpRight />
        </Button>
      )}
    </div>
  )
}

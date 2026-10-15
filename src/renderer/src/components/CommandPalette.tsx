import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { FileText, NotebookPen, Upload, Plus, Settings2, Moon, Sun, BookMarked, Sparkles, PanelLeft, Quote, Link2, GraduationCap, FileDown, ScanText, Compass, ListTodo, Shapes, Table2, BookOpenText, Pause, Play, SkipForward, Square, Timer, Crosshair, ChartColumn, Check, X } from 'lucide-react'
import { activeTab, createNote, openBoard, openMatrix, openTasks, openThesis, openWiki, openAgent, openResearch, openAnalysis, openTab, patchSettings, saveNote, toast, useStore } from '../store'
import { exportThesisDocx, exportThesisPdf } from '../thesis/exporting'
import { importPapers } from '../lib/ingest'
import { exportBibliography } from '../lib/exporting'
import { authorLine, inText, inTextGroup } from '../lib/citation'
import { matchScore, mod } from '../lib/util'
import { focusedEditor, getEditor } from '../editor/noteBridge'
import { canonicalIds } from '../thesis/typed'
import { extend, PHASE_LABEL, skip, startTask, stop, toggle, usePomodoro } from '../pomodoro/timer'

interface Item {
  id: string
  group: string
  title: string
  sub?: string
  icon: React.ReactNode
  hint?: string
  run: () => void
  score?: number
}

const LIMIT = 8 // per group; keeps choices scannable (Hick's law)

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  if (!open) return null
  return <Palette />
}

function Palette() {
  const mode = useStore((s) => s.paletteMode)
  const noteId = useStore((s) => s.paletteNoteId)
  const papers = useStore((s) => s.papers)
  const notes = useStore((s) => s.notes)
  const theme = useStore((s) => s.settings.theme)
  const tasks = useStore((s) => s.tasks)
  const run = usePomodoro((s) => s.run)
  const [q, setQ] = useState('')
  // Citing: sources gathered for one parenthesis, and the highlighted row.
  const [picked, setPicked] = useState<string[]>([])
  const [active, setActive] = useState('')
  const togglePick = (id: string) => setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]))
  const close = () => useStore.setState({ paletteOpen: false, paletteMode: 'all', paletteNoteId: null })

  const items = useMemo<Item[]>(() => {
    const style = useStore.getState().settings.citationStyle
    const paperItems = (run: (id: string) => void, sub?: (id: string) => string): Item[] =>
      Object.values(papers)
        .map((p) => ({
          id: `p:${p.id}`,
          group: 'Papers',
          title: p.title,
          sub: sub ? sub(p.id) : `${authorLine(p) || 'Autor desconocido'}${p.year ? ` · ${p.year}` : ''}`,
          icon: <FileText size={15} />,
          run: () => run(p.id),
          score: q ? matchScore(`${p.title} ${authorLine(p, 99)} ${p.year ?? ''} ${p.tags.join(' ')}`, q) : p.updatedAt
        }))
        .filter((i) => i.score >= 0)

    if (mode === 'cite') {
      // Copies of a paper in the library make one reference: offer only the most complete one.
      const canon = canonicalIds(Object.values(papers))
      return paperItems(
        (id) => cite(picked.includes(id) ? picked : [...picked, id]),
        (id) => inText(papers[id], style)
      ).filter((i) => canon.get(i.id.slice(2)) === i.id.slice(2))
    }
    if (mode === 'link') {
      const note = noteId ? notes[noteId] : null
      return paperItems((id) => {
        if (!note) return
        if (!note.paperIds.includes(id)) saveNote({ ...note, paperIds: [...note.paperIds, id], updatedAt: Date.now() })
        toast('Paper vinculado a la nota')
      }).filter((i) => !note?.paperIds.includes(i.id.slice(2)))
    }

    const commands: Item[] = [
      { id: 'c:import', group: 'Acciones', title: 'Importar PDF', icon: <Upload size={15} />, hint: `${mod}O`, run: () => void importPapers() },
      { id: 'c:note', group: 'Acciones', title: 'Nueva nota', icon: <Plus size={15} />, hint: `${mod}N`, run: () => createNote() },
      { id: 'c:thesis', group: 'Acciones', title: 'Abrir tesis', icon: <GraduationCap size={15} />, hint: `${mod}⌥T`, run: () => void openThesis() },
      { id: 'c:board', group: 'Acciones', title: 'Abrir pizarra (Excalidraw)', icon: <Shapes size={15} />, hint: `${mod}⌥B`, run: openBoard },
      { id: 'c:matrix', group: 'Acciones', title: 'Abrir matriz de literatura', icon: <Table2 size={15} />, hint: `${mod}⌥L`, run: openMatrix },
      { id: 'c:tasks', group: 'Acciones', title: 'Abrir tareas y cronograma', icon: <ListTodo size={15} />, hint: `${mod}⌥D`, run: () => openTasks() },
      { id: 'c:agent', group: 'Acciones', title: 'Abrir el asistente general (biblioteca, notas, tareas)', icon: <Sparkles size={15} />, hint: `${mod}⌥A`, run: () => openAgent() },
      { id: 'c:research', group: 'Acciones', title: 'Abrir marco de investigación (temas de la cátedra, chequeos, plan)', icon: <Crosshair size={15} />, hint: `${mod}⌥M`, run: openResearch },
      { id: 'c:analysis', group: 'Acciones', title: 'Abrir análisis de datos (escalas, alfa, correlaciones, tablas APA)', icon: <ChartColumn size={15} />, hint: `${mod}⌥Y`, run: openAnalysis },
      { id: 'c:wiki', group: 'Acciones', title: 'Abrir wiki de conocimiento (resaltados, notas, glosario)', icon: <BookOpenText size={15} />, hint: `${mod}⌥K`, run: openWiki },
      { id: 'c:thesis-docx', group: 'Acciones', title: 'Exportar tesis a Word (.docx)', icon: <FileText size={15} />, run: () => void exportThesisDocx() },
      { id: 'c:thesis-pdf', group: 'Acciones', title: 'Exportar tesis a PDF', icon: <FileDown size={15} />, run: () => void exportThesisPdf() },
      ...(activeTab()?.kind === 'paper'
        ? [
            {
              id: 'c:skim',
              group: 'Acciones',
              title: 'Modo lectura rápida: marcá oraciones clave',
              icon: <ScanText size={15} />,
              hint: `${mod}⌥S`,
              run: () => window.dispatchEvent(new CustomEvent('reader-command', { detail: 'skim' }))
            },
            { id: 'c:guide', group: 'Acciones', title: 'Guía de lectura', icon: <Compass size={15} />, run: () => useStore.setState({ rightOpen: true, rightTab: 'guide' }) }
          ]
        : []),
      { id: 'c:assistant', group: 'Acciones', title: 'Preguntarle al asistente', icon: <Sparkles size={15} />, hint: `${mod}J`, run: () => useStore.setState({ rightOpen: true, rightTab: 'assistant' }) },
      { id: 'c:sidebar', group: 'Acciones', title: 'Mostrar u ocultar la barra lateral', icon: <PanelLeft size={15} />, hint: `${mod}\\`, run: () => useStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen })) },
      { id: 'c:bib', group: 'Acciones', title: 'Exportar biblioteca como BibTeX', icon: <BookMarked size={15} />, run: () => void exportBibliography() },
      {
        id: 'c:theme',
        group: 'Acciones',
        title: theme === 'dark' ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro',
        icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
        run: () => patchSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
      },
      { id: 'c:settings', group: 'Acciones', title: 'Ajustes', icon: <Settings2 size={15} />, hint: `${mod},`, run: () => useStore.setState({ settingsOpen: true }) }
    ]
      .map((c) => ({ ...c, score: q ? matchScore(c.title, q) : 0 }))
      .filter((c) => c.score >= 0)

    // The running timer's controls, then (when searching) a pomodoro on any open task.
    const timerItems: Item[] = (
      run
        ? [
            {
              id: 't:toggle',
              title: run.state === 'running' ? 'Pausar el pomodoro' : run.state === 'paused' ? 'Seguir con el pomodoro' : `Empezar ${PHASE_LABEL[run.phase].toLowerCase()}`,
              icon: run.state === 'running' ? <Pause size={15} /> : <Play size={15} />,
              run: toggle
            },
            { id: 't:extend', title: 'Sumar 5 minutos al pomodoro', icon: <Plus size={15} />, run: () => extend(5) },
            { id: 't:skip', title: run.phase === 'focus' ? 'Saltar al descanso' : 'Saltar el descanso', icon: <SkipForward size={15} />, run: skip },
            { id: 't:stop', title: 'Detener el pomodoro', icon: <Square size={15} />, run: stop }
          ]
        : []
    )
      .map((c) => ({ ...c, group: 'Pomodoro', sub: run?.title, score: q ? matchScore(`${c.title} pomodoro timer`, q) : 0 }))
      .filter((c) => c.score >= 0)
    const taskItems: Item[] = q
      ? Object.values(tasks)
          .filter((t) => t.status !== 'done' && t.title && t.id !== run?.taskId)
          .map((t) => ({
            id: `tp:${t.id}`,
            group: 'Pomodoro',
            title: `Empezar pomodoro: ${t.title}`,
            sub: t.pomodoro ? `${t.pomodoro.sessions} × ${t.pomodoro.focusMinutes} min` : '25 min',
            icon: <Timer size={15} />,
            run: () => void startTask(t.id),
            score: matchScore(`${t.title} pomodoro`, q)
          }))
          .filter((i) => i.score >= 0)
      : []

    const noteItems: Item[] = Object.values(notes)
      .map((n) => ({
        id: `n:${n.id}`,
        group: 'Notas',
        title: n.title || 'Nota sin título',
        sub: n.plain.replace(/\s+/g, ' ').slice(0, 80),
        icon: <NotebookPen size={15} />,
        run: () => openTab({ kind: 'note', id: n.id }),
        score: q ? matchScore(`${n.title} ${n.plain.slice(0, 3000)}`, q) : n.updatedAt
      }))
      .filter((i) => i.score >= 0)

    const papersList = paperItems((id) => openTab({ kind: 'paper', id }))
    const sort = (a: Item[]) => a.sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, LIMIT)
    // With a query, content first; without one, recent items then actions.
    return q
      ? [...sort(papersList), ...sort(noteItems), ...sort([...timerItems, ...taskItems]), ...sort(commands)]
      : [...timerItems, ...sort(papersList).slice(0, 5), ...sort(noteItems).slice(0, 4), ...commands]
  }, [mode, noteId, papers, notes, tasks, run, q, theme, picked])

  const sorted = mode === 'all' ? items : items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 30)
  const groups = [...new Set(sorted.map((i) => i.group))]

  /** One citation with every source, in one parenthesis (APA orders them alphabetically). */
  function cite(ids: string[]) {
    const ed = (noteId && getEditor(noteId)) || focusedEditor()?.editor
    if (!ed) return toast('Primero ubicá el cursor en una nota')
    const [first, ...rest] = ids
    ed.chain().focus().insertCitation({ paperId: first, extra: rest.map((paperId) => ({ paperId })) }).run()
  }

  const pick = (i: Item | undefined) => {
    if (!i) return
    close()
    i.run()
  }

  const placeholder = mode === 'cite' ? 'Citá un paper…' : mode === 'link' ? 'Vinculá un paper a esta nota…' : 'Buscá papers, notas y acciones…'
  const verb = mode === 'cite' ? (picked.length ? 'citar todas' : 'insertar cita') : mode === 'link' ? 'vincular' : 'abrir'
  const citeStyle = useStore.getState().settings.citationStyle

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent showCloseButton={false} className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-[600px]">
        <DialogTitle className="sr-only">Paleta de comandos</DialogTitle>
        <DialogDescription className="sr-only">{placeholder}</DialogDescription>
      <Command
        shouldFilter={false}
        loop
        value={active}
        onValueChange={setActive}
        onKeyDown={(e) => {
          // ⌘↩ adds the highlighted paper to the parenthesis and keeps the palette open.
          if (mode !== 'cite' || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !active.startsWith('p:')) return
          e.preventDefault()
          togglePick(active.slice(2))
          setQ('')
        }}
        className="rounded-none bg-transparent [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase [&_[data-slot=command-input-wrapper]]:h-12">
        <CommandInput value={q} onValueChange={setQ} placeholder={picked.length ? 'Sumá otra fuente a la misma cita…' : placeholder} className="h-12 text-[15px]" />
        {mode === 'cite' && picked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-xs">
            {picked.map((id) =>
              papers[id] ? (
                <span key={id} className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-brand-text">
                  {inText(papers[id], citeStyle).slice(1, -1)}
                  <button type="button" aria-label="Quitar" className="opacity-60 hover:opacity-100" onClick={() => togglePick(id)}>
                    <X size={12} />
                  </button>
                </span>
              ) : null
            )}
            <span className="flex-1" />
            <button
              type="button"
              className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground hover:opacity-90"
              onClick={() => {
                close()
                cite(picked)
              }}
            >
              Insertar {inTextGroup(picked.flatMap((id) => (papers[id] ? [{ paper: papers[id] }] : [])), citeStyle)}
            </button>
          </div>
        )}
        <CommandList className="max-h-[52vh]">
          <CommandEmpty>{Object.keys(papers).length || mode === 'all' ? 'Sin resultados' : 'Importá papers primero'}</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g} heading={mode === 'all' ? g : undefined}>
              {sorted
                .filter((i) => i.group === g)
                .map((it) => (
                  <CommandItem key={it.id} value={it.id} onSelect={() => pick(it)} className="gap-3 rounded-lg px-2.5 py-2 data-[selected=true]:bg-brand-soft [&_svg]:text-faint data-[selected=true]:[&_svg]:text-primary">
                    <span className="grid flex-none place-items-center [&_svg]:size-4">{it.icon}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{it.title}</span>
                      {it.sub && <span className="truncate text-xs text-muted-foreground">{it.sub}</span>}
                    </span>
                    {it.hint && <CommandShortcut>{it.hint}</CommandShortcut>}
                    {mode === 'cite' && (
                      <button
                        type="button"
                        title={picked.includes(it.id.slice(2)) ? 'Quitar de la cita' : 'Sumar a la misma cita (⌘↩)'}
                        className={`grid size-6 flex-none place-items-center rounded-md hover:bg-background ${picked.includes(it.id.slice(2)) ? '[&_svg]:!text-primary' : ''}`}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePick(it.id.slice(2))
                        }}
                      >
                        {picked.includes(it.id.slice(2)) ? <Check size={14} /> : <Plus size={14} />}
                      </button>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="flex gap-4 border-t bg-muted/50 px-4 py-2 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd> navegar
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↩</Kbd> {verb}
          </span>
          {mode === 'cite' && (
            <span className="flex items-center gap-1.5">
              <Kbd>{mod}↩</Kbd> sumar otra fuente
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> cerrar
          </span>
        </div>
      </Command>
      </DialogContent>
    </Dialog>
  )
}

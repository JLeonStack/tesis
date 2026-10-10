import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { FileText, NotebookPen, Upload, Plus, Settings2, Moon, Sun, BookMarked, Sparkles, PanelLeft, Quote, Link2, GraduationCap, FileDown, ScanText, Compass, Shapes, Table2 } from 'lucide-react'
import { activeTab, createNote, openBoard, openMatrix, openThesis, openTab, patchSettings, saveNote, toast, useStore } from '../store'
import { exportThesisDocx, exportThesisPdf } from '../thesis/exporting'
import { importPapers } from '../lib/ingest'
import { exportBibliography } from '../lib/exporting'
import { authorLine, inText } from '../lib/citation'
import { matchScore, mod } from '../lib/util'
import { focusedEditor, getEditor } from '../editor/noteBridge'

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
  const [q, setQ] = useState('')
  const close = () => useStore.setState({ paletteOpen: false, paletteMode: 'all', paletteNoteId: null })

  const items = useMemo<Item[]>(() => {
    const style = useStore.getState().settings.citationStyle
    const paperItems = (run: (id: string) => void, sub?: (id: string) => string): Item[] =>
      Object.values(papers)
        .map((p) => ({
          id: `p:${p.id}`,
          group: 'Papers',
          title: p.title,
          sub: sub ? sub(p.id) : `${authorLine(p) || 'Unknown author'}${p.year ? ` · ${p.year}` : ''}`,
          icon: <FileText size={15} />,
          run: () => run(p.id),
          score: q ? matchScore(`${p.title} ${authorLine(p, 99)} ${p.year ?? ''} ${p.tags.join(' ')}`, q) : p.updatedAt
        }))
        .filter((i) => i.score >= 0)

    if (mode === 'cite') {
      return paperItems(
        (id) => {
          const ed = (noteId && getEditor(noteId)) || focusedEditor()?.editor
          if (ed) ed.chain().focus().insertCitation({ paperId: id }).run()
          else toast('Place the cursor in a note first')
        },
        (id) => inText(papers[id], style)
      )
    }
    if (mode === 'link') {
      const note = noteId ? notes[noteId] : null
      return paperItems((id) => {
        if (!note) return
        if (!note.paperIds.includes(id)) saveNote({ ...note, paperIds: [...note.paperIds, id], updatedAt: Date.now() })
        toast('Paper linked to note')
      }).filter((i) => !note?.paperIds.includes(i.id.slice(2)))
    }

    const commands: Item[] = [
      { id: 'c:import', group: 'Actions', title: 'Import PDFs', icon: <Upload size={15} />, hint: `${mod}O`, run: () => void importPapers() },
      { id: 'c:note', group: 'Actions', title: 'New note', icon: <Plus size={15} />, hint: `${mod}N`, run: () => createNote() },
      { id: 'c:thesis', group: 'Actions', title: 'Abrir tesis', icon: <GraduationCap size={15} />, hint: `${mod}⌥T`, run: () => void openThesis() },
      { id: 'c:board', group: 'Actions', title: 'Open whiteboard (Excalidraw)', icon: <Shapes size={15} />, hint: `${mod}⌥B`, run: openBoard },
      { id: 'c:matrix', group: 'Actions', title: 'Open literature matrix', icon: <Table2 size={15} />, hint: `${mod}⌥L`, run: openMatrix },
      { id: 'c:thesis-docx', group: 'Actions', title: 'Exportar tesis a Word (.docx)', icon: <FileText size={15} />, run: () => void exportThesisDocx() },
      { id: 'c:thesis-pdf', group: 'Actions', title: 'Exportar tesis a PDF', icon: <FileDown size={15} />, run: () => void exportThesisPdf() },
      ...(activeTab()?.kind === 'paper'
        ? [
            {
              id: 'c:skim',
              group: 'Actions',
              title: 'Skim mode: mark key sentences',
              icon: <ScanText size={15} />,
              hint: `${mod}⌥S`,
              run: () => window.dispatchEvent(new CustomEvent('reader-command', { detail: 'skim' }))
            },
            { id: 'c:guide', group: 'Actions', title: 'Reading guide', icon: <Compass size={15} />, run: () => useStore.setState({ rightOpen: true, rightTab: 'guide' }) }
          ]
        : []),
      { id: 'c:assistant', group: 'Actions', title: 'Ask the assistant', icon: <Sparkles size={15} />, hint: `${mod}J`, run: () => useStore.setState({ rightOpen: true, rightTab: 'assistant' }) },
      { id: 'c:sidebar', group: 'Actions', title: 'Toggle sidebar', icon: <PanelLeft size={15} />, hint: `${mod}\\`, run: () => useStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen })) },
      { id: 'c:bib', group: 'Actions', title: 'Export library as BibTeX', icon: <BookMarked size={15} />, run: () => void exportBibliography() },
      {
        id: 'c:theme',
        group: 'Actions',
        title: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
        run: () => patchSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
      },
      { id: 'c:settings', group: 'Actions', title: 'Settings', icon: <Settings2 size={15} />, hint: `${mod},`, run: () => useStore.setState({ settingsOpen: true }) }
    ]
      .map((c) => ({ ...c, score: q ? matchScore(c.title, q) : 0 }))
      .filter((c) => c.score >= 0)

    const noteItems: Item[] = Object.values(notes)
      .map((n) => ({
        id: `n:${n.id}`,
        group: 'Notes',
        title: n.title || 'Untitled note',
        sub: n.plain.replace(/\s+/g, ' ').slice(0, 80),
        icon: <NotebookPen size={15} />,
        run: () => openTab({ kind: 'note', id: n.id }),
        score: q ? matchScore(`${n.title} ${n.plain.slice(0, 3000)}`, q) : n.updatedAt
      }))
      .filter((i) => i.score >= 0)

    const papersList = paperItems((id) => openTab({ kind: 'paper', id }))
    const sort = (a: Item[]) => a.sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, LIMIT)
    // With a query, content first; without one, recent items then actions.
    return q ? [...sort(papersList), ...sort(noteItems), ...sort(commands)] : [...sort(papersList).slice(0, 5), ...sort(noteItems).slice(0, 4), ...commands]
  }, [mode, noteId, papers, notes, q, theme])

  const sorted = mode === 'all' ? items : items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 30)
  const groups = [...new Set(sorted.map((i) => i.group))]

  const pick = (i: Item | undefined) => {
    if (!i) return
    close()
    i.run()
  }

  const placeholder = mode === 'cite' ? 'Cite a paper…' : mode === 'link' ? 'Link a paper to this note…' : 'Search papers, notes and actions…'
  const verb = mode === 'cite' ? 'insert citation' : mode === 'link' ? 'link' : 'open'

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent showCloseButton={false} className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-[600px]">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">{placeholder}</DialogDescription>
      <Command shouldFilter={false} loop className="rounded-none bg-transparent [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase [&_[data-slot=command-input-wrapper]]:h-12">
        <CommandInput value={q} onValueChange={setQ} placeholder={placeholder} className="h-12 text-[15px]" />
        <CommandList className="max-h-[52vh]">
          <CommandEmpty>{Object.keys(papers).length || mode === 'all' ? 'No results' : 'Import papers first'}</CommandEmpty>
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
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="flex gap-4 border-t bg-muted/50 px-4 py-2 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↩</Kbd> {verb}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </Command>
      </DialogContent>
    </Dialog>
  )
}

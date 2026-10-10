import { useEffect, useState } from 'react'
import { Sidebar, SidebarRail } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { Workspace } from './components/Workspace'
import { RightPanel, RightRail } from './panels/RightPanel'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/SettingsDialog'
import { ToastHost } from './components/ToastHost'
import { AnimatePresence, motion } from 'motion/react'
import { Resizer } from './components/Resizer'
import { closeTab, createNote, isFullWidth, openBoard, openMatrix, openPalette, openThesis, toast, toggleSideNote, useStore } from './store'
import { exportThesisDocx, exportThesisPdf } from './thesis/exporting'
import { importPapers, resumePending } from './lib/ingest'
import { startHighlightTranslation } from './lib/highlightTranslate'
import { exportActiveNote, exportBibliography } from './lib/exporting'
import { clamp } from './lib/util'
import { Upload } from 'lucide-react'

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const rightOpen = useStore((s) => s.rightOpen)
  // The whiteboard and the matrix have nothing for the side panel to show; they get the room instead.
  const fullWidth = useStore((s) => isFullWidth(s.active))
  const sidebarW = useStore((s) => s.sidebarW)
  const rightW = useStore((s) => s.rightW)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    resumePending()
    return window.api.onMenu(handleMenu)
  }, [])
  useEffect(() => startHighlightTranslation(), [])

  // Window-level drag & drop (Postel's law: accept PDFs dropped anywhere).
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      const paths = files.filter((f) => /\.pdf$/i.test(f.name)).map((f) => window.api.papers.pathForFile(f))
      if (paths.length) void importPapers(paths)
      else toast('Only PDF files can be imported')
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // Collapsed panels become rails rather than vanishing (Zeigarnik, Fitts).
  const cols = [sidebarOpen ? 'var(--sidebar-w) 0px' : '56px', 'minmax(0,1fr)', fullWidth ? '' : rightOpen ? '0px var(--right-w)' : '52px'].join(' ')

  return (
    <div
      className="grid h-screen overflow-hidden"
      style={
        {
          gridTemplateColumns: cols,
          gridTemplateRows: 'minmax(0,1fr)',
          '--sidebar-w': `${sidebarW}px`,
          '--right-w': `${rightW}px`
        } as React.CSSProperties
      }
    >
      {sidebarOpen ? (
        <>
          <Sidebar />
          <Resizer onResize={(dx) => useStore.setState((s) => ({ sidebarW: clamp(s.sidebarW + dx, 220, 420) }))} />
        </>
      ) : (
        <SidebarRail />
      )}
      <main className="flex min-w-0 flex-col bg-background">
        <TabBar />
        <Workspace />
      </main>
      {fullWidth ? null : rightOpen ? (
        <>
          <Resizer onResize={(dx) => useStore.setState((s) => ({ rightW: clamp(s.rightW - dx, 320, 640) }))} />
          <RightPanel />
        </>
      ) : (
        <RightRail />
      )}
      <CommandPalette />
      <SettingsDialog />
      <ToastHost />
      <AnimatePresence>
        {dragging && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[80] grid place-items-center rounded-xl border-[3px] border-dashed border-primary bg-primary/10 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="flex flex-col items-center gap-2 rounded-2xl bg-popover px-10 py-7 text-primary shadow-2xl"
              initial={{ scale: 0.92, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 4 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            >
              <Upload className="size-7" strokeWidth={1.6} />
              <strong className="text-[15px] text-foreground">Drop PDFs to add them to your library</strong>
              <span className="text-muted-foreground">Metadata and citations are filled in automatically</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function handleMenu(action: string): void {
  const s = useStore.getState()
  switch (action) {
    case 'import':
      return void importPapers()
    case 'new-note':
      createNote()
      return
    case 'side-note':
      return toggleSideNote()
    case 'close-tab':
      if (s.active) closeTab(s.active)
      return
    case 'palette':
      return s.paletteOpen ? useStore.setState({ paletteOpen: false }) : openPalette()
    case 'settings':
      return useStore.setState({ settingsOpen: true })
    case 'toggle-sidebar':
      return useStore.setState({ sidebarOpen: !s.sidebarOpen })
    case 'toggle-assistant':
      return useStore.setState({ rightOpen: !(s.rightOpen && s.rightTab === 'assistant'), rightTab: 'assistant' })
    case 'open-thesis':
      openThesis()
      return
    case 'open-board':
      return openBoard()
    case 'open-matrix':
      return openMatrix()
    case 'export-thesis-docx':
      return void exportThesisDocx()
    case 'export-thesis-pdf':
      return void exportThesisPdf()
    case 'export-note':
      return void exportActiveNote()
    case 'export-bib':
      return void exportBibliography()
    default:
      // zoom-in / zoom-out / zoom-fit / find are handled by the active reader
      window.dispatchEvent(new CustomEvent('reader-command', { detail: action }))
  }
}

import { Copy, FileText, Plus, X, Library } from 'lucide-react'
import { openPalette, openTab, saveNote, useStore } from '../store'
import { citedPaperIds, copyText, bibliography, notePapers } from '../lib/exporting'
import { authorLine, inText, plainRef } from '../lib/citation'
import { focusedEditor } from '../editor/noteBridge'
import { mod } from '../lib/util'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState, Hint, IconButton } from '../components/common'
import { Collapsible } from '../components/Collapsible'

const refHtml = (r: string) => r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*([^*]+)\*/g, '<i>$1</i>')

export function SourcesPanel({ noteId }: { noteId: string }) {
  const note = useStore((s) => s.notes[noteId])
  const style = useStore((s) => s.settings.citationStyle)
  useStore((s) => s.papers) // re-render on metadata edits
  if (!note) return null
  const papers = notePapers(note)
  const cited = new Set(citedPaperIds(note.content))
  const refs = bibliography(papers)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Collapsible
        id="sources.papers"
        title="Fuentes de esta nota"
        marker="bg-kind-paper"
        count={papers.length || undefined}
        className="border-b"
        headerClassName="px-3.5 py-1.5"
        actions={
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => openPalette('link', noteId)}>
            <Plus /> Vincular paper
          </Button>
        }
      >
      {papers.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="Todavía no hay fuentes"
          description={`Vinculá papers para darle su texto completo al asistente, o citalos con ${mod}⇧C mientras escribís.`}
        />
      ) : (
        <div className="flex flex-col gap-0.5 p-2">
          {papers.map((p) => (
            <div key={p.id} className="group rounded-lg p-1.5 transition-colors hover:bg-accent/60">
              <button className="flex w-full items-start gap-2.5 p-1 text-left" onClick={() => openTab({ kind: 'paper', id: p.id })}>
                <FileText className="mt-0.5 size-3.5 flex-none text-faint" />
                <span className="flex min-w-0 flex-col">
                  <strong className="leading-snug font-[550]">{p.title}</strong>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    {authorLine(p) || 'Autor desconocido'}
                    {p.year ? ` · ${p.year}` : ''}
                    {cited.has(p.id) && (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        citado
                      </Badge>
                    )}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-0.5 pl-7">
                <Hint label="Insertar cita en el cursor">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-brand-text hover:bg-brand-soft hover:text-brand-text"
                    onClick={() => {
                      const f = focusedEditor()
                      if (f) f.editor.chain().focus().insertCitation({ paperId: p.id }).run()
                      else void copyText(inText(p, style), 'Cita en el texto copiada')
                    }}
                  >
                    {inText(p, style)}
                  </Button>
                </Hint>
                {note.paperIds.includes(p.id) && !cited.has(p.id) && (
                  <IconButton
                    size="icon-xs"
                    label="Desvincular"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => saveNote({ ...note, paperIds: note.paperIds.filter((x) => x !== p.id), updatedAt: Date.now() })}
                  >
                    <X />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </Collapsible>
      {refs.length > 0 && (
        <Collapsible
          id="sources.references"
          title="Referencias"
          count={refs.length}
          headerClassName="px-3.5 py-1.5"
          actions={
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void copyText(refs.map(plainRef).join('\n\n'), `${refs.length} referencias copiadas`)}>
              <Copy /> Copiar
            </Button>
          }
        >
          <div className="flex flex-col gap-2 px-3.5 pb-4 pl-[calc(0.875rem+1.5em)]">
            {refs.map((r, i) => (
              <p key={i} className="reference text-[12.5px]" dangerouslySetInnerHTML={{ __html: refHtml(r) }} />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  )
}

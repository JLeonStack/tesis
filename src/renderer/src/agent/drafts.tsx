import { useState } from 'react'
import { AlertTriangle, FilePenLine } from 'lucide-react'
import { logAiUse, toast, useStore } from '../store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { withThesisEditor } from '../thesis/bridge'
import { uid } from '../lib/util'

// Draft paragraphs the thesis assistant may propose (when the student allows
// it in Ajustes): fenced ```borrador blocks, shown as a card instead of prose.
// Inserting one takes an explicit acknowledgement of the UCEMA AI policy, is
// logged, and leaves the text marked as an AI draft until the student reviews it.

const DRAFT = /```borrador[^\n]*\n([\s\S]*?)(```|$)/g

/** The prose without its drafts, and the drafts (`done` false while one is still streaming in). */
export function splitDrafts(text: string): { prose: string; drafts: { text: string; done: boolean }[] } {
  const drafts: { text: string; done: boolean }[] = []
  const prose = text.replace(DRAFT, (_, body: string, end: string) => {
    drafts.push({ text: body.trim(), done: end === '```' })
    return ''
  })
  return { prose: prose.trim(), drafts }
}

export const DRAFT_POLICY =
  'Las Pautas de la UCEMA (8.e) permiten la IA para corregir redacción, gramática, formato y APA, pero no para reemplazar el análisis, la argumentación ni la construcción original del trabajo. Todos los trabajos pasan por Turnitin, que detecta texto generado por IA.'

export function DraftCard({ text, done, label }: { text: string; done: boolean; label: string }) {
  const allowed = useStore((s) => s.settings.aiDrafts === 'warn')
  const [open, setOpen] = useState(false)
  const [ack, setAck] = useState(false)
  const [inserted, setInserted] = useState(false)
  const paragraphs = text.split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)

  const insert = async () => {
    setOpen(false)
    // Logged only once it's in: the mark carries the log entry's id.
    const id = uid()
    const ok = await withThesisEditor((ed) => ed.chain().focus().insertDraft(paragraphs, id).run())
    if (!ok) return toast('No se pudo insertar el borrador en la tesis', undefined, { status: 'error' })
    logAiUse({ id, kind: 'draft', label, chars: text.length, accepted: true })
    setInserted(true)
    toast('Borrador insertado y marcado', undefined, { status: 'success', description: 'Reescribilo con tus palabras y marcalo como revisado en Requisitos.' })
  }

  return (
    <div className="mt-1.5 rounded-xl border border-dashed border-bloom-amber/60 bg-bloom-amber/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-bloom-amber">
        <FilePenLine className="size-3.5" /> Borrador de la IA · {paragraphs.length} párrafo{paragraphs.length === 1 ? '' : 's'}
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 text-[13px] text-muted-foreground">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {done && (
        <div className="mt-2 flex items-center gap-2">
          {allowed ? (
            <Button size="xs" variant="outline" disabled={inserted} onClick={() => setOpen(true)}>
              {inserted ? 'Insertado' : 'Insertar en la tesis…'}
            </Button>
          ) : (
            <span className="text-[11.5px] text-muted-foreground">Los borradores están desactivados en Ajustes → Reglas y verificación.</span>
          )}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-bloom-amber" /> Antes de insertar texto de la IA
            </DialogTitle>
            <DialogDescription>{DRAFT_POLICY}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5 text-[12.5px]">
            <li>• El texto queda subrayado como borrador y anotado en el registro de uso de IA (lo podés exportar para tu tutor).</li>
            <li>• Los Requisitos marcan un error mientras haya borradores sin revisar.</li>
            <li>• Usalo como punto de partida: el análisis y los argumentos tienen que ser tuyos.</li>
          </ul>
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Lo voy a revisar, verificar y reescribir con mis palabras antes de entregarlo.
          </label>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" disabled={!ack} onClick={() => void insert()}>
              Insertar marcado como borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

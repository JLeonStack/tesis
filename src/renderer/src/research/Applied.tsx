import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Copy, Loader2, MinusCircle, XCircle } from 'lucide-react'
import type { AiUse } from '@shared/types'
import { toast, useStore } from '../store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { researchBlock } from './framework'
import { EXCLUDED, TARGET_COUNT, probeAssistants, type Probe } from './verify'

// Proof that the framework reaches every assistant, shared by the research
// tab and Ajustes. The probe rebuilds every assistant's instructions, so it
// only re-runs when something it looks for can have changed.

export function useProbes(): Probe[] | null {
  const research = useStore((s) => s.settings.research)
  const title = useStore((s) => s.settings.thesisTitle)
  const question = useStore((s) => s.settings.researchQuestion)
  const drafts = useStore((s) => s.settings.aiDrafts)
  const dataset = useStore((s) => s.settings.analysis.datasetId)
  const library = useStore((s) => Object.keys(s.papers).length)
  const [probes, setProbes] = useState<Probe[] | null>(null)
  useEffect(() => {
    let live = true
    setProbes(null)
    void probeAssistants(useStore.getState()).then((p) => live && setProbes(p))
    return () => {
      live = false
    }
  }, [research, title, question, drafts, dataset, library])
  return probes
}

export function ProbeGrid({ probes, compact }: { probes: Probe[] | null; compact?: boolean }) {
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fill,minmax(270px,1fr))]')}>
      {probes
        ? probes.map((p) => (
            <div key={p.id} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 shadow-xs">
              <span className="mt-0.5 flex-none">{p.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-[550]">{p.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{p.ok ? p.where : `Falta: ${p.missing.join(', ')}`}</span>
              </span>
            </div>
          ))
        : Array.from({ length: TARGET_COUNT }, (_, i) => (
            <div key={i} className="flex h-[58px] items-center gap-2 rounded-xl border bg-card px-3 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Verificando…
            </div>
          ))}
      {EXCLUDED.map((x) => (
        <div key={x.label} className="flex items-start gap-2.5 rounded-xl border border-dashed px-3 py-2.5">
          <MinusCircle className="mt-0.5 size-4 flex-none text-faint" />
          <span className="min-w-0">
            <span className="block text-[13px] font-[550] text-muted-foreground">{x.label}: sin el marco, a propósito</span>
            <span className="block text-[11.5px] text-faint">{x.why}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** The exact framework text the assistants receive, copyable. */
export function FrameworkText() {
  const settings = useStore((s) => s.settings)
  const [show, setShow] = useState(false)
  const block = useMemo(() => researchBlock(settings), [settings])
  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 px-3.5 py-2">
        <button onClick={() => setShow(!show)} className="flex flex-1 items-center gap-1.5 text-left text-[12.5px] font-[550]">
          <ChevronDown className={cn('size-4 transition-transform', !show && '-rotate-90')} /> El texto exacto que recibe cada asistente
          <span className="font-normal text-faint">· {block.length.toLocaleString('es-AR')} caracteres</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(block)
            toast('Marco copiado', undefined, { status: 'success' })
          }}
        >
          <Copy /> Copiar
        </Button>
      </div>
      {show && <pre className="max-h-[420px] overflow-auto border-t px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{block}</pre>}
    </div>
  )
}

const KIND_LABEL: Record<AiUse['kind'], string> = { draft: 'Borrador insertado', assist: 'Ayuda de redacción', autocomplete: 'Autocompletado' }

/** The AI-use log as Markdown, for the tutor (transparency, UCEMA pautas 8.e). */
export function aiLogMarkdown(entries: AiUse[]): string {
  const sorted = [...entries].sort((a, b) => a.at - b.at)
  const by = (k: AiUse['kind']) => sorted.filter((e) => e.kind === k)
  const chars = (es: AiUse[]) => es.reduce((n, e) => n + e.chars, 0)
  const rows = sorted.map(
    (e) =>
      `| ${new Date(e.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} | ${KIND_LABEL[e.kind]} | ${e.label.replace(/\|/g, '/')} | ${e.chars} | ${e.kind === 'draft' ? (e.reviewedAt ? `revisado el ${new Date(e.reviewedAt).toLocaleDateString('es-AR')}` : 'pendiente de revisión') : '—'} |`
  )
  return `# Registro de uso de IA en el trabajo final

Generado por Thesis Studio el ${new Date().toLocaleDateString('es-AR', { dateStyle: 'long' })}. Según las Pautas UCEMA (8.e), la IA se usó para corregir redacción, gramática, formato y APA; todo aporte fue revisado y validado por el estudiante.

- Ayudas de redacción aplicadas: ${by('assist').length} (${chars(by('assist'))} caracteres)
- Autocompletado aceptado: ${chars(by('autocomplete'))} caracteres en ${by('autocomplete').length} sesiones
- Borradores insertados: ${by('draft').length} (${chars(by('draft'))} caracteres), ${by('draft').filter((e) => e.reviewedAt).length} revisados y reescritos

| Fecha | Tipo | Detalle | Caracteres | Estado |
|---|---|---|---|---|
${rows.join('\n') || '| — | — | Sin uso registrado | — | — |'}
`
}

export async function exportAiLog(): Promise<void> {
  const md = aiLogMarkdown(Object.values(useStore.getState().ailog))
  const path = await window.api.shell.saveFile('Registro de uso de IA.md', md, [{ name: 'Markdown', extensions: ['md'] }])
  if (path) toast('Registro exportado', undefined, { status: 'success' })
}

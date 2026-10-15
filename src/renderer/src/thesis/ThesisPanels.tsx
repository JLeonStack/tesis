import { useMemo } from 'react'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { patchAiUse, toast, useStore } from '../store'
import { cn } from '@/lib/utils'
import { analyze } from './analyze'
import { useLiveThesis, thesisEditor } from './bridge'
import { thesisChecks } from './checks'
import { scrollToPos } from './schema'
import { SECTION_INFO } from './template'

function jump(thesisId: string, pos: number | undefined, where?: 'cover' | 'auth') {
  if (where) {
    document.querySelector(where === 'cover' ? '.cover-sheet' : '.auth-sheet')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return
  }
  const ed = thesisEditor(thesisId)
  if (ed && pos != null) scrollToPos(ed, pos)
}

/** Esquema: every heading, indented by level; click to jump. */
export function OutlinePanel({ thesisId }: { thesisId: string }) {
  const live = useLiveThesis(thesisId)
  const outline = live ? analyze(live.doc).outline : []
  const groups = ['cuerpo', 'apendices'] as const
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {groups.map((g) => {
        const items = outline.filter((h) => h.section === g)
        if (!items.length) return null
        return (
          <div key={g} className="mb-4">
            <div className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{SECTION_INFO[g].label}</div>
            {items.map((h) => (
              <button
                key={h.pos}
                onClick={() => jump(thesisId, h.pos)}
                className={cn(
                  'block w-full truncate rounded-md py-1 pr-2 text-left text-[13px] transition-colors hover:bg-accent',
                  h.level === 1 && 'font-semibold',
                  h.level >= 3 && 'italic text-muted-foreground',
                  !h.text && 'text-faint'
                )}
                style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
                title={h.text}
              >
                {h.text || 'Sin título'}
              </button>
            ))}
          </div>
        )
      })}
      {!outline.length && <p className="p-4 text-center text-muted-foreground">Todavía no hay títulos.</p>}
    </div>
  )
}

/** Requisitos: the UCEMA rules, checked live. */
export function ChecksPanel({ thesisId }: { thesisId: string }) {
  const live = useLiveThesis(thesisId)
  const papers = useStore((s) => s.papers)
  const research = useStore((s) => s.settings.research)
  const checks = useMemo(() => (live ? thesisChecks(live.doc, live.thesis.meta, papers, research) : []), [live, papers, research])
  const failing = checks.filter((c) => !c.ok)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <p className="px-2 pb-3 text-[12.5px] text-muted-foreground">
        {failing.length ? `${failing.length} punto${failing.length > 1 ? 's' : ''} por revisar según las pautas UCEMA.` : 'Cumple las pautas que se pueden verificar automáticamente.'}
      </p>
      <ul className="space-y-0.5">
        {[...failing, ...checks.filter((c) => c.ok)].map((c) => {
          const Icon = c.ok ? CircleCheck : c.severity === 'error' ? CircleAlert : TriangleAlert
          const clickable = c.pos != null || !!c.where
          return (
            <li key={c.id}>
              <button
                disabled={!clickable}
                onClick={() => jump(thesisId, c.pos, c.where)}
                className={cn('flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left', clickable && 'hover:bg-accent')}
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-4 flex-none',
                    c.ok ? 'text-success' : c.severity === 'error' ? 'text-destructive' : 'text-bloom-amber'
                  )}
                />
                <span className="min-w-0">
                  <span className={cn('block text-[13px]', c.ok && 'text-muted-foreground')}>{c.title}</span>
                  {c.detail && !c.ok && <span className="block text-[11.5px] text-faint">{c.detail}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <DraftsList thesisId={thesisId} />
      <p className="mt-4 px-2 text-[11.5px] leading-relaxed text-faint">
        Formato fijo en el editor y en la exportación: Calibri 11, interlineado doble, sangría de 1,27 cm, márgenes de 2,54 cm, tamaño carta, número de página arriba a la derecha y referencias en APA 7.
      </p>
    </div>
  )
}

/** The AI drafts still marked in the text: jump to each, and mark it reviewed once rewritten. */
function DraftsList({ thesisId }: { thesisId: string }) {
  const live = useLiveThesis(thesisId)
  const drafts = live ? analyze(live.doc).drafts : []
  const byLog = [...new Map(drafts.map((d) => [d.logId, d])).values()]
  if (!byLog.length) return null
  return (
    <div className="mt-3 rounded-lg border border-dashed border-bloom-amber/60 px-2 py-2">
      <div className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-bloom-amber uppercase">Borradores de IA</div>
      {byLog.map((d) => (
        <div key={d.logId} className="flex items-center gap-2 rounded-md px-1 py-1 text-[12.5px]">
          <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => jump(thesisId, d.from)} title={d.text}>
            «{d.text.slice(0, 80)}»
          </button>
          <button
            className="flex-none rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium hover:bg-accent"
            title="Ya lo reescribí con mis palabras y verifiqué lo que dice"
            onClick={() => {
              const ed = thesisEditor(thesisId)
              if (!ed?.commands.clearDraft(d.logId)) return
              patchAiUse(d.logId, { reviewedAt: Date.now() })
              toast('Borrador marcado como revisado')
            }}
          >
            Revisado
          </button>
        </div>
      ))}
    </div>
  )
}

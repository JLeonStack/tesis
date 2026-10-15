import { useEffect, useState, type ReactNode } from 'react'
import {
  BookCheck,
  BookOpenText,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Copy,
  Eye,
  EyeOff,
  FileSearch,
  RotateCcw,
  Scale,
  Search,
  UserRound,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { Collapsible } from '../components/Collapsible'
import { Hint, IconButton } from '../components/common'
import { jumpToQuote, openTab, useStore } from '../store'
import { inText, shortLabel } from '../lib/citation'
import { printedPage } from '../lib/pages'
import { copyText } from '../lib/exporting'
import { mod } from '../lib/util'
import { useLiveThesis, thesisEditor } from './bridge'
import { scrollToPos } from './schema'
import { THESIS_CITE } from './references'
import { VERDICT_LABELS, backSentence, citeEvidence, clearEvidence, findSupport, nextToRead, readInDepth, useEvidence, type Evidence, type Verdict } from './evidence'
import { supportTarget, uncitedEnabled, uncitedOf } from './uncited'
import { CONSTRUCTS } from '../research/framework'
import type { InstrumentRef } from './support'

/** How many claims of the body carry no citation (for the tab's badge). */
export function useUncitedCount(thesisId: string | null): number {
  const live = useLiveThesis(thesisId ?? '')
  return live ? uncitedOf(live.doc).length : 0
}

const VERDICT_STYLE: Record<Verdict, { icon: ReactNode; text: string; bar: string }> = {
  apoya: { icon: <CircleCheck />, text: 'text-success', bar: 'bg-success' },
  matiza: { icon: <Scale />, text: 'text-bloom-amber', bar: 'bg-bloom-amber' },
  contradice: { icon: <CircleX />, text: 'text-destructive', bar: 'bg-destructive' },
  no_respalda: { icon: <CircleMinus />, text: 'text-faint', bar: 'bg-border' },
  sin_verificar: { icon: <CircleDashed />, text: 'text-muted-foreground', bar: 'bg-border' }
}

/**
 * Respaldo: back the sentence at the caret with the library (passages with
 * their page, and whether they support it), cite in one click, and go through
 * the body's claims that still have no citation.
 */
export function EvidencePanel({ thesisId }: { thesisId: string }) {
  const ev = useEvidence()
  const editor = thesisEditor(thesisId)
  const claim = ev.claim?.thesisId === thesisId ? ev.claim : null

  // The sentence is tinted in the text while this tab shows it.
  const hasClaim = !!claim
  useEffect(() => {
    if (hasClaim) thesisEditor(thesisId)?.commands.showSupportTarget(true)
    return () => void thesisEditor(thesisId)?.commands.showSupportTarget(false)
  }, [thesisId, hasClaim])

  const close = () => {
    clearEvidence()
    editor?.commands.setSupportTarget(null)
  }
  const shown = ev.results.filter((r) => r.verdict !== 'no_respalda')
  const weak = ev.results.filter((r) => r.verdict === 'no_respalda')
  const busy = ev.status === 'searching' || ev.status === 'checking' || ev.status === 'reading'
  const papers = useStore((s) => s.papers)
  const connected = useStore((s) => !!s.account?.connected)
  const toRead = claim && connected && ev.status === 'done' ? nextToRead(ev) : []

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {!claim ? (
        <div className="mb-3 rounded-xl border bg-background/60 p-3.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <BookCheck className="size-4 text-success" /> Respaldá cada afirmación
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Posicionate en una oración de la tesis o seleccioná lo que afirmás, y tocá <b>Respaldar</b> ({mod}⌥E). El modelo elige en tu biblioteca los papers que pueden
            respaldarla (por sus guías de lectura), lee sus pasajes y, si ninguno alcanza, los lee completos. Te muestra el pasaje textual con su página y si apoya, matiza o
            contradice lo que escribiste. Con un clic insertás la cita en APA y la referencia aparece sola en Referencias.
          </p>
          <Button size="xs" className="mt-2.5 h-7" disabled={!editor} onClick={() => editor && backSentence(editor, thesisId)}>
            <FileSearch /> Respaldar la oración actual
          </Button>
        </div>
      ) : (
        <div className="mb-3 rounded-xl border bg-background/60 p-3">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">Afirmación</span>
            <span className="flex-1" />
            <IconButton size="icon-xs" label="Buscar de nuevo" disabled={busy} onClick={() => void findSupport(claim)}>
              <RotateCcw />
            </IconButton>
            <IconButton size="icon-xs" label="Cerrar" onClick={close}>
              <X />
            </IconButton>
          </div>
          <button
            className="mt-1 line-clamp-4 text-left font-serif text-[13.5px] leading-relaxed hover:underline"
            title="Ir a la oración"
            onClick={() => editor && scrollToPos(editor, Math.max(0, (supportTarget(editor.state) ?? claim.sentence).from - 1))}
          >
            {claim.text}
          </button>
          <div className="mt-1.5 text-[11.5px] text-muted-foreground">
            {ev.status === 'searching' ? (
              <TextShimmer duration={1.6} className="text-[11.5px] font-medium">
                Buscando en el texto completo de tu biblioteca…
              </TextShimmer>
            ) : ev.status === 'checking' ? (
              <TextShimmer duration={1.6} className="text-[11.5px] font-medium">
                {`Verificando ${ev.results.length} pasajes${ev.picked.length ? ` de ${ev.picked.length} papers elegidos` : ''} contra tu oración…`}
              </TextShimmer>
            ) : ev.status === 'reading' ? (
              <TextShimmer duration={1.6} className="text-[11.5px] font-medium">
                {`Leyendo completos: ${ev.reading.map((pid) => (papers[pid] ? shortLabel(papers[pid]) : '')).filter(Boolean).join(', ')}…`}
              </TextShimmer>
            ) : (
              <SummaryLine results={ev.results} searched={ev.searched} />
            )}
          </div>
          {ev.withoutText > 0 && !busy && (
            <p className="mt-1 text-[11px] text-faint">
              {ev.withoutText} {ev.withoutText === 1 ? 'paper todavía no tiene' : 'papers todavía no tienen'} el texto listo y no entraron en la búsqueda.
            </p>
          )}
        </div>
      )}

      {claim && ev.notice && <p className="mb-3 rounded-lg border border-bloom-amber/40 bg-bloom-amber/8 px-3 py-2 text-[12px] text-foreground">{ev.notice}</p>}

      {claim && (
        <div className="space-y-2">
          {shown.map((e) => (
            <EvidenceCard key={e.id} e={e} cited={claim.citedIds.includes(e.paperId)} canCite={!!editor} busy={ev.status === 'checking' && !e.deep} />
          ))}
          {toRead.length > 0 && (
            <Hint label="El modelo lee estos papers de principio a fin buscando lo que respalda tu oración, como el asistente. Tarda más.">
              <Button variant="outline" size="xs" className="h-7 w-full justify-start" onClick={() => void readInDepth()}>
                <BookOpenText />
                <span className="truncate">Leer a fondo: {toRead.map((pid) => (papers[pid] ? shortLabel(papers[pid]) : '')).filter(Boolean).join(', ')}</span>
              </Button>
            </Hint>
          )}
          {ev.status === 'done' && !ev.results.length && (
            <p className="rounded-lg border border-dashed px-3 py-3 text-[12.5px] text-muted-foreground">
              No encontré pasajes de tu biblioteca que hablen de esto. Probá seleccionar solo la idea central, o sumá papers sobre el tema (el asistente general puede recomendarte cuáles leer).
            </p>
          )}
          {weak.length > 0 && (
            <Collapsible local defaultOpen={false} title="No alcanzan para citarlos" count={weak.length} className="pt-1">
              <div className="space-y-2 pt-1">
                {weak.map((e) => (
                  <EvidenceCard key={e.id} e={e} cited={claim.citedIds.includes(e.paperId)} canCite={!!editor} busy={false} />
                ))}
              </div>
            </Collapsible>
          )}
          {ev.instruments.length > 0 && <Instruments refs={ev.instruments} cited={claim.citedIds} canCite={!!editor} thesisId={thesisId} />}
        </div>
      )}

      <UncitedList thesisId={thesisId} />

      <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-faint">
        Busca y verifica fuentes; nunca escribe tu texto (Pautas UCEMA 8.e). Leé el pasaje en el PDF antes de citarlo: el veredicto es una ayuda, no reemplaza tu lectura.
      </p>
    </div>
  )
}

function SummaryLine({ results, searched }: { results: Evidence[]; searched: number }) {
  if (!results.length) return <span>{searched ? `Busqué en ${searched} ${searched === 1 ? 'paper' : 'papers'}.` : 'Tu biblioteca todavía no tiene papers con texto.'}</span>
  const n = (v: Verdict) => results.filter((r) => r.verdict === v).length
  const parts = [
    n('apoya') && `${n('apoya')} lo ${n('apoya') === 1 ? 'apoya' : 'apoyan'}`,
    n('matiza') && `${n('matiza')} lo ${n('matiza') === 1 ? 'matiza' : 'matizan'}`,
    n('contradice') && `${n('contradice')} lo ${n('contradice') === 1 ? 'contradice' : 'contradicen'}`,
    n('sin_verificar') && `${n('sin_verificar')} sin verificar`
  ].filter(Boolean)
  return (
    <span>
      {results.length} {results.length === 1 ? 'pasaje' : 'pasajes'} en {searched} {searched === 1 ? 'paper' : 'papers'}
      {parts.length ? ` · ${parts.join(', ')}` : ' · ninguno alcanza para citarlo'}
    </span>
  )
}

function EvidenceCard({ e, cited, canCite, busy }: { e: Evidence; cited: boolean; canCite: boolean; busy: boolean }) {
  const paper = useStore((s) => s.papers[e.paperId])
  if (!paper) return null
  const v = VERDICT_STYLE[e.verdict]
  const cite = (page?: number) => {
    const ed = thesisEditor(useEvidence.getState().claim?.thesisId ?? '')
    if (ed) citeEvidence(ed, e.paperId, page)
  }
  const label = inText(paper, THESIS_CITE.style, undefined, THESIS_CITE.locale)
  // The citation shows the article's printed page; the reader opens the PDF page.
  const shown = printedPage(paper, e.page)
  const pdfNote = shown !== e.page ? ` (página ${e.page} del PDF)` : ''
  return (
    <div className={cn('rounded-xl border bg-card p-3 transition-opacity', busy && 'opacity-70')}>
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-semibold [&_svg]:size-3.5', v.text)}>
          {v.icon}
          {busy && e.verdict === 'sin_verificar' ? 'Verificando…' : VERDICT_LABELS[e.verdict]}
        </span>
        {e.deep && (
          <Hint label="Lo encontró leyendo el paper completo">
            <span className="rounded bg-muted px-1 text-[10.5px] font-medium text-muted-foreground">lectura completa</span>
          </Hint>
        )}
        <span className="flex-1" />
        <button className="truncate text-[12px] font-medium text-kind-paper hover:underline" title={paper.title} onClick={() => openTab({ kind: 'paper', id: paper.id })}>
          {shortLabel(paper)}
        </button>
      </div>
      <div className="mt-2 flex gap-2.5">
        <span className={cn('w-[3px] flex-none rounded-full', v.bar)} />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[13px] leading-relaxed">“{e.quote}”</p>
          {e.translation && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">«{e.translation}»</p>}
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
            <Hint label={`Abrir el paper en esta página${pdfNote}, con el pasaje marcado`}>
              <button className="flex-none rounded px-1 font-medium whitespace-nowrap text-brand-text tabular-nums hover:bg-brand-soft" onClick={() => jumpToQuote(e.paperId, e.page, e.quote)}>
                p. {shown}
              </button>
            </Hint>
            <span className="truncate" title={paper.title}>
              {paper.title}
            </span>
          </div>
          {!e.exact && <p className="mt-0.5 text-[11px] text-faint">La oración del pasaje más cercana a lo que señaló el asistente.</p>}
        </div>
      </div>
      {e.why && <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{e.why}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {cited ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
            <CircleCheck className="size-3.5" /> Citado en la oración
          </span>
        ) : (
          <>
            <Hint label={e.verdict === 'contradice' ? 'Contradice tu oración: si lo citás, que sea para marcar el contraste' : 'Inserta la cita antes del punto final de la oración (paráfrasis, APA 7)'}>
              <Button
                size="xs"
                variant={e.verdict === 'apoya' ? 'default' : 'outline'}
                className="h-7"
                disabled={!canCite}
                onClick={() => cite()}
              >
                Citar {label}
              </Button>
            </Hint>
            <Hint label={`Con el número de página${pdfNote}: para citas textuales o cuando querés señalar el pasaje`}>
              <Button size="xs" variant="ghost" className="h-7 text-muted-foreground" disabled={!canCite} onClick={() => cite(e.page)}>
                con p. {shown}
              </Button>
            </Hint>
          </>
        )}
        <span className="flex-1" />
        <IconButton size="icon-xs" label="Copiar el pasaje con su cita" onClick={() => void copyText(`“${e.quote}” ${inText(paper, THESIS_CITE.style, e.page, THESIS_CITE.locale)}`, 'Pasaje copiado con la cita')}>
          <Copy />
        </IconButton>
      </div>
    </div>
  )
}

/** The course instrument the sentence talks about: its references, cited in one click when the paper is in the library. */
function Instruments({ refs, cited, canCite, thesisId }: { refs: InstrumentRef[]; cited: string[]; canCite: boolean; thesisId: string }) {
  const papers = useStore((s) => s.papers)
  const groups = [...new Set(refs.map((r) => r.construct))]
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[11px] font-semibold tracking-wider text-faint uppercase">Fuentes del instrumento</div>
      {groups.map((g) => (
        <div key={g} className="mt-2">
          <div className="text-[12.5px] font-medium">{CONSTRUCTS[g].instrument}</div>
          <ul className="mt-1 space-y-1.5">
            {refs
              .filter((r) => r.construct === g)
              .map((r) => {
                const p = r.paperId ? papers[r.paperId] : undefined
                return (
                  <li key={r.reference} className="text-[12px] leading-relaxed">
                    <span className="text-muted-foreground">{r.reference}</span>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {p ? (
                        cited.includes(p.id) ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
                            <CircleCheck className="size-3.5" /> Citado
                          </span>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-6"
                            disabled={!canCite}
                            onClick={() => {
                              const ed = thesisEditor(thesisId)
                              if (ed) citeEvidence(ed, p.id)
                            }}
                          >
                            Citar {inText(p, THESIS_CITE.style, undefined, THESIS_CITE.locale)}
                          </Button>
                        )
                      ) : (
                        <>
                          <span className="text-[11.5px] text-faint">No está en tu biblioteca: importá el PDF para citarlo con un clic.</span>
                          <IconButton size="icon-xs" label="Copiar la referencia" onClick={() => void copyText(r.reference, 'Referencia copiada')}>
                            <Copy />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The body's claims without a citation: jump to each, back it, or mark it as the student's own. */
function UncitedList({ thesisId }: { thesisId: string }) {
  const live = useLiveThesis(thesisId)
  const editor = thesisEditor(thesisId)
  const [, bump] = useState(0)
  const items = live ? uncitedOf(live.doc) : []
  const marking = editor ? uncitedEnabled(editor.state) : false
  const max = 60
  return (
    <Collapsible
      id="support-uncited"
      title="Oraciones sin cita"
      count={items.length}
      summary={items.length ? 'del cuerpo de la tesis' : undefined}
      className="mt-4"
      actions={
        <IconButton
          size="icon-xs"
          label={marking ? 'Dejar de marcarlas en el texto' : 'Marcarlas en el texto (subrayado punteado)'}
          active={marking}
          disabled={!editor}
          onClick={() => {
            editor?.commands.toggleUncitedMarks()
            bump((n) => n + 1)
          }}
        >
          {marking ? <Eye /> : <EyeOff />}
        </IconButton>
      }
    >
      {!items.length ? (
        <p className="px-1 py-2 text-[12.5px] text-muted-foreground">Todas las afirmaciones del cuerpo tienen cita, o las marcaste como tuyas.</p>
      ) : (
        <ul className="space-y-0.5 pt-1">
          {items.slice(0, max).map((u) => (
            <li key={`${u.from}-${u.text.slice(0, 20)}`} className="group flex items-start gap-1 rounded-lg px-1.5 py-1 hover:bg-accent/60">
              <button
                className="line-clamp-2 min-w-0 flex-1 text-left text-[12.5px] leading-snug"
                title="Ir a la oración"
                disabled={!editor}
                onClick={() => {
                  if (!editor) return
                  scrollToPos(editor, Math.max(0, u.from - 1))
                  editor.commands.setTextSelection({ from: u.from, to: u.to })
                }}
              >
                {u.text}
              </button>
              <div className="flex flex-none gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton size="icon-xs" label="Buscar respaldo en tu biblioteca" disabled={!editor} onClick={() => editor && backSentence(editor, thesisId, u.from, u.from)}>
                  <Search />
                </IconButton>
                <IconButton
                  size="icon-xs"
                  label="Es mía: es mi planteo, no necesita cita"
                  disabled={!editor}
                  onClick={() => {
                    editor?.commands.markAsOwn(u.text)
                    bump((n) => n + 1)
                  }}
                >
                  <UserRound />
                </IconButton>
              </div>
            </li>
          ))}
          {items.length > max && <li className="px-1.5 py-1 text-[11.5px] text-faint">y {items.length - max} más…</li>}
        </ul>
      )}
      <p className="px-1.5 pt-2 text-[11px] leading-relaxed text-faint">
        Cuenta las oraciones del cuerpo que afirman algo y no tienen cita. No incluye tus resultados (con estadísticos, tablas o figuras), tus hipótesis ni lo que plantea este trabajo.
      </p>
    </Collapsible>
  )
}

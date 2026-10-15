import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock, Check, CheckCircle2, ChevronDown, Crosshair, ChartColumn, Info, ListPlus, Sparkles, XCircle } from 'lucide-react'
import type { ConstructId } from '@shared/types'
import { AGENT_TAB, askAssistant, openAnalysis, openMatrix, openTasks, patchMatrix, patchResearch, patchSettings, tabKey, toast, useStore } from '../store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ANALYSIS_STEPS,
  APPROVAL,
  CONSTRUCTS,
  CONSTRUCT_ORDER,
  DATASET,
  DELIVERIES,
  DELIVERY_WEEKS,
  DEMOGRAPHICS,
  PHASES,
  PROJECT,
  RULES,
  SUBMISSION_EMAIL,
  THEME,
  WORKSHOP_START,
  chosenPair,
  deliveryLabel,
  fmtDelivery,
  frameworkChecks,
  nextDelivery,
  type FrameworkCheck
} from './framework'
import { changeCount, createPlan, planChanges } from './plan'
import { FrameworkText, ProbeGrid, useProbes } from './Applied'
import { MIN_CROSS, coverage } from './coverage'

const ask = (prompt: string) => askAssistant({ chatId: tabKey(AGENT_TAB), prefill: prompt, autoSend: true })

/** The course's research framework: what's fixed, what the student picks, and proof that the assistant applies it. */
export function ResearchView() {
  const settings = useStore((s) => s.settings)
  const r = settings.research
  const pair = chosenPair(r)
  const checks = useMemo(() => frameworkChecks(settings), [settings])
  const issues = checks.filter((c) => !c.ok && c.severity !== 'info').length

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2.5">
          <Crosshair className="size-4.5 flex-none text-bloom-teal" />
          <div className="min-w-0">
            <h1 className="text-[14px] leading-tight font-semibold">Marco de investigación</h1>
            <p className="text-[11.5px] text-muted-foreground">
              {pair.length === 2 ? `Tu combinación: ${pair.map((c) => c.label).join(' × ')}` : 'Elegí 2 de los 5 temas de la cátedra'} ·{' '}
              {issues ? `${issues} punto${issues > 1 ? 's' : ''} para revisar` : 'todo en regla'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => ask('Mirando el marco de la cátedra, mi combinación de temas, mi pregunta y mi biblioteca: ¿mi planteo está bien encuadrado? Señalá qué ajustar, proponé 2 o 3 hipótesis para mi combinación fundadas en papers de mi biblioteca y decime qué me falta leer. Si todavía no elegí los temas, ayudame a elegirlos.')}>
          <Sparkles className="text-brand" /> Revisar mi planteo con el asistente
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[920px] flex-col gap-7 px-8 pt-6 pb-16">
          <Theme />
          <Topics />
          {pair.length === 2 && <Pair />}
          <Framing />
          <Demographics />
          <Calendar />
          <Checks checks={checks} />
          <Applied />
          <Method />
        </div>
      </div>
    </div>
  )
}

function Block({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[17px] font-medium tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Theme() {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-bloom-teal uppercase">
        <Crosshair className="size-3.5" /> Temática obligatoria de la cátedra
      </div>
      <p className="mt-2 font-heading text-[16px] leading-snug">{THEME}</p>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Proyecto: «{PROJECT.title}» · {PROJECT.researchers}
      </p>
      <ul className="mt-3 grid gap-1.5 text-[12.5px]">
        {RULES.map((rule) => (
          <li key={rule} className="flex gap-2">
            <Check className="mt-0.5 size-3.5 flex-none text-success" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Topics() {
  const chosen = useStore((s) => s.settings.research.constructs)
  const toggle = (id: ConstructId) => {
    if (chosen.includes(id)) return patchResearch({ constructs: chosen.filter((c) => c !== id) })
    if (chosen.length >= 2) return toast('Ya cruzás 2 temas: quitá uno para elegir otro')
    patchResearch({ constructs: [...chosen, id] })
  }
  return (
    <Block title="Tus 2 temas" hint={`Elegí exactamente 2 de los 5 para cruzar. ${chosen.length}/2 elegidos.`}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {CONSTRUCT_ORDER.map((id) => (
          <TopicCard key={id} id={id} on={chosen.includes(id)} locked={!chosen.includes(id) && chosen.length >= 2} onToggle={() => toggle(id)} />
        ))}
      </div>
    </Block>
  )
}

function TopicCard({ id, on, locked, onToggle }: { id: ConstructId; on: boolean; locked: boolean; onToggle: () => void }) {
  const c = CONSTRUCTS[id]
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow,opacity]', on ? 'border-bloom-teal ring-2 ring-bloom-teal/25' : locked && 'opacity-60')}>
      <button onClick={onToggle} aria-pressed={on} className="flex items-start gap-3 p-3.5 text-left">
        <span className={cn('mt-0.5 grid size-5 flex-none place-items-center rounded-md border-[1.5px] border-input transition-colors', on && 'border-bloom-teal bg-bloom-teal text-white')}>
          {on && <Check className="size-3.5" strokeWidth={3} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <strong className="font-[600]">{c.label}</strong>
          <span className="text-[11.5px] text-muted-foreground">{c.course}</span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px] font-medium', c.tone)}>{c.rates === 'leader' ? 'El colaborador evalúa a su jefe' : 'Autoinforme del colaborador'}</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{c.columns.split(' ')[0].replace(/[,(]$/, '')}</span>
          </span>
        </span>
      </button>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 border-t px-3.5 py-2 text-left text-[11.5px] text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} /> Instrumento y puntuación
      </button>
      {open && (
        <dl className="grid gap-2 px-3.5 pb-3.5 text-[12px]">
          <Def term="Instrumento">{c.instrument}</Def>
          <Def term="Ítems">{c.items}</Def>
          <Def term="Escala">{c.scale}</Def>
          <Def term="Puntuación">{c.scoring}</Def>
          <Def term="En la base">{c.columns}</Def>
          <Def term="Referencias">
            <ul className="grid gap-1">
              {c.references.map((ref) => (
                <li key={ref} className="text-muted-foreground">
                  {ref}
                </li>
              ))}
            </ul>
          </Def>
        </dl>
      )}
    </div>
  )
}

function Def({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold tracking-wide text-faint uppercase">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** The pair, side by side: what each measures, and a starting direction for the model. */
function Pair() {
  const r = useStore((s) => s.settings.research)
  const [a, b] = chosenPair(r)
  const pair = `${a.label} × ${b.label}`
  return (
    <Block title={pair} hint={`Dirección sugerida para empezar: ${a.label} como predictor, ${b.label} como resultado. Discutila con tu tutor.`}>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-muted/50 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">{a.label}</th>
              <th className="px-3 py-2 font-medium">{b.label}</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">
            {(
              [
                ['Quién responde', (c: typeof a) => (c.rates === 'leader' ? 'El colaborador, sobre su jefe directo' : 'El colaborador, sobre sí mismo')],
                ['Instrumento', (c: typeof a) => c.instrument],
                ['Puntuación', (c: typeof a) => c.scoring],
                ['Columnas', (c: typeof a) => c.columns]
              ] as const
            ).map(([label, get]) => (
              <tr key={label}>
                <td className="w-[120px] text-[11.5px] font-medium text-muted-foreground">{label}</td>
                <td>{get(a)}</td>
                <td>{get(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Coverage />
      <div className="flex flex-wrap gap-2">
        <AskChip prompt={`Proponé 3 hipótesis para cruzar ${pair} desde la perspectiva del colaborador, cada una fundada en papers de mi biblioteca (citá), con la dirección esperada y la prueba estadística que corresponde según el instructivo de la cátedra.`}>Proponer hipótesis</AskChip>
        <AskChip prompt={`¿Qué papers de mi biblioteca estudian ${a.label} y ${b.label} juntos, o cada uno con liderazgo? Ordenalos por utilidad para mi tesis y sumá a las candidatas los que falten.`}>Papers que cruzan los 2 temas</AskChip>
        <AskChip prompt={`Con la base de la cátedra, armame el plan de análisis para ${pair}: qué columnas uso, cómo puntúo cada escala (ítems inversos), qué chequeos hago (alfa, normalidad, atípicos), qué pruebas corro y cómo sumo los cruces demográficos que elegí. Paso a paso; los números los calcula la pestaña Análisis de datos de la app.`}>Plan de análisis</AskChip>
        <AskChip prompt={`¿Qué aplicación práctica para las organizaciones podría salir de cruzar ${pair}? Dame 3 ideas que dependan de los resultados posibles, sin escribir el texto por mí.`}>Ideas de aplicación</AskChip>
      </div>
    </Block>
  )
}

/** How much of the library backs each chosen topic and, above all, the cross between them. */
function Coverage() {
  const r = useStore((s) => s.settings.research)
  const papers = useStore((s) => s.papers)
  const guides = useStore((s) => s.guides)
  const c = useMemo(() => coverage(Object.values(papers), guides, r), [papers, guides, r])
  const [a, b] = chosenPair(r)
  const show = (topic: 'pair' | ConstructId) => {
    openMatrix()
    patchMatrix({ topic, filter: null, query: '', level: 'all', sort: 'relevance' })
  }
  const thin = c.cross < MIN_CROSS
  const cards: { topic: 'pair' | ConstructId; label: string; n: number }[] = [
    { topic: a.id, label: a.label, n: c.by[a.id] },
    { topic: b.id, label: b.label, n: c.by[b.id] },
    { topic: 'pair', label: 'Cruzan los dos', n: c.cross }
  ]
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {cards.map((x) => (
          <button
            key={x.topic}
            onClick={() => show(x.topic)}
            className="flex flex-col items-start gap-0.5 rounded-xl border bg-card px-3 py-2 text-left shadow-xs transition-colors hover:border-ring"
            title="Ver en la matriz de literatura"
          >
            <span className="text-[11.5px] text-muted-foreground">{x.label}</span>
            <strong className={cn('text-[15px] font-[600] tabular-nums', x.topic === 'pair' && thin && 'text-bloom-amber')}>
              {x.n} <span className="text-[11.5px] font-normal text-muted-foreground">de {c.total} papers</span>
            </strong>
          </button>
        ))}
      </div>
      {thin && (
        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 flex-none text-bloom-amber" />
          Pocos papers cruzan tus dos temas (menos de {MIN_CROSS}). El marco teórico necesita evidencia del vínculo entre ambos, no solo de cada uno: buscá estudios que los relacionen, aunque sea con liderazgo en general.
        </p>
      )}
    </div>
  )
}

function AskChip({ prompt, children }: { prompt: string; children: ReactNode }) {
  return (
    <button
      onClick={() => ask(prompt)}
      className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12.5px] shadow-xs transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text"
    >
      <Sparkles className="size-3.5 text-brand" /> {children}
    </button>
  )
}

/** Title, question and hypotheses, edited here as well as in Ajustes: the checks below read them. */
function Framing() {
  const settings = useStore((s) => s.settings)
  return (
    <Block title="Tu planteo" hint="El asistente lo recibe con cada pedido, junto con el marco de la cátedra.">
      <div className="grid gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-[550] text-muted-foreground">Título provisorio</span>
          <Input
            key={`t:${settings.thesisTitle}`}
            defaultValue={settings.thesisTitle}
            placeholder="p. ej. El líder como proveedor de seguridad y el comportamiento de ciudadanía organizacional de los colaboradores"
            onBlur={(e) => e.target.value.trim() !== settings.thesisTitle && patchSettings({ thesisTitle: e.target.value.trim() })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-[550] text-muted-foreground">Pregunta de investigación</span>
          <Textarea
            key={`q:${settings.researchQuestion}`}
            rows={2}
            className="resize-none"
            defaultValue={settings.researchQuestion}
            placeholder="p. ej. ¿Cómo se relaciona la percepción del líder como proveedor de seguridad con el CCO de los colaboradores, según su edad y su género?"
            onBlur={(e) => e.target.value.trim() !== settings.researchQuestion && patchSettings({ researchQuestion: e.target.value.trim() })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-[550] text-muted-foreground">Hipótesis de trabajo (en tus palabras)</span>
          <Textarea
            key={`h:${settings.research.hypotheses}`}
            rows={3}
            className="resize-none"
            defaultValue={settings.research.hypotheses}
            placeholder="H₁: Cuanto más perciben los colaboradores a su jefe como proveedor de seguridad, mayor es su CCO dirigido a la organización. H₀: No existe relación entre ambas variables."
            onBlur={(e) => e.target.value.trim() !== settings.research.hypotheses && patchResearch({ hypotheses: e.target.value.trim() })}
          />
        </label>
      </div>
    </Block>
  )
}

function Demographics() {
  const chosen = useStore((s) => s.settings.research.demographics)
  const toggle = (id: string) => patchResearch({ demographics: chosen.includes(id) ? chosen.filter((d) => d !== id) : [...chosen, id] })
  return (
    <Block title="Cruces demográficos" hint="Opcionales: variables de la base para comparar grupos o controlar en la regresión.">
      <div className="flex flex-wrap gap-2">
        {DEMOGRAPHICS.map((d) => {
          const on = chosen.includes(d.id)
          return (
            <button
              key={d.id}
              onClick={() => toggle(d.id)}
              aria-pressed={on}
              title={`${d.column} · ${d.kind}`}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors',
                on ? 'border-bloom-teal bg-bloom-teal/12 font-medium text-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {on && <Check className="size-3.5 text-bloom-teal" strokeWidth={3} />}
              {d.label}
              <span className="text-[10.5px] text-faint">{d.column}</span>
            </button>
          )
        })}
      </div>
    </Block>
  )
}

function Calendar() {
  const settings = useStore((s) => s.settings)
  const tasks = useStore((s) => s.tasks)
  const next = nextDelivery()
  const changes = useMemo(() => changeCount(planChanges(settings, Object.values(tasks))), [settings, tasks])
  return (
    <Block
      title="Entrega"
      hint={`3.er trimestre: el taller empezó el ${fmtDelivery(WORKSHOP_START)}, con una entrega cada ${DELIVERY_WEEKS} semanas. La última es el trabajo final, con la aprobación previa del tutor.`}
    >
      <div className="rounded-xl border bg-card p-1.5 shadow-xs">
        {DELIVERIES.map((d, i) => {
          const n = i + 1
          const final = n === DELIVERIES.length
          const past = !next || n < next.n
          const isNext = next?.n === n
          return (
            <div key={n} className={cn('flex items-start gap-3 rounded-lg px-2.5 py-2.5', isNext && 'bg-bloom-teal/10')}>
              <span
                className={cn(
                  'mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border text-[12px] font-[600] tabular-nums',
                  isNext ? 'border-bloom-teal bg-bloom-teal text-white' : past ? 'text-faint' : 'text-muted-foreground'
                )}
              >
                {past ? <Check className="size-3.5" strokeWidth={3} /> : n}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('flex flex-wrap items-baseline gap-x-2 text-[13px]', past && 'text-faint')}>
                  <span className="font-[600] first-letter:uppercase">{fmtDelivery(d)}</span>
                  <span className="text-muted-foreground">{deliveryLabel(n)}</span>
                  {isNext && <span className="text-[12px] font-medium text-bloom-teal">{next.left ? `faltan ${next.left} día${next.left === 1 ? '' : 's'}` : 'es hoy'}</span>}
                </span>
                <span className="block text-[11.5px] text-muted-foreground first-letter:uppercase">
                  {PHASES.filter((p) => p.delivery === n)
                    .map((p) => p.title.toLowerCase())
                    .join(' · ')}
                </span>
                {final && (
                  <span className="block text-[11.5px] text-muted-foreground">
                    Aprobación del tutor: {fmtDelivery(APPROVAL)} · PDF a {SUBMISSION_EMAIL}
                  </span>
                )}
              </span>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2 border-t px-2.5 pt-2.5 pb-1">
          <CalendarClock className="size-4 text-muted-foreground" />
          <span className="flex-1 text-[12px] text-muted-foreground">
            {changes ? 'Tu cronograma no coincide con estas entregas.' : 'Tu cronograma está al día con las entregas.'}
          </span>
          <Button
            size="sm"
            disabled={!changes || !next}
            onClick={() => createPlan().count > 0 && openTasks()}
            title="Cada etapa de la cátedra dentro de la entrega en que se presenta, con pomodoros y los hitos de cada entrega y del tutor"
          >
            <ListPlus /> {changes ? `Ajustar el plan (${changes} cambio${changes === 1 ? '' : 's'})` : 'Plan al día'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openTasks()}>
            Ver cronograma
          </Button>
        </div>
      </div>
    </Block>
  )
}

const SEVERITY_ICON: Record<FrameworkCheck['severity'], ReactNode> = {
  error: <XCircle className="size-4 text-destructive" />,
  warn: <AlertTriangle className="size-4 text-bloom-amber" />,
  info: <Info className="size-4 text-muted-foreground" />
}

function Checks({ checks }: { checks: FrameworkCheck[] }) {
  return (
    <Block title="Chequeos" hint="Se actualizan mientras escribís: tu planteo frente a las reglas de la cátedra.">
      <div className="rounded-xl border bg-card p-1.5 shadow-xs">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2">
            <span className="mt-0.5 flex-none">{c.ok ? <CheckCircle2 className="size-4 text-success" /> : SEVERITY_ICON[c.severity]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-[550] first-letter:uppercase">{c.title}</span>
              {c.detail && <span className="block text-[11.5px] text-muted-foreground first-letter:uppercase">{c.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </Block>
  )
}

/** Proof: every assistant's real instructions, built now and searched for the framework and your choices. */
function Applied() {
  const probes = useProbes()
  const ok = probes?.filter((p) => p.ok).length ?? 0
  return (
    <Block
      title="Aplicado en el asistente"
      hint="Cada asistente se arma igual que en un chat real y se busca en sus instrucciones el marco y tus elecciones."
      actions={probes && <span className={cn('text-[12px] font-medium tabular-nums', ok === probes.length ? 'text-success' : 'text-bloom-amber')}>{ok}/{probes.length} al día</span>}
    >
      <ProbeGrid probes={probes} />
      <FrameworkText />
    </Block>
  )
}

/** The data and the course's analysis guide, for doing the analysis yourself. */
function Method() {
  return (
    <Block
      title="Datos y análisis"
      hint="Del instructivo de la cátedra (Continuous Data Analysis Guide). La pestaña «Análisis de datos» importa la base y calcula cada paso para tu combinación."
      actions={
        <Button variant="outline" size="sm" onClick={openAnalysis}>
          <ChartColumn className="text-bloom-amber" /> Abrir el análisis
        </Button>
      }
    >
      <p className="rounded-xl border bg-card p-3.5 text-[12.5px] shadow-xs">{DATASET}</p>
      <ol className="grid gap-2">
        {ANALYSIS_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl border bg-card p-3.5 shadow-xs">
            <span className="grid size-6 flex-none place-items-center rounded-full bg-bloom-teal/12 text-[12px] font-semibold text-bloom-teal tabular-nums">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-[600]">{s.title}</span>
              <span className="block text-[12.5px] text-muted-foreground">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </Block>
  )
}

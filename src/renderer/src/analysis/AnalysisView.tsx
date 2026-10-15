import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ChartColumn, Copy, Crosshair, FileSpreadsheet, ImagePlus, Info, Sparkles, Table2, Trash2, Upload } from 'lucide-react'
import type { Dataset } from '@shared/types'
import { AGENT_TAB, askAssistant, deleteDataset, openResearch, patchAnalysis, saveDataset, tabKey, toast, useStore } from '../store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { EmptyState } from '../components/common'
import { Segmented } from '../components/Segmented'
import { ANALYSIS_STEPS, CONSTRUCTS, chosenPair } from '../research/framework'
import { apaInline, type ApaFigure, type ApaTable } from '../thesis/tables'
import { withThesisEditor } from '../thesis/bridge'
import { Frame, importDataset } from './dataset'
import { KEY_BY_ID } from './keys'
import { correlationTable, descriptivesTable, groupTable, moderationTable, regressionTable, relationshipsTable, reliabilityTable, resultsText, sampleTable } from './apa'
import { groupMeans, histogram, qqPlot, scatter } from './charts'
import { fmtNum, fmtP, fmtR } from './stats'
import { useResults } from './use'
import type { Results } from './results'

const ask = (prompt: string) => askAssistant({ chatId: tabKey(AGENT_TAB), prefill: prompt, autoSend: true })

async function insertTable(t: ApaTable): Promise<void> {
  const ok = await withThesisEditor((ed) => ed.chain().focus().insertApaTable(t).run())
  toast(ok ? 'Tabla insertada en la tesis' : 'No se pudo abrir la tesis', undefined, { status: ok ? 'success' : 'error', description: ok ? 'Mencionala en el texto («como muestra la Tabla N…») y revisá la nota.' : undefined })
}

async function insertFigure(f: ApaFigure): Promise<void> {
  const ok = await withThesisEditor((ed) => ed.chain().focus().insertApaFigure(f).run())
  toast(ok ? 'Figura insertada en la tesis' : 'No se pudo abrir la tesis', undefined, { status: ok ? 'success' : 'error' })
}

function copyTable(t: ApaTable): void {
  const strip = (s: string) => s.replace(/\*/g, '')
  void navigator.clipboard.writeText([strip(t.title), t.headers.map(strip).join('\t'), ...t.rows.map((r) => r.map(strip).join('\t')), t.note ? `Nota. ${strip(t.note)}` : ''].join('\n'))
  toast('Tabla copiada (se pega en Excel o Word)')
}

/** The course dataset, scored and analysed for the student's pair: the Method and Results chapters' numbers. */
export function AnalysisView() {
  const settings = useStore((s) => s.settings)
  const datasets = useStore((s) => s.datasets)
  const data = settings.analysis.datasetId ? datasets[settings.analysis.datasetId] : undefined
  const res = useResults()
  const pair = chosenPair(settings.research)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const d = await importDataset(file)
      // Kept next to earlier imports; the selector in the header picks the one analysed.
      saveDataset(d)
      patchAnalysis({ datasetId: d.id })
      const f = new Frame(d)
      const e = f.excluded
      toast(`Base importada: ${f.rows.length} respuestas válidas`, undefined, {
        status: 'success',
        description: `${d.rows.length} filas en total; quedan fuera ${e.unfinished} sin finalizar, ${e.preview} vistas previas y ${e.noConsent} sin consentimiento.${d.labeled ? ' Exportación con etiquetas.' : ''}`
      })
    } catch (e) {
      toast((e as Error).message, undefined, { status: 'error' })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2.5">
          <ChartColumn className="size-4.5 flex-none text-bloom-amber" />
          <div className="min-w-0">
            <h1 className="text-[14px] leading-tight font-semibold">Análisis de datos</h1>
            <p className="text-[11.5px] text-muted-foreground">
              {data ? `${data.name} · ${res?.n ?? 0} respuestas válidas` : 'Importá la base de la cátedra'} ·{' '}
              {pair.length === 2 ? pair.map((c) => c.label).join(' × ') : 'sin combinación elegida'}
            </p>
          </div>
        </div>
        {Object.keys(datasets).length > 1 && data && (
          <Select value={data.id} onValueChange={(datasetId) => patchAnalysis({ datasetId })}>
            <SelectTrigger size="sm" className="h-8 max-w-64 text-[12.5px]" title="Base que se analiza">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(datasets)
                .sort((a, b) => b.importedAt - a.importedAt)
                .map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.sav" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        {data && (
          <Button
            variant="outline"
            size="sm"
            disabled={!res}
            onClick={() =>
              ask(
                'Mirá los resultados de mi análisis (<analysis>) a la luz de mis hipótesis y de mi combinación de temas. Explicame qué dicen, cuáles hipótesis se sostienen y cuáles no, qué limitaciones tengo que reconocer y qué me conviene mirar en la literatura de mi biblioteca para discutirlos. No redactes la sección por mí: dame la estructura y los puntos a cubrir.'
              )
            }
          >
            <Sparkles className="text-brand" /> Interpretar con el asistente
          </Button>
        )}
        <Button size="sm" variant={data ? 'outline' : 'default'} disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload /> {data ? 'Importar otra base' : 'Importar base (.xlsx)'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <EmptyState
            icon={<FileSpreadsheet />}
            title="Importá la base de datos de la cátedra"
            description={
              <>
                El .xlsx exportado de Qualtrics (carpeta «5. Base de datos para analizar»). Sirve la versión «Con etiquetas» o «Sin etiquetas»; el .sav de SPSS no.
              </>
            }
          >
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload /> Elegir archivo
            </Button>
          </EmptyState>
        ) : !res ? (
          <EmptyState icon={<AlertTriangle />} title="No se pudo analizar la base" description="Revisá que sea la exportación de Qualtrics del cuestionario de la cátedra." />
        ) : (
          <div className="mx-auto flex max-w-[1000px] flex-col gap-8 px-8 pt-6 pb-16">
            <Overview data={data} res={res} />
            <SampleSection res={res} />
            <ReliabilitySection res={res} />
            <DescriptivesSection res={res} />
            <CorrelationSection res={res} />
            <GroupSection res={res} />
            <RegressionSection res={res} />
            <Integrity />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- pieces ----------

function Section({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
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

type FigureMaker = { label: string; make: () => ApaFigure | null }

function TableActions({ table, figure, figures }: { table: ApaTable; figure?: () => ApaFigure | null; figures?: FigureMaker[] }) {
  const all = [...(figure ? [{ label: 'Figura', make: figure }] : []), ...(figures ?? [])]
  return (
    <div className="flex flex-none flex-wrap justify-end gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => copyTable(table)} title="Copiar la tabla como texto con tabulaciones">
        <Copy /> Copiar
      </Button>
      {all.map((f) => (
        <Button
          key={f.label}
          variant="outline"
          size="sm"
          onClick={() => {
            const fig = f.make()
            if (fig) void insertFigure(fig)
          }}
        >
          <ImagePlus /> {f.label}
        </Button>
      ))}
      <Button variant="outline" size="sm" onClick={() => void insertTable(table)}>
        <Table2 /> Insertar tabla APA
      </Button>
    </div>
  )
}

/** A compact select, for the analysis' choices. */
function Pick<T extends string>({ value, onChange, items, title, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; title?: string; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className={cn('h-7 text-[12.5px]', className)} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** An APA table as it will look in the thesis (lighter chrome). */
function TableView({ t }: { t: ApaTable }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card px-4 py-3 shadow-xs">
      <p className="text-[12.5px] italic" dangerouslySetInnerHTML={{ __html: apaInline(t.title).replace(/<\/?i>/g, '') }} />
      <table className="mt-2 w-full border-collapse text-[12.5px] tabular-nums">
        <thead>
          <tr className="border-y border-foreground/60">
            {t.headers.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-center font-normal whitespace-nowrap" dangerouslySetInnerHTML={{ __html: apaInline(h) }} />
            ))}
          </tr>
        </thead>
        <tbody className="border-b border-foreground/60">
          {t.rows.map((r, i) => (
            <tr key={i}>
              {t.headers.map((_, j) => (
                <td key={j} className={cn('px-2 py-1', j === 0 ? 'text-left' : 'text-right whitespace-nowrap')} dangerouslySetInnerHTML={{ __html: apaInline(r[j] ?? '') }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.note && <p className="mt-2 text-[11.5px] text-muted-foreground" dangerouslySetInnerHTML={{ __html: `<i>Nota.</i> ${apaInline(t.note)}` }} />}
    </div>
  )
}

function Overview({ data, res }: { data: Dataset; res: Results }) {
  const settings = useStore((s) => s.settings)
  const a = settings.analysis
  const pair = chosenPair(settings.research)
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
        <Stat label="Respuestas válidas" value={res.n} />
        <Stat label="Filas en la base" value={res.total} />
        <Stat label="Sin finalizar" value={res.excluded.unfinished} />
        <Stat label="Vistas previas / pruebas" value={res.excluded.preview} />
        <Stat label="Sin consentimiento" value={res.excluded.noConsent} />
        {res.excluded.speeders > 0 && <Stat label="Demasiado rápidas" value={res.excluded.speeders} />}
        {res.excluded.noBoss > 0 && <Stat label="Sin jefe directo" value={res.excluded.noBoss} />}
        <Stat label="Exportación" value={data.labeled ? 'Con etiquetas' : 'Sin etiquetas'} />
        <Stat label="Importada" value={new Date(data.importedAt).toLocaleDateString('es-AR')} />
        <button className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-destructive" onClick={() => deleteDataset(data.id)} title="Quitar la base importada">
          <Trash2 className="size-3.5" /> Quitar
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted-foreground">Tu combinación:</span>
        {pair.length === 2 ? (
          pair.map((c) => (
            <span key={c.id} className={cn('rounded-md px-2 py-0.5 font-medium', c.tone)}>
              {c.label}
            </span>
          ))
        ) : (
          <button className="flex items-center gap-1 font-medium text-destructive" onClick={openResearch}>
            <Crosshair className="size-3.5" /> Elegí tus 2 temas
          </button>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Pruebas:</span>
          <Segmented
          size="sm"
          value={a.method}
          onChange={(method) => patchAnalysis({ method })}
          items={[
            { value: 'auto', label: 'Según la normalidad', title: 'Pearson y t si ninguna variable tiene asimetría mayor a ±1; si no, Spearman y Mann-Whitney' },
            { value: 'parametric', label: 'Paramétricas' },
            { value: 'nonparametric', label: 'No paramétricas' }
          ]}
          />
        </span>
        <label className="flex items-center gap-1.5" title="Lleva los valores con |z| > 3 a ±3 desvíos antes de las pruebas (hay que mencionarlo en Método)">
          <input type="checkbox" checked={a.winsorize} onChange={(e) => patchAnalysis({ winsorize: e.target.checked })} /> Winsorizar atípicos
        </label>
        {(res.speeders.count > 0 || a.dropSpeeders) && (
          <label className="flex items-center gap-1.5" title={`Respuestas de menos de ${fmtNum(res.speeders.threshold / 60, 1)} min (un tercio de la mediana, ${fmtNum(res.speeders.median / 60, 1)} min): pueden no haber leído las preguntas. Si las excluís, informalo en Método.`}>
            <input type="checkbox" checked={!!a.dropSpeeders} onChange={(e) => patchAnalysis({ dropSpeeders: e.target.checked })} /> Excluir respuestas demasiado rápidas ({res.speeders.count})
          </label>
        )}
        {(res.noBoss > 0 || a.dropNoBoss) && (
          <label className="flex items-center gap-1.5" title="Quienes se identificaron como propietarios o fundadores (Q2.5) no tienen un jefe directo a quien describir en la HSA-TFL y la LSPS. Si los excluís, informalo en Participantes.">
            <input type="checkbox" checked={!!a.dropNoBoss} onChange={(e) => patchAnalysis({ dropNoBoss: e.target.checked })} /> Excluir propietarios / fundadores ({res.noBoss})
          </label>
        )}
      </div>
      {res.notes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg bg-bloom-amber/10 px-3 py-2 text-[12.5px]">
          {res.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <Info className="mt-0.5 size-3.5 flex-none text-bloom-amber" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function SampleSection({ res }: { res: Results }) {
  const table = useMemo(() => sampleTable(res.sample, res.n), [res])
  const e = res.excluded
  if (!res.sample.continuous.length && !res.sample.categorical.length) return null
  return (
    <Section
      title="Participantes"
      hint={`Para la sección Participantes del Método. De ${res.total} filas se excluyeron ${e.unfinished} sin finalizar, ${e.preview} vistas previas o pruebas de la encuesta y ${e.noConsent} sin consentimiento informado${e.speeders ? `, ${e.speeders} respuestas demasiado rápidas` : ''}${e.noBoss ? `, ${e.noBoss} propietarios o fundadores sin jefe directo` : ''}: quedan ${res.n}.`}
      actions={<TableActions table={table} />}
    >
      <TableView t={table} />
    </Section>
  )
}

function ReliabilitySection({ res }: { res: Results }) {
  const table = useMemo(() => reliabilityTable(res.reliability), [res])
  const reverse = useStore((s) => s.settings.analysis.reverse)
  const weak = res.reliability.filter((r) => r.weakItems.length)
  return (
    <Section title="1. Puntuación y confiabilidad" hint={ANALYSIS_STEPS[1].detail} actions={<TableActions table={table} />}>
      <TableView t={table} />
      {weak.length > 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          Ítems que bajan el α (quitarlos lo sube .02 o más):{' '}
          {weak.map((r) => `${r.key.label}: ${r.weakItems.map((w) => `ítem ${w.item} (α = ${fmtR(w.alphaIfDeleted)})`).join(', ')}`).join('; ')}. Antes de quitar un ítem, revisá que su clave (directo o inverso) sea correcta.
        </p>
      )}
      <details className="rounded-lg border bg-card px-3 py-2 text-[12.5px]">
        <summary className="cursor-pointer font-medium">Claves de puntuación (ítems inversos)</summary>
        <p className="mt-2 text-muted-foreground">
          Vienen del documento de cuestionarios de la cátedra y de los artículos de validación. Si tu tutor indica otra clave, cambiá los ítems inversos (números de ítem dentro de la escala, separados por coma).
        </p>
        <div className="mt-2 grid gap-2">
          {res.scores
            .filter((s) => !s.key.of)
            .map(({ key }) => {
              const base = KEY_BY_ID[key.id]
              const changed = !!reverse[key.id]
              return (
                <div key={key.id} className="grid grid-cols-[minmax(0,1fr)_160px] items-center gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {key.label} <span className="font-normal text-muted-foreground">· {key.items.length} ítems ({key.items[0]}–{key.items.at(-1)})</span>
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground" title={key.source}>
                      {key.source}
                    </div>
                  </div>
                  <Input
                    key={`${key.id}:${key.reverse.join()}`}
                    defaultValue={key.reverse.join(', ')}
                    placeholder="ninguno"
                    className={cn('h-7 text-[12px]', changed && 'border-bloom-amber')}
                    title={changed ? `Cambiado. Clave original: ${base.reverse.join(', ') || 'ninguno'}` : 'Ítems inversos'}
                    onBlur={(e) => {
                      const next = e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= key.items.length)
                      const same = next.join() === base.reverse.join()
                      const { [key.id]: _, ...rest } = reverse
                      patchAnalysis({ reverse: same ? rest : { ...reverse, [key.id]: next } })
                    }}
                  />
                </div>
              )
            })}
        </div>
      </details>
    </Section>
  )
}

function DescriptivesSection({ res }: { res: Results }) {
  const table = useMemo(() => descriptivesTable(res.descriptives, res.n), [res])
  const [varId, setVarId] = useState(res.descriptives[0]?.id ?? '')
  const row = res.descriptives.find((d) => d.id === varId) ?? res.descriptives[0]
  return (
    <Section
      title="2. Descriptivos y normalidad"
      hint={`${ANALYSIS_STEPS[2].detail} ${ANALYSIS_STEPS[3].detail}`}
      actions={
        <TableActions
          table={table}
          figures={
            row
              ? [
                  { label: 'Histograma', make: () => ({ title: `Distribución de ${row.label.toLowerCase()}`, svg: histogram(row.values, row.label), note: `*N* = ${row.n}. Asimetría = ${fmtNum(row.skewness)}.` }) },
                  { label: 'Q-Q', make: () => ({ title: `Gráfico Q-Q normal de ${row.label.toLowerCase()}`, svg: qqPlot(row.values, row.label), note: `*N* = ${row.n}. Si los puntos siguen la diagonal, la distribución es aproximadamente normal.` }) }
                ]
              : undefined
          }
        />
      }
    >
      <TableView t={table} />
      {row && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>Figuras de:</span>
          <Pick value={row.id} onChange={setVarId} items={res.descriptives.map((d) => ({ value: d.id, label: d.label }))} className="max-w-72" />
          <span>
            asimetría {fmtNum(row.skewness)} ({row.skew}){row.outliers ? `, ${row.outliers} atípico(s)` : ''}. El instructivo recomienda mirar el histograma o el Q-Q además de la asimetría.
          </span>
        </div>
      )}
    </Section>
  )
}

const DIRECTION_ITEMS = [
  { value: 'two', label: 'Dos colas' },
  { value: '+', label: 'Una cola: positiva' },
  { value: '-', label: 'Una cola: negativa' }
] as const

function setDirection(key: string, v: 'two' | '+' | '-') {
  const { [key]: _, ...rest } = useStore.getState().settings.analysis.directions ?? {}
  patchAnalysis({ directions: v === 'two' ? rest : { ...rest, [key]: v } })
}

function CorrelationSection({ res }: { res: Results }) {
  const c = res.correlations
  const directions = useStore((s) => s.settings.analysis.directions) ?? {}
  const correction = useStore((s) => s.settings.analysis.correction) ?? 'fdr'
  const table = useMemo(() => (c ? correlationTable(c, res.descriptives) : null), [c, res])
  if (!c || !table) return null
  const sym = c.method === 'pearson' ? 'r' : 'ρ'
  // The pair's main scores, for the scatter plot.
  const prim = res.pair.map((id) => res.scores.find((s) => s.key.construct === id && s.key.primary)).filter((s) => !!s)
  const inMatrix = (id: string) => c.vars.some((v) => v.id === id)
  const crossCells = res.pairs.filter((p) => p.cross && inMatrix(p.a.id) && inMatrix(p.b.id))
  return (
    <Section
      title="3. Correlaciones"
      hint={`${ANALYSIS_STEPS[4].detail} ${ANALYSIS_STEPS[5].detail}`}
      actions={
        <TableActions
          table={table}
          figure={
            prim.length === 2
              ? () => ({
                  title: `Relación entre ${prim[0]!.key.label.toLowerCase()} y ${prim[1]!.key.label.toLowerCase()}`,
                  svg: scatter(
                    prim[0]!.values.map((v) => v ?? NaN),
                    prim[1]!.values.map((v) => v ?? NaN),
                    prim[0]!.key.label,
                    prim[1]!.key.label
                  ),
                  note: 'La línea muestra el ajuste por mínimos cuadrados.'
                })
              : undefined
          }
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted-foreground">Corrección por comparaciones múltiples:</span>
        <Segmented
          size="sm"
          value={correction}
          onChange={(v) => patchAnalysis({ correction: v })}
          items={[
            { value: 'fdr', label: 'FDR', title: 'Benjamini-Hochberg: controla la proporción de falsos positivos entre los significativos' },
            { value: 'bonferroni', label: 'Bonferroni', title: `La más estricta: p < .05 ÷ ${c.tests} pruebas = ${fmtP(0.05 / Math.max(1, c.tests))}` }
          ]}
        />
        <span className="text-faint">
          {c.tests} pruebas (k(k − 1)/2). En la tabla van los p sin corregir; † marca las que siguen siendo significativas.
        </span>
      </div>
      <TableView t={table} />
      {crossCells.length > 0 && (
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <p className="text-muted-foreground">Entre tus dos temas (lo que ponen a prueba tus hipótesis). Si tu hipótesis predice el signo, probala a una cola:</p>
          {crossCells.map((p) => (
            <div key={p.key} className={cn('flex flex-wrap items-center gap-2', p.pAdj < 0.05 ? 'text-foreground' : 'text-muted-foreground')}>
              <Pick value={directions[p.key] ?? 'two'} onChange={(v) => setDirection(p.key, v)} items={[...DIRECTION_ITEMS]} className="w-40" title="Hipótesis direccional" />
              <span>
                {p.a.label} — {p.b.label}: <i>{sym}</i>({p.n - 2}) = {fmtR(p.r)}, <i>p</i> {p.p < 0.001 ? '< .001' : `= ${fmtP(p.p)}`}
                {p.tails === 1 ? ' (una cola)' : ''}
                <span className="text-faint">
                  {' '}
                  · {correction === 'bonferroni' ? 'Bonferroni' : 'FDR'} {fmtP(p.pAdj)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <RelationshipsBlock res={res} />
      <ComparisonBlock res={res} />
    </Section>
  )
}

/** Attachment per relationship: is the bond with the mother, the father, the partner or the friend what matters? */
function RelationshipsBlock({ res }: { res: Results }) {
  const rel = res.relationships
  const correction = useStore((s) => s.settings.analysis.correction) ?? 'fdr'
  const table = useMemo(() => (rel ? relationshipsTable(rel, correction) : null), [rel, correction])
  if (!rel || !table) return null
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium">Apego por vínculo</h3>
          <p className="text-[12.5px] text-muted-foreground">El ECR-RS mide el apego en cuatro vínculos. Mirá si la relación con tu otro tema depende del vínculo; para probar que una es más fuerte que otra, comparalas abajo.</p>
        </div>
        <TableActions table={table} />
      </div>
      <TableView t={table} />
    </div>
  )
}

/** The guide's section 7: Fisher's z for the difference between two correlations. */
function ComparisonBlock({ res }: { res: Results }) {
  const compare = useStore((s) => s.settings.analysis.compare) ?? []
  const c = res.correlations
  if (!c || res.pairs.length < 2) return null
  const sym = c.method === 'pearson' ? 'r' : 'ρ'
  const items = [{ value: 'none', label: 'Elegí una correlación' }, ...res.pairs.map((p) => ({ value: p.key, label: `${p.a.label} — ${p.b.label} (${sym} = ${fmtR(p.r)})` }))]
  const set = (i: 0 | 1, v: string) => {
    const next = [compare[0] ?? 'none', compare[1] ?? 'none']
    next[i] = v
    patchAnalysis({ compare: next.every((x) => x === 'none') ? [] : next })
  }
  const cmp = res.comparison
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-[12.5px]">
      <h3 className="text-[14px] font-medium">Comparar dos correlaciones</h3>
      <p className="text-muted-foreground">
        Si una hipótesis dice que una correlación es más fuerte que otra (por ejemplo, el apego a la madre más que al padre), compará los coeficientes con la <i>z</i> de Fisher, como la calculadora que indica el instructivo.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Pick value={compare[0] ?? 'none'} onChange={(v) => set(0, v)} items={items} className="max-w-96" />
        <span className="text-muted-foreground">frente a</span>
        <Pick value={compare[1] ?? 'none'} onChange={(v) => set(1, v)} items={items} className="max-w-96" />
      </div>
      {cmp && (
        <p className={cmp.p < 0.05 ? 'text-foreground' : 'text-muted-foreground'}>
          <i>z</i> = {fmtNum(cmp.z)}, <i>p</i> {cmp.p < 0.001 ? '< .001' : `= ${fmtP(cmp.p)}`} a dos colas (una cola: {fmtP(cmp.p1)}).{' '}
          {cmp.p < 0.05 ? 'Las dos correlaciones difieren significativamente.' : 'No hay evidencia de que difieran.'}
          <span className="text-faint"> Ambas salen de la misma muestra; el instructivo usa la fórmula para muestras independientes, que es conservadora en ese caso.</span>
        </p>
      )}
    </div>
  )
}

function GroupSection({ res }: { res: Results }) {
  const table = useMemo(() => (res.groups.length ? groupTable(res.groups) : null), [res])
  const demos = useStore((s) => s.settings.research.demographics)
  const [pick, setPick] = useState('0')
  if (!table)
    return (
      <Section title="4. Comparaciones por variables demográficas" hint="Elegí variables demográficas categóricas (género, nivel educativo, posición, sector) en el marco de investigación para compararlas.">
        {!demos.length && (
          <Button variant="outline" size="sm" className="self-start" onClick={openResearch}>
            <Crosshair /> Elegir variables demográficas
          </Button>
        )}
      </Section>
    )
  const g = res.groups[Number(pick)] ?? res.groups[0]
  return (
    <Section
      title="4. Comparaciones por variables demográficas"
      hint="t de Welch o Mann-Whitney para dos grupos; ANOVA o Kruskal-Wallis para más. p corregidos por Bonferroni."
      actions={<TableActions table={table} figure={() => ({ title: `${g.score.label} según ${g.demographic.label.toLowerCase()}`, svg: groupMeans(g.groups, g.score.label, g.demographic.label), note: 'Las barras de error muestran intervalos de confianza del 95 %.' })} />}
    >
      <TableView t={table} />
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span>Figura de:</span>
        <Pick value={String(res.groups.indexOf(g))} onChange={setPick} items={res.groups.map((x, i) => ({ value: String(i), label: `${x.score.label} según ${x.demographic.label.toLowerCase()}` }))} className="max-w-96" />
      </div>
      <ul className="grid gap-1 text-[12.5px]">
        {res.groups.map((g) => (
          <li key={`${g.demographic.id}-${g.score.id}`} className={g.pAdj < 0.05 ? '' : 'text-muted-foreground'}>
            {g.score.label} según {g.demographic.label.toLowerCase()}: {g.apa}
            <span className="text-faint"> · Bonferroni {fmtP(g.pAdj)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function RegressionSection({ res }: { res: Results }) {
  const a = useStore((s) => s.settings.analysis)
  if (res.pair.length !== 2) return null
  const outcome = a.outcome && res.pair.includes(a.outcome) ? a.outcome : res.pair[1]
  return (
    <Section title="5. Regresión múltiple" hint={`${ANALYSIS_STEPS[6].detail} Tu tema predictor (y la demografía elegida) prediciendo el otro; los predictores continuos entran estandarizados (z) y los de dos grupos como 0/1.`}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted-foreground">Variable dependiente:</span>
        <Pick value={outcome} onChange={(v) => patchAnalysis({ outcome: v })} items={res.pair.map((id) => ({ value: id, label: CONSTRUCTS[id].label }))} className="w-60" />
        <span className="ml-3 text-muted-foreground">Moderador:</span>
        <Pick
          value={a.moderator ?? 'none'}
          onChange={(v) => patchAnalysis({ moderator: v === 'none' ? null : v })}
          items={[{ value: 'none', label: 'Ninguno' }, ...res.moderators.map((m) => ({ value: m.id, label: m.label }))]}
          className="w-60"
          title="¿La relación cambia según esta variable? Se prueba la interacción con tu tema predictor"
        />
      </div>
      {!res.regressions.length && <p className="text-[12.5px] text-muted-foreground">No hay suficientes casos completos para la regresión.</p>}
      {res.regressions.map((r) => (
        <RegressionBlock key={r.outcome.id} r={r} count={res.regressions.length} />
      ))}
    </Section>
  )
}

function RegressionBlock({ r, count }: { r: Results['regressions'][number]; count: number }) {
  const table = useMemo(() => regressionTable(r, count), [r, count])
  const mod = useMemo(() => moderationTable(r), [r])
  const pp = r.partialPlot
  const residualsOk = Math.abs(r.residuals.skewness) <= 1
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <h3 className="min-w-0 flex-1 text-[14px] font-medium">Sobre {r.outcome.label.toLowerCase()}</h3>
        <TableActions
          table={table}
          figures={[
            ...(pp ? [{ label: 'Gráfico parcial', make: () => ({ title: `Regresión parcial de ${r.outcome.label.toLowerCase()} sobre ${r.predictors[0].label.toLowerCase()}`, svg: scatter(pp.x, pp.y, pp.xLabel, pp.yLabel), note: 'Residuos de ambas variables una vez descontados los demás predictores; la pendiente es la contribución propia del predictor.' }) }] : []),
            { label: 'Residuos', make: () => ({ title: `Distribución de los residuos de la regresión sobre ${r.outcome.label.toLowerCase()}`, svg: histogram(r.residuals.values, 'Residuo'), note: `*N* = ${r.n}. Asimetría = ${fmtNum(r.residuals.skewness)}.` }) },
            { label: 'Q-Q residuos', make: () => ({ title: `Gráfico Q-Q normal de los residuos (${r.outcome.label.toLowerCase()})`, svg: qqPlot(r.residuals.values, 'Residuo'), note: `*N* = ${r.n}.` }) }
          ]}
        />
      </div>
      <TableView t={table} />
      <p className="text-[12.5px] text-muted-foreground">
        <i>R</i>² = {fmtR(r.r2)}: el modelo explica el {fmtNum(r.r2 * 100, 1)} % de la varianza de {r.outcome.label.toLowerCase()} (<i>p</i> {r.p < 0.001 ? '< .001' : `= ${fmtP(r.p)}`}
        {count > 1 ? `; Bonferroni por ${count} regresiones: ${fmtP(r.pAdj)}` : ''}).{' '}
        <span className={residualsOk ? '' : 'text-destructive'}>
          Residuos: asimetría {fmtNum(r.residuals.skewness)} ({residualsOk ? 'aproximadamente normales' : 'no normales: mencionalo como limitación'})
          {r.residuals.outliers ? `, ${r.residuals.outliers} a más de 3 DE` : ''}.
        </span>
      </p>
      {mod && r.moderation && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
              Moderación por {r.moderation.moderator.label.toLowerCase()}: Δ<i>R</i>² = {fmtR(r.moderation.deltaR2)}, <i>p</i> {r.moderation.p < 0.001 ? '< .001' : `= ${fmtP(r.moderation.p)}`}.{' '}
              {r.moderation.p < 0.05 ? 'La relación cambia según el moderador.' : 'No hay evidencia de que la relación cambie según el moderador.'}
            </p>
            <TableActions table={mod} />
          </div>
          <TableView t={mod} />
        </div>
      )}
    </div>
  )
}

/** The numbers are the student's analysis; the interpretation has to be too. */
function Integrity() {
  const res = useResults()
  return (
    <section className="rounded-xl border border-dashed p-4 text-[12.5px] text-muted-foreground">
      <p>
        <b className="text-foreground">Para el capítulo de Método:</b> la app puntúa las escalas con las claves de cada instrumento (
        {Object.values(CONSTRUCTS)
          .map((c) => c.instrument.split(':')[0])
          .join(', ')}
        ), excluye las respuestas sin finalizar y calcula los estadísticos con los mismos métodos que SPSS. Describí el procedimiento con tus palabras y conservá esta base para tu tutor.
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 -ml-2"
        onClick={() => {
          if (!res) return
          void navigator.clipboard.writeText(resultsText(res))
          toast('Resumen de resultados copiado')
        }}
      >
        <Copy /> Copiar todos los resultados como texto
      </Button>
    </section>
  )
}


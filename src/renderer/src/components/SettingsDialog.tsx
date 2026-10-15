import { useMemo, useState, type ReactNode } from 'react'
import { Loader2, CheckCircle2, FolderOpen, Monitor, Sun, Moon, Crosshair, AlertTriangle, XCircle, Info, ArrowRight, ShieldCheck, Download } from 'lucide-react'
import type { AiEffort, AiProvider, CitationStyle } from '@shared/types'
import { AI_PROVIDERS, EFFORT_HINTS, EFFORT_LABELS, modelsFor } from '@shared/ai'
import { aiEffort, aiModel, currentThesis, openResearch, patchResearch, patchSettings, refreshAccount, setProvider, toast, useStore } from '../store'
import { CONSTRUCTS, CONSTRUCT_ORDER, DEADLINE, RULES, SUBMISSION_EMAIL, THEME, fmtDeadline, frameworkChecks } from '../research/framework'
import { FrameworkText, ProbeGrid, exportAiLog, useProbes } from '../research/Applied'
import { DRAFT_POLICY } from '../agent/drafts'
import { liveThesis } from '../thesis/bridge'
import { thesisChecks } from '../thesis/checks'
import { cn } from '@/lib/utils'
import { STYLE_LABELS } from '../lib/citation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Collapsible } from './Collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button as MotionButton } from '@/components/motion/button'
import { Segmented } from './Segmented'
import { TRANSLATE_LANGUAGES } from '../lib/translate'
import { VoiceSettings } from './VoiceSettings'

const PROVIDERS = (Object.keys(AI_PROVIDERS) as AiProvider[]).map((p) => ({ value: p, label: AI_PROVIDERS[p].label }))
const SHORT_EFFORT: Partial<Record<AiEffort, string>> = { xhigh: 'Muy alto' }

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && useStore.setState({ settingsOpen: false })}>
      <DialogContent className="flex max-h-[84vh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle>Ajustes</DialogTitle>
          <DialogDescription className="sr-only">Preferencias de tesis, citas, asistente y apariencia</DialogDescription>
        </DialogHeader>
        {open && <Body />}
      </DialogContent>
    </Dialog>
  )
}

/** Settings sections fold like every other section; the description stays as the collapsed summary. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Collapsible
      id={`settings.${title.toLowerCase()}`}
      group="settings"
      variant="title"
      title={title}
      summary={description}
      className="py-3 not-first:border-t"
      contentClassName="flex flex-col gap-3 pt-1 pb-2"
    >
      {description && <p className="-mt-1 text-[12.5px] text-muted-foreground">{description}</p>}
      {children}
    </Collapsible>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11.5px] font-[550] text-muted-foreground">{children}</span>
}

function Body() {
  const settings = useStore((s) => s.settings)
  const account = useStore((s) => s.account)
  const libraryDir = useStore((s) => s.libraryDir)
  const [busy, setBusy] = useState(false)
  const provider = AI_PROVIDERS[settings.provider]
  const models = modelsFor(settings.provider)
  const model = aiModel(settings)
  const effort = aiEffort(settings)

  const connect = async () => {
    const target = settings.provider
    setBusy(true)
    try {
      const a = await window.api.ai.login(target)
      if (target === useStore.getState().settings.provider) useStore.setState({ account: a })
      if (a.connected) {
        toast(`${AI_PROVIDERS[target].label} conectado`, undefined, { status: 'success' })
        await refreshAccount()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-2">
      <Section title="Tu tesis" description="El asistente usa esto para juzgar la relevancia y ajustar cada respuesta.">
        <label className="flex flex-col gap-1.5">
          <Label>Título provisorio</Label>
          <Input
            key={settings.thesisTitle}
            defaultValue={settings.thesisTitle}
            placeholder="p. ej. El líder como proveedor de seguridad y el CCO de los colaboradores"
            onBlur={(e) => patchSettings({ thesisTitle: e.target.value.trim() })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>Pregunta de investigación y alcance</Label>
          <Textarea
            key={settings.researchQuestion}
            rows={3}
            defaultValue={settings.researchQuestion}
            placeholder="p. ej. ¿Cómo se relaciona la percepción del jefe como proveedor de seguridad con el CCO de los colaboradores?"
            onBlur={(e) => patchSettings({ researchQuestion: e.target.value.trim() })}
            className="resize-none"
          />
        </label>
      </Section>

      <Section title="Tu voz" description="Cómo escribís vos: las ayudas de redacción y los borradores se ajustan a tu estilo. Se guarda y la vas afinando con el tiempo.">
        <VoiceSettings />
      </Section>

      <Section title="Marco de investigación" description="Lo fija la cátedra y el asistente lo aplica en cada respuesta: 2 de 5 temas, desde la perspectiva del colaborador.">
        <ResearchSummary />
      </Section>

      <Section title="Reglas y verificación" description="Qué reglas aplica la app (cátedra y Pautas UCEMA) y la prueba de que llegan a cada asistente y a tu tesis.">
        <RulesAndVerification />
      </Section>

      <Section title="Estilo de cita">
        <div className="max-w-[420px]">
          <Segmented
            fill
            value={settings.citationStyle}
            onChange={(s) => patchSettings({ citationStyle: s })}
            items={(Object.keys(STYLE_LABELS) as CitationStyle[]).map((s) => ({ value: s, label: STYLE_LABELS[s] }))}
          />
        </div>
      </Section>

      <Section title="Asistente">
        <div className="flex flex-col gap-1.5">
          <Label>Suscripción</Label>
          <div className="max-w-[320px]">
            <Segmented fill value={settings.provider} onChange={setProvider} items={PROVIDERS} />
          </div>
        </div>
        <div className="flex min-h-9 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          {account == null ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Verificando la conexión…
            </span>
          ) : account.connected ? (
            <span className="flex min-w-0 items-center gap-2 font-[550] text-success">
              <CheckCircle2 className="size-4 flex-none" />
              <span className="truncate">
                Conectado a {provider.label}
                {account.email ? ` como ${account.email}` : ''}
              </span>
              {account.plan && (
                <Badge variant="secondary" className="uppercase">
                  {account.plan}
                </Badge>
              )}
            </span>
          ) : account.error === 'cli-missing' ? (
            <span className="min-w-0 text-muted-foreground">
              Primero instalá el {provider.cli}: <code className="font-mono text-xs select-all">{provider.install}</code>
            </span>
          ) : (
            <span className="text-muted-foreground">Sin conectar</span>
          )}
          <span className="flex-1" />
          {account && !account.connected && account.error !== 'cli-missing' && (
            <MotionButton size="sm" disabled={busy} onClick={() => void connect()}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} Conectar {provider.label}
            </MotionButton>
          )}
          {account?.error === 'cli-missing' && (
            <Button variant="outline" size="sm" onClick={() => void refreshAccount()}>
              Reintentar
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <Label>Modelo</Label>
            <Select value={model.id} onValueChange={(v) => patchSettings({ model: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m, i) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                    {i === 0 ? ' (predeterminado)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Traducir lo seleccionado a</Label>
            <Select value={settings.translateTo} onValueChange={(v) => patchSettings({ translateTo: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSLATE_LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Esfuerzo</Label>
            <Segmented
              fill
              value={effort}
              onChange={(e) => patchSettings({ effort: e })}
              items={model.efforts.map((e) => ({ value: e, label: SHORT_EFFORT[e] ?? EFFORT_LABELS[e], title: EFFORT_HINTS[e] }))}
            />
            <span className="text-[11.5px] text-faint">
              {EFFORT_HINTS[effort]}. Aplica al chat; los asistentes de escritura y las traducciones mantienen su propio nivel, más liviano.
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Funciona con el {provider.cli} oficial de {provider.vendor} y tu plan de {provider.label}. El texto de los papers se envía a{' '}
          {provider.vendor} solo cuando usás el asistente.
        </p>
      </Section>

      <Section title="Apariencia">
        <div className="max-w-[320px]">
          <Segmented
            fill
            value={settings.theme}
            onChange={(t) => patchSettings({ theme: t })}
            items={[
              { value: 'system', label: 'Sistema', icon: <Monitor /> },
              { value: 'light', label: 'Claro', icon: <Sun /> },
              { value: 'dark', label: 'Oscuro', icon: <Moon /> }
            ]}
          />
        </div>
      </Section>

      <Section title="Biblioteca">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{libraryDir}</span>
          <Button variant="outline" size="sm" onClick={() => window.api.papers.reveal('')}>
            <FolderOpen /> Mostrar en el Finder
          </Button>
        </div>
      </Section>
    </div>
  )
}

/** The framework at a glance: the pair (editable), and whether anything breaks the course's rules. */
function ResearchSummary() {
  const settings = useStore((s) => s.settings)
  const chosen = settings.research.constructs
  const checks = frameworkChecks(settings).filter((c) => !c.ok)
  const toggle = (id: (typeof chosen)[number]) => {
    if (chosen.includes(id)) return patchResearch({ constructs: chosen.filter((c) => c !== id) })
    if (chosen.length >= 2) return toast('Ya cruzás 2 temas: quitá uno para elegir otro')
    patchResearch({ constructs: [...chosen, id] })
  }
  return (
    <>
      <p className="rounded-xl border bg-muted/40 px-3 py-2 text-[12.5px] leading-snug">
        <span className="font-[600]">Temática obligatoria: </span>
        {THEME}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label>Tus 2 temas ({chosen.length}/2)</Label>
        <div className="flex flex-wrap gap-1.5">
          {CONSTRUCT_ORDER.map((id) => {
            const on = chosen.includes(id)
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                aria-pressed={on}
                className={cn(
                  'h-7 rounded-full border px-2.5 text-[12px] transition-colors',
                  on ? 'border-bloom-teal bg-bloom-teal/12 font-medium' : 'text-muted-foreground hover:text-foreground',
                  !on && chosen.length >= 2 && 'opacity-50'
                )}
              >
                {CONSTRUCTS[id].label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {checks.length ? (
          checks.slice(0, 4).map((c) => (
            <span key={c.id} className="flex items-center gap-2 text-[12px]">
              {c.severity === 'error' ? <XCircle className="size-3.5 flex-none text-destructive" /> : c.severity === 'warn' ? <AlertTriangle className="size-3.5 flex-none text-bloom-amber" /> : <Info className="size-3.5 flex-none text-muted-foreground" />}
              <span className="first-letter:uppercase">{c.title}</span>
            </span>
          ))
        ) : (
          <span className="flex items-center gap-2 text-[12px] font-[550] text-success">
            <CheckCircle2 className="size-3.5" /> Tu planteo cumple el marco de la cátedra
          </span>
        )}
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            useStore.setState({ settingsOpen: false })
            openResearch()
          }}
        >
          <Crosshair className="text-bloom-teal" /> Ver el marco completo y verificar el asistente <ArrowRight />
        </Button>
      </div>
    </>
  )
}

function Status({ ok, severity = 'error', children }: { ok: boolean; severity?: 'error' | 'warn' | 'info'; children: ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-[12px]">
      {ok ? (
        <CheckCircle2 className="mt-px size-3.5 flex-none text-success" />
      ) : severity === 'error' ? (
        <XCircle className="mt-px size-3.5 flex-none text-destructive" />
      ) : severity === 'warn' ? (
        <AlertTriangle className="mt-px size-3.5 flex-none text-bloom-amber" />
      ) : (
        <Info className="mt-px size-3.5 flex-none text-muted-foreground" />
      )}
      <span className="min-w-0 first-letter:uppercase">{children}</span>
    </span>
  )
}

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card px-3.5 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12.5px] font-[600]">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** Everything the app holds the thesis to, each with its live state, and proof the assistants receive it. */
function RulesAndVerification() {
  const settings = useStore((s) => s.settings)
  const papers = useStore((s) => s.papers)
  const theses = useStore((s) => s.theses)
  const ailog = useStore((s) => s.ailog)
  const probes = useProbes()
  const framework = useMemo(() => frameworkChecks(settings), [settings])
  const thesis = useMemo(() => {
    const t = currentThesis()
    const live = t ? liveThesis(t.id) : null
    return live ? thesisChecks(live.doc, live.thesis.meta, papers, settings.research) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theses, papers, settings.research])
  const log = Object.values(ailog)
  const pendingDrafts = log.filter((e) => e.kind === 'draft' && !e.reviewedAt).length
  const probesOk = probes?.filter((p) => p.ok).length ?? 0

  return (
    <>
      <Group title="Marco de la cátedra" aside={<span className="text-[11.5px] text-faint">Se aplica siempre</span>}>
        <p className="text-[12px] text-muted-foreground">{THEME}</p>
        {RULES.map((r) => (
          <Status key={r} ok>
            {r}
          </Status>
        ))}
        <span className="my-1 h-px bg-border" />
        {framework.map((c) => (
          <Status key={c.id} ok={c.ok} severity={c.severity}>
            {c.title}
          </Status>
        ))}
      </Group>

      <Group
        title="Llega a cada asistente"
        aside={probes && <span className={cn('text-[11.5px] font-medium tabular-nums', probesOk === probes.length ? 'text-success' : 'text-bloom-amber')}>{probesOk}/{probes.length} verificados</span>}
      >
        <p className="text-[11.5px] text-muted-foreground">Cada asistente se arma como en un chat real y se buscan en sus instrucciones el marco, tu combinación, tus hipótesis y variables, la fecha y las Pautas.</p>
        <ProbeGrid probes={probes} compact />
      </Group>

      <Group title="Pautas UCEMA en tu tesis" aside={thesis && <span className="text-[11.5px] text-faint tabular-nums">{thesis.filter((c) => c.ok).length}/{thesis.length} cumplidas</span>}>
        {thesis ? (
          thesis.map((c) => (
            <Status key={c.id} ok={c.ok} severity={c.severity}>
              {c.title}
            </Status>
          ))
        ) : (
          <span className="text-[12px] text-muted-foreground">Abrí la tesis para verificarla.</span>
        )}
        <Status ok>Formato fijo al exportar: Calibri 11, interlineado doble, alineación izquierda, sangría de 1,27 cm, carta, márgenes de 2,54 cm, notas al pie, APA 7</Status>
        <Status ok severity="info">
          Entrega final: {fmtDeadline(DEADLINE)}, en PDF a {SUBMISSION_EMAIL}, con la aprobación previa del tutor
        </Status>
      </Group>

      <Group
        title="Uso de IA (Pautas 8.e y Turnitin)"
        aside={
          <Button variant="ghost" size="xs" onClick={() => void exportAiLog()}>
            <Download /> Exportar registro
          </Button>
        }
      >
        <p className="text-[12px] text-muted-foreground">{DRAFT_POLICY}</p>
        <div className="flex flex-col gap-1.5">
          <Label>Cuando le pidas que redacte</Label>
          <Segmented
            fill
            value={settings.aiDrafts}
            onChange={(v) => patchSettings({ aiDrafts: v })}
            items={[
              { value: 'off', label: 'Solo orientar y corregir', title: 'El asistente no redacta: da preguntas, esquemas y correcciones' },
              { value: 'warn', label: 'Borradores con advertencia', title: 'Puede proponer borradores: se muestran aparte, con advertencia, marcados en la tesis y registrados' }
            ]}
          />
        </div>
        <Status ok>Ayudas de redacción y autocompletado: solo sobre texto que escribiste, registradas ({log.filter((e) => e.kind !== 'draft').length})</Status>
        <Status ok={!pendingDrafts} severity="warn">
          {pendingDrafts ? `${pendingDrafts} borrador${pendingDrafts > 1 ? 'es' : ''} de IA sin revisar en la tesis` : `Borradores: ${log.filter((e) => e.kind === 'draft').length} insertados, todos revisados`}
        </Status>
        <Status ok>Los resultados vienen de la base de la cátedra calculada en la app: el asistente no puede inventar estadísticos</Status>
      </Group>

      <FrameworkText />
      <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
        <ShieldCheck className="size-3.5" /> Se vuelve a verificar cada vez que cambiás tus elecciones.
      </span>
    </>
  )
}

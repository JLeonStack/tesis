import { useState, type ReactNode } from 'react'
import { FileText, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { VoiceProfile } from '@shared/types'
import { aiModel, patchVoice, providerLabel, toast, useStore } from '../store'
import { ANALYZE_INSTRUCTIONS, ANALYZE_SCHEMA, PERSON_LABELS, analyzePrompt, mergeLists, pickThesisSamples, thesisParagraphs } from '../lib/voice'
import { liveThesis } from '../thesis/bridge'
import { timeAgo, uid } from '../lib/util'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Segmented } from './Segmented'

// Ajustes → Tu voz: the student describes how they write, keeps a few of their
// own paragraphs as reference, and lets the AI describe the style it sees in
// them. The profile is saved with the settings and reaches every helper that
// writes or rewrites thesis text (see voiceBlock in ../lib/voice).

const MIN_SAMPLE_WORDS = 40
const wordCount = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length

function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] font-[550] text-muted-foreground">
      <span className="flex-1">{children}</span>
      {aside}
    </span>
  )
}

async function analyzeVoice(v: VoiceProfile): Promise<void> {
  const r = (await window.api.ai.assist({
    instructions: ANALYZE_INSTRUCTIONS,
    prompt: analyzePrompt(v),
    schema: ANALYZE_SCHEMA,
    model: aiModel().id,
    effort: 'low'
  })) as { traits?: string; prefer?: string[]; avoid?: string[] }
  // The student's own lists stay; the analysis only adds to them.
  const now = useStore.getState().settings.voice
  patchVoice({
    traits: r.traits?.trim() || now.traits,
    prefer: mergeLists(now.prefer, r.prefer ?? []),
    avoid: mergeLists(now.avoid, r.avoid ?? []),
    analyzedAt: Date.now()
  })
}

export function VoiceSettings() {
  const voice = useStore((s) => s.settings.voice)
  const connected = useStore((s) => !!s.account?.connected)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const draftWords = wordCount(draft)
  const sampleWords = voice.samples.reduce((n, s) => n + wordCount(s.text), 0)

  const addSample = () => {
    const text = draft.trim()
    if (wordCount(text) < MIN_SAMPLE_WORDS) return toast(`Pegá al menos ${MIN_SAMPLE_WORDS} palabras: un párrafo completo escrito por vos`)
    patchVoice({ samples: [...voice.samples, { id: uid(), text, source: 'pegado', addedAt: Date.now() }] })
    setDraft('')
  }

  const fromThesis = () => {
    const live = liveThesis()
    if (!live) return toast('Todavía no hay una tesis para tomar párrafos')
    const picked = pickThesisSamples(thesisParagraphs(live.doc), voice.samples)
    if (!picked.length) return toast('No encontré párrafos nuevos', undefined, { description: `Tomo párrafos tuyos de ${MIN_SAMPLE_WORDS}+ palabras del cuerpo de la tesis, sin citas en bloque ni borradores de IA.` })
    const now = Date.now()
    patchVoice({ samples: [...voice.samples, ...picked.map((text, i) => ({ id: uid(), text, source: 'tesis' as const, addedAt: now + i }))] })
    toast(`${picked.length} párrafo${picked.length > 1 ? 's' : ''} de tu tesis agregado${picked.length > 1 ? 's' : ''}`, undefined, { status: 'success' })
  }

  const analyze = async () => {
    if (!connected) return toast(`Conectá tu cuenta de ${providerLabel()} en «Asistente» para analizar tu voz`)
    setBusy(true)
    try {
      await analyzeVoice(useStore.getState().settings.voice)
      toast('Tu voz quedó actualizada', undefined, { status: 'success', description: 'Revisá los rasgos y editá lo que no te represente.' })
    } catch (e) {
      toast('No se pudo analizar tu voz', undefined, { status: 'error', description: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="max-w-[320px]">
        <Segmented
          fill
          value={voice.enabled ? 'on' : 'off'}
          onChange={(v) => patchVoice({ enabled: v === 'on' })}
          items={[
            { value: 'on', label: 'Aplicar mi voz' },
            { value: 'off', label: 'Desactivada' }
          ]}
        />
      </div>

      <div className={voice.enabled ? 'contents' : 'pointer-events-none flex flex-col gap-3 opacity-50'}>
        <label className="flex flex-col gap-1.5">
          <Label>Cómo querés sonar, en tus palabras</Label>
          <Textarea
            key={`d${voice.analyzedAt}`}
            rows={3}
            defaultValue={voice.description}
            placeholder="p. ej. Directo y ordenado. Me gusta anticipar al lector qué viene, explicar con ejemplos del mundo de la empresa y cerrar con la implicancia práctica, no con un resumen."
            onBlur={(e) => e.target.value.trim() !== voice.description && patchVoice({ description: e.target.value.trim() })}
            className="resize-none"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <Label>Sujeto</Label>
          <Segmented
            fill
            size="sm"
            value={voice.person}
            onChange={(person) => patchVoice({ person })}
            items={(Object.keys(PERSON_LABELS) as VoiceProfile['person'][]).map((p) => ({ value: p, label: PERSON_LABELS[p].split(' (')[0], title: PERSON_LABELS[p] }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Oraciones</Label>
          <Segmented
            fill
            size="sm"
            value={voice.sentences}
            onChange={(sentences) => patchVoice({ sentences })}
            items={[
              { value: 'cortas', label: 'Cortas y directas' },
              { value: 'variadas', label: 'Variadas' },
              { value: 'largas', label: 'Desarrolladas' }
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <Label>Expresiones y conectores tuyos</Label>
            <Textarea
              key={`p${voice.analyzedAt}`}
              rows={5}
              defaultValue={voice.prefer}
              placeholder={'Uno por línea, p. ej.\ndicho de otro modo\nlo que interesa acá es\nen la práctica'}
              onBlur={(e) => e.target.value !== voice.prefer && patchVoice({ prefer: e.target.value })}
              className="resize-none text-[12.5px]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Evitar</Label>
            <Textarea
              key={`a${voice.analyzedAt}`}
              rows={5}
              defaultValue={voice.avoid}
              placeholder="Uno por línea"
              onBlur={(e) => e.target.value !== voice.avoid && patchVoice({ avoid: e.target.value })}
              className="resize-none text-[12.5px]"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label aside={voice.samples.length > 0 && <span className="font-normal text-faint tabular-nums">{voice.samples.length} · {sampleWords} palabras</span>}>
            Muestras de tu escritura
          </Label>
          <p className="text-[11.5px] text-muted-foreground">Párrafos que escribiste vos (de la tesis, de trabajos anteriores, de tus notas). Cuantas más y más variadas, mejor te describe.</p>
          {voice.samples.length > 0 && (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {[...voice.samples].reverse().map((s) => (
                <li key={s.id} className="group flex items-start gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-[12px]">
                  {s.source === 'tesis' && <FileText className="mt-0.5 size-3.5 flex-none text-muted-foreground" aria-label="De tu tesis" />}
                  <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground">{s.text}</span>
                  <button
                    className="flex-none rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                    aria-label="Quitar muestra"
                    onClick={() => patchVoice({ samples: voice.samples.filter((x) => x.id !== s.id) })}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Pegá un párrafo escrito por vos…" className="resize-none text-[12.5px]" />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={!draft.trim()} onClick={addSample}>
              <Plus /> Agregar muestra{draft.trim() ? ` (${draftWords} palabras)` : ''}
            </Button>
            <Button variant="outline" size="sm" onClick={fromThesis}>
              <FileText /> Tomar párrafos de mi tesis
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label aside={voice.analyzedAt && <span className="font-normal text-faint">Analizada {timeAgo(voice.analyzedAt)}</span>}>Rasgos de tu voz</Label>
          <Textarea
            key={`t${voice.analyzedAt}`}
            rows={4}
            defaultValue={voice.traits}
            placeholder="Analizá tus muestras para que la IA describa cómo escribís. Después podés corregir lo que no te represente."
            onBlur={(e) => e.target.value.trim() !== voice.traits && patchVoice({ traits: e.target.value.trim() })}
            className="resize-none text-[12.5px]"
          />
          <div>
            <Button size="sm" disabled={busy || !voice.samples.length} onClick={() => void analyze()}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {voice.analyzedAt ? 'Volver a analizar' : 'Analizar mi voz'}
            </Button>
          </div>
        </div>

        <p className="text-[11.5px] text-muted-foreground">
          Se aplica a las ayudas de redacción (incluida «Con mi voz»), el autocompletado, los chats de notas y de la tesis y el asistente general, siempre dentro del registro académico. Los borradores de IA siguen marcados y registrados como indican las Pautas 8.e.
        </p>
      </div>
    </>
  )
}

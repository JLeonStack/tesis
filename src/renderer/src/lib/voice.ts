import type { Node as PMNode } from '@tiptap/pm/model'
import type { Settings, VoiceProfile, VoiceSample } from '@shared/types'

// The student's writing voice (Ajustes → Tu voz). It is built up over time:
// what they say about how they write, the expressions they use or avoid, and
// paragraphs they wrote themselves, which the AI reads to describe their style.
// Every helper that writes or rewrites text for the thesis gets it, so its
// suggestions sound like the student instead of like a generic model. The
// academic register still wins when the two pull apart.

export const VOICE_TAG = 'student_voice'

/** Stock phrasings that make any text sound generic; the student can edit the list. */
export const GENERIC_PHRASES = [
  'cabe destacar',
  'es importante destacar',
  'es fundamental señalar',
  'en el mundo actual',
  'en la actualidad, cada vez más',
  'juega un papel crucial',
  'desempeña un rol fundamental',
  'en este sentido (como muletilla)',
  'un amplio abanico de',
  'en el panorama actual',
  'profundizar en',
  'sumergirse en',
  'no solo… sino también (repetido)',
  'en definitiva / en suma al cierre de cada párrafo',
  'raya (—) para incisos'
]

export const DEFAULT_VOICE: VoiceProfile = {
  enabled: true,
  description: '',
  person: 'impersonal',
  sentences: 'variadas',
  prefer: '',
  avoid: GENERIC_PHRASES.join('\n'),
  samples: [],
  traits: '',
  analyzedAt: null
}

export const PERSON_LABELS: Record<VoiceProfile['person'], string> = {
  impersonal: 'Impersonal («se observa»)',
  nosotros: 'Primera plural («observamos»)',
  yo: 'Primera singular («observo»)',
  mixto: 'Mixto según la sección'
}

const SENTENCE_LABELS: Record<VoiceProfile['sentences'], string> = {
  cortas: 'cortas y directas (15 a 20 palabras)',
  variadas: 'de largo variado: alterná oraciones cortas con otras más desarrolladas (15 a 30 palabras)',
  largas: 'desarrolladas, con subordinadas, sin pasar de 30 palabras'
}

/** One entry per line (commas also split), trimmed and without repeats. */
export function parseList(s: string): string[] {
  const seen = new Set<string>()
  return s
    .split(/\n|,(?![^(]*\))/)
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
}

export const mergeLists = (a: string, b: string[]) => parseList([a, ...b].join('\n')).join('\n')

const SAMPLE_BUDGET = 1800

/** The most recent samples that fit the budget, each clipped to whole sentences. */
export function sampleExcerpts(samples: VoiceSample[], budget = SAMPLE_BUDGET): string[] {
  const out: string[] = []
  let left = budget
  for (const s of [...samples].sort((a, b) => b.addedAt - a.addedAt)) {
    if (left < 200 || out.length >= 3) break
    const text = s.text.replace(/\s+/g, ' ').trim()
    let clip = text.slice(0, Math.min(left, 700))
    if (clip.length < text.length) clip = clip.replace(/[^.!?…]*$/, '').trim() || clip
    out.push(clip)
    left -= clip.length
  }
  return out
}

const hasProfile = (v: VoiceProfile) => !!(v.description.trim() || v.traits.trim() || v.prefer.trim() || v.avoid.trim() || v.samples.length)

/**
 * The voice, as it goes into an assistant's instructions. `samples` adds a few
 * of the student's own paragraphs (left out of the latency-bound autocomplete).
 */
export function voiceBlock(s: Pick<Settings, 'voice'>, opts: { samples?: boolean } = {}): string {
  const v = s.voice
  if (!v?.enabled || !hasProfile(v)) return ''
  const lines = [
    `<${VOICE_TAG}>`,
    'Cuando redactes, reescribas o completes texto para la tesis o las notas del estudiante, hacelo con su voz: que suene a algo que escribió él, no a un texto genérico. Siempre dentro del registro académico de un trabajo final (sin voseo ni coloquialismos, ortografía de la RAE, reglas de la cátedra): si su voz y el registro chocan, gana el registro.'
  ]
  if (v.description.trim()) lines.push(`Cómo describe su forma de escribir: ${v.description.trim()}`)
  if (v.traits.trim()) lines.push(`Rasgos observados en lo que escribió: ${v.traits.trim()}`)
  lines.push(`Sujeto gramatical: ${PERSON_LABELS[v.person].toLowerCase()}. Oraciones ${SENTENCE_LABELS[v.sentences]}.`)
  const prefer = parseList(v.prefer)
  if (prefer.length) lines.push(`Expresiones y conectores que usa (preferilos cuando encajen, sin forzarlos ni repetirlos): ${prefer.join('; ')}.`)
  const avoid = parseList(v.avoid)
  if (avoid.length) lines.push(`No uses: ${avoid.join('; ')}.`)
  lines.push(
    'Además: variá el largo de las oraciones y la forma en que arrancan los párrafos; no cierres cada párrafo con una oración que lo resuma; nada de enumeraciones de a tres por reflejo ni de fórmulas de relleno; preferí lo concreto de su tema y su caso a las generalidades.'
  )
  const excerpts = opts.samples ? sampleExcerpts(v.samples) : []
  if (excerpts.length) {
    lines.push('Fragmentos escritos por el estudiante, como referencia de ritmo, vocabulario y forma de encadenar ideas (no copies su contenido):')
    for (const e of excerpts) lines.push(`"""${e}"""`)
  }
  lines.push(`</${VOICE_TAG}>`)
  return lines.join('\n')
}

// ---------- learning the voice ----------

const MIN_WORDS = 40
const BODY_SECTIONS = new Set(['resumen', 'cuerpo', 'apendices'])
const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length

/**
 * Paragraphs of the thesis the student wrote: body sections only, never a
 * block quote (the source's words) nor anything still marked as an AI draft.
 */
export function thesisParagraphs(doc: PMNode): string[] {
  const out: string[] = []
  doc.forEach((section) => {
    if (!BODY_SECTIONS.has(section.attrs.kind)) return
    section.forEach((block) => {
      if (block.type.name !== 'paragraph') return
      let drafted = false
      block.descendants((n) => {
        if (n.marks.some((m) => m.type.name === 'aiDraft')) drafted = true
        return !drafted
      })
      const text = block.textContent.replace(/\s+/g, ' ').trim()
      if (!drafted && words(text) >= MIN_WORDS && !/\[completar/i.test(text)) out.push(text)
    })
  })
  return out
}

/** New samples from the thesis: the longest paragraphs not already saved. */
export function pickThesisSamples(paragraphs: string[], saved: VoiceSample[], max = 6): string[] {
  const have = new Set(saved.map((s) => s.text.trim()))
  return paragraphs
    .filter((p) => !have.has(p))
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
}

export const ANALYZE_INSTRUCTIONS = `Sos un analista de estilo de textos académicos en español. Describís cómo escribe una persona a partir de párrafos que escribió ella, para que otros asistentes puedan sugerirle texto con su misma voz.
Reglas:
- Describí rasgos observables, con ejemplos breves tomados de los textos: largo y ritmo de las oraciones, cómo arranca y cierra los párrafos, conectores y giros característicos, sujeto gramatical (impersonal, nosotros, yo), grado de formalidad, uso de ejemplos, de preguntas, de incisos, de adjetivos y adverbios, vocabulario técnico.
- No juzgues ni corrijas: describí. Si algo choca con el registro académico (voseo, coloquialismos), mencionalo como algo a no imitar.
- En "prefer" van expresiones y conectores que la persona realmente usa (textuales, cortos). En "avoid" van giros que no usa y que desentonarían con su estilo, o vicios suyos que no conviene amplificar.
- En español, breve. Respondé únicamente con el JSON pedido.`

export const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['traits', 'prefer', 'avoid'],
  properties: {
    traits: { type: 'string' },
    prefer: { type: 'array', items: { type: 'string' } },
    avoid: { type: 'array', items: { type: 'string' } }
  }
}

const ANALYZE_BUDGET = 14_000

export function analyzePrompt(v: VoiceProfile): string {
  let body = ''
  for (const s of [...v.samples].sort((a, b) => b.addedAt - a.addedAt)) {
    const chunk = `"""${s.text.trim()}"""\n\n`
    if (body.length + chunk.length > ANALYZE_BUDGET) break
    body += chunk
  }
  const told = v.description.trim() ? `\nCómo dice el estudiante que quiere sonar: ${v.description.trim()}\n` : ''
  const before = v.traits.trim() ? `\nDescripción anterior (actualizala con lo nuevo, conservá lo que siga valiendo):\n${v.traits.trim()}\n` : ''
  return `Describí la voz de escritura de este estudiante de MBA en "traits" (un párrafo de 4 a 7 oraciones, concreto), y listá en "prefer" hasta 12 expresiones o conectores suyos y en "avoid" hasta 8 giros a evitar.${told}${before}\nTextos escritos por el estudiante:\n\n${body}`
}

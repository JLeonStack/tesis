import type { Settings } from '@shared/types'
import { aiModel, providerLabel, useStore } from '../store'
import { researchBrief } from '../research/framework'
import { voiceBlock } from '../lib/voice'

// Writing helpers backed by the ChatGPT connection. They only ever work on
// text the student already wrote (UCEMA allows AI for correcting writing,
// grammar, format and APA; never for producing the analysis).

export type AssistKind = 'synonyms' | 'correct' | 'clearer' | 'formal' | 'concise' | 'voice' | 'define' | 'translate' | 'ideas'

export interface Option {
  text: string
  note: string
}
export interface Change {
  original: string
  replacement: string
  reason: string
}

export type AssistResult =
  | { kind: 'synonyms'; options: Option[] }
  | { kind: 'correct'; text: string; changes: Change[] }
  | { kind: 'clearer' | 'formal' | 'concise' | 'voice' | 'translate'; options: Option[] }
  | { kind: 'define'; definition: string; example: string; register: string }
  | { kind: 'ideas'; ideas: { question: string; why: string }[] }

export const ASSIST_LABELS: Record<AssistKind, string> = {
  synonyms: 'Sinónimos',
  correct: 'Corregir',
  clearer: 'Más claro',
  formal: 'Más académico',
  concise: 'Más conciso',
  voice: 'Con mi voz',
  define: 'Definición',
  translate: 'Traducir al español',
  ideas: 'Ideas para seguir'
}

/** The helpers' instructions, with the course framework (so terms and constructs are used precisely) and the student's voice. */
export const assistInstructions = (s: Pick<Settings, 'research' | 'researchQuestion' | 'voice'>) =>
  [INSTRUCTIONS, researchBrief(s), voiceBlock(s, { samples: true })].filter(Boolean).join('\n\n')

const INSTRUCTIONS = `Sos un corrector de estilo de textos académicos en español. Ayudás a un estudiante de la Maestría en Dirección de Empresas (Universidad del CEMA, Argentina) a pulir la redacción de su trabajo final, que sigue las normas APA 7.
Reglas:
- Trabajá solo sobre el texto que te pasan. Nunca agregues ideas, datos, ejemplos, afirmaciones ni fuentes que no estén.
- Conservá el significado, los términos técnicos, los números y las citas entre paréntesis como (Autor, año).
- Los marcadores ⟦1⟧, ⟦2⟧… son citas o notas al pie: conservalos exactamente, pegados a la palabra que acompañan.
- Registro académico formal, impersonal cuando corresponda; sin voseo ni coloquialismos. Ortografía y puntuación según la RAE.
- Si hay un bloque <student_voice>, tus reformulaciones respetan esa voz: mejorá el texto sin borrarle la forma de escribir del estudiante.
- Las notas o explicaciones van en español, breves (una línea).
- Respondé únicamente con el JSON pedido.`

const str = { type: 'string' }
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const OPTIONS = obj({ options: { type: 'array', items: obj({ text: str, note: str }) } })
const SCHEMAS: Record<AssistKind, object> = {
  synonyms: OPTIONS,
  clearer: OPTIONS,
  formal: OPTIONS,
  concise: OPTIONS,
  voice: OPTIONS,
  translate: OPTIONS,
  correct: obj({ text: str, changes: { type: 'array', items: obj({ original: str, replacement: str, reason: str }) } }),
  define: obj({ definition: str, example: str, register: str }),
  ideas: obj({ ideas: { type: 'array', items: obj({ question: str, why: str }) } })
}

function prompt(kind: AssistKind, text: string, context: string): string {
  const ctx = context && context !== text ? `\n\nContexto (párrafo donde aparece):\n"""${context}"""` : ''
  switch (kind) {
    case 'synonyms':
      return `Proponé hasta 8 sinónimos o expresiones equivalentes para «${text}» que encajen en esta oración sin cambiar el sentido, ordenados del más adecuado al menos adecuado para un texto académico. Cada opción debe poder reemplazar el texto tal cual (misma concordancia de género y número, mismo tiempo verbal). En "note" indicá el matiz o registro en pocas palabras.${ctx}`
    case 'correct':
      return `Corregí ortografía, gramática, concordancia, puntuación y tildes del siguiente texto. No cambies el estilo ni reescribas lo que ya es correcto. Devolvé el texto completo corregido en "text" y cada cambio en "changes" con el motivo. Si no hay errores, devolvé el texto igual y "changes" vacío.\n\nTexto:\n"""${text}"""${ctx}`
    case 'clearer':
      return `Proponé 3 reformulaciones más claras y fluidas del texto, con el mismo contenido y extensión similar. En "note" explicá en pocas palabras qué mejora cada una.\n\nTexto:\n"""${text}"""${ctx}`
    case 'formal':
      return `Proponé 3 versiones del texto en un registro académico más formal e impersonal, con el mismo contenido. En "note" explicá qué cambia.\n\nTexto:\n"""${text}"""${ctx}`
    case 'concise':
      return `Proponé 3 versiones más concisas del texto: eliminá redundancias y relleno sin perder información. En "note" indicá qué se quitó.\n\nTexto:\n"""${text}"""${ctx}`
    case 'voice':
      return `Proponé 3 versiones del texto reescritas con la voz del estudiante que describe <student_voice> (su ritmo, sus conectores, su sujeto gramatical, su vocabulario), con el mismo contenido, las mismas citas y extensión similar, y en registro académico. No agregues ideas. En "note" indicá en pocas palabras qué rasgo de su voz aplicaste.\n\nTexto:\n"""${text}"""${ctx}`
    case 'translate':
      return `Traducí el texto al español académico rioplatense formal. Devolvé 1 opción (o 2 si hay una alternativa terminológica relevante). Para términos técnicos sin traducción asentada, agregá el original entre paréntesis la primera vez. En "note" señalá decisiones de traducción importantes, o dejalo vacío.\n\nTexto:\n"""${text}"""`
    case 'ideas':
      return `El estudiante se trabó escribiendo. No escribas texto por él: proponé 3 preguntas guía, concretas y distintas, que lo ayuden a decidir qué escribir a continuación en esta parte de su trabajo (por ejemplo: qué afirmación de su texto falta fundamentar, qué relación entre ideas explicar, qué fuente de su marco teórico conectar, qué implicancia para el caso analizar). Basate solo en lo que ya escribió. En "why" explicá en pocas palabras por qué esa pregunta hace avanzar el texto.\n\n${context}`
    case 'define':
      return `Definí «${text}» tal como se usa en este contexto (administración, economía o ciencias sociales cuando aplique), en una o dos oraciones. En "example" dá un ejemplo breve de uso académico correcto y en "register" indicá si es formal, técnico, neutro o coloquial y si conviene usarlo en un trabajo final.${ctx}`
  }
}

const norm = (s: string) => s.trim().toLowerCase()
const cache = new Map<string, AssistResult>()

export async function runAssist(kind: AssistKind, text: string, context: string): Promise<AssistResult> {
  if (!useStore.getState().account?.connected) throw new Error(`Conectá tu cuenta de ${providerLabel()} en Ajustes para usar las ayudas con IA.`)
  const key = `${kind}\n${text}\n${context}`
  const hit = cache.get(key)
  if (hit) return hit
  const r = (await window.api.ai.assist({
    instructions: assistInstructions(useStore.getState().settings),
    prompt: prompt(kind, text, context),
    schema: SCHEMAS[kind],
    model: aiModel().id
  })) as Omit<AssistResult, 'kind'>
  const result = { kind, ...r } as AssistResult
  // Drop echoes of the original and duplicates.
  if ('options' in result) {
    const seen = new Set([kind === 'synonyms' ? norm(text) : ''])
    result.options = result.options.filter((o) => o.text.trim() && !seen.has(norm(o.text)) && seen.add(norm(o.text)))
  }
  cache.set(key, result)
  if (cache.size > 150) cache.delete(cache.keys().next().value!)
  return result
}


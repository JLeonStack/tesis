import { aiModel, useStore } from '../store'
import { cachedTranslation, langLabel, translationRules } from './translate'

// Quotes saved to notes are translated into Spanish automatically. Requests
// that arrive together (exporting every highlight) go out as one batch.

// The stored/model-facing value stays in English, like Settings.translateTo.
const LANG = 'Spanish'
const BATCH = 20
const WAIT_MS = 250

const ES = new Set(['de', 'la', 'que', 'el', 'en', 'los', 'las', 'del', 'se', 'por', 'con', 'una', 'para', 'es', 'y', 'al', 'lo', 'como', 'más', 'su', 'sus', 'entre'])
const EN = new Set(['the', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'with', 'as', 'are', 'this', 'be', 'by', 'on', 'it', 'which', 'from', 'an', 'their'])

/** Already Spanish? Function words give it away even in short quotes. */
export function looksSpanish(text: string): boolean {
  let es = 0
  let en = 0
  for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (ES.has(w)) es++
    else if (EN.has(w)) en++
  }
  return es > en
}

export const canTranslate = () => !!useStore.getState().account?.connected

const INSTRUCTIONS = `Traducís citas textuales de papers académicos (negocios, management, economía, ciencias sociales) a ${langLabel(LANG)}, para las notas de investigación de un estudiante de MBA.
${translationRules(LANG)}
- Recibís una lista numerada de pasajes independientes. Devolvé una traducción por pasaje, en el mismo orden, como texto plano y sin comillas alrededor.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: { translations: { type: 'array', items: { type: 'string' } } }
}

type Job = { text: string; resolve: (t: string) => void; reject: (e: Error) => void }
let queue: Job[] = []
let timer: ReturnType<typeof setTimeout> | undefined

/** Spanish translation of a quote. Rejects when the model is unavailable or the call fails. */
export function translateQuote(text: string): Promise<string> {
  const clean = text.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim()
  if (/^spanish/i.test(useStore.getState().settings.translateTo)) {
    const hit = cachedTranslation(clean)
    if (hit) return Promise.resolve(hit)
  }
  return new Promise((resolve, reject) => {
    queue.push({ text: clean, resolve, reject })
    clearTimeout(timer)
    timer = setTimeout(flush, WAIT_MS)
  })
}

function flush(): void {
  const jobs = queue
  queue = []
  for (let i = 0; i < jobs.length; i += BATCH) void run(jobs.slice(i, i + BATCH))
}

async function run(jobs: Job[]): Promise<void> {
  try {
    const list = jobs.map((j, i) => `${i + 1}. ${j.text}`).join('\n\n')
    const r = (await window.api.ai.extract(`Traducí estos ${jobs.length} pasajes a ${langLabel(LANG)}:\n\n${list}`, SCHEMA, {
      instructions: INSTRUCTIONS,
      model: aiModel().id,
      effort: 'low'
    })) as { translations: string[] }
    jobs.forEach((j, i) => {
      const t = r.translations[i]?.trim().replace(/^[«“"]+|[»”"]+$/g, '')
      if (t) j.resolve(t)
      else j.reject(new Error('Falta la traducción'))
    })
  } catch (e) {
    for (const j of jobs) j.reject(e as Error)
  }
}

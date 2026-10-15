import type { ConstructId } from '@shared/types'

// How each of the course's scales is scored from the Qualtrics export. The
// items, reverse keys and subscales come from the course's questionnaire
// document (ETHXXX_LEAD_questionnaires) and the instruments' validation papers;
// the response codes were checked against the labelled export.

/** How a raw response code becomes an item score. */
export type Transform =
  /** Likert as coded; reverse = min + max − value. */
  | 'likert'
  /** Coded 1–5, scored 0–4 as the instrument is (HSA-TFL, LSPS); reverse likewise. */
  | 'minus1'
  /** EQ 0-1-2: coded 1 (totalmente en desacuerdo) to 4 (totalmente de acuerdo); only empathic answers score. */
  | 'eq'

export interface ScaleKey {
  id: string
  construct: ConstructId
  label: string
  /** Column codes, in item order. */
  items: string[]
  /** Reverse-keyed items: 1-based positions in `items`. */
  reverse: number[]
  transform: Transform
  /** Raw codes run from min to max. */
  min: number
  max: number
  /** Mean of the items, or their sum (EQ). */
  score: 'mean' | 'sum'
  /** The construct's main score(s), the ones hypotheses are about. */
  primary?: boolean
  /** A subscale of this key. */
  parent?: string
  /** Not item-level: the mean of these keys' scores, over those answered (ECR-RS across relationships). */
  of?: string[]
  /** Where the scoring comes from, for the Method chapter. */
  source: string
}

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}_${from + i}`)
const pick = (prefix: string, ns: number[]) => ns.map((n) => `${prefix}_${n}`)

const RELATIONSHIPS = [
  { q: 'Q3.1', id: 'mother', label: 'madre' },
  { q: 'Q3.2', id: 'father', label: 'padre' },
  { q: 'Q3.3', id: 'partner', label: 'pareja' },
  { q: 'Q3.4', id: 'friend', label: 'mejor amigo/a' }
]

const ECR_SOURCE = 'Fraley et al. (2011); versión en español de Maffezzoli et al. (2014). Evitación: ítems 1–6, con 1–4 invertidos (8 − valor); ansiedad: ítems 7–9. Escala de 1 a 7.'

const ecr: ScaleKey[] = [
  {
    id: 'ecr.avoid',
    construct: 'attachment',
    label: 'Apego: evitación (global)',
    items: [],
    reverse: [],
    transform: 'likert',
    min: 1,
    max: 7,
    score: 'mean',
    primary: true,
    of: RELATIONSHIPS.map((r) => `ecr.avoid.${r.id}`),
    source: `${ECR_SOURCE} Global: promedio de los vínculos respondidos.`
  },
  {
    id: 'ecr.anx',
    construct: 'attachment',
    label: 'Apego: ansiedad (global)',
    items: [],
    reverse: [],
    transform: 'likert',
    min: 1,
    max: 7,
    score: 'mean',
    primary: true,
    of: RELATIONSHIPS.map((r) => `ecr.anx.${r.id}`),
    source: `${ECR_SOURCE} Global: promedio de los vínculos respondidos.`
  },
  ...RELATIONSHIPS.flatMap((r): ScaleKey[] => [
    { id: `ecr.avoid.${r.id}`, construct: 'attachment', label: `Evitación (${r.label})`, items: range(r.q, 1, 6), reverse: [1, 2, 3, 4], transform: 'likert', min: 1, max: 7, score: 'mean', parent: 'ecr.avoid', source: ECR_SOURCE },
    { id: `ecr.anx.${r.id}`, construct: 'attachment', label: `Ansiedad (${r.label})`, items: range(r.q, 7, 9), reverse: [], transform: 'likert', min: 1, max: 7, score: 'mean', parent: 'ecr.anx', source: ECR_SOURCE }
  ])
]

// The Chilean EQ's 29 items, in the order of the course's survey (Q4.1_1–29),
// with their numbers in the original 60-item EQ: 1–13 cognitive empathy,
// 14–22 emotional reactivity, 23–29 social skills. Reverse-keyed as in
// Baron-Cohen & Wheelwright (2004): original items 4, 8, 12, 14, 15, 21, 27, 32, 46, 48, 49, 50.
// (The course document marks 35 instead of 21 as reversed; 35, «No encuentro que
// las situaciones sociales sean confusas», scores agreement in the original key.
// Change it in the analysis view if the tutor says otherwise.)
export const EQ_ORIGINAL = [1, 19, 25, 26, 36, 41, 43, 44, 52, 54, 55, 58, 60, 15, 27, 32, 42, 46, 48, 49, 50, 59, 4, 8, 12, 14, 21, 35, 57]
const EQ_REVERSED_ORIGINAL = new Set([4, 8, 12, 14, 15, 21, 27, 32, 46, 48, 49, 50])
const eqReverse = (from: number, to: number) => EQ_ORIGINAL.slice(from - 1, to).flatMap((orig, i) => (EQ_REVERSED_ORIGINAL.has(orig) ? [i + 1] : []))
const EQ_SOURCE = 'Fernández et al. (2021), versión chilena de 29 ítems; puntuación 0-1-2 (Lawrence et al., 2004): 2 = respuesta empática fuerte, 1 = leve, 0 = el resto; los ítems inversos al revés. Rango total 0–58.'

const eq: ScaleKey[] = [
  { id: 'eq', construct: 'empathy', label: 'Empatía (EQ total)', items: range('Q4.1', 1, 29), reverse: eqReverse(1, 29), transform: 'eq', min: 1, max: 4, score: 'sum', primary: true, source: EQ_SOURCE },
  { id: 'eq.cog', construct: 'empathy', label: 'Empatía cognitiva', items: range('Q4.1', 1, 13), reverse: eqReverse(1, 13), transform: 'eq', min: 1, max: 4, score: 'sum', parent: 'eq', source: EQ_SOURCE },
  { id: 'eq.emo', construct: 'empathy', label: 'Reactividad emocional', items: range('Q4.1', 14, 22), reverse: eqReverse(14, 22), transform: 'eq', min: 1, max: 4, score: 'sum', parent: 'eq', source: EQ_SOURCE },
  { id: 'eq.soc', construct: 'empathy', label: 'Habilidades sociales', items: range('Q4.1', 23, 29), reverse: eqReverse(23, 29), transform: 'eq', min: 1, max: 4, score: 'sum', parent: 'eq', source: EQ_SOURCE }
]

const TFL_SOURCE = 'Berger et al. (2012), HSA-TFL en español: 8 ítems de 0 a 4 (en la base, 1 a 5), evaluados por el colaborador sobre su superior directo.'
const tfl: ScaleKey[] = [
  { id: 'tfl', construct: 'tfl', label: 'Liderazgo transformacional', items: range('Q5.1', 1, 8), reverse: [], transform: 'minus1', min: 1, max: 5, score: 'mean', primary: true, source: TFL_SOURCE },
  { id: 'tfl.insp', construct: 'tfl', label: 'Inspiración motivacional', items: pick('Q5.1', [1, 8]), reverse: [], transform: 'minus1', min: 1, max: 5, score: 'mean', parent: 'tfl', source: TFL_SOURCE },
  { id: 'tfl.char', construct: 'tfl', label: 'Carisma', items: pick('Q5.1', [2, 3]), reverse: [], transform: 'minus1', min: 1, max: 5, score: 'mean', parent: 'tfl', source: TFL_SOURCE },
  { id: 'tfl.cons', construct: 'tfl', label: 'Consideración individualizada', items: pick('Q5.1', [4, 5]), reverse: [], transform: 'minus1', min: 1, max: 5, score: 'mean', parent: 'tfl', source: TFL_SOURCE },
  { id: 'tfl.stim', construct: 'tfl', label: 'Estimulación intelectual', items: pick('Q5.1', [6, 7]), reverse: [], transform: 'minus1', min: 1, max: 5, score: 'mean', parent: 'tfl', source: TFL_SOURCE }
]

const security: ScaleKey[] = [
  {
    id: 'lsps',
    construct: 'security',
    label: 'Líder como proveedor de seguridad',
    items: range('Q7.1', 1, 15),
    reverse: [],
    transform: 'minus1',
    min: 1,
    max: 5,
    score: 'mean',
    primary: true,
    source: 'Molero et al. (2019), LSPS: 15 ítems unidimensionales de 0 a 4 (en la base, 1 a 5); el colaborador describe a su jefe/a directo/a.'
  }
]

const OCB_SOURCE = 'Lee y Allen (2002), adaptación de Dávila y Finkelstein (2010): 16 ítems de frecuencia de 1 (nunca) a 5 (siempre).'
const ocb: ScaleKey[] = [
  { id: 'cco', construct: 'ocb', label: 'CCO total', items: range('Q6.1', 1, 16), reverse: [], transform: 'likert', min: 1, max: 5, score: 'mean', primary: true, source: OCB_SOURCE },
  { id: 'cco.i', construct: 'ocb', label: 'CCO hacia individuos (CCO-I)', items: range('Q6.1', 1, 8), reverse: [], transform: 'likert', min: 1, max: 5, score: 'mean', parent: 'cco', source: OCB_SOURCE },
  { id: 'cco.o', construct: 'ocb', label: 'CCO hacia la organización (CCO-O)', items: range('Q6.1', 9, 16), reverse: [], transform: 'likert', min: 1, max: 5, score: 'mean', parent: 'cco', source: OCB_SOURCE }
]

export const SCALE_KEYS: ScaleKey[] = [...ecr, ...eq, ...tfl, ...security, ...ocb]
export const KEY_BY_ID = Object.fromEntries(SCALE_KEYS.map((k) => [k.id, k])) as Record<string, ScaleKey>

/** The scales of a construct, the main score(s) first, then subscales (ECR-RS: per relationship). */
export const keysOf = (c: ConstructId) => SCALE_KEYS.filter((k) => k.construct === c)

/** The key with the student's own reverse items, when they changed them. */
export function withOverrides(k: ScaleKey, reverse: Record<string, number[]>): ScaleKey {
  return reverse[k.id] ? { ...k, reverse: reverse[k.id] } : k
}

/** One item's score from its raw code (null when missing or out of range). */
export function itemScore(raw: number | null, k: ScaleKey, reversed: boolean): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < k.min || raw > k.max) return null
  if (k.transform === 'eq') {
    // 4 = totalmente de acuerdo … 1 = totalmente en desacuerdo.
    if (reversed) return raw === 1 ? 2 : raw === 2 ? 1 : 0
    return raw === 4 ? 2 : raw === 3 ? 1 : 0
  }
  const v = reversed ? k.min + k.max - raw : raw
  return k.transform === 'minus1' ? v - 1 : v
}

/** Share of a scale's items that must be answered for a score (the rest prorated). */
export const MIN_ANSWERED = 0.8

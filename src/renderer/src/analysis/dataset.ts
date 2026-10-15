import type { Cell, Dataset } from '@shared/types'
import { DEMOGRAPHICS } from '../research/framework'
import { uid } from '../lib/util'
import { readCsv, readXlsx } from './xlsx'

// The course's Qualtrics export, made analysable: codes or labels become
// numbers, demographics become ages and categories, and only finished
// responses are kept. Both exports work: "Sin etiquetas" (numeric codes, with
// a couple of quirks fixed here) and "Con etiquetas" (the answers as text).

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Response labels per question block, as the labelled export writes them. */
const LABELS: [prefix: RegExp, map: Record<string, number>][] = [
  [/^Q3\./, { 'totalmente en desacuerdo': 1, 'en desacuerdo': 2, 'algo en desacuerdo': 3, 'ni de acuerdo ni en desacuerdo': 4, 'algo de acuerdo': 5, 'de acuerdo': 6, acuerdo: 6, 'totalmente de acuerdo': 7 }],
  [/^Q4\./, { 'totalmente en desacuerdo': 1, 'en desacuerdo': 1, 'algo en desacuerdo': 2, 'algo de acuerdo': 3, 'totalmente acuerdo': 4, 'totalmente de acuerdo': 4 }],
  [
    /^Q[57]\./,
    { 'completamente de desacuerdo': 1, 'completamente en desacuerdo': 1, 'totalmente en desacuerdo': 1, 'algo en desacuerdo': 2, 'ni acuerdo ni en desacuerdo': 3, 'ni de acuerdo ni en desacuerdo': 3, 'algo de acuerdo': 4, 'completamente de acuerdo': 5, 'totalmente de acuerdo': 5 }
  ],
  [/^Q6\./, { nunca: 1, 'a veces': 2, 'la mitad de las veces': 3, 'la mayoria de las veces': 4, siempre: 5 }],
  [/^Finished$/, { verdadero: 1, falso: 0, true: 1, false: 0 }]
]

/** Category names for the numeric export's codes (from the labelled export). */
export const CATEGORY_LABELS: Record<string, string[]> = {
  'Q2.3': ['', 'Hombre', 'Mujer', 'No binario'],
  'Q2.4': ['', 'Primaria completa', 'Secundaria completa', 'Terciaria completa', 'Universitaria completa', 'Postgrado completo', 'Doctorado completo'],
  'Q2.5': ['', 'Contribuidor individual (sin subordinados)', 'Supervisión / jefatura', 'Subgerencia / gerencia junior', 'Gerencia', 'Dirección / alta gerencia', 'Ejecutivo (C-level)', 'Propietario / fundador'],
  'Q2.9': [
    '',
    'Agricultura, silvicultura y pesca',
    'Explotación de minas y canteras',
    'Industrias manufactureras',
    'Suministro de electricidad, gas, vapor y aire acondicionado',
    'Suministro de agua; saneamiento y gestión de residuos',
    'Construcción',
    'Comercio al por mayor y al por menor; reparación de vehículos',
    'Transporte y almacenamiento',
    'Alojamiento y servicios de comida',
    'Información y comunicaciones',
    'Actividades financieras y de seguros',
    'Actividades inmobiliarias',
    'Actividades profesionales, científicas y técnicas',
    'Actividades administrativas y servicios de apoyo',
    'Administración pública y defensa; seguridad social obligatoria',
    'Educación',
    'Actividades de atención de la salud humana y asistencia social',
    'Actividades artísticas, de entretenimiento y recreación',
    'Otras actividades de servicios',
    'Actividades de organizaciones y organismos extraterritoriales'
  ]
}

/** Education in order, for treating it as ordinal when needed. */
export const EDUCATION_ORDER = CATEGORY_LABELS['Q2.4'].slice(1)

// ---------- import ----------

export async function importDataset(file: File): Promise<Dataset> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.sav')) throw new Error('Los archivos de SPSS (.sav) no se pueden leer acá: usá la versión .xlsx de la misma exportación (está en la misma carpeta).')
  const grid = lower.endsWith('.csv') ? readCsv(await file.text()) : await readXlsx(await file.arrayBuffer())
  return fromGrid(grid, file.name.replace(/\.[^.]+$/, ''))
}

/** Row 1: column codes. Qualtrics adds the question text (row 2) and sometimes an ImportId row (row 3). */
export function fromGrid(grid: Cell[][], name: string): Dataset {
  const header = (grid[0] ?? []).map((c) => (c == null ? '' : String(c).trim()))
  if (!header.includes('Finished') && !header.some((h) => /^Q\d/.test(h))) throw new Error('No parece una exportación de Qualtrics: la primera fila debería tener los códigos de columna (Finished, Q2.2, Q3.1_1…).')
  let start = 1
  let questions: string[] = []
  const looksLikeText = (row: Cell[]) => {
    const qs = header.map((h, i) => (/^Q\d/.test(h) ? row[i] : undefined)).filter((c) => c !== undefined && c !== null)
    return qs.length > 0 && qs.filter((c) => typeof c === 'string').length / qs.length > 0.8 && qs.some((c) => typeof c === 'string' && c.length > 25)
  }
  if (grid[1] && looksLikeText(grid[1])) {
    questions = header.map((_, i) => (grid[1][i] == null ? '' : String(grid[1][i])))
    start = 2
  }
  if (grid[start]?.some((c) => typeof c === 'string' && c.startsWith('{"ImportId'))) start++
  const rows = grid.slice(start).filter((r) => r.some((c) => c != null))
  const width = header.length
  const finished = header.indexOf('Finished')
  const probe = header.indexOf('Q4.1_1') >= 0 ? header.indexOf('Q4.1_1') : header.findIndex((h) => /^Q[3-7]\./.test(h))
  const labeled = probe >= 0 && rows.filter((r) => typeof r[probe] === 'string').length > rows.filter((r) => typeof r[probe] === 'number').length
  return {
    id: uid(),
    name,
    columns: header,
    questions,
    rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)),
    labeled: labeled || (finished >= 0 && rows.some((r) => typeof r[finished] === 'string')),
    importedAt: Date.now()
  }
}

// ---------- reading values ----------

/** Why responses were left out, in the order the filters run (for the Participants section). */
export interface Exclusions {
  /** Qualtrics' Finished = false. */
  unfinished: number
  /** Survey previews, tests and spam (Qualtrics' Status), not real participants. */
  preview: number
  /** Answered NO to either informed-consent question (Q2_2, Q2_3). */
  noConsent: number
  /** Faster than a third of the median duration; only counted here when they are left out. */
  speeders: number
  /** Owners/founders, with no direct boss to describe; only counted here when they are left out. */
  noBoss: number
}

/** Qualtrics' Status: 0 = IP address, 1 = preview, 2 = test, 8/9/12 = spam, 16 = offline, 17 = offline preview. */
const STATUS_KEPT_CODES = new Set([0, 4, 16])
const notReal = (cell: Cell) => (typeof cell === 'number' ? !STATUS_KEPT_CODES.has(cell) : cell != null && /vista previa|preview|prueba|test|spam/i.test(cell))

/** Informed consent: the labelled export writes SI/NO; the numeric one codes them 3/4. */
const consentRefused = (cell: Cell) => (typeof cell === 'number' ? cell === 4 : cell != null && /^no\b/i.test(fold(cell)))

export const CONSENT_COLUMNS = ['Q2_2', 'Q2_3']
const DURATION = 'Duration (in seconds)'

/** Organisational position (Q2.5): code 7 is «Propietario / fundador», who has no direct boss. */
const POSITION = 'Q2.5'
const isOwner = (cell: Cell) => (typeof cell === 'number' ? cell === 7 : cell != null && /propietari|fundador/.test(fold(cell)))

export class Frame {
  readonly index: Map<string, number>
  /** Rows kept: finished responses from real participants who consented (and, when asked, neither speeders nor owners). */
  readonly rows: Cell[][]
  readonly excluded: Exclusions
  /** Responses faster than a third of the median duration (flagged whether or not they are left out). */
  readonly speeders: { count: number; threshold: number; median: number }
  /** Owners/founders among the responses otherwise kept (flagged whether or not they are left out). */
  readonly noBoss: number
  /** Answers given as text that matched no known response label: "Q3.3 · Acuerdo". */
  readonly unknown = new Set<string>()

  constructor(
    readonly data: Dataset,
    opts: { dropSpeeders?: boolean; dropNoBoss?: boolean } = {}
  ) {
    this.index = new Map(data.columns.map((c, i) => [c, i]))
    const at = (col: string) => this.index.get(col)
    const fin = at('Finished')
    const finished = fin == null ? data.rows : data.rows.filter((r) => this.code('Finished', r[fin]) === 1)
    const status = at('Status')
    const real = status == null ? finished : finished.filter((r) => !notReal(r[status]))
    const consent = CONSENT_COLUMNS.map(at).filter((i): i is number => i != null)
    const consented = real.filter((r) => !consent.some((i) => consentRefused(r[i])))
    const dur = at(DURATION)
    const secs = dur == null ? [] : consented.map((r) => (typeof r[dur] === 'number' ? (r[dur] as number) : Number(r[dur]))).filter((v) => Number.isFinite(v) && v > 0)
    const sorted = [...secs].sort((a, b) => a - b)
    const median = sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : NaN
    const threshold = median / 3
    const fast = (r: Cell[]) => dur != null && Number(r[dur]) > 0 && Number(r[dur]) < threshold
    const attentive = opts.dropSpeeders ? consented.filter((r) => !fast(r)) : consented
    const pos = at(POSITION)
    const owner = (r: Cell[]) => pos != null && isOwner(r[pos])
    const kept = opts.dropNoBoss ? attentive.filter((r) => !owner(r)) : attentive
    this.rows = kept
    this.speeders = { count: consented.filter(fast).length, threshold, median }
    this.noBoss = attentive.filter(owner).length
    this.excluded = {
      unfinished: data.rows.length - finished.length,
      preview: finished.length - real.length,
      noConsent: real.length - consented.length,
      speeders: consented.length - attentive.length,
      noBoss: attentive.length - kept.length
    }
  }

  has(col: string): boolean {
    return this.index.has(col)
  }

  /** A response as a number: the code itself, or the code its label stands for. */
  code(col: string, cell: Cell): number | null {
    if (cell == null) return null
    if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
    const t = fold(cell)
    const n = Number(t.replace(',', '.'))
    if (t && Number.isFinite(n)) return n
    for (const [re, map] of LABELS) if (re.test(col) && t in map) return map[t]
    if (/^Q[3-7]\./.test(col)) this.unknown.add(`${col.split('_')[0]} · ${cell.trim()}`)
    return null
  }

  /** Raw codes of a column over the kept rows. */
  codes(col: string): (number | null)[] {
    const i = this.index.get(col)
    return i == null ? this.rows.map(() => null) : this.rows.map((r) => this.code(col, r[i]))
  }

  /** A continuous demographic in real units (the numeric export's quirks undone), implausible values dropped. */
  numeric(col: string): (number | null)[] {
    const i = this.index.get(col)
    if (i == null) return this.rows.map(() => null)
    return this.rows.map((r) => {
      const cell = r[i]
      let v = this.code(col, cell)
      if (v == null) return null
      if (typeof cell === 'number' && !this.data.labeled) {
        // Numeric export: age is shifted (code − 956), and in Q2.6 code 1 means 0 years, 71 means 1.
        if (col === 'Q2.2' && v >= 900) v -= 956
        if (col === 'Q2.6') v = v === 1 ? 0 : v === 71 ? 1 : v
      }
      if (col === 'Q2.2') return v >= 16 && v <= 90 ? v : null
      return v >= 0 && v <= 70 ? v : null
    })
  }

  /** A categorical demographic as its label. */
  category(col: string): (string | null)[] {
    const i = this.index.get(col)
    if (i == null) return this.rows.map(() => null)
    return this.rows.map((r) => {
      const c = r[i]
      if (c == null) return null
      if (typeof c === 'string') return c.trim() || null
      return CATEGORY_LABELS[col]?.[c] ?? String(c)
    })
  }
}

/** The demographics the dataset has, with their kind. */
export const demographicsIn = (f: Frame) => DEMOGRAPHICS.filter((d) => f.has(d.column))

import type { AnalysisSettings, ConstructId, Dataset, ResearchSettings } from '@shared/types'
import { CONSTRUCTS, CONSTRUCT_ORDER, DEMOGRAPHICS, chosenPair, type Demographic } from '../research/framework'
import { Frame, type Exclusions } from './dataset'
import { KEY_BY_ID, MIN_ANSWERED, itemScore, keysOf, withOverrides, type ScaleKey } from './keys'
import {
  anovaOneWay,
  apaCorr,
  bonferroni,
  compareCorrelations,
  cronbachAlpha,
  describe,
  fdrBH,
  fmtNum,
  fmtP,
  fmtR,
  kruskalWallis,
  mannWhitney,
  oneTailed,
  ols,
  partialR,
  pearson,
  pFromF,
  spearman,
  welchT,
  winsorize
} from './stats'

// Everything the course's analysis guide asks for, computed for the student's
// pair: the sample and who was left out, scale scores, reliability,
// descriptives and normality, correlations (one- or two-tailed, with
// multiple-comparison corrections, attachment per relationship and the
// comparison of two correlations), group comparisons by the chosen
// demographics, and a regression with its residual check, partial plot and
// an optional moderator. Each block can become an APA table.

type Num = number | null

export interface Score {
  key: ScaleKey
  values: Num[]
}

export interface Reliability {
  key: ScaleKey
  alpha: number
  n: number
  k: number
  /** Item positions whose removal would raise α by .02 or more. */
  weakItems: { item: number; alphaIfDeleted: number }[]
}

/** The guide's reading of α: < .50 poor, .50–.75 moderate, .75–.90 good, > .90 excellent. */
export const alphaBand = (a: number) => (a > 0.9 ? 'Excelente' : a >= 0.75 ? 'Buena' : a >= 0.5 ? 'Moderada' : 'Pobre')

export interface DescRow {
  id: string
  label: string
  n: number
  min: number
  max: number
  range: number
  mean: number
  sd: number
  skewness: number
  kurtosis: number
  outliers: number
  /** The guide's reading of skewness: |s| < .5 fine, up to 1 moderate, beyond 1 strong. */
  skew: 'leve' | 'moderada' | 'fuerte'
  /** |skewness| ≤ 1: close enough to normal for parametric tests. */
  normal: boolean
  /** The values described, for its histogram and Q-Q plot. */
  values: number[]
}

export interface Sample {
  continuous: { id: string; label: string; n: number; mean: number; sd: number; min: number; max: number }[]
  categorical: { id: string; label: string; n: number; groups: { label: string; n: number; pct: number }[] }[]
}

export interface CorrCell {
  r: number
  /** Uncorrected (one-tailed when the pair has a hypothesized direction). */
  p: number
  pAdj: number
  n: number
  tails: 1 | 2
}

export interface Correlations {
  method: 'pearson' | 'spearman'
  correction: 'fdr' | 'bonferroni'
  vars: { id: string; label: string }[]
  /** Lower triangle: cells[i][j] for j < i. */
  cells: (CorrCell | null)[][]
  tests: number
}

/** One correlation, anywhere in the results (matrix or attachment by relationship). */
export interface CorrPair extends CorrCell {
  key: string
  a: { id: string; label: string }
  b: { id: string; label: string }
  /** Between the two topics (what hypotheses are about), not within one. */
  cross: boolean
}

export interface Relationships {
  method: 'pearson' | 'spearman'
  outcomes: { id: string; label: string }[]
  rows: { relationship: string; avoid: (CorrPair | null)[]; anx: (CorrPair | null)[] }[]
  tests: number
}

export interface Comparison {
  a: CorrPair
  b: CorrPair
  z: number
  p: number
  p1: number
}

export interface GroupTest {
  demographic: Demographic
  score: { id: string; label: string }
  groups: { label: string; n: number; mean: number; sd: number }[]
  /** Groups left out for having fewer than MIN_GROUP responses. */
  dropped: string[]
  test: 'welch' | 'mann-whitney' | 'anova' | 'kruskal-wallis'
  stat: number
  df?: string
  p: number
  pAdj: number
  effect: { name: string; value: number }
  apa: string
}

export interface RegCoef {
  name: string
  b: number
  se: number
  beta: number
  t: number
  p: number
  vif?: number
  /** Partial correlation with the outcome, the other predictors held constant. */
  partial?: number
}

export interface Moderation {
  moderator: { id: string; label: string }
  n: number
  /** R² without and with the interaction terms. */
  r2Before: number
  r2: number
  deltaR2: number
  F: number
  df1: number
  df2: number
  p: number
  terms: RegCoef[]
}

export interface Regression {
  outcome: { id: string; label: string }
  predictors: { id: string; label: string; kind: 'z' | 'dummy' }[]
  n: number
  r2: number
  adjR2: number
  F: number
  df1: number
  df2: number
  p: number
  /** Bonferroni over the regressions run (one per outcome score). */
  pAdj: number
  coefs: RegCoef[]
  /** The guide asks for normal residuals: their shape and extreme values. */
  residuals: { values: number[]; skewness: number; kurtosis: number; outliers: number }
  /** Partial regression plot of the first predictor: both residualized on the other predictors. */
  partialPlot: { x: number[]; y: number[]; xLabel: string; yLabel: string } | null
  moderation: Moderation | null
}

export interface Results {
  /** Responses analysed. */
  n: number
  /** Rows in the file. */
  total: number
  excluded: Exclusions
  speeders: { count: number; threshold: number; median: number }
  /** Owners/founders among the responses kept before that filter. */
  noBoss: number
  pair: ConstructId[]
  sample: Sample
  scores: Score[]
  reliability: Reliability[]
  descriptives: DescRow[]
  correlations: Correlations | null
  relationships: Relationships | null
  /** Every correlation computed, by key: for directions and comparisons. */
  pairs: CorrPair[]
  comparison: Comparison | null
  groups: GroupTest[]
  regressions: Regression[]
  /** Demographics that can moderate: continuous ones and two-group categorical ones. */
  moderators: { id: string; label: string }[]
  /** Things to say in the text: low α, non-normal scales, dropped groups. */
  notes: string[]
}

const MIN_GROUP = 5

/** The key of a pair of variables, order-independent. */
export const pairKey = (a: string, b: string) => [a, b].sort().join('|')

// ---------- scoring ----------

function itemMatrix(f: Frame, k: ScaleKey): Num[][] {
  const cols = k.items.map((c) => f.codes(c))
  const rev = new Set(k.reverse)
  return f.rows.map((_, r) => cols.map((col, i) => itemScore(col[r], k, rev.has(i + 1))))
}

/** Per-response scale scores: mean or sum of the items, prorated when at least 80% are answered. */
export function scoreKey(f: Frame, k: ScaleKey, all: Map<string, Num[]>): Num[] {
  if (k.of) {
    const parts = k.of.map((id) => all.get(id)).filter((v): v is Num[] => !!v)
    return f.rows.map((_, r) => {
      const vals = parts.map((p) => p[r]).filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    })
  }
  return itemMatrix(f, k).map((row) => {
    const vals = row.filter((v): v is number => v != null)
    if (!vals.length || vals.length < Math.ceil(row.length * MIN_ANSWERED)) return null
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    return k.score === 'sum' ? mean * row.length : mean
  })
}

export function scoreAll(f: Frame, keys: ScaleKey[]): Score[] {
  const all = new Map<string, Num[]>()
  // Item-level keys first, so composites can average them.
  for (const k of [...keys.filter((k) => !k.of), ...keys.filter((k) => k.of)]) all.set(k.id, scoreKey(f, k, all))
  return keys.map((k) => ({ key: k, values: all.get(k.id)! }))
}

export function reliabilityOf(f: Frame, k: ScaleKey): Reliability | null {
  if (k.of || k.items.length < 2) return null
  const res = cronbachAlpha(itemMatrix(f, k))
  if (!Number.isFinite(res.alpha)) return null
  const weakItems = res.ifDeleted.flatMap((a, i) => (a - res.alpha >= 0.02 ? [{ item: i + 1, alphaIfDeleted: a }] : []))
  return { key: k, alpha: res.alpha, n: res.n, k: res.k, weakItems }
}

// ---------- the whole analysis ----------

const present = (xs: Num[]): number[] => xs.filter((v): v is number => v != null && Number.isFinite(v))

function descRow(id: string, label: string, xs: Num[]): DescRow | null {
  const v = present(xs)
  if (v.length < 3) return null
  const d = describe(v)
  const m = d.mean
  const outliers = v.filter((x) => Math.abs((x - m) / d.sd) > 3).length
  const a = Math.abs(d.skewness)
  return { id, label, n: d.n, min: d.min, max: d.max, range: d.range, mean: d.mean, sd: d.sd, skewness: d.skewness, kurtosis: d.kurtosis, outliers, skew: a < 0.5 ? 'leve' : a <= 1 ? 'moderada' : 'fuerte', normal: a <= 1, values: v }
}

/** Who answered: every demographic in the file, as the Participants section reports it. */
export function sampleOf(f: Frame): Sample {
  const out: Sample = { continuous: [], categorical: [] }
  for (const d of DEMOGRAPHICS) {
    if (!f.has(d.column)) continue
    if (d.kind === 'continua') {
      const v = present(f.numeric(d.column))
      if (!v.length) continue
      const s = describe(v)
      out.continuous.push({ id: d.id, label: d.label, n: s.n, mean: s.mean, sd: s.sd, min: s.min, max: s.max })
    } else {
      const counts = new Map<string, number>()
      for (const c of f.category(d.column)) if (c != null) counts.set(c, (counts.get(c) ?? 0) + 1)
      const n = [...counts.values()].reduce((a, b) => a + b, 0)
      if (!n) continue
      out.categorical.push({ id: d.id, label: d.label, n, groups: [...counts].sort((a, b) => b[1] - a[1]).map(([label, k]) => ({ label, n: k, pct: (100 * k) / n })) })
    }
  }
  return out
}

/** A two-group categorical demographic as 0/1 (the larger group is 0), groups under MIN_GROUP left out. */
function dummyOf(f: Frame, d: Demographic): { label: string; values: Num[] } | null {
  const cats = f.category(d.column)
  const counts = new Map<string, number>()
  for (const c of cats) if (c != null) counts.set(c, (counts.get(c) ?? 0) + 1)
  const kept = [...counts].filter(([, n]) => n >= MIN_GROUP).sort((a, b) => b[1] - a[1])
  if (kept.length !== 2) return null
  const [ref, one] = [kept[0][0], kept[1][0]]
  return { label: `${d.label} (${one} = 1)`, values: cats.map((c) => (c === one ? 1 : c === ref ? 0 : null)) }
}

const zOf = (v: number[]) => {
  const d = describe(v)
  return v.map((x) => (d.sd > 0 ? (x - d.mean) / d.sd : 0))
}

/** y minus its least-squares fit on cols (or minus its mean when there are none). */
function residualize(y: number[], cols: number[][]): number[] {
  if (!cols.length) {
    const m = describe(y).mean
    return y.map((v) => v - m)
  }
  const res = ols(y, y.map((_, i) => cols.map((c) => c[i])))
  if (!res.coefs.length) return y.map(() => NaN)
  return y.map((v, i) => v - res.coefs[0].b - cols.reduce((s, c, j) => s + res.coefs[j + 1].b * c[i], 0))
}

type Column = { id: string; label: string; kind: 'z' | 'dummy'; values: Num[] }

/** Complete cases of the outcome and columns: y raw, continuous columns standardized, dummies as 0/1. */
function design(outcome: Num[], cols: Column[]): { y: number[]; X: number[][] } {
  const rows = outcome.map((y, r) => [y, ...cols.map((p) => p.values[r])])
  const complete = rows.filter((row) => row.every((v) => v != null && Number.isFinite(v))) as number[][]
  return {
    y: complete.map((r) => r[0]),
    X: cols.map((p, j) => {
      const raw = complete.map((r) => r[j + 1])
      return p.kind === 'z' ? zOf(raw) : raw
    })
  }
}

const byRow = (cols: number[][], n: number) => Array.from({ length: n }, (_, i) => cols.map((c) => c[i]))

/** The topic predictors × moderator on top of predictors and moderator: does the moderator change the slopes? */
function moderate(outcome: Num[], preds: Column[], moderator: Column): Moderation | null {
  const all = preds.some((p) => p.id === moderator.id) ? preds : [...preds, moderator]
  const { y, X } = design(outcome, all)
  const mod = X[all.findIndex((p) => p.id === moderator.id)]
  const topics = all.map((p, j) => ({ p, j })).filter(({ p }) => p.kind === 'z' && KEY_BY_ID[p.id])
  if (!topics.length || y.length <= all.length + topics.length + 10) return null
  const inter = topics.map(({ j }) => X[j].map((v, i) => v * mod[i]))
  const names = [...all.map((p) => p.label), ...topics.map(({ p }) => `${p.label} × ${moderator.label}`)]
  const r1 = ols(y, byRow(X, y.length))
  const r2 = ols(y, byRow([...X, ...inter], y.length), names)
  if (!r1.coefs.length || !r2.coefs.length) return null
  const q = inter.length
  const deltaR2 = r2.r2 - r1.r2
  const F = deltaR2 / q / ((1 - r2.r2) / r2.df2)
  return {
    moderator: { id: moderator.id, label: moderator.label },
    n: r2.n,
    r2Before: r1.r2,
    r2: r2.r2,
    deltaR2,
    F,
    df1: q,
    df2: r2.df2,
    p: pFromF(F, q, r2.df2),
    terms: r2.coefs.slice(1 + X.length).map((c) => ({ ...c, partial: partialR(c.t, r2.df2) }))
  }
}

/** One regression on complete cases, with its residual check, partial plot and optional moderation. */
function regress(outcome: { id: string; label: string; values: Num[] }, preds: Column[], moderator: Column | null): Omit<Regression, 'pAdj'> | null {
  const { y, X } = design(outcome.values, preds)
  if (y.length <= preds.length + 10) return null
  const res = ols(y, byRow(X, y.length), preds.map((p) => p.label))
  if (!res.coefs.length) return null
  const resid = y.map((v, i) => v - res.coefs[0].b - X.reduce((s, c, j) => s + res.coefs[j + 1].b * c[i], 0))
  const rd = describe(resid)
  const others = X.slice(1)
  const partialPlot = preds[0]
    ? { x: residualize(X[0], others), y: residualize(y, others), xLabel: others.length ? `${preds[0].label} (residuos)` : preds[0].label, yLabel: others.length ? `${outcome.label} (residuos)` : outcome.label }
    : null
  const moderation = moderator ? moderate(outcome.values, preds, moderator) : null

  return {
    outcome: { id: outcome.id, label: outcome.label },
    predictors: preds.map(({ id, label, kind }) => ({ id, label, kind })),
    n: res.n,
    r2: res.r2,
    adjR2: res.adjR2,
    F: res.F,
    df1: res.df1,
    df2: res.df2,
    p: res.p,
    coefs: res.coefs.map((c, i) => (i === 0 ? c : { ...c, vif: res.vif[i - 1], partial: partialR(c.t, res.df2) })),
    residuals: { values: resid, skewness: rd.skewness, kurtosis: rd.kurtosis, outliers: resid.filter((v) => Math.abs((v - rd.mean) / rd.sd) > 3).length },
    partialPlot,
    moderation
  }
}

/** The keys analysed for a construct: main scores and subscales (ECR-RS: global scores only, relationships in reliability). */
export function analysedKeys(c: ConstructId): ScaleKey[] {
  return keysOf(c).filter((k) => !(c === 'attachment' && k.parent))
}

export function runAnalysis(data: Dataset, research: ResearchSettings, opts: AnalysisSettings): Results {
  const f = new Frame(data, { dropSpeeders: opts.dropSpeeders, dropNoBoss: opts.dropNoBoss })
  const pair = chosenPair(research).map((c) => c.id)
  const constructs = pair.length ? pair : CONSTRUCT_ORDER
  const keys = constructs.flatMap((c) => keysOf(c)).map((k) => withOverrides(k, opts.reverse))
  const scores = scoreAll(f, keys)
  const byId = new Map(scores.map((s) => [s.key.id, s]))
  const notes: string[] = []
  const directions = opts.directions ?? {}
  const correct = (ps: number[]) => (opts.correction === 'bonferroni' ? bonferroni(ps) : fdrBH(ps))
  const prep = (xs: Num[]): Num[] => {
    if (!opts.winsorize) return xs
    const v = present(xs)
    const w = winsorize(v, 3)
    let j = 0
    return xs.map((x) => (x == null || !Number.isFinite(x) ? null : w[j++]))
  }

  if (f.speeders.count && !opts.dropSpeeders)
    notes.push(`${f.speeders.count} respuesta(s) duraron menos de un tercio de la mediana (< ${fmtNum(f.speeders.threshold / 60, 1)} min; mediana ${fmtNum(f.speeders.median / 60, 1)} min): revisá si respondieron con atención; podés excluirlas.`)
  if (f.noBoss && !opts.dropNoBoss && pair.some((c) => c === 'tfl' || c === 'security'))
    notes.push(`${f.noBoss} participante(s) son propietarios o fundadores: no tienen un jefe directo a quien describir en la ${pair.includes('security') ? 'LSPS' : 'HSA-TFL'}. Podés excluirlos.`)

  // Reliability: every item-level key analysed (ECR-RS: per relationship).
  const reliability = keys.map((k) => reliabilityOf(f, k)).filter((r): r is Reliability => !!r)
  for (const r of reliability) if (r.alpha < 0.7) notes.push(`α de ${r.key.label} = ${fmtR(r.alpha)}: por debajo de .70; va como limitación.`)

  // Descriptives: the scales analysed plus the chosen continuous demographics.
  const shown = constructs.flatMap((c) => analysedKeys(c)).map((k) => byId.get(k.id)!).filter(Boolean)
  const demos = DEMOGRAPHICS.filter((d) => research.demographics.includes(d.id) && f.has(d.column))
  const contDemos = demos.filter((d) => d.kind === 'continua')
  const catDemos = demos.filter((d) => d.kind === 'categórica')
  const descriptives = [
    ...shown.map((s) => descRow(s.key.id, s.key.label, s.values)),
    ...contDemos.map((d) => descRow(d.id, d.label, f.numeric(d.column)))
  ].filter((d): d is DescRow => !!d)
  const descOf = new Map(descriptives.map((d) => [d.id, d]))
  const nonNormal = descriptives.filter((d) => !d.normal)
  if (nonNormal.length) notes.push(`Asimetría mayor a ±1 en: ${nonNormal.map((d) => d.label).join(', ')}.`)
  const parametric = opts.method === 'parametric' || (opts.method === 'auto' && !nonNormal.length)
  const method = parametric ? 'pearson' : 'spearman'
  const construct = (id: string) => KEY_BY_ID[id]?.construct

  /** r and p for two variables, one-tailed when the student set a direction for them. */
  const corr = (a: { id: string; label: string; values: Num[] }, b: { id: string; label: string; values: Num[] }): Omit<CorrPair, 'pAdj'> | null => {
    const [x, y] = paired(a.values, b.values)
    if (x.length < 4) return null
    const res = method === 'pearson' ? pearson(x, y) : spearman(x, y)
    const key = pairKey(a.id, b.id)
    const dir = directions[key]
    const ca = construct(a.id)
    const cb = construct(b.id)
    return { key, a: { id: a.id, label: a.label }, b: { id: b.id, label: b.label }, r: res.r, n: res.n, p: dir ? oneTailed(res.p, res.r, dir) : res.p, tails: dir ? 1 : 2, cross: !!ca && !!cb && ca !== cb }
  }
  const pairs: CorrPair[] = []

  // Correlations among the pair's scores and the continuous demographics.
  const vars = [
    ...shown.map((s) => ({ id: s.key.id, label: s.key.label, values: prep(s.values) })),
    ...contDemos.map((d) => ({ id: d.id, label: d.label, values: f.numeric(d.column) }))
  ].filter((v) => descOf.has(v.id))
  let correlations: Correlations | null = null
  if (vars.length >= 2) {
    const raw: { i: number; j: number; c: Omit<CorrPair, 'pAdj'> }[] = []
    for (let i = 1; i < vars.length; i++)
      for (let j = 0; j < i; j++) {
        const c = corr(vars[i], vars[j])
        if (c) raw.push({ i, j, c })
      }
    const adj = correct(raw.map((x) => x.c.p))
    const cells: (CorrCell | null)[][] = vars.map((_, i) => vars.slice(0, i).map(() => null))
    raw.forEach(({ i, j, c }, k) => {
      const full = { ...c, pAdj: adj[k] }
      cells[i][j] = { r: c.r, p: c.p, pAdj: adj[k], n: c.n, tails: c.tails }
      pairs.push(full)
    })
    correlations = { method, correction: opts.correction ?? 'fdr', vars: vars.map(({ id, label }) => ({ id, label })), cells, tests: raw.length }
  }

  // Attachment per relationship against the other topic's main scores (does the bond matter?).
  let relationships: Relationships | null = null
  if (pair.length === 2 && pair.includes('attachment')) {
    const other = pair.find((c) => c !== 'attachment')!
    const outcomes = analysedKeys(other).map((k) => byId.get(k.id)!).filter((s) => s?.key.primary)
    const rels = keysOf('attachment').filter((k) => k.parent === 'ecr.avoid')
    const raw: Omit<CorrPair, 'pAdj'>[] = []
    const rows = rels.map((k) => {
      const rel = k.id.split('.').at(-1)!
      const anxKey = byId.get(`ecr.anx.${rel}`)
      const avoidKey = byId.get(k.id)
      const line = (s: Score | undefined) =>
        outcomes.map((o) => {
          if (!s) return null
          const c = corr({ id: s.key.id, label: s.key.label, values: prep(s.values) }, { id: o.key.id, label: o.key.label, values: prep(o.values) })
          if (c) raw.push(c)
          return c
        })
      return { relationship: k.label.replace(/^Evitación \((.*)\)$/, '$1'), avoid: line(avoidKey), anx: line(anxKey) }
    })
    const adj = correct(raw.map((c) => c.p))
    const full = new Map(raw.map((c, i) => [c, { ...c, pAdj: adj[i] }]))
    relationships = {
      method,
      outcomes: outcomes.map((o) => ({ id: o.key.id, label: o.key.label })),
      rows: rows.map((r) => ({ relationship: r.relationship, avoid: r.avoid.map((c) => (c ? full.get(c)! : null)), anx: r.anx.map((c) => (c ? full.get(c)! : null)) })),
      tests: raw.length
    }
    pairs.push(...full.values())
  }

  // The guide's section 7: is one correlation stronger than another?
  let comparison: Comparison | null = null
  const [ka, kb] = opts.compare ?? []
  const ca = pairs.find((p) => p.key === ka)
  const cb = pairs.find((p) => p.key === kb)
  if (ca && cb && ka !== kb) comparison = { a: ca, b: cb, ...compareCorrelations(ca.r, ca.n, cb.r, cb.n) }

  // Group comparisons: each main score of the pair by each chosen categorical demographic.
  const primaries = shown.filter((s) => s.key.primary)
  const groups: GroupTest[] = []
  for (const d of catDemos) {
    const cats = f.category(d.column)
    for (const s of primaries) {
      const g = new Map<string, number[]>()
      prep(s.values).forEach((v, r) => {
        const c = cats[r]
        if (v == null || c == null) return
        g.set(c, [...(g.get(c) ?? []), v])
      })
      const kept = [...g].filter(([, xs]) => xs.length >= MIN_GROUP).sort((a, b) => b[1].length - a[1].length)
      const dropped = [...g].filter(([, xs]) => xs.length < MIN_GROUP).map(([l, xs]) => `${l} (n = ${xs.length})`)
      if (kept.length < 2) continue
      const stats = kept.map(([label, xs]) => ({ ...describe(xs), label, n: xs.length }))
      const base = { demographic: d, score: { id: s.key.id, label: s.key.label }, groups: stats.map(({ label, n, mean, sd }) => ({ label, n, mean, sd })), dropped }
      if (kept.length === 2) {
        const [a, b] = [kept[0][1], kept[1][1]]
        if (parametric) {
          const t = welchT(a, b)
          groups.push({ ...base, test: 'welch', stat: t.t, df: fmtNum(t.df, 1), p: t.p, pAdj: t.p, effect: { name: 'd', value: t.d }, apa: `t(${fmtNum(t.df, 1)}) = ${fmtNum(t.t)}, p ${pRel(t.p)}, d = ${fmtNum(t.d)}` })
        } else {
          const u = mannWhitney(a, b)
          groups.push({ ...base, test: 'mann-whitney', stat: u.U, p: u.p, pAdj: u.p, effect: { name: 'r', value: u.r }, apa: `U = ${fmtNum(u.U, 0)}, z = ${fmtNum(u.z)}, p ${pRel(u.p)}, r = ${fmtR(u.r)}` })
        }
      } else if (parametric) {
        const a = anovaOneWay(kept.map(([, xs]) => xs))
        groups.push({ ...base, test: 'anova', stat: a.F, df: `${a.df1}, ${a.df2}`, p: a.p, pAdj: a.p, effect: { name: 'η²', value: a.eta2 }, apa: `F(${a.df1}, ${a.df2}) = ${fmtNum(a.F)}, p ${pRel(a.p)}, η² = ${fmtR(a.eta2)}` })
      } else {
        const k = kruskalWallis(kept.map(([, xs]) => xs))
        groups.push({ ...base, test: 'kruskal-wallis', stat: k.H, df: String(k.df), p: k.p, pAdj: k.p, effect: { name: 'ε²', value: k.epsilon2 }, apa: `H(${k.df}) = ${fmtNum(k.H)}, p ${pRel(k.p)}, ε² = ${fmtR(k.epsilon2)}` })
      }
      if (dropped.length) notes.push(`${d.label}: grupos con menos de ${MIN_GROUP} respuestas fuera de la comparación: ${dropped.join(', ')}.`)
    }
  }
  const gAdj = bonferroni(groups.map((g) => g.p))
  groups.forEach((g, i) => (g.pAdj = gAdj[i]))

  // Moderators: continuous demographics, or categorical ones with exactly two groups to compare.
  const asColumn = (d: Demographic): Column | null => {
    if (d.kind === 'continua') return { id: d.id, label: d.label, kind: 'z', values: f.numeric(d.column) }
    const dm = dummyOf(f, d)
    return dm ? { id: d.id, label: dm.label, kind: 'dummy', values: dm.values } : null
  }
  const moderatorCols = DEMOGRAPHICS.filter((d) => f.has(d.column))
    .map(asColumn)
    .filter((c): c is Column => !!c)

  // Regression: one topic's main score(s) predicting the other's, controlling for the chosen demographics
  // (continuous ones standardized, two-group ones as 0/1). One regression per outcome score.
  const regressions: Regression[] = []
  if (pair.length === 2) {
    const outC = opts.outcome && pair.includes(opts.outcome) ? opts.outcome : pair[1]
    const predC = pair.find((c) => c !== outC)!
    const outcomes = analysedKeys(outC).map((k) => byId.get(k.id)!).filter((s) => s.key.primary)
    const preds: Column[] = [
      ...analysedKeys(predC)
        .map((k) => byId.get(k.id)!)
        .filter((s) => s.key.primary)
        .map((s): Column => ({ id: s.key.id, label: s.key.label, kind: 'z', values: prep(s.values) })),
      ...demos.map(asColumn).filter((c): c is Column => !!c)
    ]
    const skipped = catDemos.filter((d) => !dummyOf(f, d))
    if (skipped.length) notes.push(`Regresión: ${skipped.map((d) => d.label).join(', ')} tiene(n) más de dos grupos y no entra como predictor (sí en las comparaciones por grupo).`)
    const moderator = opts.moderator ? (moderatorCols.find((c) => c.id === opts.moderator) ?? null) : null
    for (const o of outcomes) {
      const r = regress({ id: o.key.id, label: o.key.label, values: prep(o.values) }, preds, moderator)
      if (r) regressions.push({ ...r, pAdj: r.p })
    }
    const rAdj = bonferroni(regressions.map((r) => r.p))
    regressions.forEach((r, i) => (r.pAdj = rAdj[i]))
    for (const r of regressions) {
      const highVif = r.coefs.filter((c) => (c.vif ?? 0) >= 5).length
      if (highVif) notes.push(`Regresión sobre ${r.outcome.label}: ${highVif} predictor(es) con VIF ≥ 5 (multicolinealidad).`)
      if (Math.abs(r.residuals.skewness) > 1) notes.push(`Regresión sobre ${r.outcome.label}: los residuos no se distribuyen normalmente (asimetría ${fmtNum(r.residuals.skewness)}); mencionalo como limitación o consultá con tu tutor.`)
    }
  }

  if (f.unknown.size) notes.unshift(`Respuestas con etiquetas que no se reconocieron (quedan como faltantes): ${[...f.unknown].slice(0, 6).join('; ')}${f.unknown.size > 6 ? '…' : ''}. Usá la exportación «Sin etiquetas» o avisá para agregarlas.`)
  if (pair.length !== 2) notes.unshift('Elegí tus 2 temas en el marco de investigación: mientras tanto se muestran las 5 escalas.')
  return {
    n: f.rows.length,
    total: data.rows.length,
    excluded: f.excluded,
    speeders: f.speeders,
    noBoss: f.noBoss,
    pair,
    sample: sampleOf(f),
    scores,
    reliability,
    descriptives,
    correlations,
    relationships,
    pairs,
    comparison,
    groups,
    regressions,
    moderators: moderatorCols.map(({ id, label }) => ({ id, label })),
    notes: [...new Set(notes)]
  }
}

function paired(a: Num[], b: Num[]): [number[], number[]] {
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < a.length; i++) {
    const u = a[i]
    const v = b[i]
    if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) x.push(u), y.push(v)
  }
  return [x, y]
}

/** "= .034" or "< .001", for running text. */
export const pRel = (p: number) => (p < 0.001 ? '< .001' : `= ${fmtP(p)}`)

export const constructLabel = (c: ConstructId) => CONSTRUCTS[c].label
export { KEY_BY_ID, apaCorr }

// A self-contained statistics layer for the thesis analyses: distributions,
// descriptives, reliability, correlation, group comparisons, OLS regression and
// APA formatting. No imports, no state — every function is pure.
//
// Missing values are null, undefined or NaN. Single-sample functions drop them,
// paired functions (correlations, regression) drop the whole case: pairwise for
// a pair of variables, listwise for a matrix or a model.

/** A variable's values, with missing cases as null, undefined or NaN. */
export type Nums = (number | null | undefined)[]

// ---------------------------------------------------------------- helpers

/** Finite values only, in order. */
function clean(xs: Nums): number[] {
  const out: number[] = []
  for (const v of xs) if (v != null && Number.isFinite(v)) out.push(v as number)
  return out
}

function isNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

/** Cases where both variables are present. */
function pair(x: Nums, y: Nums): [number[], number[]] {
  const a: number[] = []
  const b: number[] = []
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    if (isNum(x[i]) && isNum(y[i])) {
      a.push(x[i] as number)
      b.push(y[i] as number)
    }
  }
  return [a, b]
}

function sum(xs: number[]): number {
  let s = 0
  for (const v of xs) s += v
  return s
}

/** Ranks from 1, ties sharing their average rank. */
function rankOf(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const r = new Array<number>(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k]] = avg
    i = j + 1
  }
  return r
}

/** Sizes of the tied groups (only groups larger than one). */
function tieSizes(xs: number[]): number[] {
  const s = [...xs].sort((a, b) => a - b)
  const out: number[] = []
  let i = 0
  while (i < s.length) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[i]) j++
    if (j > i) out.push(j - i + 1)
    i = j + 1
  }
  return out
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7
]

/** log Γ(x) for x > 0 (Lanczos). */
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const z = x - 1
  let a = LANCZOS[0]
  const t = z + 7.5
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Continued fraction for the incomplete beta (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const EPS = 3e-16
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(a: number, b: number, x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0
  if (x >= 1) return 1
  const lbt =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x)
  const bt = Math.exp(lbt)
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

function gammaSer(a: number, x: number): number {
  let ap = a
  let del = 1 / a
  let s = del
  for (let i = 0; i < 500; i++) {
    ap += 1
    del *= x / ap
    s += del
    if (Math.abs(del) < Math.abs(s) * 1e-16) break
  }
  return s * Math.exp(-x + a * Math.log(x) - logGamma(a))
}

function gammaCf(a: number, x: number): number {
  const FPMIN = 1e-300
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaInc(a: number, x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0
  return x < a + 1 ? gammaSer(a, x) : 1 - gammaCf(a, x)
}

// ---------------------------------------------------------------- distributions

/** Standard normal cumulative probability. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0
  const g = gammaInc(0.5, (z * z) / 2)
  return z >= 0 ? 0.5 * (1 + g) : 0.5 * (1 - g)
}

/** Student's t cumulative probability. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return NaN
  const p = 0.5 * betaInc(df / 2, 0.5, df / (df + t * t))
  return t >= 0 ? 1 - p : p
}

/** F cumulative probability. */
export function fCdf(f: number, d1: number, d2: number): number {
  if (!Number.isFinite(f) || f <= 0) return 0
  if (!(d1 > 0) || !(d2 > 0)) return NaN
  return betaInc(d1 / 2, d2 / 2, (d1 * f) / (d1 * f + d2))
}

/** Chi-square cumulative probability with k degrees of freedom. */
export function chiSqCdf(x: number, k: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0
  if (!(k > 0)) return NaN
  return gammaInc(k / 2, x / 2)
}

/** p value for a t statistic (two-tailed by default). */
export function pFromT(t: number, df: number, tails: 1 | 2 = 2): number {
  if (!Number.isFinite(t) || !(df > 0)) return NaN
  if (tails === 1) return 1 - tCdf(t, df)
  return 2 * (1 - tCdf(Math.abs(t), df))
}

/** p value for an F statistic (upper tail). */
export function pFromF(f: number, d1: number, d2: number): number {
  if (!Number.isFinite(f) || !(d1 > 0) || !(d2 > 0)) return NaN
  return 1 - fCdf(f, d1, d2)
}

/** p value for a chi-square statistic (upper tail). */
export function pFromChiSq(x: number, k: number): number {
  if (!Number.isFinite(x) || !(k > 0)) return NaN
  return 1 - chiSqCdf(x, k)
}

/** p value for a z statistic (two-tailed by default). */
export function pFromZ(z: number, tails: 1 | 2 = 2): number {
  if (!Number.isFinite(z)) return NaN
  if (tails === 1) return 1 - normalCdf(z)
  return 2 * (1 - normalCdf(Math.abs(z)))
}

// ---------------------------------------------------------------- descriptives

/** Arithmetic mean of the present values. */
export function mean(xs: Nums): number {
  const v = clean(xs)
  return v.length ? sum(v) / v.length : NaN
}

/** Sample variance (n − 1). */
export function variance(xs: Nums): number {
  const v = clean(xs)
  if (v.length < 2) return NaN
  const m = sum(v) / v.length
  let s = 0
  for (const x of v) s += (x - m) * (x - m)
  return s / (v.length - 1)
}

/** Sample standard deviation (n − 1). */
export function sd(xs: Nums): number {
  return Math.sqrt(variance(xs))
}

/** Quantile by linear interpolation between order statistics. */
export function quantile(xs: Nums, q: number): number {
  const v = clean(xs).sort((a, b) => a - b)
  if (!v.length || !(q >= 0) || !(q <= 1)) return NaN
  const h = (v.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return v[lo] + (h - lo) * (v[hi] - v[lo])
}

/** Median of the present values. */
export function median(xs: Nums): number {
  return quantile(xs, 0.5)
}

export interface Describe {
  n: number
  min: number
  max: number
  range: number
  mean: number
  sd: number
  /** Sample-adjusted G1, as SPSS reports it. */
  skewness: number
  /** Sample-adjusted excess kurtosis G2, as SPSS reports it. */
  kurtosis: number
}

/** n, min, max, range, mean, sd and sample-adjusted skewness/kurtosis. */
export function describe(xs: Nums): Describe {
  const v = clean(xs)
  const n = v.length
  if (!n) {
    return { n: 0, min: NaN, max: NaN, range: NaN, mean: NaN, sd: NaN, skewness: NaN, kurtosis: NaN }
  }
  const m = sum(v) / n
  let s2 = 0
  let m3 = 0
  let m4 = 0
  let min = Infinity
  let max = -Infinity
  for (const x of v) {
    const d = x - m
    s2 += d * d
    m3 += d * d * d
    m4 += d * d * d * d
    if (x < min) min = x
    if (x > max) max = x
  }
  const s = n > 1 ? Math.sqrt(s2 / (n - 1)) : NaN
  let skewness = NaN
  let kurtosis = NaN
  if (n > 2 && s > 0) {
    skewness = (n / ((n - 1) * (n - 2))) * (m3 / (s * s * s))
  }
  if (n > 3 && s > 0) {
    const g2 = m4 / (s * s * s * s)
    kurtosis =
      ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * g2 -
      (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3))
  }
  return { n, min, max, range: max - min, mean: m, sd: s, skewness, kurtosis }
}

/** Standardized values, NaN where the case is missing. */
export function zScores(xs: Nums): number[] {
  const m = mean(xs)
  const s = sd(xs)
  return xs.map((v) => (isNum(v) && s > 0 ? (v - m) / s : NaN))
}

/** Indices whose standardized value exceeds k in absolute size. */
export function outliers(xs: Nums, k = 3): number[] {
  const z = zScores(xs)
  const out: number[] = []
  for (let i = 0; i < z.length; i++) if (Number.isFinite(z[i]) && Math.abs(z[i]) > k) out.push(i)
  return out
}

/** Values clamped to mean ± k·sd, NaN where the case is missing. */
export function winsorize(xs: Nums, k = 3): number[] {
  const m = mean(xs)
  const s = sd(xs)
  if (!(s > 0)) return xs.map((v) => (isNum(v) ? v : NaN))
  const lo = m - k * s
  const hi = m + k * s
  return xs.map((v) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : NaN))
}

// ---------------------------------------------------------------- reliability

export interface Alpha {
  alpha: number
  /** Cases kept after listwise deletion. */
  n: number
  /** Number of items. */
  k: number
  /** Alpha with each item removed. */
  ifDeleted: number[]
  /** Corrected item-total correlation per item. */
  itemTotal: number[]
}

/** Cronbach's alpha over a rows × items matrix, listwise deletion. */
export function cronbachAlpha(items: (number | null | undefined)[][]): Alpha {
  const k = items.length ? Math.max(...items.map((r) => r.length)) : 0
  const rows = items.filter((r) => r.length === k && r.every(isNum)) as number[][]
  const n = rows.length
  const empty: Alpha = { alpha: NaN, n, k, ifDeleted: new Array(k).fill(NaN), itemTotal: new Array(k).fill(NaN) }
  if (k < 2 || n < 2) return empty
  const cols: number[][] = []
  for (let j = 0; j < k; j++) cols.push(rows.map((r) => r[j]))
  const raw = (keep: number[]) => {
    const kk = keep.length
    if (kk < 2) return NaN
    const totals = rows.map((r) => sum(keep.map((j) => r[j])))
    const vItems = sum(keep.map((j) => variance(cols[j])))
    const vTotal = variance(totals)
    if (!(vTotal > 0)) return NaN
    return (kk / (kk - 1)) * (1 - vItems / vTotal)
  }
  const all = cols.map((_, j) => j)
  const ifDeleted = all.map((j) => raw(all.filter((o) => o !== j)))
  const itemTotal = all.map((j) => {
    const rest = rows.map((r) => sum(all.filter((o) => o !== j).map((o) => r[o])))
    return pearson(cols[j], rest).r
  })
  return { alpha: raw(all), n, k, ifDeleted, itemTotal }
}

// ---------------------------------------------------------------- correlation

export interface Corr {
  /** Pearson r, or Spearman's rho when it comes from spearman(). */
  r: number
  n: number
  df: number
  t: number
  p: number
}

/** Pearson correlation with its t test, pairwise deletion. */
export function pearson(x: Nums, y: Nums): Corr {
  const [a, b] = pair(x, y)
  const n = a.length
  if (n < 3) return { r: NaN, n, df: Math.max(0, n - 2), t: NaN, p: NaN }
  const ma = sum(a) / n
  const mb = sum(b) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  const denom = Math.sqrt(saa * sbb)
  if (!(denom > 0)) return { r: NaN, n, df: n - 2, t: NaN, p: NaN }
  const r = Math.max(-1, Math.min(1, sab / denom))
  const df = n - 2
  const t = r * Math.sqrt(df / Math.max(1e-300, 1 - r * r))
  return { r, n, df, t, p: pFromT(t, df) }
}

/** Spearman's rho (average ranks for ties); `r` holds rho. */
export function spearman(x: Nums, y: Nums): Corr {
  const [a, b] = pair(x, y)
  if (a.length < 3) return { r: NaN, n: a.length, df: Math.max(0, a.length - 2), t: NaN, p: NaN }
  return pearson(rankOf(a), rankOf(b))
}

export interface CorrMatrix {
  names: string[]
  r: number[][]
  p: number[][]
  n: number[][]
}

/** Pairwise correlation matrix with p values and case counts. */
export function correlationMatrix(
  vars: Record<string, Nums>,
  method: 'pearson' | 'spearman' = 'pearson'
): CorrMatrix {
  const names = Object.keys(vars)
  const fn = method === 'spearman' ? spearman : pearson
  const r = names.map(() => new Array<number>(names.length).fill(NaN))
  const p = names.map(() => new Array<number>(names.length).fill(NaN))
  const n = names.map(() => new Array<number>(names.length).fill(0))
  for (let i = 0; i < names.length; i++) {
    r[i][i] = 1
    p[i][i] = 0
    n[i][i] = clean(vars[names[i]]).length
    for (let j = i + 1; j < names.length; j++) {
      const res = fn(vars[names[i]], vars[names[j]])
      r[i][j] = r[j][i] = res.r
      p[i][j] = p[j][i] = res.p
      n[i][j] = n[j][i] = res.n
    }
  }
  return { names, r, p, n }
}

// ---------------------------------------------------------------- group tests

export interface TTest {
  t: number
  df: number
  p: number
  meanA: number
  meanB: number
  sdA: number
  sdB: number
  nA: number
  nB: number
  /** Cohen's d on the pooled standard deviation. */
  d: number
}

function tTest(a: Nums, b: Nums, welch: boolean): TTest {
  const x = clean(a)
  const y = clean(b)
  const nA = x.length
  const nB = y.length
  const meanA = mean(x)
  const meanB = mean(y)
  const vA = variance(x)
  const vB = variance(y)
  const sdA = Math.sqrt(vA)
  const sdB = Math.sqrt(vB)
  const base = { meanA, meanB, sdA, sdB, nA, nB }
  if (nA < 2 || nB < 2) return { ...base, t: NaN, df: NaN, p: NaN, d: NaN }
  const pooled = ((nA - 1) * vA + (nB - 1) * vB) / (nA + nB - 2)
  const d = pooled > 0 ? (meanA - meanB) / Math.sqrt(pooled) : NaN
  let t: number
  let df: number
  if (welch) {
    const sa = vA / nA
    const sb = vB / nB
    const se = Math.sqrt(sa + sb)
    t = (meanA - meanB) / se
    df = (sa + sb) ** 2 / (sa ** 2 / (nA - 1) + sb ** 2 / (nB - 1))
  } else {
    df = nA + nB - 2
    t = (meanA - meanB) / Math.sqrt(pooled * (1 / nA + 1 / nB))
  }
  return { ...base, t, df, p: pFromT(t, df), d }
}

/** Welch's t test (unequal variances) with Cohen's d. */
export function welchT(a: Nums, b: Nums): TTest {
  return tTest(a, b, true)
}

/** Student's t test (equal variances assumed) with Cohen's d. */
export function studentT(a: Nums, b: Nums): TTest {
  return tTest(a, b, false)
}

export interface MannWhitney {
  /** U for the first group. */
  U: number
  z: number
  p: number
  nA: number
  nB: number
  /** Effect size |z| / √N. */
  r: number
}

/** Mann-Whitney U, normal approximation with tie correction. */
export function mannWhitney(a: Nums, b: Nums): MannWhitney {
  const x = clean(a)
  const y = clean(b)
  const nA = x.length
  const nB = y.length
  if (!nA || !nB) return { U: NaN, z: NaN, p: NaN, nA, nB, r: NaN }
  const all = [...x, ...y]
  const N = nA + nB
  const rk = rankOf(all)
  let rA = 0
  for (let i = 0; i < nA; i++) rA += rk[i]
  const U = rA - (nA * (nA + 1)) / 2
  const mu = (nA * nB) / 2
  const ties = tieSizes(all).reduce((s, t) => s + (t * t * t - t), 0)
  const sigma = Math.sqrt(((nA * nB) / 12) * (N + 1 - ties / (N * (N - 1))))
  const z = sigma > 0 ? (U - mu) / sigma : NaN
  return { U, z, p: pFromZ(z), nA, nB, r: Math.abs(z) / Math.sqrt(N) }
}

export interface Anova {
  F: number
  df1: number
  df2: number
  p: number
  /** SS between / SS total. */
  eta2: number
}

/** One-way ANOVA across independent groups. */
export function anovaOneWay(groups: Nums[]): Anova {
  const gs = groups.map(clean).filter((g) => g.length > 0)
  const k = gs.length
  const N = gs.reduce((s, g) => s + g.length, 0)
  if (k < 2 || N <= k) return { F: NaN, df1: NaN, df2: NaN, p: NaN, eta2: NaN }
  const grand = gs.reduce((s, g) => s + sum(g), 0) / N
  let ssb = 0
  let ssw = 0
  for (const g of gs) {
    const m = sum(g) / g.length
    ssb += g.length * (m - grand) ** 2
    for (const v of g) ssw += (v - m) ** 2
  }
  const df1 = k - 1
  const df2 = N - k
  const F = ssw > 0 ? ssb / df1 / (ssw / df2) : NaN
  return { F, df1, df2, p: pFromF(F, df1, df2), eta2: ssb / (ssb + ssw) }
}

export interface Kruskal {
  H: number
  df: number
  p: number
  /** H / (N − 1). */
  epsilon2: number
}

/** Kruskal-Wallis H with tie correction. */
export function kruskalWallis(groups: Nums[]): Kruskal {
  const gs = groups.map(clean).filter((g) => g.length > 0)
  const k = gs.length
  const N = gs.reduce((s, g) => s + g.length, 0)
  if (k < 2 || N < 3) return { H: NaN, df: NaN, p: NaN, epsilon2: NaN }
  const all = gs.flat()
  const rk = rankOf(all)
  let at = 0
  let h = 0
  for (const g of gs) {
    let r = 0
    for (let i = 0; i < g.length; i++) r += rk[at + i]
    at += g.length
    h += (r * r) / g.length
  }
  let H = (12 / (N * (N + 1))) * h - 3 * (N + 1)
  const ties = tieSizes(all).reduce((s, t) => s + (t * t * t - t), 0)
  const corr = 1 - ties / (N * N * N - N)
  if (corr > 0) H /= corr
  const df = k - 1
  return { H, df, p: pFromChiSq(H, df), epsilon2: H / (N - 1) }
}

/** One-tailed p from a two-tailed one: halved when the effect goes the hypothesized way, 1 − p/2 otherwise. */
export function oneTailed(p: number, observed: number, expected: '+' | '-'): number {
  if (!Number.isFinite(p) || !Number.isFinite(observed)) return NaN
  return (observed >= 0) === (expected === '+') ? p / 2 : 1 - p / 2
}

export interface CorrDiff {
  z: number
  /** Two-tailed. */
  p: number
  /** One-tailed, in the direction observed. */
  p1: number
}

/**
 * Difference between two correlation coefficients with Fisher's r-to-z
 * (independent samples, as VassarStats' rdiff calculator the course points to).
 */
export function compareCorrelations(r1: number, n1: number, r2: number, n2: number): CorrDiff {
  if (![r1, r2].every(Number.isFinite) || n1 < 4 || n2 < 4) return { z: NaN, p: NaN, p1: NaN }
  const fz = (r: number) => Math.atanh(Math.max(-0.999999, Math.min(0.999999, r)))
  const z = (fz(r1) - fz(r2)) / Math.sqrt(1 / (n1 - 3) + 1 / (n2 - 3))
  return { z, p: pFromZ(z), p1: pFromZ(Math.abs(z), 1) }
}

/** Partial correlation of a regression predictor with the outcome, from its t and the residual df. */
export function partialR(t: number, df: number): number {
  return Number.isFinite(t) && df > 0 ? t / Math.sqrt(t * t + df) : NaN
}

/** Standard normal quantile (Acklam's rational approximation, |error| < 1.2e-9 after one refinement). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  let x: number
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else {
    const q = p - 0.5
    const r = q * q
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  // One Newton step against the exact CDF.
  const e = normalCdf(x) - p
  return x - e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
}

// ---------------------------------------------------------------- multiplicity

/** Bonferroni-adjusted p values, capped at 1. */
export function bonferroni(ps: number[]): number[] {
  const m = ps.length
  return ps.map((p) => (Number.isFinite(p) ? Math.min(1, p * m) : NaN))
}

/** Benjamini-Hochberg FDR-adjusted p values, monotone and capped at 1. */
export function fdrBH(ps: number[]): number[] {
  const m = ps.length
  const order = ps.map((_, i) => i).filter((i) => Number.isFinite(ps[i]))
  order.sort((a, b) => ps[a] - ps[b])
  const out = new Array<number>(m).fill(NaN)
  let prev = 1
  for (let k = order.length; k >= 1; k--) {
    const i = order[k - 1]
    prev = Math.min(prev, (order.length / k) * ps[i])
    out[i] = Math.min(1, prev)
  }
  return out
}

// ---------------------------------------------------------------- linear algebra

/** Inverse of a square matrix by Gauss-Jordan with partial pivoting, or null if singular. */
export function invert(m: number[][]): number[][] | null {
  const n = m.length
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r
    if (Math.abs(a[piv][col]) < 1e-12) return null
    if (piv !== col) {
      const tmp = a[piv]
      a[piv] = a[col]
      a[col] = tmp
    }
    const d = a[col][col]
    for (let j = 0; j < 2 * n; j++) a[col][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = a[r][col]
      if (f === 0) continue
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j]
    }
  }
  return a.map((row) => row.slice(n))
}

// ---------------------------------------------------------------- regression

export interface Coef {
  name: string
  b: number
  se: number
  t: number
  p: number
  /** Standardized coefficient b · sd(x) / sd(y); NaN for the intercept. */
  beta: number
}

export interface Ols {
  n: number
  /** Number of predictors, intercept excluded. */
  k: number
  coefs: Coef[]
  r2: number
  adjR2: number
  F: number
  df1: number
  df2: number
  p: number
  /** Variance inflation per predictor, intercept excluded. */
  vif: number[]
}

const NO_OLS: Ols = {
  n: 0, k: 0, coefs: [], r2: NaN, adjR2: NaN, F: NaN, df1: NaN, df2: NaN, p: NaN, vif: []
}

function fit(y: number[], cols: number[][]): { b: number[]; xtxInv: number[][]; r2: number } | null {
  const n = y.length
  const p = cols.length + 1
  const design = y.map((_, i) => [1, ...cols.map((c) => c[i])])
  const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  const xty = new Array<number>(p).fill(0)
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      xty[a] += design[i][a] * y[i]
      for (let b = a; b < p; b++) xtx[a][b] += design[i][a] * design[i][b]
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a]
  const xtxInv = invert(xtx)
  if (!xtxInv) return null
  const b = xtxInv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0))
  const my = sum(y) / n
  let sse = 0
  let sst = 0
  for (let i = 0; i < n; i++) {
    const fitted = design[i].reduce((s, v, j) => s + v * b[j], 0)
    sse += (y[i] - fitted) ** 2
    sst += (y[i] - my) ** 2
  }
  return { b, xtxInv, r2: sst > 0 ? 1 - sse / sst : NaN }
}

/** OLS regression with an internal intercept, listwise deletion; X is rows × predictors. */
export function ols(y: Nums, X: Nums[], names?: string[]): Ols {
  const k = X.length ? Math.max(...X.map((r) => r.length)) : 0
  if (!k || !y.length) return NO_OLS
  const keep: number[] = []
  for (let i = 0; i < Math.min(y.length, X.length); i++) {
    if (isNum(y[i]) && X[i] && X[i].length === k && X[i].every(isNum)) keep.push(i)
  }
  const yv = keep.map((i) => y[i] as number)
  const cols: number[][] = []
  for (let j = 0; j < k; j++) cols.push(keep.map((i) => X[i][j] as number))
  const n = yv.length
  const labels = Array.from({ length: k }, (_, j) => names?.[j] ?? `x${j + 1}`)
  if (n < k + 2) return { ...NO_OLS, n, k }
  const res = fit(yv, cols)
  if (!res) return { ...NO_OLS, n, k }
  const { b, xtxInv, r2 } = res
  const df1 = k
  const df2 = n - k - 1
  const my = sum(yv) / n
  let sst = 0
  for (const v of yv) sst += (v - my) ** 2
  const sse = sst * (1 - r2)
  const mse = sse / df2
  const sdy = sd(yv)
  const coefs: Coef[] = b.map((bj, j) => {
    const se = Math.sqrt(Math.max(0, mse * xtxInv[j][j]))
    const t = se > 0 ? bj / se : NaN
    const beta = j === 0 ? NaN : (bj * sd(cols[j - 1])) / sdy
    return { name: j === 0 ? 'Intercept' : labels[j - 1], b: bj, se, t, p: pFromT(t, df2), beta }
  })
  const F = r2 < 1 ? r2 / df1 / ((1 - r2) / df2) : Infinity
  const vif = cols.map((_, j) => {
    if (k < 2) return 1
    const others = cols.filter((_, o) => o !== j)
    const r = fit(cols[j], others)
    return r && r.r2 < 1 ? 1 / (1 - r.r2) : Infinity
  })
  return {
    n,
    k,
    coefs,
    r2,
    adjR2: 1 - (1 - r2) * ((n - 1) / df2),
    F,
    df1,
    df2,
    p: pFromF(F, df1, df2),
    vif
  }
}

// ---------------------------------------------------------------- APA formatting

/** Strip the leading zero of a formatted decimal, keeping any sign. */
function noLead(s: string): string {
  return s.replace(/^(-?)0\./, '$1.')
}

/** A p value as APA prints it: "< .001" or ".034". */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p < 0.001) return '< .001'
  if (p > 0.9995) return '1.000'
  return noLead(p.toFixed(3))
}

/** A correlation as APA prints it: two decimals, no leading zero. */
export function fmtR(r: number): string {
  if (!Number.isFinite(r)) return '—'
  if (Math.abs(r) >= 0.995) return (r < 0 ? '-' : '') + '1.00'
  return noLead(r.toFixed(2))
}

/** A plain number with its leading zero kept. */
export function fmtNum(x: number, d = 2): string {
  return Number.isFinite(x) ? x.toFixed(d) : '—'
}

function pClause(p: number): string {
  const s = fmtP(p)
  return s.startsWith('<') ? `p ${s}` : `p = ${s}`
}

function fmtDf(df: number): string {
  if (!Number.isFinite(df)) return '—'
  return Number.isInteger(df) ? String(df) : df.toFixed(2)
}

/** e.g. "r(248) = .31, p < .001". */
export function apaCorr(res: Corr, symbol = 'r'): string {
  return `${symbol}(${fmtDf(res.df)}) = ${fmtR(res.r)}, ${pClause(res.p)}`
}

/** e.g. "t(38.21) = 2.14, p = .039, d = 0.52". */
export function apaT(res: TTest): string {
  return `t(${fmtDf(res.df)}) = ${fmtNum(res.t)}, ${pClause(res.p)}, d = ${fmtNum(res.d)}`
}

/** e.g. "U = 42, z = -2.14, p = .032, r = .31". */
export function apaU(res: MannWhitney): string {
  const u = Number.isInteger(res.U) ? String(res.U) : fmtNum(res.U, 1)
  return `U = ${u}, z = ${fmtNum(res.z)}, ${pClause(res.p)}, r = ${fmtR(res.r)}`
}

/** e.g. "F(2, 247) = 5.12, p = .007, η² = .04". */
export function apaF(res: { F: number; df1: number; df2: number; p: number; eta2?: number }): string {
  const base = `F(${fmtDf(res.df1)}, ${fmtDf(res.df2)}) = ${fmtNum(res.F)}, ${pClause(res.p)}`
  return res.eta2 != null && Number.isFinite(res.eta2) ? `${base}, η² = ${fmtR(res.eta2)}` : base
}

/** e.g. "H(2) = 7.41, p = .025, ε² = .09". */
export function apaH(res: Kruskal): string {
  return `H(${fmtDf(res.df)}) = ${fmtNum(res.H)}, ${pClause(res.p)}, ε² = ${fmtR(res.epsilon2)}`
}

// Reference values come from scipy/numpy (scipy 1.15.3, Python 3.10) computed
// independently of this implementation; the BH values match statsmodels'
// multipletests(method='fdr_bh').

import { describe as suite, expect, it } from 'vitest'

import {
  anovaOneWay,
  apaCorr,
  apaF,
  apaT,
  apaU,
  bonferroni,
  chiSqCdf,
  correlationMatrix,
  cronbachAlpha,
  describe,
  fCdf,
  fdrBH,
  fmtNum,
  fmtP,
  fmtR,
  invert,
  kruskalWallis,
  mannWhitney,
  median,
  normalCdf,
  ols,
  outliers,
  pFromF,
  pFromT,
  pearson,
  quantile,
  sd,
  spearman,
  studentT,
  tCdf,
  variance,
  welchT,
  winsorize,
  zScores
} from './stats'

const TOL = 1e-4
const close = (a: number, b: number, tol = TOL) => expect(Math.abs(a - b)).toBeLessThan(tol)

const A = [2.3, 4.1, 3.3, 5.8, 1.9, 4.4, 3.1, 6.2, 2.8, 5.1, 3.9, 4.7]
const B = [3.9, 2.2, 5.5, 4.8, 3.1, 6.0, 2.7, 4.2, 5.3, 3.6]
const SKEWED = [1, 1, 1, 2, 2, 3, 3, 4, 5, 7, 9, 14, 21]
const X = [5, 3, 4, 4, 7, 2, 6, 5, 3, 8, 6, 4, 7, 5, 2]
const Y = [4.2, 2.8, 3.9, 4.4, 6.1, 2.1, 5.5, 4.0, 3.2, 7.4, 5.0, 3.5, 6.6, 4.8, 1.9]
const MA = [3, 5, 4, 7, 3, 6, 5, 8, 4, 6, 7, 5]
const MB = [2, 4, 3, 5, 2, 6, 3, 4, 5, 3]
const G1 = [4.1, 3.8, 5.2, 4.6, 3.9, 4.8, 5.0]
const G2 = [3.1, 2.8, 3.6, 3.0, 2.5, 3.3, 2.9, 3.4]
const G3 = [5.4, 6.1, 5.0, 5.8, 6.4, 5.6]

const ITEMS = [
  [5, 4, 5, 4, 5],
  [3, 3, 4, 3, 3],
  [4, 4, 4, 5, 4],
  [2, 1, 2, 2, 3],
  [5, 5, 5, 4, 4],
  [3, 4, 3, 3, 2],
  [4, 3, 4, 4, 5],
  [1, 2, 1, 2, 1],
  [5, 4, 4, 5, 5],
  [2, 3, 3, 2, 2],
  [4, 5, 4, 4, 3],
  [3, 2, 3, 4, 4],
  [5, 5, 4, 4, 5],
  [2, 2, 3, 3, 2]
]

const OLS_X = [
  [5.0, 5.6, 4.45], [3.22, 4.09, 3.02], [5.12, 7.68, 4.02], [3.76, 5.98, 5.71],
  [5.21, 3.14, 4.94], [6.39, 2.31, 4.08], [1.2, 2.42, 1.32], [4.53, 2.47, 5.54],
  [5.31, 4.63, -0.03], [3.92, 4.9, 5.23], [1.94, 4.04, 3.04], [3.38, 7.12, 3.38],
  [4.93, 6.77, 3.83], [4.78, 5.22, 5.13], [2.55, 5.15, 7.72], [1.91, 6.72, 5.24],
  [3.72, 9.0, 6.52], [2.6, 5.15, 6.15], [4.62, 6.37, 4.87], [6.33, 7.88, 3.65]
]
const OLS_Y = [
  6.56, 4.07, 5.02, 3.8, 7.97, 10.13, 3.29, 9.52, 4.33, 4.96,
  3.56, 0.77, 4.74, 6.51, 6.06, 2.56, 2.82, 3.87, 5.24, 7.7
]

suite('distributions', () => {
  it('normalCdf matches scipy.norm.cdf', () => {
    const zs = [-3.5, -1.96, -0.5, 0, 1.2345, 2.5758, 4]
    const ref = [
      0.000232629079, 0.024997895148, 0.308537538726, 0.5, 0.891491676637,
      0.994999576262, 0.999968328758
    ]
    zs.forEach((z, i) => close(normalCdf(z), ref[i], 1e-10))
  })

  it('tCdf matches scipy.t.cdf, including fractional df', () => {
    const cases: [number, number][] = [[-2.5, 7], [0, 12], [1, 1], [2, 30], [3.1, 248], [1.7, 2.5]]
    const ref = [0.020496109293, 0.5, 0.75, 0.972687477519, 0.998920709637, 0.89719389142]
    cases.forEach(([t, df], i) => close(tCdf(t, df), ref[i], 1e-10))
  })

  it('fCdf matches scipy.f.cdf', () => {
    const cases: [number, number, number][] = [[1, 2, 10], [3.5, 3, 20], [0.25, 5, 5], [12, 1, 248]]
    const ref = [0.598122427984, 0.965506896115, 0.077188625242, 0.999373386643]
    cases.forEach(([f, d1, d2], i) => close(fCdf(f, d1, d2), ref[i], 1e-10))
  })

  it('chiSqCdf matches scipy.chi2.cdf', () => {
    const cases: [number, number][] = [[1, 1], [3.84, 1], [7.81, 3], [20, 10]]
    const ref = [0.682689492137, 0.949956478751, 0.94989394365, 0.970747311923]
    cases.forEach(([x, k], i) => close(chiSqCdf(x, k), ref[i], 1e-10))
  })

  it('pFromT and pFromF give tail probabilities', () => {
    close(pFromT(2.14, 38.21), 0.038800097345, 1e-10)
    close(pFromT(-2.14, 38.21), 0.038800097345, 1e-10)
    close(pFromT(2.14, 38, 1), 0.01941819603, 1e-10)
    close(pFromF(5.12, 2, 247), 0.006626265988, 1e-10)
  })
})

suite('descriptives', () => {
  it('describe reproduces mean, sd and SPSS skewness/kurtosis', () => {
    const d = describe(A)
    expect(d.n).toBe(12)
    close(d.min, 1.9)
    close(d.max, 6.2)
    close(d.range, 4.3)
    close(d.mean, 3.966666666667)
    close(d.sd, 1.347950183415)
    close(d.skewness, 0.14445376398)
    close(d.kurtosis, -0.848656231128)
  })

  it('describe handles a skewed, leptokurtic variable', () => {
    const d = describe(SKEWED)
    close(d.mean, 5.615384615385)
    close(d.sd, 5.965714005024)
    close(d.skewness, 1.782371993106)
    close(d.kurtosis, 2.919829809234)
  })

  it('drops missing values', () => {
    const withGaps = [...A, null, undefined, NaN]
    expect(describe(withGaps).n).toBe(12)
    close(mean0(withGaps), 3.966666666667)
    close(sd(withGaps), 1.347950183415)
    close(variance(withGaps), 1.347950183415 ** 2)
  })

  it('median and quantile interpolate linearly', () => {
    close(median(A), 4)
    close(quantile(A, 0.25), 3.025)
    close(quantile(A, 0.9), 5.73)
    close(quantile(A, 0), 1.9)
    close(quantile(A, 1), 6.2)
  })

  it('zScores, outliers and winsorize use mean ± k·sd', () => {
    const xs = [10, 10, 10, 10, 10, 10, 10, 10, 10, 60]
    const z = zScores(xs)
    close(z[0], (10 - 15) / sd(xs), 1e-9)
    expect(outliers(xs, 2)).toEqual([9])
    expect(outliers(xs, 3)).toEqual([])
    const w = winsorize(xs, 1)
    close(w[9], 15 + sd(xs), 1e-9)
    expect(zScores([1, null, 3])[1]).toBeNaN()
  })
})

suite('reliability', () => {
  it('cronbachAlpha matches the hand computation', () => {
    const a = cronbachAlpha(ITEMS)
    expect(a.n).toBe(14)
    expect(a.k).toBe(5)
    close(a.alpha, 0.932654586213)
    const refDel = [0.883654999455, 0.940872135994, 0.909899888765, 0.91888062345, 0.92818547991]
    refDel.forEach((v, j) => close(a.ifDeleted[j], v))
    const refIt = [0.982676244034, 0.699402333724, 0.871667827233, 0.829931656756, 0.773501761531]
    refIt.forEach((v, j) => close(a.itemTotal[j], v))
  })

  it('deletes incomplete cases listwise', () => {
    const a = cronbachAlpha([...ITEMS, [5, null, 4, 3, 2], [1, 1, 1, 1, NaN]])
    expect(a.n).toBe(14)
    close(a.alpha, 0.932654586213)
  })
})

suite('correlation', () => {
  it('pearson matches scipy.pearsonr', () => {
    const res = pearson(X, Y)
    expect(res.n).toBe(15)
    expect(res.df).toBe(13)
    close(res.r, 0.977223409664)
    close(res.p, 3.92e-10, 1e-12)
  })

  it('spearman averages ranks for ties', () => {
    const res = spearman(X, Y)
    close(res.r, 0.967565772702)
    close(res.t, 13.809748380285, 1e-6)
    close(res.p, 3.811e-9, 1e-11)
  })

  it('deletes pairs with a missing value', () => {
    const xg = [...X, 9, null]
    const yg = [...Y, null, 9]
    const res = pearson(xg, yg)
    expect(res.n).toBe(15)
    close(res.r, 0.977223409664)
  })

  it('correlationMatrix is symmetric with 1 on the diagonal', () => {
    const m = correlationMatrix({ x: X, y: Y, a: [...A, 1, 2, 3] }, 'pearson')
    expect(m.names).toEqual(['x', 'y', 'a'])
    expect(m.r[0][0]).toBe(1)
    close(m.r[0][1], 0.977223409664)
    close(m.r[1][0], 0.977223409664)
    close(m.p[0][1], 3.92e-10, 1e-12)
    expect(m.n[0][1]).toBe(15)
    expect(m.n[2][2]).toBe(15)
    const s = correlationMatrix({ x: X, y: Y }, 'spearman')
    close(s.r[0][1], 0.967565772702)
  })
})

suite('group comparisons', () => {
  it('welchT matches scipy.ttest_ind(equal_var=False)', () => {
    const res = welchT(A, B)
    close(res.t, -0.292892351934)
    close(res.df, 19.683271139094)
    close(res.p, 0.77266985307)
    close(res.d, -0.124635340172)
    expect(res.nA).toBe(12)
    expect(res.nB).toBe(10)
    close(res.meanA, 3.966666666667)
    close(res.sdA, 1.347950183415)
  })

  it('studentT matches scipy.ttest_ind(equal_var=True)', () => {
    const res = studentT(A, B)
    close(res.t, -0.291085442188)
    expect(res.df).toBe(20)
    close(res.p, 0.773983277548)
    close(res.d, -0.124635340172)
  })

  it('mannWhitney matches the tie-corrected normal approximation', () => {
    const res = mannWhitney(MA, MB)
    close(res.U, 92, 1e-9)
    close(res.z, 2.144190061634, 1e-6)
    close(res.p, 0.032017661077, 1e-6)
    expect(res.nA).toBe(12)
    expect(res.nB).toBe(10)
    close(res.r, 2.144190061634 / Math.sqrt(22), 1e-6)
  })

  it('anovaOneWay matches scipy.f_oneway', () => {
    const res = anovaOneWay([G1, G2, G3])
    close(res.F, 55.034768013428, 1e-6)
    expect(res.df1).toBe(2)
    expect(res.df2).toBe(18)
    close(res.p, 2.1401e-8, 1e-11)
    close(res.eta2, 0.859451353082)
  })

  it('kruskalWallis matches scipy.kruskal', () => {
    const res = kruskalWallis([G1, G2, G3])
    close(res.H, 17.250069618491, 1e-6)
    expect(res.df).toBe(2)
    close(res.p, 0.000179553955, 1e-8)
    close(res.epsilon2, 0.862503480925)
  })

  it('kruskalWallis corrects for heavy ties', () => {
    const res = kruskalWallis([[1, 2, 2, 3, 3, 3], [2, 3, 3, 4, 4, 5], [3, 4, 5, 5, 5, 5]])
    close(res.H, 9.128587196468, 1e-6)
    close(res.p, 0.010417235362, 1e-7)
  })
})

suite('multiplicity', () => {
  const PS = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216, 0.222, 0.44, 0.81]

  it('bonferroni multiplies and caps at 1', () => {
    const ref = [0.013, 0.104, 0.507, 0.533, 0.546, 0.78, 0.962, 1, 1, 1, 1, 1, 1]
    bonferroni(PS).forEach((v, i) => close(v, ref[i]))
  })

  it('fdrBH matches statsmodels fdr_bh and stays monotone', () => {
    const ref = [
      0.013, 0.052, 0.1092, 0.1092, 0.1092, 0.13, 0.137428571429, 0.262363636364,
      0.262363636364, 0.262363636364, 0.262363636364, 0.476666666667, 0.81
    ]
    const got = fdrBH(PS)
    got.forEach((v, i) => close(v, ref[i]))
    const sorted = [...got].sort((a, b) => a - b)
    expect(got).toEqual(sorted)
  })

  it('fdrBH keeps the original order and caps at 1', () => {
    const got = fdrBH([0.9, 0.001, 0.5])
    close(got[0], 0.9)
    close(got[1], 0.003)
    close(got[2], 0.75)
    expect(fdrBH([0.4, 0.5, 0.6]).every((v) => v <= 1)).toBe(true)
    close(fdrBH([0.4, 0.5, 0.6])[2], 0.6)
  })
})

suite('linear algebra and regression', () => {
  it('invert produces the identity and detects singularity', () => {
    const m = [[4, 7, 2], [3, 6, 1], [2, 5, 3]]
    const inv = invert(m)!
    expect(inv).not.toBeNull()
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const v = m[i].reduce((s, x, k) => s + x * inv[k][j], 0)
        close(v, i === j ? 1 : 0, 1e-9)
      }
    }
    expect(invert([[1, 2], [2, 4]])).toBeNull()
  })

  it('ols matches the numpy least-squares fit', () => {
    const res = ols(OLS_Y, OLS_X, ['a', 'b', 'c'])
    expect(res.n).toBe(20)
    expect(res.k).toBe(3)
    expect(res.coefs.map((c) => c.name)).toEqual(['Intercept', 'a', 'b', 'c'])
    const b = [2.116092490231, 1.234985796915, -0.786152725391, 0.52016762377]
    const se = [0.96251675978, 0.151095886299, 0.118933428109, 0.128052518217]
    const t = [2.198499370249, 8.173523629031, -6.61002325324, 4.062142869301]
    const p = [0.042971255496, 4.19323e-7, 5.997823e-6, 0.000905715372]
    res.coefs.forEach((c, i) => {
      close(c.b, b[i], 1e-6)
      close(c.se, se[i], 1e-6)
      close(c.t, t[i], 1e-5)
      close(c.p, p[i], 1e-7)
    })
    expect(res.coefs[0].beta).toBeNaN()
    const beta = [0.762562330926, -0.633813863229, 0.388609036502]
    beta.forEach((v, j) => close(res.coefs[j + 1].beta, v, 1e-6))
    close(res.r2, 0.863973384002, 1e-8)
    close(res.adjR2, 0.838468393503, 1e-8)
    close(res.F, 33.874679703095, 1e-6)
    expect(res.df1).toBe(3)
    expect(res.df2).toBe(16)
    close(res.p, 3.66895e-7, 1e-10)
    const vif = [1.023830681417, 1.081467773209, 1.076493697027]
    vif.forEach((v, j) => close(res.vif[j], v, 1e-8))
  })

  it('ols deletes cases listwise and defaults predictor names', () => {
    const y = [...OLS_Y, 5, null]
    const x = [...OLS_X, [1, null, 3], [1, 2, 3]]
    const res = ols(y, x)
    expect(res.n).toBe(20)
    close(res.r2, 0.863973384002, 1e-8)
    expect(res.coefs.map((c) => c.name)).toEqual(['Intercept', 'x1', 'x2', 'x3'])
  })

  it('ols reproduces a simple regression from the correlation', () => {
    const res = ols(Y, X.map((v) => [v]), ['x'])
    const r = pearson(X, Y).r
    close(res.r2, r * r, 1e-9)
    close(res.coefs[1].beta, r, 1e-9)
    close(res.coefs[1].t, pearson(X, Y).t, 1e-6)
    expect(res.vif).toEqual([1])
  })
})

suite('APA formatting', () => {
  it('formats p, r and plain numbers', () => {
    expect(fmtP(0.0004)).toBe('< .001')
    expect(fmtP(0.034)).toBe('.034')
    expect(fmtP(0.0345)).toBe('.035')
    expect(fmtP(0.5)).toBe('.500')
    expect(fmtP(1)).toBe('1.000')
    expect(fmtR(0.314)).toBe('.31')
    expect(fmtR(-0.314)).toBe('-.31')
    expect(fmtR(1)).toBe('1.00')
    expect(fmtNum(0.52)).toBe('0.52')
    expect(fmtNum(12.3456, 3)).toBe('12.346')
  })

  it('builds APA sentences', () => {
    expect(apaCorr({ r: 0.31, n: 250, df: 248, t: 5.1, p: 0.0004 })).toBe('r(248) = .31, p < .001')
    expect(apaCorr({ r: 0.31, n: 250, df: 248, t: 5.1, p: 0.021 })).toBe('r(248) = .31, p = .021')
    expect(apaT(welchT(A, B))).toBe('t(19.68) = -0.29, p = .773, d = -0.12')
    expect(apaU(mannWhitney(MA, MB))).toBe('U = 92, z = 2.14, p = .032, r = .46')
    expect(apaF({ F: 5.12, df1: 2, df2: 247, p: 0.0066, eta2: 0.04 })).toBe(
      'F(2, 247) = 5.12, p = .007, η² = .04'
    )
    expect(apaF({ F: 5.12, df1: 2, df2: 247, p: 0.0066 })).toBe('F(2, 247) = 5.12, p = .007')
  })
})

// Re-exported under a different name so the suite helper above can keep `describe`.
function mean0(xs: (number | null | undefined)[]): number {
  return describe(xs).mean
}

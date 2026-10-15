import { describe, expect, it } from 'vitest'
import type { Cell, ConstructId } from '@shared/types'
import { Frame, fromGrid } from './dataset'
import { EQ_ORIGINAL, KEY_BY_ID, itemScore } from './keys'
import { pairKey, runAnalysis, scoreAll } from './results'
import { compareCorrelations, normalQuantile, oneTailed, partialR } from './stats'
import { readCsv } from './xlsx'
import { APPROVAL, DEADLINE, DELIVERIES, nextDelivery } from '../research/framework'

const cols = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`)

/** A small Qualtrics-shaped grid: header, question-text row, then responses. */
function grid(rows: Record<string, Cell>[], labeled = false): Cell[][] {
  const header = ['Finished', 'Q2.2', 'Q2.3', ...cols('Q4.1', 29), ...cols('Q5.1', 8), ...cols('Q6.1', 16), ...cols('Q7.1', 15), ...['Q3.1', 'Q3.2', 'Q3.3', 'Q3.4'].flatMap((q) => cols(q, 9))]
  const text = header.map((h) => `Pregunta larga de la encuesta para la columna ${h}`)
  return [header, text, ...rows.map((r) => header.map((h) => r[h] ?? (labeled ? null : null)))]
}

describe('dataset', () => {
  it('skips the question-text row and keeps finished responses only', () => {
    const d = fromGrid(grid([{ Finished: 1 }, { Finished: 0 }, { Finished: 1 }]), 'x')
    expect(d.rows).toHaveLength(3)
    expect(d.questions[0]).toContain('Finished')
    const f = new Frame(d)
    expect(f.rows).toHaveLength(2)
    expect(f.excluded.unfinished).toBe(1)
  })

  it('undoes the numeric export quirks for age and leadership years', () => {
    const d = fromGrid(grid([{ Finished: 1, 'Q2.2': 1000 }, { Finished: 1, 'Q2.2': 974 }, { Finished: 1, 'Q2.2': 5 }]), 'x')
    expect(new Frame(d).numeric('Q2.2')).toEqual([44, 18, null])
  })

  it('reads the labelled export', () => {
    const d = fromGrid(grid([{ Finished: 'Verdadero', 'Q2.2': '44', 'Q2.3': 'Mujer', 'Q4.1_1': 'Totalmente acuerdo', 'Q6.1_1': 'La mayoría de las veces' }], true), 'x')
    const f = new Frame(d)
    expect(f.rows).toHaveLength(1)
    expect(f.numeric('Q2.2')).toEqual([44])
    expect(f.category('Q2.3')).toEqual(['Mujer'])
    expect(f.codes('Q4.1_1')).toEqual([4])
    expect(f.codes('Q6.1_1')).toEqual([4])
  })

  it('leaves out survey previews, refused consent and (when asked) speeders', () => {
    const header = ['Status', 'Duration (in seconds)', 'Finished', 'Q2_2', 'Q2_3', 'Q2.2', 'Q4.1_1']
    const text = header.map((h) => `Pregunta larga de la encuesta para la columna ${h}`)
    const labeled = fromGrid(
      [
        header,
        text,
        ['Vista previa de encuesta', 900, 'Verdadero', 'SI', 'SI', '40', 'Algo de acuerdo'],
        ['Dirección IP', 900, 'Verdadero', 'SI', 'NO', null, null],
        ['Dirección IP', 1000, 'Verdadero', 'SI', 'SI', '40', 'Algo de acuerdo'],
        ['Dirección IP', 1200, 'Verdadero', 'SI', 'SI', '41', 'Algo de acuerdo'],
        ['Dirección IP', 100, 'Verdadero', 'SI', 'SI', '42', 'Algo de acuerdo'],
        ['Dirección IP', 50, 'Falso', 'SI', 'SI', null, null]
      ],
      'x'
    )
    const f = new Frame(labeled)
    expect(f.rows).toHaveLength(3)
    expect(f.excluded).toEqual({ unfinished: 1, preview: 1, noConsent: 1, speeders: 0, noBoss: 0 })
    expect(f.speeders.count).toBe(1)
    const strict = new Frame(labeled, { dropSpeeders: true })
    expect(strict.rows).toHaveLength(2)
    expect(strict.excluded.speeders).toBe(1)
    // The numeric export: Status 1 = preview, consent 3 = SI and 4 = NO.
    const numeric = fromGrid([header, text, [1, 900, 1, 3, 3, 990, 3], [0, 900, 1, 3, 4, null, null], [0, 900, 1, 3, 3, 990, 3]], 'x')
    expect(new Frame(numeric).excluded).toEqual({ unfinished: 0, preview: 1, noConsent: 1, speeders: 0, noBoss: 0 })
  })

  it('leaves out owners and founders, who have no direct boss, only when asked', () => {
    const header = ['Finished', 'Q2.5', 'Q7.1_1']
    const text = header.map((h) => `Pregunta larga de la encuesta para la columna ${h}`)
    const numeric = fromGrid([header, text, [1, 7, 3], [1, 1, 4], [1, 4, 5], [0, 7, null]], 'x')
    const all = new Frame(numeric)
    expect(all.rows).toHaveLength(3)
    expect(all.noBoss).toBe(1)
    expect(all.excluded.noBoss).toBe(0)
    const bossed = new Frame(numeric, { dropNoBoss: true })
    expect(bossed.rows).toHaveLength(2)
    expect(bossed.excluded).toEqual({ unfinished: 1, preview: 0, noConsent: 0, speeders: 0, noBoss: 1 })
    // The labelled export writes the position as text.
    const labeled = fromGrid([header, text, ['Verdadero', 'Propietario / fundador', 'Algo de acuerdo'], ['Verdadero', 'Gerencia', 'Algo de acuerdo']], 'x')
    expect(new Frame(labeled, { dropNoBoss: true }).rows).toHaveLength(1)
  })

  it('maps numeric categories to their labels', () => {
    const f = new Frame(fromGrid(grid([{ Finished: 1, 'Q2.3': 2 }]), 'x'))
    expect(f.category('Q2.3')).toEqual(['Mujer'])
  })

  it('parses CSV with quotes and semicolons', () => {
    expect(readCsv('a;b\n"x;y";1,5\n')).toEqual([['a', 'b'], ['x;y', 1.5]])
  })
})

describe('scoring keys', () => {
  it('scores the EQ 0-1-2 with reverse items', () => {
    const eq = KEY_BY_ID['eq']
    expect(itemScore(4, eq, false)).toBe(2)
    expect(itemScore(3, eq, false)).toBe(1)
    expect(itemScore(2, eq, false)).toBe(0)
    expect(itemScore(1, eq, true)).toBe(2)
    expect(itemScore(2, eq, true)).toBe(1)
    expect(itemScore(4, eq, true)).toBe(0)
    // 12 reverse items: original 4, 8, 12, 14, 15, 21, 27, 32, 46, 48, 49, 50.
    expect(eq.reverse.map((i) => EQ_ORIGINAL[i - 1]).sort((a, b) => a - b)).toEqual([4, 8, 12, 14, 15, 21, 27, 32, 46, 48, 49, 50])
    expect(KEY_BY_ID['eq.cog'].reverse).toEqual([])
  })

  it('reverses ECR-RS avoidance items 1–4 and shifts HSA-TFL to 0–4', () => {
    expect(itemScore(7, KEY_BY_ID['ecr.avoid.mother'], true)).toBe(1)
    expect(itemScore(5, KEY_BY_ID['tfl'], false)).toBe(4)
    expect(itemScore(6, KEY_BY_ID['tfl'], false)).toBeNull()
  })

  it('averages ECR-RS over the relationships answered, and prorates missing items', () => {
    const row: Record<string, Cell> = { Finished: 1 }
    // Mother: avoidance items 1–4 at 7 (reversed → 1), 5–6 at 1 → mean 1. Father skipped.
    cols('Q3.1', 9).forEach((c, i) => (row[c] = i < 4 ? 7 : i < 6 ? 1 : 4))
    // Partner: all 4 → avoidance 4.
    cols('Q3.3', 9).forEach((c) => (row[c] = 4))
    // LSPS with one item missing out of 15 (≥ 80% answered).
    cols('Q7.1', 15).forEach((c, i) => (row[c] = i === 0 ? null : 3))
    const f = new Frame(fromGrid(grid([row]), 'x'))
    const scores = Object.fromEntries(scoreAll(f, [KEY_BY_ID['ecr.avoid.mother'], KEY_BY_ID['ecr.avoid.partner'], KEY_BY_ID['ecr.avoid.father'], KEY_BY_ID['ecr.avoid'], KEY_BY_ID['lsps']]).map((s) => [s.key.id, s.values[0]]))
    expect(scores['ecr.avoid.mother']).toBe(1)
    expect(scores['ecr.avoid.father']).toBeNull()
    expect(scores['ecr.avoid']).toBe(2.5)
    expect(scores['lsps']).toBe(2)
  })
})

describe('stats for the guide', () => {
  it('compares two correlations with Fisher z, as VassarStats', () => {
    const c = compareCorrelations(0.5, 100, 0.3, 100)
    expect(c.z).toBeCloseTo(1.67, 2)
    expect(c.p).toBeCloseTo(0.095, 3)
    expect(c.p1).toBeCloseTo(0.0475, 3)
  })

  it('halves p in the hypothesized direction only', () => {
    expect(oneTailed(0.08, 0.2, '+')).toBeCloseTo(0.04)
    expect(oneTailed(0.08, 0.2, '-')).toBeCloseTo(0.96)
  })

  it('has normal quantiles and partial correlations', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5)
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5)
    expect(partialR(2, 96)).toBeCloseTo(0.2, 6)
  })
})

describe('runAnalysis', () => {
  const rows: Record<string, Cell>[] = []
  let seed = 7
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 80; i++) {
    const lead = 1 + Math.floor(rand() * 5)
    const r: Record<string, Cell> = { Finished: 1, 'Q2.2': 980 + Math.floor(rand() * 30), 'Q2.3': i % 2 ? 1 : 2 }
    cols('Q5.1', 8).forEach((c) => (r[c] = Math.max(1, Math.min(5, lead + (rand() < 0.3 ? 1 : 0)))))
    cols('Q6.1', 16).forEach((c) => (r[c] = Math.max(1, Math.min(5, lead + (rand() < 0.5 ? -1 : 0)))))
    // Attachment: avoidance with the mother tracks leadership, the rest is noise.
    cols('Q3.1', 9).forEach((c, j) => (r[c] = j < 4 ? 8 - (lead + 1) : j < 6 ? lead + 1 : 1 + Math.floor(rand() * 7)))
    ;['Q3.2', 'Q3.3', 'Q3.4'].forEach((q) => cols(q, 9).forEach((c) => (r[c] = 1 + Math.floor(rand() * 7))))
    rows.push(r)
  }
  const d = fromGrid(grid(rows), 'x')
  const base = { datasetId: d.id, reverse: {}, winsorize: false, method: 'auto', correction: 'fdr', directions: {}, outcome: null, moderator: null, compare: [], dropSpeeders: false } as const
  const research = { constructs: ['ocb', 'tfl'] as ConstructId[], demographics: ['age', 'gender'], hypotheses: '' }

  it('computes the sample, reliability, correlations and a regression for the pair', () => {
    const res = runAnalysis(d, research, { ...base, directions: {}, compare: [] })
    expect(res.n).toBe(80)
    expect(res.pair).toEqual(['tfl', 'ocb'])
    expect(res.sample.categorical.find((c) => c.id === 'gender')!.groups.map((g) => g.n)).toEqual([40, 40])
    expect(res.reliability.find((r) => r.key.id === 'tfl')!.alpha).toBeGreaterThan(0.9)
    expect(res.correlations!.vars.map((v) => v.id)).toContain('age')
    const tflCco = res.correlations!.cells[res.correlations!.vars.findIndex((v) => v.id === 'cco')][0]
    expect(tflCco!.r).toBeGreaterThan(0.7)
    expect(res.groups.length).toBeGreaterThan(0)
    const reg = res.regressions[0]
    expect(reg.outcome.id).toBe('cco')
    expect(reg.r2).toBeGreaterThan(0.5)
    // Age standardized, gender as a 0/1 dummy; partial r and residuals reported.
    expect(reg.predictors.map((p) => p.kind)).toEqual(['z', 'z', 'dummy'])
    expect(reg.coefs[1].partial).toBeGreaterThan(0.5)
    expect(reg.residuals.values).toHaveLength(reg.n)
    expect(reg.partialPlot!.x).toHaveLength(reg.n)
  })

  it('tests directional hypotheses one-tailed and corrects with Bonferroni when asked', () => {
    const two = runAnalysis(d, research, { ...base, directions: {}, compare: [] })
    const key = pairKey('tfl', 'cco')
    const one = runAnalysis(d, research, { ...base, directions: { [key]: '+' }, correction: 'bonferroni', compare: [] })
    const p2 = two.pairs.find((p) => p.key === key)!
    const p1 = one.pairs.find((p) => p.key === key)!
    expect(p1.tails).toBe(1)
    expect(p1.p).toBeCloseTo(p2.p / 2, 12)
    expect(p1.pAdj).toBeCloseTo(Math.min(1, p1.p * one.correlations!.tests), 12)
  })

  it('swaps the outcome and tests a moderator', () => {
    const res = runAnalysis(d, research, { ...base, directions: {}, compare: [], outcome: 'tfl', moderator: 'gender' })
    expect(res.regressions[0].outcome.id).toBe('tfl')
    const m = res.regressions[0].moderation!
    expect(m.terms).toHaveLength(1)
    expect(m.terms[0].name).toContain('×')
    expect(m.deltaR2).toBeGreaterThanOrEqual(0)
  })

  it('breaks attachment down by relationship and compares two correlations', () => {
    const r0 = runAnalysis(d, { ...research, constructs: ['attachment', 'tfl'] }, { ...base, directions: {}, compare: [] })
    const rel = r0.relationships!
    expect(rel.rows.map((r) => r.relationship)).toEqual(['madre', 'padre', 'pareja', 'mejor amigo/a'])
    const mother = rel.rows[0].avoid[0]!
    const father = rel.rows[1].avoid[0]!
    expect(Math.abs(mother.r)).toBeGreaterThan(0.7)
    expect(Math.abs(father.r)).toBeLessThan(0.3)
    const res = runAnalysis(d, { ...research, constructs: ['attachment', 'tfl'] }, { ...base, directions: {}, compare: [mother.key, father.key] })
    expect(res.comparison!.p).toBeLessThan(0.001)
    expect(res.regressions.map((r) => r.outcome.id)).toEqual(['tfl'])
  })
})

describe('calendar', () => {
  const day = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-')

  it('has the 3rd-term deliveries every 4 weeks from 15/10, the last one final', () => {
    expect(DELIVERIES.map(day)).toEqual(['2026-10-15', '2026-11-12', '2026-12-10'])
    expect(day(DEADLINE)).toBe('2026-12-10')
    expect(day(APPROVAL)).toBe('2026-12-3')
  })

  it('counts down to the next delivery', () => {
    expect(nextDelivery(new Date(2026, 9, 10, 15))).toMatchObject({ n: 1, left: 5, final: false })
    expect(nextDelivery(new Date(2026, 9, 15, 22))).toMatchObject({ n: 1, left: 0 })
    expect(nextDelivery(new Date(2026, 9, 16))).toMatchObject({ n: 2, left: 27 })
    expect(nextDelivery(new Date(2026, 11, 10))).toMatchObject({ n: 3, final: true })
    expect(nextDelivery(new Date(2026, 11, 11))).toBeUndefined()
  })
})

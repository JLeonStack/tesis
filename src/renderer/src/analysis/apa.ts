import type { ApaTable } from '../thesis/tables'
import { alphaBand, type Comparison, type Correlations, type DescRow, type GroupTest, type Regression, type Relationships, type Reliability, type Results, type Sample } from './results'
import { fmtNum, fmtP, fmtR } from './stats'

// The analysis results as APA 7 tables (Spanish conventions: M, DE, n, α) and
// as plain sentences for the assistant. Statistical symbols go in *italics*.

const d2 = (x: number) => fmtNum(x, 2).replace('-', '−')
const r2 = (x: number) => fmtR(x).replace('-', '−')
const pTxt = (p: number) => (p < 0.001 ? '< .001' : `= ${fmtP(p)}`)
const stars = (p: number) => (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '')

export function reliabilityTable(rel: Reliability[]): ApaTable {
  return {
    title: 'Confiabilidad de las escalas (alfa de Cronbach)',
    headers: ['Escala', 'Ítems', '*n*', 'α', 'Confiabilidad'],
    rows: rel.map((r) => [r.key.label, String(r.k), String(r.n), r2(r.alpha), alphaBand(r.alpha)]),
    note: 'α = alfa de Cronbach, calculado con los ítems invertidos según la clave de cada instrumento; *n* = respuestas completas. Menos de .50 indica una confiabilidad pobre; de .50 a .75, moderada; de .75 a .90, buena; más de .90, excelente. Se considera aceptable desde .70.'
  }
}

/** Who took part: the Participants section's table. */
export function sampleTable(s: Sample, n: number): ApaTable {
  const rows: string[][] = []
  for (const c of s.continuous) rows.push([c.id === 'age' ? 'Edad (años)' : c.label, String(c.n), `${d2(c.mean)} (${d2(c.sd)})`, `${fmtNum(c.min, 0)}–${fmtNum(c.max, 0)}`])
  for (const c of s.categorical) {
    rows.push([c.label, String(c.n), '', ''])
    for (const g of c.groups) rows.push([`\u2003${g.label}`, `${g.n} (${fmtNum(g.pct, 1)} %)`, '', ''])
  }
  return {
    title: 'Características sociodemográficas de la muestra',
    headers: ['Característica', '*n* (%)', '*M* (*DE*)', 'Rango'],
    rows,
    note: `*N* = ${n}. *M* = media; *DE* = desvío estándar. Los porcentajes se calculan sobre quienes respondieron cada pregunta.`
  }
}

export function descriptivesTable(rows: DescRow[], n: number): ApaTable {
  const out = rows.filter((d) => d.outliers)
  return {
    title: 'Estadísticos descriptivos de las variables del estudio',
    headers: ['Variable', '*n*', '*M*', '*DE*', 'Mín.', 'Máx.', 'Rango', 'Asimetría', 'Curtosis'],
    rows: rows.map((d) => [d.label, String(d.n), d2(d.mean), d2(d.sd), d2(d.min), d2(d.max), d2(d.range), d2(d.skewness), d2(d.kurtosis)]),
    note: `*N* = ${n} respuestas válidas. *M* = media; *DE* = desvío estándar. Una asimetría entre −0.5 y 0.5 es leve; entre 0.5 y 1 (en valor absoluto), moderada; más allá de ±1, la distribución no es normal.${out.length ? ` Valores atípicos (más de 3 *DE* de la media): ${out.map((d) => `${d.label.toLowerCase()} (${d.outliers})`).join(', ')}.` : ' No hay valores atípicos (más de 3 *DE* de la media).'}`
  }
}

const dagger = (pAdj: number) => (pAdj < 0.05 ? '†' : '')

function correctionNote(correction: 'fdr' | 'bonferroni', tests: number, oneTailed: boolean): string {
  const how = correction === 'bonferroni' ? `Bonferroni (umbral corregido *p* < ${fmtP(0.05 / Math.max(1, tests))})` : 'FDR (Benjamini-Hochberg)'
  return `Los valores *p* no están corregidos; † indica que la correlación sigue siendo significativa tras corregir por ${tests} pruebas con ${how}.${oneTailed ? ' Las hipótesis direccionales se prueban a una cola (ᵃ).' : ''}`
}

export function correlationTable(c: Correlations, desc: DescRow[]): ApaTable {
  const byId = new Map(desc.map((d) => [d.id, d]))
  const sym = c.method === 'pearson' ? '*r*' : 'ρ'
  const oneTailed = c.cells.some((row) => row.some((x) => x?.tails === 1))
  return {
    title: `Correlaciones ${c.method === 'pearson' ? 'de Pearson' : 'de Spearman'} entre las variables del estudio`,
    headers: ['Variable', '*M*', '*DE*', ...c.vars.map((_, i) => String(i + 1))],
    rows: c.vars.map((v, i) => {
      const d = byId.get(v.id)
      return [
        `${i + 1}. ${v.label}`,
        d ? d2(d.mean) : '',
        d ? d2(d.sd) : '',
        ...c.vars.map((_, j) => {
          if (j === i) return '—'
          if (j > i) return ''
          const cell = c.cells[i][j]
          return cell ? `${r2(cell.r)}${stars(cell.p)}${dagger(cell.pAdj)}${cell.tails === 1 ? 'ᵃ' : ''}` : ''
        })
      ]
    }),
    note: `${sym} = coeficiente de correlación ${c.method === 'pearson' ? 'de Pearson' : 'de Spearman (las variables no se distribuyen normalmente)'}. *M* = media; *DE* = desvío estándar. ${correctionNote(c.correction, c.tests, oneTailed)} * *p* < .05. ** *p* < .01. *** *p* < .001.`
  }
}

/** Attachment per relationship against the other topic's main scores. */
export function relationshipsTable(rel: Relationships, correction: 'fdr' | 'bonferroni'): ApaTable {
  const sym = rel.method === 'pearson' ? '*r*' : 'ρ'
  const cell = (c: Relationships['rows'][number]['avoid'][number]) => (c ? `${r2(c.r)}${stars(c.p)}${dagger(c.pAdj)}${c.tails === 1 ? 'ᵃ' : ''}` : '')
  const oneTailed = rel.rows.some((r) => [...r.avoid, ...r.anx].some((c) => c?.tails === 1))
  return {
    title: `Correlaciones entre el apego por vínculo y ${rel.outcomes.map((o) => o.label.toLowerCase()).join(' y ')}`,
    headers: ['Vínculo', ...rel.outcomes.flatMap((o) => [`Evitación — ${o.label}`, `Ansiedad — ${o.label}`])],
    rows: rel.rows.map((r) => [r.relationship[0].toUpperCase() + r.relationship.slice(1), ...rel.outcomes.flatMap((_, i) => [cell(r.avoid[i]), cell(r.anx[i])])]),
    note: `${sym} = coeficiente de correlación ${rel.method === 'pearson' ? 'de Pearson' : 'de Spearman'}. ECR-RS respondido para cada vínculo. ${correctionNote(correction, rel.tests, oneTailed)} * *p* < .05. ** *p* < .01. *** *p* < .001.`
  }
}

/** The comparison of two correlations, as a sentence. */
export function comparisonText(c: Comparison, symbol = 'r'): string {
  return `${c.a.a.label} — ${c.a.b.label} (${symbol} = ${fmtR(c.a.r)}, n = ${c.a.n}) frente a ${c.b.a.label} — ${c.b.b.label} (${symbol} = ${fmtR(c.b.r)}, n = ${c.b.n}): z = ${fmtNum(c.z)}, p ${c.p < 0.001 ? '< .001' : `= ${fmtP(c.p)}`} a dos colas (una cola: ${fmtP(c.p1)})`
}

export function groupTable(tests: GroupTest[]): ApaTable {
  const rows: string[][] = []
  for (const g of tests) {
    g.groups.forEach((gr, i) => {
      rows.push([
        i === 0 ? `${g.score.label} según ${g.demographic.label.toLowerCase()}` : '',
        gr.label,
        String(gr.n),
        d2(gr.mean),
        d2(gr.sd),
        i === 0 ? testStat(g) : '',
        i === 0 ? fmtP(g.p) : '',
        i === 0 ? `${g.effect.name} = ${g.effect.name === 'd' ? d2(g.effect.value) : r2(g.effect.value)}` : ''
      ])
    })
  }
  return {
    title: 'Comparación de las variables del estudio según variables demográficas',
    headers: ['Variable', 'Grupo', '*n*', '*M*', '*DE*', 'Estadístico', '*p*', 'Efecto'],
    rows,
    note: `${testNames(tests)} Los grupos con menos de 5 respuestas no se incluyen. Con ${tests.length} comparaciones, el umbral corregido por Bonferroni es *p* < ${fmtP(0.05 / Math.max(1, tests.length))}.`
  }
}

const testStat = (g: GroupTest) =>
  g.test === 'welch' ? `*t*(${g.df}) = ${d2(g.stat)}` : g.test === 'mann-whitney' ? `*U* = ${fmtNum(g.stat, 0)}` : g.test === 'anova' ? `*F*(${g.df}) = ${d2(g.stat)}` : `*H*(${g.df}) = ${d2(g.stat)}`

function testNames(tests: GroupTest[]): string {
  const used = new Set(tests.map((t) => t.test))
  const parts: string[] = []
  if (used.has('welch')) parts.push('*t* = prueba *t* de Welch; *d* = *d* de Cohen')
  if (used.has('mann-whitney')) parts.push('*U* = prueba de Mann-Whitney; *r* = tamaño del efecto')
  if (used.has('anova')) parts.push('*F* = ANOVA de un factor; η² = eta cuadrado')
  if (used.has('kruskal-wallis')) parts.push('*H* = prueba de Kruskal-Wallis; ε² = épsilon cuadrado')
  return parts.length ? `${parts.join('. ')}.` : ''
}

export function regressionTable(r: Regression, count = 1): ApaTable {
  const z = r.predictors.filter((p) => p.kind === 'z').length
  const dummies = r.predictors.filter((p) => p.kind === 'dummy')
  return {
    title: `Regresión lineal múltiple sobre ${r.outcome.label.toLowerCase()}`,
    headers: ['Predictor', '*B*', '*EE*', 'β', '*t*', '*p*', '*r* parcial', 'VIF'],
    rows: r.coefs.map((c) => [c.name === 'Intercept' ? 'Constante' : c.name, d2(c.b), d2(c.se), Number.isFinite(c.beta) ? r2(c.beta) : '', d2(c.t), fmtP(c.p), c.partial != null ? r2(c.partial) : '', c.vif != null ? d2(c.vif) : '']),
    note: `*N* = ${r.n}. *R*² = ${r2(r.r2)}, *R*² ajustado = ${r2(r.adjR2)}, *F*(${r.df1}, ${r.df2}) = ${d2(r.F)}, *p* ${pTxt(r.p)}${count > 1 ? ` (corregido por Bonferroni para ${count} regresiones: *p* ${pTxt(r.pAdj)})` : ''}. ${z ? 'Los predictores continuos se ingresaron estandarizados (puntuaciones *z*). ' : ''}${dummies.length ? `${dummies.map((d) => d.label).join(', ')}: codificación 0/1. ` : ''}*B* = coeficiente no estandarizado; *EE* = error estándar; β = coeficiente estandarizado; VIF = factor de inflación de la varianza. Residuos: asimetría = ${d2(r.residuals.skewness)}, curtosis = ${d2(r.residuals.kurtosis)}${r.residuals.outliers ? `, ${r.residuals.outliers} residuo(s) a más de 3 *DE*` : ''}.`
  }
}

export function moderationTable(r: Regression): ApaTable | null {
  const m = r.moderation
  if (!m) return null
  return {
    title: `Moderación de ${m.moderator.label.toLowerCase()} sobre ${r.outcome.label.toLowerCase()}`,
    headers: ['Término de interacción', '*B*', '*EE*', 'β', '*t*', '*p*'],
    rows: m.terms.map((c) => [c.name, d2(c.b), d2(c.se), Number.isFinite(c.beta) ? r2(c.beta) : '', d2(c.t), fmtP(c.p)]),
    note: `*N* = ${m.n}. Paso 1: predictores, covariables y moderador (*R*² = ${r2(m.r2Before)}). Paso 2: más las interacciones (*R*² = ${r2(m.r2)}), Δ*R*² = ${r2(m.deltaR2)}, *F*(${m.df1}, ${m.df2}) = ${d2(m.F)}, *p* ${pTxt(m.p)}. Productos de los predictores estandarizados por el moderador.`
  }
}

// ---------- for the assistant ----------

/** Every computed number, as short lines: what the assistant may cite (and nothing else). */
export function resultsText(res: Results): string {
  const e = res.excluded
  const out: string[] = [
    `N = ${res.n} respuestas válidas de ${res.total} filas (excluidas: ${e.unfinished} sin finalizar, ${e.preview} vistas previas o pruebas, ${e.noConsent} sin consentimiento${e.speeders ? `, ${e.speeders} demasiado rápidas` : ''}${e.noBoss ? `, ${e.noBoss} propietarios o fundadores sin jefe directo` : ''}).`
  ]
  const s = res.sample
  if (s.continuous.length || s.categorical.length)
    out.push(
      `Muestra: ${[
        ...s.continuous.map((c) => `${c.label} M = ${fmtNum(c.mean)} (DE = ${fmtNum(c.sd)}, rango ${fmtNum(c.min, 0)}–${fmtNum(c.max, 0)})`),
        ...s.categorical.map((c) => `${c.label}: ${c.groups.map((g) => `${g.label} ${g.n} (${fmtNum(g.pct, 1)} %)`).join(', ')}`)
      ].join('; ')}.`
    )
  if (res.reliability.length) out.push(`Confiabilidad: ${res.reliability.map((r) => `${r.key.label} α = ${fmtR(r.alpha)} (${alphaBand(r.alpha).toLowerCase()}, k = ${r.k}, n = ${r.n})`).join('; ')}.`)
  if (res.descriptives.length)
    out.push(`Descriptivos: ${res.descriptives.map((d) => `${d.label} M = ${fmtNum(d.mean)}, DE = ${fmtNum(d.sd)}, rango ${fmtNum(d.min)}–${fmtNum(d.max)}, asimetría ${fmtNum(d.skewness)} (${d.skew})${d.outliers ? `, ${d.outliers} atípicos (|z| > 3)` : ''}`).join('; ')}.`)
  const c = res.correlations
  const line = (x: { a: { label: string }; b: { label: string }; r: number; n: number; p: number; pAdj: number; tails: 1 | 2 }, sym: string, how: string) =>
    `${x.a.label} con ${x.b.label}: ${sym}(${x.n - 2}) = ${fmtR(x.r)}, p ${pTxt(x.p)}${x.tails === 1 ? ' (una cola)' : ''} (${how} p ${pTxt(x.pAdj)})`
  if (c) {
    const sym = c.method === 'pearson' ? 'r' : 'rho'
    const how = c.correction === 'bonferroni' ? 'Bonferroni' : 'FDR'
    const cells = res.pairs.filter((p) => c.vars.some((v) => v.id === p.a.id) && c.vars.some((v) => v.id === p.b.id))
    out.push(`Correlaciones (${c.method === 'pearson' ? 'Pearson' : 'Spearman'}, ${c.tests} pruebas): ${cells.map((x) => line(x, sym, how)).join('; ')}.`)
  }
  const rel = res.relationships
  if (rel) {
    const sym = rel.method === 'pearson' ? 'r' : 'rho'
    const cells = rel.rows.flatMap((r) => [...r.avoid, ...r.anx]).filter((x) => !!x)
    out.push(`Apego por vínculo (${rel.tests} pruebas): ${cells.map((x) => line(x!, sym, c?.correction === 'bonferroni' ? 'Bonferroni' : 'FDR')).join('; ')}.`)
  }
  if (res.comparison) out.push(`Comparación de correlaciones (z de Fisher): ${comparisonText(res.comparison, c?.method === 'spearman' ? 'rho' : 'r')}.`)
  for (const g of res.groups) out.push(`${g.score.label} según ${g.demographic.label}: ${g.groups.map((x) => `${x.label} M = ${fmtNum(x.mean)} (DE = ${fmtNum(x.sd)}, n = ${x.n})`).join(', ')}; ${g.apa} (Bonferroni p ${pTxt(g.pAdj)}).`)
  for (const r of res.regressions) {
    out.push(
      `Regresión sobre ${r.outcome.label} (predictores continuos en z): R² = ${fmtR(r.r2)}, F(${r.df1}, ${r.df2}) = ${fmtNum(r.F)}, p ${pTxt(r.p)}${res.regressions.length > 1 ? ` (Bonferroni p ${pTxt(r.pAdj)})` : ''}, n = ${r.n}; ${r.coefs
        .filter((x) => x.name !== 'Intercept')
        .map((x) => `${x.name} β = ${fmtR(x.beta)}, r parcial = ${fmtR(x.partial ?? NaN)}, p ${pTxt(x.p)}, VIF = ${fmtNum(x.vif ?? 1)}`)
        .join('; ')}. Residuos: asimetría ${fmtNum(r.residuals.skewness)}, ${r.residuals.outliers} a más de 3 DE.`
    )
    const m = r.moderation
    if (m) out.push(`Moderación por ${m.moderator.label} sobre ${r.outcome.label}: ΔR² = ${fmtR(m.deltaR2)}, F(${m.df1}, ${m.df2}) = ${fmtNum(m.F)}, p ${pTxt(m.p)}; ${m.terms.map((t) => `${t.name} β = ${fmtR(t.beta)}, p ${pTxt(t.p)}`).join('; ')}.`)
  }
  if (res.notes.length) out.push(`Observaciones: ${res.notes.join(' ')}`)
  return out.join('\n')
}

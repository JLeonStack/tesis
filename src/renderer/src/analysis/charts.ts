import { describe, normalQuantile } from './stats'

// Figures for the thesis in APA style: grayscale, no chart junk, labelled
// axes, Calibri. Plain SVG strings, so they print in the PDF and rasterize
// for Word.

const W = 600
const H = 380
const M = { top: 16, right: 20, bottom: 56, left: 64 }
const FONT = `font-family="Calibri, Carlito, sans-serif" font-size="13" fill="#000"`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Decimal points, like the APA tables next to them.
const num = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2))

/** About five round ticks covering [lo, hi]. */
function ticks(lo: number, hi: number, n = 5): number[] {
  if (lo === hi) return [lo]
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

function frame(xLabel: string, yLabel: string, xs: [number, number], ys: [number, number], body: string, xTickLabels?: { at: number; label: string }[]): string {
  const iw = W - M.left - M.right
  const ih = H - M.top - M.bottom
  const sx = (v: number) => M.left + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * iw
  const sy = (v: number) => M.top + ih - ((v - ys[0]) / (ys[1] - ys[0] || 1)) * ih
  const yt = ticks(ys[0], ys[1])
  const xt = xTickLabels ?? ticks(xs[0], xs[1]).map((v) => ({ at: v, label: num(v) }))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
<g stroke="#000" stroke-width="1"><line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + ih}"/><line x1="${M.left}" y1="${M.top + ih}" x2="${M.left + iw}" y2="${M.top + ih}"/></g>
${yt.map((v) => `<line x1="${M.left - 4}" y1="${sy(v)}" x2="${M.left}" y2="${sy(v)}" stroke="#000"/><text x="${M.left - 8}" y="${sy(v) + 4}" text-anchor="end" ${FONT}>${num(v)}</text>`).join('')}
${xt.map((t) => `<line x1="${sx(t.at)}" y1="${M.top + ih}" x2="${sx(t.at)}" y2="${M.top + ih + 4}" stroke="#000"/><text x="${sx(t.at)}" y="${M.top + ih + 20}" text-anchor="middle" ${FONT}>${esc(t.label)}</text>`).join('')}
<text x="${M.left + iw / 2}" y="${H - 10}" text-anchor="middle" ${FONT}>${esc(xLabel)}</text>
<text transform="translate(16 ${M.top + ih / 2}) rotate(-90)" text-anchor="middle" ${FONT}>${esc(yLabel)}</text>
${body.replace(/\{x:([-\d.e]+)\}/g, (_, v) => String(sx(Number(v)))).replace(/\{y:([-\d.e]+)\}/g, (_, v) => String(sy(Number(v))))}
</svg>`
}

/** Distribution of one variable. */
export function histogram(values: number[], label: string): string {
  const v = values.filter(Number.isFinite)
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const bins = Math.max(5, Math.min(15, Math.ceil(Math.log2(v.length) + 1)))
  const w = (hi - lo) / bins || 1
  const counts = Array.from({ length: bins }, () => 0)
  for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++
  const top = Math.max(...counts)
  const bars = counts.map((c, i) => `<rect x="{x:${lo + i * w}}" y="{y:${c}}" width="${((W - M.left - M.right) * w) / (hi - lo || 1) - 1}" height="${((H - M.top - M.bottom) * c) / top}" fill="#9a9a9a" stroke="#000" stroke-width="0.5"/>`).join('')
  return frame(label, 'Frecuencia', [lo, hi], [0, top], bars)
}

/** Two variables with the least-squares line. */
export function scatter(x: number[], y: number[], xLabel: string, yLabel: string): string {
  const pts = x.map((v, i) => [v, y[i]] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const mx = describe(xs).mean
  const my = describe(ys).mean
  const sxy = pts.reduce((a, [u, v]) => a + (u - mx) * (v - my), 0)
  const sxx = xs.reduce((a, u) => a + (u - mx) ** 2, 0)
  const b = sxx ? sxy / sxx : 0
  const a = my - b * mx
  const dots = pts.map(([u, v]) => `<circle cx="{x:${u}}" cy="{y:${v}}" r="2.6" fill="#000" fill-opacity="0.45"/>`).join('')
  const line = `<line x1="{x:${x0}}" y1="{y:${Math.min(y1, Math.max(y0, a + b * x0))}}" x2="{x:${x1}}" y2="{y:${Math.min(y1, Math.max(y0, a + b * x1))}}" stroke="#000" stroke-width="1.5"/>`
  return frame(xLabel, yLabel, [x0, x1], [y0, y1], dots + line)
}

/** Group means with 95% confidence intervals. */
export function groupMeans(groups: { label: string; n: number; mean: number; sd: number }[], yLabel: string, xLabel: string): string {
  const ci = groups.map((g) => (1.96 * g.sd) / Math.sqrt(g.n))
  const lo = Math.min(0, ...groups.map((g, i) => g.mean - ci[i]))
  const hi = Math.max(...groups.map((g, i) => g.mean + ci[i]))
  const k = groups.length
  const ih = H - M.top - M.bottom
  const px = (v: number) => (ih * v) / (hi - lo || 1)
  const bw = Math.min(70, ((W - M.left - M.right) / k) * 0.55)
  const body = groups
    .map((g, i) => {
      const cx = i + 0.5
      return (
        `<rect x="{x:${cx}}" y="{y:${g.mean}}" width="${bw}" height="${px(g.mean - lo)}" transform="translate(${-bw / 2} 0)" fill="#9a9a9a" stroke="#000"/>` +
        `<line x1="{x:${cx}}" y1="{y:${g.mean - ci[i]}}" x2="{x:${cx}}" y2="{y:${g.mean + ci[i]}}" stroke="#000"/>` +
        [g.mean - ci[i], g.mean + ci[i]].map((v) => `<path d="M{x:${cx}} {y:${v}} m-6 0 h12" stroke="#000"/>`).join('')
      )
    })
    .join('')
  const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)
  return frame(xLabel, yLabel, [0, k], [lo, hi], body, groups.map((g, i) => ({ at: i + 0.5, label: `${short(g.label)} (n = ${g.n})` })))
}

/** Normal Q-Q plot: standardized values against the normal quantiles they would have, with the identity line. */
export function qqPlot(values: number[], label: string): string {
  const v = values.filter(Number.isFinite)
  const d = describe(v)
  const z = v.map((x) => (d.sd > 0 ? (x - d.mean) / d.sd : 0)).sort((a, b) => a - b)
  const n = z.length
  const pts = z.map((y, i) => [normalQuantile((i + 0.625) / (n + 0.25)), y] as const)
  const lo = Math.min(pts[0]?.[0] ?? -3, z[0] ?? -3)
  const hi = Math.max(pts.at(-1)?.[0] ?? 3, z.at(-1) ?? 3)
  const dots = pts.map(([u, w]) => `<circle cx="{x:${u}}" cy="{y:${w}}" r="2.6" fill="#000" fill-opacity="0.45"/>`).join('')
  const line = `<line x1="{x:${lo}}" y1="{y:${lo}}" x2="{x:${hi}}" y2="{y:${hi}}" stroke="#000" stroke-width="1.5"/>`
  return frame('Cuantil normal esperado', `${label} (z)`, [lo, hi], [lo, hi], dots + line)
}

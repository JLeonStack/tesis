export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  const d = (...a: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
  d.cancel = () => clearTimeout(t)
  return d
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const isMac = navigator.platform.toLowerCase().includes('mac')
export const mod = isMac ? '⌘' : 'Ctrl+'

/** Case/diacritic-insensitive normalization for search. */
export const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tiny fuzzy score: all query words must appear; earlier = better. */
export function matchScore(haystack: string, query: string): number {
  const h = fold(haystack)
  let score = 0
  for (const w of fold(query).split(/\s+/).filter(Boolean)) {
    const i = h.indexOf(w)
    if (i < 0) return -1
    score += i === 0 ? 3 : h[i - 1] === ' ' ? 2 : 1
  }
  return score
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

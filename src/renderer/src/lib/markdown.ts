import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const md = new Marked({ gfm: true, breaks: false, async: false })

// Matches [S1, p. 12], [S2, pp. 3–4], [S1, pp. 11, 15, 19], [p. 7] and multi-cites [S1, p. 3; S2, p. 8].
const CITE_GROUP = /\[((?:S\d+)?(?:,?\s*pp?\.\s*[\d–\-, ]+)?(?:\s*;\s*(?:S\d+)?(?:,?\s*pp?\.\s*[\d–\-, ]+)?)*)\]/g
const CITE_ONE = /^(S\d+)?(?:,?\s*pp?\.\s*([\d–\-, ]+?))?\s*$/

/** One citation part → source key plus each page or range it lists (Postel's law: accept every form models write). */
function parseCite(part: string): { key: string; pages: { first: string; label: string }[] } | null {
  const m = part.trim().match(CITE_ONE)
  if (!m || (!m[1] && !m[2])) return null
  const pages = (m[2] ?? '')
    .split(',')
    .map((x) => x.trim().replace(/\s*[–-]\s*/, '–'))
    .filter((x) => /^\d+(–\d+)?$/.test(x))
    .map((label) => ({ first: label.split('–')[0], label }))
  if (m[2] && !pages.length) return null
  return { key: m[1] ?? 'S1', pages }
}

export interface CiteResolver {
  (sourceKey: string): string | null // returns a short label, or null if unknown
}

function chips(html: string, resolve: CiteResolver): string {
  return html.replace(CITE_GROUP, (whole, inner: string) => {
    const parts = inner.split(/\s*;\s*/)
    const out: string[] = []
    for (const part of parts) {
      const c = parseCite(part)
      if (!c) return whole
      const label = resolve(c.key)
      if (!label) return whole
      // The source label shows once; further pages of the same source are compact chips (less noise, same targets).
      ;(c.pages.length ? c.pages : [null]).forEach((page, i) => {
        out.push(
          `<button class="cite-chip" data-src="${c.key}"${page ? ` data-page="${page.first}"` : ''} title="Open ${label}${
            page ? `, page ${page.first}` : ''
          }">${i ? '' : label}${page ? `<span>p.${page.label}</span>` : ''}</button>`
        )
      })
    }
    return out.join('')
  })
}

export function renderMarkdown(text: string, resolve: CiteResolver): string {
  const html = DOMPurify.sanitize(md.parse(text) as string, { USE_PROFILES: { html: true } })
  return chips(html, resolve)
}

/** Markdown → sanitized HTML with citations as plain text, for inserting into notes. */
export function markdownToHtml(text: string): string {
  return DOMPurify.sanitize(md.parse(text) as string, { USE_PROFILES: { html: true } })
}

/** Rewrites [S1, p. 12] style markers using `fmt` (e.g. into APA in-text citations). */
export function replaceCites(text: string, fmt: (sourceKey: string, page?: string) => string | null): string {
  return text.replace(CITE_GROUP, (whole, inner: string) => {
    const out: string[] = []
    for (const part of inner.split(/\s*;\s*/)) {
      const c = parseCite(part)
      if (!c) return whole
      const r = fmt(c.key, c.pages[0]?.first)
      if (!r) return whole
      out.push(r)
    }
    return out.join(' ')
  })
}

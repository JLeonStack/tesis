import logoUrl from '../assets/ucema-logo.png'
import type { Block, Indent, ModelSection, Run, ThesisModel } from './model'
import { escapeHtml as esc, italicHtml } from './references'
import { thesisFontCss } from './fonts'
import { AUTHORIZATIONS, CAREER, UNIVERSITY, authRuns, coverBlanks, longDate, tutorLine } from './template'

// Standalone HTML for the PDF export. Paged.js paginates it in a hidden
// window: real footnotes at the foot of each page, page numbers top-right
// (none on the cover) and TOC page numbers resolved with target-counter().

const PRINT_CSS = `
@page {
  size: 8.5in 11in;
  margin: 2.54cm;
  @top-right { content: counter(page); font: 11pt Calibri, Carlito, sans-serif; vertical-align: middle; }
  @footnote {
    float: bottom;
    padding-top: 6pt;
    margin-top: 10pt;
    background: linear-gradient(#000, #000) top left / 2in 0.5pt no-repeat;
  }
}
@page :first { @top-right { content: none; } }

html { font-family: Calibri, Carlito, 'Liberation Sans', sans-serif; font-size: 11pt; line-height: 2.44; color: #000; }
body { margin: 0; }
p { margin: 0; orphans: 2; widows: 2; }
.first { text-indent: 1.27cm; }
.hanging { padding-left: 1.27cm; text-indent: -1.27cm; }
h1, h2, h3, .title { font-size: 11pt; font-weight: 700; margin: 0; line-height: 2.44; break-after: avoid; }
h1, .title { text-align: center; }
h3 { font-style: italic; }
.sec { break-before: page; }
.page-break { break-before: page; }
blockquote { margin: 0 0 0 1.27cm; }
.li { text-indent: -0.6cm; }
a { color: inherit; text-decoration: none; }
a.ext { text-decoration: underline; }

.fn { float: footnote; font-size: 10pt; line-height: 1.2; text-indent: 0; font-weight: 400; font-style: normal; text-align: left; }
.fn::footnote-call { content: counter(footnote); vertical-align: super; font-size: 0.7em; line-height: 0; }
/* The note's own number as in Word: superscript, no period. */
@counter-style sup-digits { system: numeric; symbols: '\\2070' '\\00B9' '\\00B2' '\\00B3' '\\2074' '\\2075' '\\2076' '\\2077' '\\2078' '\\2079'; }
.fn[data-footnote-marker]::marker { content: counter(footnote-marker, sup-digits) ' '; }

.toc-entry { display: flex; align-items: baseline; }
.toc-entry .text { flex: none; max-width: 85%; }
.toc-entry .dots { flex: 1; border-bottom: 1pt dotted #000; margin: 0 4pt 0.55em; }
.toc-entry .page::after { content: target-counter(attr(href), page); }
.toc-l2 { padding-left: 1.27cm; }
.toc-l3 { padding-left: 2.54cm; }

/* The cover is exactly one page: blank lines give way before anything spills over. */
.cover { display: flex; flex-direction: column; height: calc(11in - 5.08cm); overflow: hidden; }
.cover p { text-indent: 0; flex: none; }
.cover .c { text-align: center; }
.cover .r { text-align: right; }
.cover .blank { flex: 0 1 calc(12pt * 2.44); min-height: 0; }
.cover img { width: 2.72in; }
.auth { line-height: 1.83; text-align: justify; }
.auth .title { line-height: 2.44; }
.auth p { text-indent: 0; }
.auth ul { margin: 0; padding-left: 1.27cm; }
.auth li { margin-bottom: 1.83em; }
.auth .sign { text-align: center; }
`

function runsHtml(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.kind === 'break') return '<br>'
      if (r.kind === 'fn') return `<span class="fn">${italicHtml(r.text)}</span>`
      let t = esc(r.text)
      if (r.italic) t = `<i>${t}</i>`
      if (r.bold) t = `<b>${t}</b>`
      if (r.underline) t = `<u>${t}</u>`
      if (r.link) t = `<a class="ext" href="${esc(r.link)}">${t}</a>`
      return t
    })
    .join('')
}

const cls = (i: Indent) => (i === 'first' ? 'first' : i === 'hanging' ? 'hanging' : '')

function blockHtml(b: Block): string {
  switch (b.t) {
    case 'heading':
      return `<h${b.level} id="${b.anchor}">${runsHtml(b.runs)}</h${b.level}>`
    case 'para':
      return `<p class="${cls(b.indent)}"${b.anchor ? ` id="${b.anchor}"` : ''}>${runsHtml(b.runs)}</p>`
    case 'quote':
      return `<blockquote>${b.paras.map((r) => `<p>${runsHtml(r)}</p>`).join('')}</blockquote>`
    case 'list':
      return b.items
        .map((i) => `<p class="li" style="padding-left:calc(1.27cm * ${i.depth + 1})">${i.marker ? `${esc(i.marker)}&ensp;` : ''}${runsHtml(i.runs)}</p>`)
        .join('')
    case 'pageBreak':
      return '<div class="page-break"></div>'
    case 'toc':
      return (
        '<p class="title">Tabla de Contenido</p>' +
        b.entries
          .map(
            (e) =>
              `<div class="toc-entry toc-l${e.level}"><span class="text">${esc(e.text)}</span><span class="dots"></span>` +
              (e.anchor ? `<a class="page" href="#${e.anchor}"></a>` : '') +
              '</div>'
          )
          .join('')
      )
    case 'refs':
      return b.entries.map((r) => `<p class="hanging">${runsHtml(r)}</p>`).join('')
  }
}

function sectionHtml(s: ModelSection): string {
  const title = s.title && s.kind !== 'toc' ? `<h1>${esc(s.title)}</h1>` : ''
  return `<section class="sec" id="${s.anchor}">${title}${s.blocks.map(blockHtml).join('')}</section>`
}

async function logoDataUri(): Promise<string> {
  const blob = await (await fetch(logoUrl)).blob()
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(blob)
  })
}

function coverHtml(m: ThesisModel, logo: string): string {
  const meta = m.meta
  const title = [meta.title.trim() || 'Título', meta.subtitle.trim()].filter(Boolean).join(': ')
  const line = (html: string, size: number, align: 'c' | 'r', bold = true) =>
    `<p class="${align}" style="font-size:${size}pt;${bold ? 'font-weight:700' : ''}">${html}</p>`
  const blank = (n: number) => '<div class="blank"></div>'.repeat(n)
  const blanks = coverBlanks(title)
  return `<section class="cover">
    <p class="c"><img src="${logo}" alt="UCEMA"></p>${blank(1)}
    ${line(UNIVERSITY, 14, 'c')}${line(esc(CAREER), 14, 'c')}${blank(blanks.before)}
    ${line(esc(title), 24, 'c')}${line('Trabajo Final', 24, 'c')}${blank(blanks.after)}
    ${line(`<b>Autor:</b> ${esc(meta.author || 'Nombre y apellido')}`, 16, 'r', false)}
    ${line(`<b>Tutor:</b> ${esc(tutorLine(meta) || 'Grado, nombre y apellido')}`, 16, 'r', false)}
    ${line(esc(longDate(meta.date)), 14, 'r', false)}
  </section>`
}

function authorizationsHtml(m: ThesisModel): string {
  const meta = m.meta
  const items = AUTHORIZATIONS.map((a) => {
    const v = meta.auth[a.key]
    const opts = (v === null ? [true, false] : [v])
      .map((yes) => `<p>${authRuns(yes, a).map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text))).join('')}</p>`)
      .join('')
    return `<li><b>${esc(a.label)}:</b>${opts}</li>`
  }).join('')
  return `<section class="sec auth"><p class="title">Autorizaciones</p><ul>${items}</ul><br>
    <p class="sign">Nombre y apellido: ${esc(meta.author)}</p><p class="sign">DNI: ${esc(meta.dni)}</p><p class="sign">Carrera: ${esc(CAREER)}</p><p class="sign">Firma:</p></section>`
}

export async function buildPrintHtml(m: ThesisModel): Promise<string> {
  const [{ default: paged }, logo, fonts] = await Promise.all([import('pagedjs-dist/paged.polyfill.min.js?raw'), logoDataUri(), thesisFontCss()])
  const title = esc([m.meta.title, m.meta.subtitle].filter(Boolean).join(': ') || 'Trabajo Final')
  const body = coverHtml(m, logo) + m.sections.map(sectionHtml).join('') + authorizationsHtml(m)
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title>
<style>${fonts}
${PRINT_CSS}</style>
<script>
  // Paginate only once the embedded fonts are in, so line breaks use the real metrics.
  window.PagedConfig = {
    auto: true,
    before: function () { return Promise.all(Array.from(document.fonts).map(function (f) { return f.load() })) },
    after: function () { window.__pagedDone = true }
  }
</script>
<script>${paged.replace(/<\/script/gi, '<\\/script')}</script>
</head><body>${body}</body></html>`
}

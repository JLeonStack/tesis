import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  TableOfContents,
  TabStopType,
  LeaderType,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild
} from 'docx'
import logoUrl from '../assets/ucema-logo.png'
import type { Block, Indent, ModelSection, Run, ThesisModel } from './model'
import { italicRuns } from './references'
import { AUTHORIZATIONS, CAREER, UNIVERSITY, authRuns, coverBlanks, longDate, tutorLine } from './template'

// Word output that follows the UCEMA template: Letter, 2.54 cm margins,
// Calibri 11, double spacing, 1.27 cm indents, page number top-right except
// on the cover, native footnotes and a TOC field Word fills in on open.

const FONT = 'Calibri'
const INDENT = 720 // 1.27 cm in twips
const DOUBLE = { line: 480, before: 0, after: 0 }
const BLACK = '000000'

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const

function textRuns(runs: Run[], size?: number): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const r of runs) {
    if (r.kind === 'break') out.push(new TextRun({ break: 1 }))
    else if (r.kind === 'fn') out.push(new FootnoteReferenceRun(r.n))
    else {
      const run = new TextRun({ text: r.text, bold: r.bold, italics: r.italic, underline: r.underline ? {} : undefined, size })
      out.push(r.link ? new ExternalHyperlink({ link: r.link, children: [run] }) : run)
    }
  }
  return out
}

const indentFor = (indent: Indent): IParagraphOptions['indent'] =>
  indent === 'first' ? { firstLine: INDENT } : indent === 'hanging' ? { left: INDENT, hanging: INDENT } : undefined

type Item = IParagraphOptions | TableOfContents

function blockItems(b: Block, nextList: () => number): Item[] {
  switch (b.t) {
    case 'heading':
      return [{ heading: HEADINGS[b.level - 1], children: textRuns(b.runs) }]
    case 'para':
      return [{ indent: indentFor(b.indent), children: textRuns(b.runs) }]
    case 'quote':
      return b.paras.map((runs) => ({ indent: { left: INDENT }, children: textRuns(runs) }))
    case 'list': {
      // Each list restarts its numbering.
      const instance = nextList()
      return b.items.map((item) =>
        item.first
          ? { numbering: { reference: item.ordered ? 'thesis-numbers' : 'thesis-bullets', level: Math.min(item.depth, 3), instance }, children: textRuns(item.runs) }
          : { indent: { left: INDENT * (Math.min(item.depth, 3) + 1) }, children: textRuns(item.runs) }
      )
    }
    case 'pageBreak':
      return [{ pageBreakBefore: true, children: [] }]
    case 'toc':
      return [
        { style: 'TitleNoToc', children: [new TextRun('Tabla de Contenido')] },
        new TableOfContents('Tabla de Contenido', {
          hyperlink: true,
          headingStyleRange: '1-3',
          cachedEntries: b.entries.map((e) => ({ title: e.text, level: e.level }))
        })
      ]
    case 'refs':
      return b.entries.map((runs) => ({ indent: { left: INDENT, hanging: INDENT }, children: textRuns(runs) }))
  }
}

/** A section's paragraphs; the first one starts a new page. */
function sectionItems(s: ModelSection, nextList: () => number): Item[] {
  const out: Item[] = []
  // The TOC block writes its own title, which must not list itself.
  if (s.title && s.kind !== 'toc') out.push({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.title)] })
  for (const b of s.blocks) out.push(...blockItems(b, nextList))
  if (!(out[0] && !(out[0] instanceof TableOfContents))) out.unshift({ children: [] })
  out[0] = { ...(out[0] as IParagraphOptions), pageBreakBefore: true }
  return out
}

const toChild = (i: Item) => (i instanceof TableOfContents ? i : new Paragraph(i))

async function logoBytes(): Promise<ArrayBuffer> {
  return (await fetch(logoUrl)).arrayBuffer()
}

async function coverParagraphs(m: ThesisModel): Promise<Paragraph[]> {
  const meta = m.meta
  const blank = (n: number, size = 24) => Array.from({ length: n }, () => new Paragraph({ children: [new TextRun({ text: '', size })] }))
  const center = (text: string, size: number, bold = true) =>
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, size, bold })] })
  const labelled = (label: string, value: string, size: number) =>
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${label}:`, bold: true, size }), new TextRun({ text: ` ${value}`, size })] })
  const title = [meta.title.trim() || 'Título', meta.subtitle.trim()].filter(Boolean).join(': ')
  const blanks = coverBlanks(title)
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: 'png', data: await logoBytes(), transformation: { width: 261, height: 119 }, altText: { name: 'UCEMA', description: 'Logo de la Universidad del CEMA', title: 'UCEMA' } })]
    }),
    ...blank(1),
    center(UNIVERSITY, 28),
    center(CAREER, 28),
    ...blank(blanks.before),
    center(title, 48),
    center('Trabajo Final', 48),
    ...blank(blanks.after),
    labelled('Autor', meta.author || 'Nombre y apellido', 32),
    labelled('Tutor', tutorLine(meta) || 'Grado, nombre y apellido', 32),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: longDate(meta.date), size: 28 })] })
  ]
}

function authorizationParagraphs(m: ThesisModel, listInstance: number): Paragraph[] {
  const meta = m.meta
  // As in the template: 1.5 spacing, justified, signature block centered.
  const spacing = { line: 360, before: 0, after: 0 }
  const out: Paragraph[] = [
    new Paragraph({ pageBreakBefore: true, style: 'TitleNoToc', children: [new TextRun('Autorizaciones')] })
  ]
  for (const a of AUTHORIZATIONS) {
    const v = meta.auth[a.key]
    out.push(
      new Paragraph({
        numbering: { reference: 'thesis-bullets', level: 0, instance: listInstance },
        spacing,
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: `${a.label}:`, bold: true })]
      })
    )
    const options = v === null ? [true, false] : [v]
    for (const yes of options)
      out.push(
        new Paragraph({
          indent: { left: INDENT },
          spacing,
          alignment: AlignmentType.JUSTIFIED,
          children: authRuns(yes, a).map((r) => new TextRun(r))
        })
      )
    out.push(new Paragraph({ spacing, children: [] }))
  }
  out.push(new Paragraph({ spacing, children: [] }))
  const sign = (text: string) => new Paragraph({ spacing, alignment: AlignmentType.CENTER, children: [new TextRun(text)] })
  out.push(sign(`Nombre y apellido: ${meta.author}`), sign(`DNI: ${meta.dni}`), sign(`Carrera: ${CAREER}`), sign('Firma:'))
  return out
}

const numberingLevels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (l: number) => string) =>
  [0, 1, 2, 3].map((level) => ({
    level,
    format,
    text: text(level),
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: 360 } } }
  }))

export async function buildDocx(m: ThesisModel): Promise<Uint8Array> {
  let instance = 0
  const nextList = () => ++instance
  const children: (Paragraph | TableOfContents)[] = [...(await coverParagraphs(m))]
  for (const s of m.sections) children.push(...sectionItems(s, nextList).map(toChild))
  children.push(...authorizationParagraphs(m, nextList()))

  const headingStyle = (align: (typeof AlignmentType)[keyof typeof AlignmentType], italics: boolean, outlineLevel: number) => ({
    run: { font: FONT, size: 22, bold: true, italics, color: BLACK },
    paragraph: { alignment: align, spacing: DOUBLE, keepNext: true, keepLines: true, outlineLevel }
  })

  const doc = new Document({
    creator: m.meta.author || undefined,
    title: [m.meta.title, m.meta.subtitle].filter(Boolean).join(': ') || 'Trabajo Final',
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, language: { value: 'es-AR' } },
          paragraph: { spacing: DOUBLE }
        },
        heading1: headingStyle(AlignmentType.CENTER, false, 0),
        heading2: headingStyle(AlignmentType.LEFT, false, 1),
        heading3: headingStyle(AlignmentType.LEFT, true, 2),
        hyperlink: { run: { color: '0563C1', underline: {} } }
      },
      paragraphStyles: [
        {
          id: 'TitleNoToc',
          name: 'Título sin índice',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT, size: 22, bold: true },
          paragraph: { alignment: AlignmentType.CENTER, spacing: DOUBLE, keepNext: true }
        },
        // Table of contents as in the template: levels indented 1.27 cm each, dot leaders to the page number.
        ...[0, 1, 2].map((l) => ({
          id: `TOC${l + 1}`,
          name: `toc ${l + 1}`,
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT, size: 22 },
          paragraph: {
            spacing: DOUBLE,
            indent: { left: INDENT * l, firstLine: 0 },
            tabStops: [{ type: TabStopType.RIGHT, position: 9360, leader: LeaderType.DOT }]
          }
        })),
        {
          id: 'FootnoteText',
          name: 'footnote text',
          basedOn: 'Normal',
          run: { font: FONT, size: 20 },
          paragraph: { spacing: { line: 240, before: 0, after: 0 } }
        }
      ]
    },
    numbering: {
      config: [
        { reference: 'thesis-bullets', levels: numberingLevels(LevelFormat.BULLET, (l) => ['•', '◦', '▪', '•'][l]) },
        { reference: 'thesis-numbers', levels: numberingLevels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) }
      ]
    },
    footnotes: Object.fromEntries(
      m.footnotes.map((f) => [
        f.n,
        { children: [new Paragraph({ style: 'FootnoteText', children: italicRuns(f.text).map((r) => new TextRun({ text: r.text, italics: r.italic, size: 20 })) })] }
      ])
    ),
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 709, footer: 709 }
          }
        },
        headers: {
          first: new Header({ children: [new Paragraph({ children: [] })] }),
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { line: 240 }, children: [new TextRun({ children: [PageNumber.CURRENT] })] })]
          })
        },
        children
      }
    ]
  })
  return new Uint8Array(await Packer.toArrayBuffer(doc))
}

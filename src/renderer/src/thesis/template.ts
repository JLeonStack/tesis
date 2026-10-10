import type { JSONContent } from '@tiptap/react'
import type { ThesisMeta } from '@shared/types'

// Structure and guidance text of the UCEMA "Plantilla trabajo final - MBA" (2026).

export const SECTION_KINDS = ['dedicatoria', 'agradecimientos', 'resumen', 'toc', 'cuerpo', 'referencias', 'apendices'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

export const SECTION_INFO: Record<SectionKind, { label: string; title?: string; optional?: boolean }> = {
  dedicatoria: { label: 'Dedicatoria', optional: true },
  agradecimientos: { label: 'Agradecimientos', optional: true },
  resumen: { label: 'Resumen', title: 'Resumen' },
  toc: { label: 'Tabla de contenido', title: 'Tabla de Contenido' },
  cuerpo: { label: 'Cuerpo del trabajo' },
  referencias: { label: 'Referencias', title: 'Referencias' },
  apendices: { label: 'Apéndices', title: 'Apéndices', optional: true }
}

export const WORD_LIMIT = 18000
export const ABSTRACT_LIMIT = 250
export const KEYWORDS_LABEL = 'Palabras clave'

/** Guidance shown as a placeholder in the empty paragraph that follows each heading. */
export const HEADING_GUIDANCE: Record<string, string> = {
  introduccion:
    'Informá al lector sobre el contenido del trabajo, los objetivos y la metodología seguida. Podés destacar el aporte para la comunidad académica o empresarial. Breve y clara.',
  'objetivo general':
    'Condensá el tema central del trabajo (la respuesta a la pregunta que se plantea) con verbos en infinitivo: analizar, identificar, describir, comprobar…',
  conclusion:
    'Recapitulá los puntos principales vinculados con el objetivo, presentá los resultados y destacá el aporte de aplicar el marco teórico al caso. Breve, eficaz y concisa.'
}

export const SECTION_GUIDANCE: Partial<Record<SectionKind, string>> = {
  dedicatoria: 'Opcional. Nota dirigida a la persona a quien se dedica el trabajo (sin título y sin sangría). Si queda vacía, no se exporta.',
  agradecimientos: 'Opcional. Reconocimiento a personas o instituciones que colaboraron (sin título y sin sangría). Si queda vacía, no se exporta.',
  resumen:
    'Exposición breve y concisa del trabajo y sus conclusiones, en un solo párrafo sin sangría. Máximo 250 palabras. Suele escribirse al final.',
  referencias: 'Las obras citadas se agregan solas. Podés sumar aquí referencias que no estén en tu biblioteca (formato APA).',
  apendices: 'Opcional. Entrevistas, encuestas, imágenes, cálculos… Si hay más de uno: Apéndice A, Apéndice B, etc.'
}

export const DEFAULT_HEADING_GUIDANCE =
  'Desarrollá el tema. Hasta cinco niveles de título, sin numerar y con capitalización de títulos.'

export const normalizeHeading = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const p = (content?: JSONContent[]): JSONContent => (content ? { type: 'paragraph', content } : { type: 'paragraph' })

export function defaultSectionContent(kind: SectionKind): JSONContent[] {
  switch (kind) {
    case 'resumen':
      return [p(), p([{ type: 'text', text: `${KEYWORDS_LABEL}:`, marks: [{ type: 'italic' }] }, { type: 'text', text: ' ' }])]
    case 'toc':
      return [{ type: 'tocBlock' }]
    case 'cuerpo':
      return [h(1, 'Introducción'), p(), h(1, 'Objetivo General'), p(), h(1, 'Título del Primer Capítulo'), p(), h(1, 'Conclusión'), p()]
    case 'referencias':
      return [{ type: 'referenceList' }]
    default:
      return [p()]
  }
}

export function sectionJSON(kind: SectionKind, content = defaultSectionContent(kind)): JSONContent {
  return { type: 'section', attrs: { kind }, content }
}

export function templateDoc(): JSONContent {
  return { type: 'doc', content: SECTION_KINDS.map((k) => sectionJSON(k)) }
}

export function defaultMeta(): ThesisMeta {
  return {
    title: '',
    subtitle: '',
    author: '',
    tutorDegree: '',
    tutor: '',
    date: new Date().toISOString().slice(0, 10),
    dni: '',
    auth: { repositorio: null, catalogo: null, web: null }
  }
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "2026-09-27" → "27 de septiembre de 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} de ${MONTHS[m - 1]} de ${y}`
}

export const CAREER = 'Maestría en Dirección de Empresas'
export const UNIVERSITY = 'Universidad del CEMA'

export const AUTHORIZATIONS = [
  {
    key: 'repositorio',
    label: 'Repositorio Institucional UCEMA',
    strong: 'Repositorio Institucional UCEMA',
    text: 'a la Universidad del CEMA a publicar y difundir el trabajo final de mi autoría en el Repositorio Institucional UCEMA de la Biblioteca con fines exclusivamente académicos y didácticos.'
  },
  {
    key: 'catalogo',
    label: 'Catálogo en línea',
    strong: 'catálogo en línea',
    text: 'a la Universidad del CEMA a publicar y difundir el trabajo final de mi autoría en el catálogo en línea de la Biblioteca (acceso con usuario y contraseña) con fines exclusivamente académicos y didácticos.'
  },
  {
    key: 'web',
    label: 'Página web',
    strong: 'página web',
    text: 'a la Universidad del CEMA a publicar y difundir el trabajo final de mi autoría en la página web de la Universidad como trabajo destacado (si obtuviese la distinción correspondiente) con fines exclusivamente académicos y didácticos.'
  }
] as const

export const authSentence = (yes: boolean, text: string) => `${yes ? 'Autorizo' : 'NO autorizo'} ${text}`

/** As in the template: «Autorizo»/«NO autorizo» and where it's published go in bold. */
export function authRuns(yes: boolean, a: (typeof AUTHORIZATIONS)[number]): { text: string; bold: boolean }[] {
  const i = a.text.indexOf(a.strong)
  return [
    { text: yes ? 'Autorizo' : 'NO autorizo', bold: true },
    { text: ` ${a.text.slice(0, i)}`, bold: false },
    { text: a.strong, bold: true },
    { text: a.text.slice(i + a.strong.length), bold: false }
  ]
}

/** Blank lines around the cover title (template: 4 before, 3 after). Each extra line of the
 * 24 pt title takes the room of two blank lines, so the cover always fits on one page. */
export function coverBlanks(title: string): { before: number; after: number } {
  const extra = 2 * (Math.ceil(Math.max(1, title.length) / 36) - 1)
  return { before: Math.max(0, 4 - extra), after: Math.max(1, 3 - Math.max(0, extra - 4)) }
}

export const fullTitle = (m: ThesisMeta) => [m.title.trim(), m.subtitle.trim()].filter(Boolean).join(': ')
export const tutorLine = (m: ThesisMeta) => [m.tutorDegree.trim(), m.tutor.trim()].filter(Boolean).join(' ')

import type { JSONContent } from '@tiptap/react'
import type { ThesisMeta } from '@shared/types'
import { PROBLEM_SECTIONS } from '../research/framework'

// Structure and guidance text of the UCEMA "Plantilla trabajo final - MBA" (2026),
// with the body laid out as the 2026 workshop asks.

export const SECTION_KINDS = ['dedicatoria', 'agradecimientos', 'resumen', 'toc', 'cuerpo', 'referencias', 'apendices'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

export const SECTION_INFO: Record<SectionKind, { label: string; title?: string; optional?: boolean }> = {
  dedicatoria: { label: 'Dedicatoria', optional: true },
  agradecimientos: { label: 'Agradecimientos', optional: true },
  resumen: { label: 'Resumen', title: 'Resumen' },
  toc: { label: 'Tabla de contenidos', title: 'Tabla de Contenidos' },
  cuerpo: { label: 'Cuerpo del trabajo' },
  referencias: { label: 'Referencias bibliográficas', title: 'Referencias Bibliográficas' },
  apendices: { label: 'Materiales suplementarios', title: 'Materiales Suplementarios', optional: true }
}

/** A section's title: the student's, else the template's. Editable on the sheet. */
export const sectionTitle = (kind: SectionKind, custom?: string | null): string | undefined =>
  SECTION_INFO[kind]?.title ? custom?.trim() || SECTION_INFO[kind].title : undefined

/** The body's headings, in order (levels 4 and 5 run in, ending in a period). Every one can be renamed or deleted. */
export const BODY_OUTLINE: { level: 1 | 2 | 3 | 4; text: string }[] = [
  { level: 1, text: 'Introducción' },
  { level: 2, text: 'Estado del Arte y Revisión Bibliográfica' },
  { level: 2, text: 'Planteo y Relevancia del Problema' },
  { level: 2, text: 'Pregunta de Investigación' },
  { level: 2, text: 'Hipótesis' },
  { level: 1, text: 'Objetivo General' },
  { level: 1, text: 'Desarrollo del Tema' },
  { level: 2, text: 'Métodos' },
  { level: 3, text: 'Participantes' },
  { level: 4, text: 'Consideraciones Éticas.' },
  { level: 4, text: 'Criterios de Inclusión y Exclusión.' },
  { level: 4, text: 'Muestreo.' },
  { level: 3, text: 'Herramientas' },
  { level: 4, text: 'Diseño.' },
  { level: 4, text: 'Materiales.' },
  { level: 4, text: 'Procedimiento.' },
  { level: 4, text: 'Procesamiento Estadístico.' },
  { level: 2, text: 'Resultados' },
  { level: 2, text: 'Conclusión, Discusión y Aplicación' }
]

export const WORD_LIMIT = 18000
export const ABSTRACT_LIMIT = 250
export const KEYWORDS_LABEL = 'Palabras clave'

/** Guidance shown as a placeholder in the empty paragraph that follows each heading. */
export const HEADING_GUIDANCE: Record<string, string> = {
  introduccion:
    'Informá al lector sobre el contenido del trabajo, los objetivos y la metodología seguida. Podés destacar el aporte para la comunidad académica o empresarial. Breve y clara.',
  'estado del arte y revision bibliografica':
    'Qué dice la literatura sobre tus 2 temas y su relación: los constructos con sus autores, los hallazgos principales y lo que todavía no se sabe. Citá cada idea ajena (APA 7).',
  'objetivo general':
    'Condensá el tema central del trabajo (la respuesta a la pregunta que se plantea) con verbos en infinitivo: analizar, identificar, describir, comprobar…',
  ...Object.fromEntries(PROBLEM_SECTIONS.map((p) => [normalizeHeading(p.heading), p.guidance])),
  'tema y relevancia del problema': PROBLEM_SECTIONS[0].guidance,
  'desarrollo del tema': 'Cómo se estudió el problema y qué se encontró: métodos, resultados y la conclusión, discusión y aplicación.',
  metodos: 'Quiénes participaron, con qué herramientas y cómo se procesaron los datos, con el detalle suficiente para replicar el estudio.',
  participantes: 'La muestra: cantidad, características demográficas y cómo se reclutó. Abajo: consideraciones éticas, criterios de inclusión y exclusión, y muestreo.',
  herramientas: 'Diseño del estudio, materiales (instrumentos, con su validación y confiabilidad), procedimiento y procesamiento estadístico.',
  resultados: 'Los resultados en el orden de las hipótesis, con tablas y figuras en formato APA, sin interpretarlos todavía.',
  'conclusion, discusion y aplicacion':
    'Interpretá los resultados frente a la literatura, con sus limitaciones e implicancias, y proponé la aplicación práctica para las organizaciones. Cerrá recapitulando el aporte en relación con el objetivo.',
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

export function normalizeHeading(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const p = (content?: JSONContent[]): JSONContent => (content ? { type: 'paragraph', content } : { type: 'paragraph' })

export function defaultSectionContent(kind: SectionKind): JSONContent[] {
  switch (kind) {
    case 'resumen':
      return [p(), p([{ type: 'text', text: `${KEYWORDS_LABEL}:`, marks: [{ type: 'italic' }] }, { type: 'text', text: ' ' }])]
    case 'toc':
      return [{ type: 'tocBlock' }]
    case 'cuerpo':
      return BODY_OUTLINE.map(outlineNode).flatMap((n) => (n.type === 'heading' ? [n, p()] : [n]))
    case 'referencias':
      return [{ type: 'referenceList' }]
    default:
      return [p()]
  }
}

/** A heading of the outline as a node: a heading, or a paragraph that opens with a run-in heading. */
export function outlineNode(o: (typeof BODY_OUTLINE)[number]): JSONContent {
  return o.level <= 3 ? h(o.level, o.text) : p([{ type: 'text', text: o.text, marks: [{ type: 'runIn', attrs: { level: o.level } }] }, { type: 'text', text: ' ' }])
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

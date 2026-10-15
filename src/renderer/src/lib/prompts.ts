import type { Note, Paper, Settings } from '@shared/types'
import { authorLine, STYLE_LABELS } from './citation'
import { getPaperText } from './ingest'
import { researchBlock } from '../research/framework'
import { voiceBlock } from './voice'

// Total characters of source text we hand the model (~90k tokens).
const BUDGET = 360_000

export interface Source {
  key: string // S1, S2…
  paper: Paper
}

/** The student's thesis and the course's research framework: in every assistant's instructions. */
export function thesisBlock(s: Settings): string {
  const lines: string[] = []
  if (s.thesisTitle.trim()) lines.push(`Título provisorio de la tesis: "${s.thesisTitle.trim()}"`)
  if (s.researchQuestion.trim()) lines.push(`Pregunta de investigación: ${s.researchQuestion.trim()}`)
  return `${lines.length ? lines.join('\n') : 'El estudiante todavía no describió su tesis.'}\n\n${researchBlock(s)}`
}

export const RULES = (style: string) => `Cómo responder:
- Fundamentá cada afirmación en las fuentes. Citá dentro del texto con el formato exacto [S1, p. 12] (id de la fuente y después la página). Varias: [S1, p. 3; S2, p. 8]. Nunca inventes páginas, citas textuales ni hallazgos.
- Si las fuentes no cubren algo, decilo en una línea y después respondé con conocimiento general, aclarando que lo es.
- Sé conciso y fácil de escanear: párrafos cortos, listas con viñetas, términos clave en **negrita**, títulos Markdown solo en respuestas largas. Sin preámbulo ni ofrecimientos al cierre.
- Cuando cites textualmente, hacelo de forma exacta y breve.
- Respondé siempre en español (registro académico rioplatense, como en la Universidad del CEMA), incluso si el estudiante escribe en otro idioma o la fuente está en inglés. Dejá las citas textuales tal cual en su idioma original y agregá una traducción al español entre paréntesis inmediatamente después.
- Cuando te pidan referencias o citas, formatealas en estilo ${style}.`

async function sourceBlocks(sources: Source[]): Promise<string> {
  const per = Math.floor(BUDGET / Math.max(1, sources.length))
  const blocks = await Promise.all(
    sources.map(async ({ key, paper }) => {
      const pages = (await getPaperText(paper.id)) ?? []
      let body = ''
      for (const p of pages) {
        const chunk = `\n[Page ${p.page}]\n${p.text}\n`
        if (body.length + chunk.length > per) {
          body += `\n[… truncado después de la página ${p.page - 1} de ${pages.length}]`
          break
        }
        body += chunk
      }
      if (!pages.length) body = paper.abstract ? `(Texto completo no disponible. Resumen:)\n${paper.abstract}` : '(Texto no disponible.)'
      const attrs = `id="${key}" title="${paper.title.replace(/"/g, "'")}" authors="${authorLine(paper, 6)}" year="${paper.year ?? ''}"`
      return `<source ${attrs}>${body}</source>`
    })
  )
  return blocks.join('\n\n')
}

/** A paper chat's instructions up to the paper's text (the Marco de investigación tab checks it too). */
export function paperPreamble(settings: Settings): string {
  return `Sos el asistente de investigación dentro de Thesis Studio, una app de escritorio donde un estudiante de MBA lee papers académicos, los anota y escribe su tesis. En este momento el estudiante está leyendo la fuente S1.

${thesisBlock(settings)}

${RULES(STYLE_LABELS[settings.citationStyle])}
- «Este paper» se refiere a S1.`
}

export async function paperInstructions(paper: Paper, settings: Settings): Promise<string> {
  return `${paperPreamble(settings)}

Fuentes:
${await sourceBlocks([{ key: 'S1', paper }])}`
}

export async function noteInstructions(note: Note, papers: Paper[], allPapers: Paper[], settings: Settings): Promise<string> {
  const sources = papers.map((paper, i) => ({ key: `S${i + 1}`, paper }))
  const catalog = allPapers
    .filter((p) => !papers.includes(p))
    .slice(0, 150)
    .map((p) => `- "${p.title}" — ${authorLine(p) || 'autores desconocidos'}${p.year ? ` (${p.year})` : ''}${p.abstract ? `: ${p.abstract.slice(0, 280)}…` : ''}`)
    .join('\n')
  return `Sos el asistente de investigación dentro de Thesis Studio, una app de escritorio donde un estudiante de MBA lee papers y escribe su tesis. El estudiante está trabajando en una nota titulada "${note.title || 'Sin título'}". Lo ayudás a ordenar ideas, reforzar argumentos, encontrar fuentes que respalden lo que dice y escribir con claridad en registro académico. El contenido actual de la nota viene adjunto en cada mensaje.

${thesisBlock(settings)}

${RULES(STYLE_LABELS[settings.citationStyle])}
- Cuando sugieras otros papers del catálogo de la biblioteca, nombralos por título y autor.

${voiceBlock(settings, { samples: true })}

${sources.length ? `Fuentes vinculadas a esta nota:\n${await sourceBlocks(sources)}` : 'Todavía no hay papers vinculados a esta nota.'}

${catalog ? `Otros papers en la biblioteca del estudiante (solo títulos y resúmenes):\n${catalog}` : ''}`
}

export interface QuickAction {
  label: string
  /** One line on what you get back, so the choice is quick (Hick's law). */
  hint: string
  prompt: string
  /** Put the prompt in the composer to finish, instead of sending it (it ends with what the student fills in). */
  prefill?: boolean
}

export const PAPER_ACTIONS: QuickAction[] = [
  {
    label: 'Resumir',
    hint: 'Pregunta, método, hallazgos y límites',
    prompt:
      'Resumime este paper para mi tesis: la pregunta de investigación, el método y los datos, los hallazgos principales y las limitaciones. Citá páginas.'
  },
  {
    label: 'Relevancia para mi tesis',
    hint: 'Dónde respalda o discute tu argumento',
    prompt:
      '¿Cómo se relaciona este paper con mi tesis y con mi combinación de temas? ¿Cuáles de mis argumentos o hipótesis podría respaldar o discutir, qué instrumento usa para medir cada constructo y qué pasajes exactos tendría que citar? Citá páginas.'
  },
  {
    label: 'Crítica',
    hint: 'Lo que cuestionaría un jurado',
    prompt:
      'Evaluá críticamente este paper: fortalezas, debilidades, amenazas a la validez y qué podría cuestionar un jurado de tesis. Citá páginas.'
  },
  {
    label: 'Citas clave',
    hint: 'Cinco pasajes citables con su página',
    prompt: 'Elegí los 5 pasajes más citables para una tesis de MBA, textuales y con el número de página, cada uno con una línea sobre cómo usarlo.'
  }
]

export const NOTE_ACTIONS: QuickAction[] = [
  {
    label: 'Ordenar mis ideas',
    hint: 'Convertir la nota en un esquema claro',
    prompt: 'Reorganizá las ideas de mi nota en un esquema claro y lógico, con títulos y viñetas. Conservá mi contenido, agrupá los puntos relacionados y señalá los duplicados.'
  },
  {
    label: 'Encontrar huecos',
    hint: 'Afirmaciones débiles o sin respaldo, y cómo cubrirlas',
    prompt: '¿Cuáles son los huecos, los argumentos débiles o las afirmaciones sin respaldo en mi nota? Para cada uno, sugerí qué evidencia lo resolvería y cuál de mis papers podría aportarla.'
  },
  {
    label: 'Sugerir fuentes',
    hint: 'Papers de tu biblioteca para cada afirmación',
    prompt: 'Para las afirmaciones principales de mi nota, sugerí qué papers de mi biblioteca las respaldan o las discuten, y por qué.'
  },
  {
    label: 'Pulir la redacción',
    hint: 'Registro académico, mismo significado',
    prompt: 'Reescribí mi nota en un registro académico claro, apto para una tesis de MBA. Conservá el significado y las citas. Devolvé solo el texto reescrito.'
  }
]

export const explainPrompt = (quote: string, page: number) =>
  `Explicá este pasaje de la página ${page} en palabras simples, y cómo encaja en el argumento del paper:\n\n> ${quote.replace(/\n+/g, ' ')}`

export const quotePrefix = (quote: string, page: number) => `Sobre este pasaje (p. ${page}):\n> ${quote.replace(/\n+/g, ' ')}\n\n`

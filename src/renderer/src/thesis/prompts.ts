import type { Paper, Settings, Thesis } from '@shared/types'
import { noteInstructions, type QuickAction } from '../lib/prompts'
import { fullTitle } from './template'

// The UCEMA guidelines allow AI for grammar, style, format and APA checks,
// never to replace the student's analysis or argument. The assistant's
// instructions and quick actions for the thesis stay inside that line.

const POLICY = `This is the student's graded MBA final project (Universidad del CEMA). University policy on AI:
- Allowed: correcting writing and grammar, checking format and APA 7 citations/references, pointing out unclear passages.
- Not allowed: writing the analysis, arguments or original content for the student. If asked to write sections, decline briefly and instead give feedback, questions or an outline the student can develop in their own words.
- Every suggestion must be reviewed by the student; say so when a change could alter meaning.
Format rules the thesis must follow: Spanish; Calibri 11; double spacing; 1.27 cm indent; unnumbered title-case headings (5 APA levels); max 18,000 words including abstract, references and footnotes; abstract ≤ 250 words in one paragraph followed by "Palabras clave"; APA 7 in Spanish (y, s. f.).
Always answer in Spanish, whatever language the student writes in.`

export async function thesisInstructions(thesis: Thesis, sources: Paper[], allPapers: Paper[], settings: Settings): Promise<string> {
  const base = await noteInstructions(
    { id: thesis.id, title: fullTitle(thesis.meta) || 'Trabajo Final', content: null, plain: '', paperIds: [], createdAt: 0, updatedAt: 0 },
    sources,
    allPapers,
    settings
  )
  return `${base.replace('working on a note titled', 'writing their final thesis, titled')}\n\n${POLICY}`
}

export const THESIS_ACTIONS: QuickAction[] = [
  {
    label: 'Revisar redacción',
    hint: 'Gramática, puntuación y claridad',
    prompt:
      'Revisá la redacción de mi tesis: errores de gramática, ortografía y puntuación, y frases poco claras. Listá cada problema con la cita textual y una corrección sugerida. No reescribas el contenido.'
  },
  {
    label: 'Verificar APA',
    hint: 'Citas en el texto y referencias',
    prompt:
      'Verificá el uso de normas APA 7 (en español) en las citas del texto y en la lista de referencias. Señalá cada error con su corrección.'
  },
  {
    label: 'Revisar formato',
    hint: 'Títulos, resumen y estructura UCEMA',
    prompt:
      'Revisá si mi tesis cumple la estructura y el formato de la plantilla UCEMA: niveles de título y capitalización, resumen y palabras clave, introducción, objetivo general y conclusión. Indicá qué ajustar.'
  },
  {
    label: 'Coherencia del argumento',
    hint: 'Preguntas de un jurado, sin reescribir',
    prompt:
      'Sin escribir contenido por mí: ¿el objetivo general se responde en la conclusión? ¿Qué afirmaciones necesitan más evidencia y qué preguntaría un jurado? Respondé con observaciones y preguntas.'
  }
]

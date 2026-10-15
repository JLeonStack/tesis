import type { JSONContent } from '@tiptap/core'
import type { PaperRecall, RecallAnswer, RecallAttempt, RecallVerdict, Settings } from '@shared/types'
import { researchBrief } from '../research/framework'
import { aiModel, saveRecall, useStore } from '../store'
import { insertIntoNote, paperNote } from '../editor/noteBridge'
import { paperBody } from './guide'

// Recall check: answer a paper's core questions from memory, get graded
// against the paper, and see it again later. Retrieval practice and spacing
// are the two study techniques with the strongest evidence (Dunlosky et al.,
// 2013); recalling a text beat rereading it a week later (Roediger &
// Karpicke, 2006: 61% vs 40%).

const DAY = 86_400_000

/** For papers without a v2 guide: the four things worth remembering about any empirical paper. */
export const GENERIC_QUESTIONS = [
  '¿Qué pregunta o problema investiga el paper?',
  '¿Cómo lo estudia (diseño, datos, muestra)?',
  '¿Qué encuentra? Nombrá los hallazgos principales.',
  '¿Qué limitaciones o condiciones reconoce?'
]

export function recallQuestions(paperId: string): string[] {
  const g = useStore.getState().guides[paperId]
  return g?.recall?.length ? g.recall : GENERIC_QUESTIONS
}

export const VERDICT_LABEL: Record<RecallVerdict, string> = { right: 'Bien', partial: 'Incompleta', missed: 'Faltó' }
const POINTS: Record<RecallVerdict, number> = { right: 1, partial: 0.5, missed: 0 }

/** Papers whose next review has arrived, oldest first. */
export function dueRecalls(now = Date.now()): PaperRecall[] {
  const { recalls, papers } = useStore.getState()
  return Object.values(recalls)
    .filter((r) => r.dueAt <= now && papers[r.id])
    .sort((a, b) => a.dueAt - b.dueAt)
}

/**
 * Next interval: weak recall comes back tomorrow; good recall waits longer
 * each time (2 days, then ×2.5), capped at two months.
 */
export function nextInterval(prev: PaperRecall | undefined, score: number): number {
  if (score < 0.6) return 1
  if (!prev) return 2
  return Math.min(60, Math.max(2, Math.round(prev.interval * 2.5)))
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers', 'summary'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'feedback', 'pages'],
        properties: {
          verdict: { type: 'string', enum: ['right', 'partial', 'missed'] },
          feedback: { type: 'string' },
          pages: { type: 'array', items: { type: 'integer' } }
        }
      }
    },
    summary: { type: 'string' }
  }
}

const INSTRUCTIONS = `Sos un tutor de lectura académica para un estudiante de MBA (Universidad del CEMA). El estudiante leyó un paper y respondió preguntas de memoria, sin mirarlo. Corregí cada respuesta comparándola con el paper.

- verdict: "right" si captura la idea central aunque use otras palabras; "partial" si es correcta pero incompleta o imprecisa; "missed" si está vacía, es errónea o no responde la pregunta.
- feedback: en español rioplatense, 1 a 3 oraciones, directo y amable. Si es "right", confirmá en pocas palabras qué estuvo bien. Si no, decí qué faltó o qué es incorrecto y cuál es la respuesta según el paper. Nunca inventes: basate solo en el paper.
- pages: las páginas ([Page N]) donde está la respuesta, para que pueda releerlas.
- summary: una oración en español con el balance y qué releer primero.
Devolvé una entrada en "answers" por pregunta, en el mismo orden.`

/** The grader's instructions, with the course framework: feedback can point at what matters for the student's pair. */
export const recallInstructions = (s: Pick<Settings, 'research' | 'researchQuestion'>) =>
  `${INSTRUCTIONS}\n- Si viene al caso, señalá en una frase cómo se conecta la respuesta con los temas de su tesis (abajo); nunca a costa de corregir lo que dice el paper.\n\n${researchBrief(s)}`

/** Grades the answers against the paper's text. */
export async function gradeRecall(paperId: string, qa: { question: string; answer: string }[]): Promise<{ answers: RecallAnswer[]; summary: string }> {
  const { body } = await paperBody(paperId)
  const list = qa.map((x, i) => `${i + 1}. Pregunta: ${x.question}\nRespuesta del estudiante: ${x.answer.trim() || '(sin respuesta)'}`).join('\n\n')
  const r = (await window.api.ai.extract(`<paper>${body}</paper>\n\nRespuestas de memoria:\n\n${list}`, SCHEMA, {
    instructions: recallInstructions(useStore.getState().settings),
    model: aiModel().id,
    effort: 'medium'
  })) as { answers: { verdict: RecallVerdict; feedback: string; pages: number[] }[]; summary: string }
  return {
    summary: r.summary,
    answers: qa.map((x, i) => {
      const g = r.answers[i] ?? { verdict: 'missed' as const, feedback: 'No se pudo corregir esta respuesta.', pages: [] }
      return { question: x.question, answer: x.answer.trim(), verdict: g.verdict, feedback: g.feedback, pages: [...new Set(g.pages)].sort((a, b) => a - b) }
    })
  }
}

/** Saves an attempt and schedules the next review. */
export function recordAttempt(paperId: string, answers: RecallAnswer[], summary: string): RecallAttempt {
  const prev = useStore.getState().recalls[paperId]
  const score = answers.length ? answers.reduce((n, a) => n + POINTS[a.verdict], 0) / answers.length : 0
  const attempt: RecallAttempt = { at: Date.now(), answers, summary, score }
  const interval = nextInterval(prev, score)
  saveRecall({ id: paperId, attempts: [...(prev?.attempts ?? []), attempt], interval, dueAt: attempt.at + interval * DAY })
  return attempt
}

/** The student's own words go to the paper's own note (not whatever note is open): material for the thesis, written by them. */
export function saveAnswersToNote(paperId: string, attempt: RecallAttempt): void {
  const date = new Date(attempt.at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
  const content: JSONContent[] = [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `En mis palabras · ${date}` }] }]
  for (const a of attempt.answers) {
    if (!a.answer) continue
    content.push({ type: 'paragraph', content: [{ type: 'text', text: a.question, marks: [{ type: 'bold' }] }] })
    content.push({ type: 'paragraph', content: [{ type: 'text', text: a.answer }] })
    if (a.verdict !== 'right') {
      const pages = a.pages.length ? ` (p. ${a.pages.join(', ')})` : ''
      content.push({ type: 'paragraph', content: [{ type: 'text', text: `Para completar: ${a.feedback}${pages}`, marks: [{ type: 'italic' }] }] })
    }
  }
  if (content.length > 1) insertIntoNote(paperNote(paperId), content, paperId)
}

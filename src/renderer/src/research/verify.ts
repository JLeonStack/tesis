import type { Note, Thesis } from '@shared/types'
import { currentThesis, type State } from '../store'
import { noteInstructions, paperPreamble } from '../lib/prompts'
import { guideInstructions } from '../lib/guide'
import { agentInstructions, agentSources } from '../agent/context'
import { thesisInstructions } from '../thesis/prompts'
import { tasksInstructions } from '../tasks/assist'
import { wikiInstructions } from '../wiki/knowledge'
import { matrixInstructions } from '../matrix/model'
import { assistInstructions } from '../thesis/assist'
import { autocompleteInstructions } from '../thesis/autocomplete'
import { recallInstructions } from '../lib/recall'
import { evidenceInstructions } from '../thesis/evidence'
import { agentContext } from '../agent/context'
import { DEADLINE, DEMOGRAPHICS, FRAMEWORK_TAG, chosenPair, fmtDeadline } from './framework'
import { VOICE_TAG, voiceBlock } from '../lib/voice'

// Proof that the framework reaches the model: each assistant's instructions are
// built exactly as a chat would build them, then searched for the framework
// and for the student's current choices.

export interface Probe {
  id: string
  label: string
  /** What it's used for, in a few words. */
  where: string
  ok: boolean
  /** What's missing from its instructions, when not ok. */
  missing: string[]
  chars: number
}

const PROBE_NOTE: Note = { id: 'probe', title: 'Nota', content: null, plain: '', paperIds: [], createdAt: 0, updatedAt: 0 }
const PROBE_THESIS: Thesis = {
  id: 'probe',
  meta: { title: '', subtitle: '', author: '', tutorDegree: '', tutor: '', date: '', dni: '', auth: { repositorio: null, catalogo: null, web: null } },
  content: null,
  plain: '',
  createdAt: 0,
  updatedAt: 0
}

interface Target {
  id: string
  label: string
  where: string
  /** One-shot helpers get the short version: the pair, question, hypotheses and demographics, without the calendar and rules. */
  brief?: boolean
  /** Checks something other than the framework (the analysis results reach the assistant with each message). */
  needles?: (s: State) => [string, string][]
  /** Writes or rewrites the student's text, so it also gets their voice (Ajustes → Tu voz). */
  voice?: boolean
  build: (s: State) => string | Promise<string>
}

const TARGETS: Target[] = [
  { id: 'agent', label: 'Asistente general', where: 'Su pestaña, el panel lateral, la pizarra y este marco', voice: true, build: (s) => agentInstructions(s, agentSources(s)) },
  { id: 'paper', label: 'Chat de cada paper', where: 'Panel lateral al leer', build: (s) => paperPreamble(s.settings) },
  { id: 'guide', label: 'Guías de lectura', where: 'Relevancia, TL;DR y fila de la matriz', build: (s) => guideInstructions(s.settings) },
  {
    id: 'note',
    label: 'Chat de cada nota',
    where: 'Panel lateral en una nota',
    voice: true,
    build: (s) => noteInstructions(PROBE_NOTE, [], [], s.settings)
  },
  {
    id: 'thesis',
    label: 'Asistente de la tesis',
    where: 'Panel lateral en el editor de tesis',
    voice: true,
    build: (s) => thesisInstructions(currentThesis() ?? PROBE_THESIS, [], [], s.settings)
  },
  { id: 'tasks', label: 'Planificación', where: 'Tareas, cronograma y pomodoros', build: (s) => tasksInstructions(s.settings, []) },
  { id: 'wiki', label: 'Conocimiento', where: 'Wiki de resaltados y glosario', build: (s) => wikiInstructions(s, [], s.settings) },
  { id: 'matrix', label: 'Matriz de literatura', where: 'Comparar y filtrar papers', build: (s) => matrixInstructions(s, [], '') },
  { id: 'assist', label: 'Ayudas de redacción', where: 'Corregir, sinónimos, más claro, ideas (editor de tesis)', brief: true, voice: true, build: (s) => assistInstructions(s.settings) },
  { id: 'autocomplete', label: 'Autocompletado', where: 'Texto fantasma al escribir la tesis', brief: true, voice: true, build: (s) => autocompleteInstructions(s.settings) },
  { id: 'evidence', label: 'Respaldo de citas', where: 'Verifica si tus papers apoyan cada oración (editor de tesis)', brief: true, build: (s) => evidenceInstructions(s.settings) },
  { id: 'recall', label: 'Corrección de repasos', where: 'Comprobá lo que leíste', brief: true, build: (s) => recallInstructions(s.settings) },
  {
    id: 'analysis',
    label: 'Resultados del análisis',
    where: 'Van con cada mensaje al asistente general: solo esos números',
    needles: (s) => [['<analysis>', 'el bloque de resultados'], ...(s.settings.analysis.datasetId && s.datasets[s.settings.analysis.datasetId] ? ([['Resultados calculados por la app', 'los resultados de tu base']] as [string, string][]) : [])],
    build: (s) => agentContext(s, [])
  }
]

/** How many assistants are checked (for placeholders while the probe runs). */
export const TARGET_COUNT = TARGETS.length

/** AI calls that deliberately don't get the framework, and why. */
export const EXCLUDED: { label: string; why: string }[] = [
  { label: 'Traducción de pasajes y citas', why: 'Traduce el texto tal cual: el marco no debe teñir la traducción.' },
  { label: 'Metadatos de papers importados', why: 'Solo extrae autor, año y título del PDF.' }
]

export async function probeAssistants(s: State): Promise<Probe[]> {
  const r = s.settings.research
  const pair = chosenPair(r)
  const expect: [string, string][] = [[`<${FRAMEWORK_TAG}>`, 'el marco de la cátedra']]
  if (pair.length === 2) expect.push([`Combinación elegida por el estudiante: ${pair[0].label} × ${pair[1].label}`, 'tu combinación'])
  for (const d of DEMOGRAPHICS.filter((d) => r.demographics.includes(d.id))) expect.push([d.label, `la variable ${d.label.toLowerCase()}`])
  if (r.hypotheses.trim()) expect.push([r.hypotheses.trim(), 'tus hipótesis'])
  if (s.settings.researchQuestion.trim()) expect.push([s.settings.researchQuestion.trim(), 'tu pregunta de investigación'])
  // Only in the full block: the calendar and the UCEMA rules on format and AI use.
  const full: [string, string][] = [
    [fmtDeadline(DEADLINE), 'la fecha de entrega'],
    ['Uso de IA (Pautas UCEMA 8.e)', 'la política de uso de IA'],
    ['Requisitos formales (Pautas UCEMA)', 'los requisitos formales'],
    ['Pautas del taller para el planteo', 'las pautas de tema, pregunta e hipótesis']
  ]

  return Promise.all(
    TARGETS.map(async (t) => {
      let text = ''
      try {
        text = await t.build(s)
      } catch {
        // Counts as missing everything below.
      }
      const needles = t.needles ? t.needles(s) : t.brief ? [...expect] : [...expect, ...full]
      if (t.voice && voiceBlock(s.settings)) needles.push([`<${VOICE_TAG}>`, 'tu voz de escritura'])
      const missing = needles.filter(([needle]) => !text.includes(needle)).map(([, what]) => what)
      return { id: t.id, label: t.label, where: t.where, ok: !!text && !missing.length, missing: text ? missing : ['no se pudo construir'], chars: text.length }
    })
  )
}

import type { Paper } from '@shared/types'
import { currentThesis, type State } from '../store'
import { authorLine, STYLE_LABELS } from '../lib/citation'
import { thesisBlock, type QuickAction } from '../lib/prompts'
import { voiceBlock } from '../lib/voice'
import { getPaperText } from '../lib/ingest'
import { readBoard } from '../board/bridge'
import { tasksContext } from '../tasks/assist'
import { actionsProtocol, type Action } from './actions'
import { liveThesis } from '../thesis/bridge'
import { analyze, countWords } from '../thesis/analyze'
import { fullTitle } from '../thesis/template'
import { matrixViewContext } from '../matrix/model'
import { progressContext } from '../progress/model'
import { analysisContext } from '../analysis/use'

// The general assistant sees the whole workspace: a catalog of the library
// (in the system prompt, cited as S1, S2…), the notes, the thesis; and with
// every message, what the student is looking at, their lists and their tasks.

const CATALOG_BUDGET = 260_000
const READ_BUDGET = 200_000

/** Papers in the order they were added: keys stay put as the library grows. */
export function agentSources(s: Pick<State, 'papers'>): Paper[] {
  return Object.values(s.papers).sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
}

const clip = (t: string | undefined, n: number) => (t ? (t.length > n ? `${t.slice(0, n)}…` : t) : '')
const attr = (t: string) => t.replace(/"/g, "'")

export function agentInstructions(s: State, sources: Paper[]): string {
  const per = Math.floor(CATALOG_BUDGET / Math.max(1, sources.length))
  const highlights = new Map<string, number>()
  for (const a of Object.values(s.annotations)) highlights.set(a.paperId, (highlights.get(a.paperId) ?? 0) + 1)
  const catalog = sources.map((p, i) => {
    const g = s.guides[p.id]
    const lines = [`${p.title} — ${authorLine(p, 4) || 'autores desconocidos'}${p.year ? ` (${p.year})` : ''}${p.venue ? `. ${p.venue}` : ''}`]
    if (p.abstract) lines.push(`Resumen: ${clip(p.abstract, 700)}`)
    if (g?.tldr) lines.push(`En breve: ${g.tldr}`)
    if (g?.relevance) lines.push(`Relevancia para la tesis (${g.relevanceLevel}): ${g.relevance}`)
    if (g?.matrix) lines.push(`Pregunta: ${g.matrix.question} | Teoría: ${g.matrix.theory} | Método: ${g.matrix.method} | Contexto: ${g.matrix.context} | Hallazgos: ${g.matrix.findings} | Limitaciones: ${g.matrix.limitations}`)
    if (g?.terms.length) lines.push(`Términos clave: ${g.terms.map((t) => t.term).join(', ')}`)
    const saved = highlights.get(p.id)
    const meta = [`key="S${i + 1}"`, `id="${p.id}"`, `status="${p.status}"`, p.starred ? 'starred="true"' : '', p.tags.length ? `tags="${attr(p.tags.join(', '))}"` : '', p.pageCount ? `pages="${p.pageCount}"` : '', saved ? `highlights="${saved}"` : '']
    return `<paper ${meta.filter(Boolean).join(' ')}>\n${clip(lines.join('\n'), per)}\n</paper>`
  })
  const key = new Map(sources.map((p, i) => [p.id, `S${i + 1}`]))
  const notes = Object.values(s.notes)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 200)
    .map((n) => {
      const linked = n.paperIds.map((id) => key.get(id)).filter(Boolean)
      return `- id="${n.id}" "${attr(n.title || 'Sin título')}"${linked.length ? ` (sobre ${linked.join(', ')})` : ''}: ${clip(n.plain.replace(/\s+/g, ' '), 240)}`
    })

  return `Sos el asistente general dentro de Thesis Studio, una app de escritorio donde un estudiante de MBA (Universidad del CEMA) lee papers, toma notas, planifica y escribe su tesis. Ves todo su espacio de trabajo. Ayudalo a pensar e iterar ideas, a decidir qué leer después, a encontrar papers relacionados en su biblioteca, a que el plan avance, y hacé cosas en la app por él.

${thesisBlock(s.settings)}

Cómo responder:
- Respondé siempre en español (rioplatense, cálido y directo), incluso si el estudiante escribe en otro idioma. Conciso y fácil de escanear: párrafos cortos, viñetas, ideas clave en **negrita**. Sin preámbulo ni ofrecimientos al cierre.
- Recomendá primero lecturas de su biblioteca: decí por qué cada una encaja con lo que busca (qué estudia, su método o sus hallazgos, cómo se conecta), de la más útil a la menos, y sumá una acción "open" para cada una así puede abrirla de un clic. Citá los papers de la biblioteca por autor y año; cuando cites lo que dice un paper en una página (después de leerlo), usá el formato exacto [S3, p. 12].
- Solo ves la entrada de catálogo de cada paper (resumen, síntesis de la guía de lectura, fila de la matriz). Para responder sobre lo que un paper realmente dice, leelo primero (ver "read" más abajo). Nunca inventes hallazgos, citas textuales ni páginas.
- Cuando su biblioteca no alcance, podés sugerir obras externas conocidas de cuya existencia estés seguro, marcadas claramente como "fuera de tu biblioteca" y con la indicación de verificarlas; nunca inventes referencias. Formateá las referencias en estilo ${STYLE_LABELS[s.settings.citationStyle]} cuando te lo pidan.
- Prestá atención a lo que está haciendo el estudiante. Cada mensaje viene con el estado en vivo de la app: <now>, <where> (la pantalla en la que está y las pestañas que tiene abiertas), <focus> (el paper o la nota en la que estuvo por última vez, con la página en la que está y sus resaltados ahí), <selection> (el pasaje que seleccionó por última vez), <recent> (lo que hizo últimamente: resaltados, notas, lecturas, tareas), <thesis_draft>, <lists>, <tasks>, <timer> (el temporizador pomodoro), <progress> (palabras escritas, sesiones de foco y avance por etapa), <analysis> (los resultados calculados con la base de la cátedra, si ya la importó), <board> (lo que está dibujado en la pizarra, mientras esté abierta) y, mientras la matriz de literatura esté en pantalla, <matrix_view> (las filas que ve y las que seleccionó: «estos papers», «los seleccionados»; cuando ahí pida encontrar, filtrar o rankear papers, mostralos con "matrix.show"). Confiá más en eso que en los mensajes anteriores, y usalo sin que te lo pidan: conectá las respuestas con lo que está leyendo o escribiendo ahora, y notá qué vence o qué quedó a medias cuando importe. No lo repitas de vuelta.
- «Este paper» / «lo que estoy leyendo» es el paper que está en <focus>; «esta nota», la nota en <focus>; «esto» / «este párrafo», por lo general el pasaje en <selection>.

${voiceBlock(s.settings)}

${actionsProtocol('agent')}

La biblioteca del estudiante (${sources.length} papers):
${catalog.join('\n') || '(vacía: todavía no importó papers)'}

Las notas del estudiante (las más recientes primero):
${notes.join('\n') || '(todavía no hay notas)'}`
}

const flat = (t: string) => t.replace(/\s+/g, ' ').trim()

/** "hace 5 min", for timestamps in the context. */
function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000)
  if (m < 1) return 'recién'
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

const VIEW_NAMES: Record<string, string> = {
  board: 'la pizarra',
  matrix: 'la matriz de literatura',
  tasks: 'la vista de tareas y cronograma',
  wiki: 'la wiki de conocimiento (resaltados, notas, glosario)',
  research: 'el marco de investigación de la cátedra (sus 2 temas, demografía, hipótesis, chequeos y plan)',
  agent: 'la pestaña del asistente (hablando con vos)'
}

/** One line for a tab. */
function tabName(s: State, kind: string, id: string, key: Map<string, string>): string {
  if (kind === 'paper' && s.papers[id]) return `el paper ${key.get(id)} "${attr(clip(s.papers[id].title, 90))}"`
  if (kind === 'note' && s.notes[id]) return `la nota "${attr(s.notes[id].title || 'Sin título')}" (id "${id}")`
  if (kind === 'thesis') return 'el borrador de su tesis'
  return VIEW_NAMES[kind] ?? kind
}

const DAY = 86_400_000

/** The app's state with each message: what the student is doing, and their lists and tasks. */
export async function agentContext(s: State, sources: Paper[]): Promise<string> {
  const key = new Map(sources.map((p, i) => [p.id, `S${i + 1}`]))
  const now = new Date()
  const out: string[] = [`<now>${now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</now>`]

  // Where: the screen in front of them, and how they're talking to you.
  const [ak, aid] = (s.active ?? '').split(':')
  const screen = s.active ? tabName(s, ak, aid, key) : 'la pantalla de inicio'
  const side = ak !== 'agent' && s.rightOpen && s.rightTab === 'assistant'
  const others = s.tabs.filter((t) => `${t.kind}:${t.id}` !== s.active).map((t) => tabName(s, t.kind, t.id, key))
  const selectedTask = ak === 'tasks' && s.selectedTask && s.tasks[s.selectedTask] ? ` con la tarea "${attr(s.tasks[s.selectedTask].title)}" (id "${s.selectedTask}") abierta` : ''
  out.push(
    `<where>En pantalla: ${screen}${selectedTask}.${side ? ' Te está hablando desde el panel lateral, al lado.' : ''}${others.length ? ` Otras pestañas abiertas: ${others.slice(0, 8).join('; ')}.` : ''}</where>`
  )

  // Focus: the paper or note they were last in, in some depth.
  let focus = 'No abrió ningún paper ni nota últimamente.'
  if (s.focus?.kind === 'paper' && s.papers[s.focus.id]) {
    const p = s.papers[s.focus.id]
    const lines = [
      `Paper ${key.get(p.id)} (id "${p.id}") "${attr(p.title)}", estado "${p.status}"${p.lastPage ? `, abierto en la página ${p.lastPage}${p.pageCount ? ` de ${p.pageCount}` : ''}` : ''}${p.maxPage && p.pageCount ? ` (lo más lejos que leyó: página ${p.maxPage})` : ''}.`
    ]
    if (p.lastPage) {
      const pages = (await getPaperText(p.id)) ?? []
      const here = pages.filter((pg) => pg.page === p.lastPage || pg.page === p.lastPage! + 1)
      if (here.length) lines.push(`Lo que hay en la página en la que está:\n${here.map((pg) => `[Page ${pg.page}] ${clip(flat(pg.text), 3500)}`).join('\n')}`)
    }
    const hls = Object.values(s.annotations)
      .filter((a) => a.paperId === p.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((a) => `- id="${a.id}" p. ${a.page} (${ago(a.createdAt)}): "${clip(flat(a.text), 220)}"${a.comment ? ` — su comentario: ${clip(flat(a.comment), 200)}` : ''}`)
    if (hls.length) lines.push(`Sus resaltados en él (los más nuevos primero):\n${hls.join('\n')}`)
    focus = lines.join('\n')
  } else if (s.focus?.kind === 'note' && s.notes[s.focus.id]) {
    const n = s.notes[s.focus.id]
    const linked = n.paperIds.map((id) => key.get(id)).filter(Boolean)
    focus = `Nota id "${n.id}" "${attr(n.title || 'Sin título')}"${linked.length ? ` (sobre ${linked.join(', ')})` : ''}, editada ${ago(n.updatedAt)}. Su contenido:\n${clip(n.plain, 12_000)}`
  }
  out.push(`<focus>\n${focus}\n</focus>`)

  // Selection: the passage "this" refers to.
  const sel = s.selection
  if (sel && Date.now() - sel.at < 30 * 60_000) {
    const from = sel.paperId && s.papers[sel.paperId] ? `paper ${key.get(sel.paperId)}${sel.page ? `, página ${sel.page}` : ''}` : sel.noteId && s.notes[sel.noteId] ? `nota "${attr(s.notes[sel.noteId].title || 'Sin título')}"` : sel.thesis ? 'el borrador de su tesis' : ''
    if (from) out.push(`<selection from="${from}" when="${ago(sel.at)}">${sel.text}</selection>`)
  }

  // Recent: what they've been doing this week.
  const week = Date.now() - 7 * DAY
  const recent: string[] = []
  const hl = Object.values(s.annotations)
    .filter((a) => a.createdAt > week && a.paperId !== (s.focus?.kind === 'paper' ? s.focus.id : ''))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
  for (const a of hl) recent.push(`- resaltó en ${key.get(a.paperId) ?? 'un paper'} p. ${a.page} (${ago(a.createdAt)}, id="${a.id}"): "${clip(flat(a.text), 160)}"${a.comment ? ` — ${clip(flat(a.comment), 140)}` : ''}`)
  const notes = Object.values(s.notes)
    .filter((n) => n.updatedAt > week && n.id !== (s.focus?.kind === 'note' ? s.focus.id : ''))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)
  for (const n of notes) recent.push(`- editó la nota "${attr(n.title || 'Sin título')}" (id "${n.id}", ${ago(n.updatedAt)})`)
  const reading = Object.values(s.papers)
    .filter((p) => p.status === 'reading')
    .slice(0, 8)
  if (reading.length) recent.push(`- leyendo ahora: ${reading.map((p) => `${key.get(p.id)}${p.maxPage && p.pageCount ? ` (p. ${p.maxPage}/${p.pageCount})` : ''}`).join(', ')}`)
  const done = Object.values(s.tasks)
    .filter((t) => t.doneAt && t.doneAt > week)
    .sort((a, b) => b.doneAt! - a.doneAt!)
    .slice(0, 5)
  for (const t of done) recent.push(`- terminó la tarea "${attr(t.title)}" (${ago(t.doneAt!)})`)
  out.push(`<recent>\n${recent.join('\n') || '(nada esta semana)'}\n</recent>`)

  // Thesis draft: how far along it is.
  const thesis = currentThesis()
  if (thesis) {
    const live = liveThesis(thesis.id)
    const outline = live ? analyze(live.doc).outline.filter((o) => o.level <= 2 && o.text.trim()) : []
    const words = countWords(live ? live.doc.textBetween(0, live.doc.content.size, '\n', ' ') : thesis.plain)
    out.push(
      `<thesis_draft title="${attr(fullTitle(thesis.meta) || 'sin título')}" words="${words}" edited="${ago(thesis.updatedAt)}">${outline.length ? `\nSecciones: ${outline.map((o) => `${o.level === 2 ? '  ' : ''}${clip(o.text, 80)}`).join(' | ')}\n` : ''}(leelo con {"op":"read","thesis":true})</thesis_draft>`
    )
  } else out.push('<thesis_draft>(sin empezar)</thesis_draft>')

  const lists = Object.values(s.lists)
    .filter((l) => l.paperIds.length)
    .map((l) => `- "${attr(l.name)}": ${l.paperIds.map((id) => key.get(id)).filter(Boolean).join(', ')}`)
  out.push(`<lists>\n${lists.join('\n') || '(todavía no hay listas de lectura)'}\n</lists>`)
  // The whiteboard, while its tab is open: what's drawn, so they can talk about it and build on it.
  if (s.tabs.some((t) => t.kind === 'board')) {
    const board = await readBoard()
    out.push(`<board>\n${board ?? '(abierta, todavía cargando)'}\n</board>`)
  }
  // The matrix, while it's on screen: what "these papers" are, and the filter in place.
  const matrix = ak === 'matrix' ? matrixViewContext(s, sources) : ''
  return `\n\n${out.join('\n')}${matrix}${tasksContext(Object.values(s.tasks), ak === 'tasks' ? s.selectedTask : null)}\n${progressContext(s)}\n${analysisContext(s)}`
}

/** The material the assistant asked to read, as the app's follow-up message; and a short label for the chat. */
export async function readMaterial(reads: Extract<Action, { op: 'read' }>[], s: State, sources: Paper[]): Promise<{ text: string; label: string } | null> {
  const key = new Map(sources.map((p, i) => [p.id, `S${i + 1}`]))
  const picked = reads.slice(0, 3).filter((r) => (r.paperId ? s.papers[r.paperId] : r.noteId ? s.notes[r.noteId] : r.thesis ? currentThesis() : false))
  if (!picked.length) return null
  const per = Math.floor(READ_BUDGET / picked.length)
  const blocks: string[] = []
  const names: string[] = []
  for (const r of picked) {
    if (r.paperId) {
      const p = s.papers[r.paperId]
      const pages = (await getPaperText(p.id)) ?? []
      let body = ''
      for (const pg of pages) {
        const chunk = `\n[Page ${pg.page}]\n${pg.text}\n`
        if (body.length + chunk.length > per) {
          body += `\n[… truncado después de la página ${pg.page - 1} de ${pages.length}]`
          break
        }
        body += chunk
      }
      if (!body) body = p.abstract ? `(Texto completo no disponible. Resumen:)\n${p.abstract}` : '(Texto no disponible.)'
      blocks.push(`<paper key="${key.get(p.id)}" id="${p.id}" title="${attr(p.title)}" authors="${authorLine(p, 6)}" year="${p.year ?? ''}">${body}</paper>`)
      names.push(`${p.authors[0]?.family ?? clip(p.title, 30)}${p.year ? ` (${p.year})` : ''}`)
    } else if (r.thesis) {
      const live = liveThesis()!
      const text = live.doc.textBetween(0, live.doc.content.size, '\n', ' ')
      blocks.push(`<thesis_draft title="${attr(fullTitle(live.thesis.meta) || 'sin título')}">\n${clip(text, per)}\n</thesis_draft>`)
      names.push('tu tesis')
    } else {
      const n = s.notes[r.noteId!]
      blocks.push(`<note id="${n.id}" title="${attr(n.title || 'Sin título')}">\n${clip(n.plain, per)}\n</note>`)
      names.push(`«${clip(n.title || 'nota', 30)}»`)
    }
  }
  return {
    label: `Leyó ${names.join(', ')}`,
    text: `(Habla la app, no el estudiante: esto es lo que pediste leer.)\n\n${blocks.join('\n\n')}\n\nAhora seguí con el último pedido del estudiante, usando esto. Citá las páginas así: [S3, p. 12].`
  }
}

/** Today's plan: a few concrete steps from the stage plan, sized in pomodoros, the first one started. */
export const PLAN_TODAY =
  'Armame el plan de hoy. Mirá <progress> (etapa actual, ritmo del plan, palabras y foco), <tasks> (lo vencido y lo de hoy) y lo que estuve haciendo. Proponé 1 a 3 tareas concretas para hoy, de las existentes o nuevas (con verbo y en pomodoros), en el orden en que conviene hacerlas, y arrancá el pomodoro de la primera. Si todavía no tengo el plan de la tesis o me faltan los 2 temas, empezá por eso.'

/** The weekly review: what moved, what slipped, and the plan adjusted to stay on time. */
export const WEEKLY_REVIEW =
  'Hacé mi revisión semanal. Con <progress> y <tasks>: qué avancé esta semana (palabras, pomodoros por etapa, tareas cerradas), qué quedó atrasado y si llego a la aprobación del tutor y a la entrega. Proponé cómo reprogramar lo atrasado (cambios de fechas o tareas más chicas) y cuál es el foco de la semana que viene. Si vas atrasado, decímelo sin rodeos.'

export const AGENT_ACTIONS: QuickAction[] = [
  {
    label: 'Plan de hoy',
    hint: 'Qué hacer hoy, con pomodoros',
    prompt: PLAN_TODAY
  },
  {
    label: 'Revisión semanal',
    hint: 'Avance, atrasos y ajustes del plan',
    prompt: WEEKLY_REVIEW
  },
  {
    label: '¿Qué leo ahora?',
    hint: 'Lo que más te conviene leer, y por qué',
    prompt: 'Mirando mi biblioteca, mis listas, lo que ya leí y mi tesis, ¿qué me conviene leer ahora? Dame hasta 3 papers en orden, con el porqué de cada uno.'
  },
  {
    label: 'Profundizar en un tema',
    hint: 'Lecturas de tu biblioteca para un tema',
    prompt: 'Quiero profundizar en: ',
    prefill: true
  },
  {
    label: 'Papers relacionados',
    hint: 'Con lo que estás leyendo',
    prompt: '¿Qué otros papers de mi biblioteca se relacionan con lo que estoy leyendo? Explicá la conexión de cada uno y si conviene sumarlo a las candidatas.'
  },
  {
    label: 'Mi marco de tesis',
    hint: 'Tus 2 temas, hipótesis y próximos pasos',
    prompt:
      'Mirando el marco de la cátedra, mi combinación de temas, mi pregunta y mi biblioteca: ¿mi planteo está bien encuadrado (2 temas, perspectiva del colaborador, demografía)? Proponé 2 o 3 hipótesis posibles para mi combinación, fundadas en papers de mi biblioteca, y decime qué me falta leer. Si todavía no elegí los temas, ayudame a elegirlos y, cuando decida, guardá su elección en el marco.'
  },
  {
    label: 'Mis resultados',
    hint: 'Qué dicen tus datos sobre tus hipótesis',
    prompt:
      'Con mis resultados (<analysis>) y mis hipótesis: ¿qué se sostiene y qué no? Decime qué tablas me conviene incluir en Resultados y en qué orden (podés insertarlas en la tesis), qué limitaciones reconocer y qué papers de mi biblioteca usar para discutirlos. No redactes la discusión por mí.'
  }
]

import type { ConstructId, ResearchSettings, Settings } from '@shared/types'

// The research framework set by the course (UCEMA MBA, taller de trabajo final
// 2026): one mandated theme, five topics of which each student crosses two,
// every measure taken from the follower's point of view, demographics as extra
// crosses. It goes into every assistant's instructions (see thesisBlock in
// ../lib/prompts) and is shown, with live checks, in the Marco de investigación tab.

export const THEME =
  'Diferencias en el estilo de liderazgo transformador en su relación con los estilos de apego, el líder como proveedor de seguridad, los diferentes niveles de empatía y el impacto en el CCO (comportamiento del ciudadano organizacional).'

export const PROJECT = {
  title: 'Estilos de liderazgo y su efectividad, en relación con la cognición social en líderes y empleados organizacionales en Latinoamérica',
  researchers: 'Dr. Lucas Canga y Mgr. Ezequiel Ierullo'
}

export interface Construct {
  id: ConstructId
  label: string
  /** For tight spots (the sidebar). */
  short: string
  /** As the course lists it. */
  course: string
  /** The English name, as most of the literature uses it. */
  en: string
  /** Whose behaviour the follower rates: their own (self-report) or their direct manager's. */
  rates: 'self' | 'leader'
  instrument: string
  items: string
  scale: string
  scoring: string
  /** Where it sits in the course's Qualtrics dataset. */
  columns: string
  references: string[]
  /** Matched against accent-folded, lowercased text to tell whether a text talks about this topic. */
  pattern: RegExp
  /** Tailwind classes for its chip. */
  tone: string
}

export const CONSTRUCTS: Record<ConstructId, Construct> = {
  attachment: {
    id: 'attachment',
    short: 'Apego',
    label: 'Apego',
    course: 'Attachment / Apego (relaciones personales, afectivas, amistades)',
    en: 'Attachment',
    rates: 'self',
    instrument: 'ECR-RS: Experiencias en Relaciones Cercanas – Estructuras de Relación',
    items: '9 ítems por vínculo, para cuatro vínculos: madre, padre, pareja y mejor amigo/a',
    scale: '1 = totalmente en desacuerdo a 7 = totalmente de acuerdo',
    scoring: 'Evitación = promedio de los ítems 1 a 6, con 1 a 4 invertidos (8 − valor). Ansiedad = promedio de los ítems 7 a 9. Se calcula por vínculo; el apego global es el promedio de los vínculos.',
    columns: 'Q3.1_1–9 (madre), Q3.2_1–9 (padre), Q3.3_1–9 (pareja), Q3.4_1–9 (mejor amigo/a)',
    references: [
      'Fraley, R. C., Heffernan, M. E., Vicary, A. M., & Brumbaugh, C. C. (2011). The Experiences in Close Relationships—Relationship Structures Questionnaire: A method for assessing attachment orientations across relationships. Psychological Assessment, 23(3), 615–625.',
      'Maffezzoli, M., Sorgen, E., Paolicchi, G., Kohan Cortada, A., Colombres, R., Pennella, M. Á., Nuñez, A. M., Olivera, C., Abreu, L., Botana, H., & Bozzalla, L. (2014). El apego en adultos: estudio de una escala para evaluarlo. Anuario de Investigaciones, 21, 355–362.'
    ],
    pattern: /\b(apego|attachment|ecr-?rs)/,
    tone: 'bg-bloom-lilac/15 text-bloom-lilac'
  },
  empathy: {
    id: 'empathy',
    short: 'Empatía',
    label: 'Empatía',
    course: 'Empatía / EQ (coeficiente de empatización; versión validada recientemente en Chile)',
    en: 'Empathy (Empathy Quotient)',
    rates: 'self',
    instrument: 'EQ corto, versión chilena del Cociente de Empatía',
    items: '29 ítems en tres factores: empatía cognitiva, reactividad emocional y habilidades sociales',
    scale: '4 opciones: totalmente de acuerdo, algo de acuerdo, algo en desacuerdo, totalmente en desacuerdo',
    scoring: 'Puntuación 0-1-2: solo suman las respuestas empáticas (2 = respuesta empática fuerte, 1 = leve, 0 = el resto); los ítems inversos se puntúan al revés. Total y subescalas por factor.',
    columns: 'Q4.1_1–29',
    references: [
      'Fernández, A. M., Baeza, C. G., Pavez, P., & Aldunate, N. (2021). Chilean version of the Empathy Quotient (EQ) scale: Adaptation and psychometric properties. The Spanish Journal of Psychology, 24, e24.',
      'Lawrence, E. J., Shaw, P., Baker, D., Baron-Cohen, S., & David, A. S. (2004). Measuring empathy: Reliability and validity of the Empathy Quotient. Psychological Medicine, 34(5), 911–919.',
      'Baron-Cohen, S., & Wheelwright, S. (2004). The Empathy Quotient: An investigation of adults with Asperger syndrome or high functioning autism, and normal sex differences. Journal of Autism and Developmental Disorders, 34(2), 163–175.'
    ],
    pattern: /\b(empat|empathy|eq-?\d*\b|cociente de empat|coeficiente de empat)/,
    tone: 'bg-bloom-pink/15 text-bloom-pink'
  },
  tfl: {
    id: 'tfl',
    short: 'Liderazgo TF',
    label: 'Liderazgo transformacional',
    course: 'Liderazgo Transformacional (TFL)',
    en: 'Transformational leadership',
    rates: 'leader',
    instrument: 'HSA-TFL-ES: escala breve de liderazgo transformacional del Human System Audit',
    items: '8 ítems en cuatro subdimensiones: carisma, inspiración motivacional, estimulación intelectual y consideración individualizada',
    scale: '0 = definitivamente en desacuerdo a 4 = completamente de acuerdo',
    scoring: 'Promedio de los 8 ítems (y de cada par de ítems por subdimensión). El colaborador evalúa a su superior directo.',
    columns: 'Q5.1_1–8 (el colaborador evalúa a su jefe). Q5.2_1–8 es la autoevaluación de quien tiene gente a cargo: no es la medida de la cátedra.',
    references: [
      'Berger, R., Yepes, M., Gómez-Benito, J., Quijano, S., & Brodbeck, F. C. (2011). Validity of the Human System Audit Transformational Leadership Short Scale (HSA-TFL) in four European countries. Universitas Psychologica, 10(3), 657–668.',
      'Berger, R., Romeo, M., Guardia, J., Yepes, M., & Soria, M. A. (2012). Psychometric properties of the Spanish Human System Audit Short-Scale of Transformational Leadership. The Spanish Journal of Psychology, 15(1), 367–376.'
    ],
    pattern: /\b(transformacional|transformador|transformational|tfl|hsa-?tfl)/,
    tone: 'bg-brand/12 text-brand-text'
  },
  security: {
    id: 'security',
    short: 'Líder seguro',
    label: 'Líder como proveedor de seguridad',
    course: 'Líder como Proveedor de Seguridad',
    en: 'Leader as security provider / secure base',
    rates: 'leader',
    instrument: 'LSPS: Escala del Líder como Proveedor de Seguridad',
    items: '15 ítems, estructura unidimensional (un solo factor)',
    scale: '0 = totalmente en desacuerdo a 4 = totalmente de acuerdo',
    scoring: 'Promedio de los 15 ítems. El colaborador describe a su jefe/a directo/a.',
    columns: 'Q7.1_1–15',
    references: [
      'Molero, F., Mikulincer, M., Shaver, P. R., Laguía, A., & Moriano, J. A. (2019). The development and validation of the Leader as Security Provider Scale. Revista de Psicología del Trabajo y de las Organizaciones, 35(3), 183–193.',
      'Popper, M., & Mayseless, O. (2003). Back to basics: Applying a parenting perspective to transformational leadership. The Leadership Quarterly, 14(1), 41–65.'
    ],
    pattern: /(proveedor de seguridad|base segura|secure base|security provider|\blsps\b|\blsbs\b|lider como (proveedor|base))/,
    tone: 'bg-bloom-teal/15 text-bloom-teal'
  },
  ocb: {
    id: 'ocb',
    short: 'CCO',
    label: 'CCO (OCB)',
    course: 'Organizational Citizenship Behavior (OCB): variable de desempeño/productividad',
    en: 'Organizational citizenship behavior',
    rates: 'self',
    instrument: 'CCO: Comportamiento de Ciudadanía Organizacional (adaptación al español)',
    items: '16 ítems: 8 dirigidos a individuos (CCO-I) y 8 a la organización (CCO-O)',
    scale: 'Frecuencia, de nunca a siempre (verificá el rango exacto en la base)',
    scoring: 'Promedio de CCO-I (ítems 1 a 8) y de CCO-O (ítems 9 a 16), y total. Es la variable de desempeño: suele ir como resultado.',
    columns: 'Q6.1_1–16',
    references: [
      'Lee, K., & Allen, N. J. (2002). Organizational citizenship behavior and workplace deviance: The role of affect and cognitions. Journal of Applied Psychology, 87(1), 131–142.',
      'Dávila, M. C., & Finkelstein, M. A. (2010). Predicting organizational citizenship behavior from the functional analysis and role identity perspectives: Further evidence in Spain and the United States. The Spanish Journal of Psychology, 13(1), 277–283.'
    ],
    pattern: /(ciudadan|citizenship|\bocb\b|\bcco\b)/,
    tone: 'bg-bloom-amber/15 text-bloom-amber'
  }
}

/** Traits of the follower first, perceptions of the leader next, performance last: the usual direction of a model. */
export const CONSTRUCT_ORDER: ConstructId[] = ['attachment', 'empathy', 'tfl', 'security', 'ocb']

export interface Demographic {
  id: string
  label: string
  column: string
  kind: 'continua' | 'categórica'
}

export const DEMOGRAPHICS: Demographic[] = [
  { id: 'age', label: 'Edad', column: 'Q2.2', kind: 'continua' },
  { id: 'gender', label: 'Género', column: 'Q2.3', kind: 'categórica' },
  { id: 'education', label: 'Nivel educativo', column: 'Q2.4', kind: 'categórica' },
  { id: 'position', label: 'Posición en la organización', column: 'Q2.5', kind: 'categórica' },
  { id: 'leading', label: 'Años de experiencia liderando', column: 'Q2.6', kind: 'continua' },
  { id: 'tenure', label: 'Antigüedad en la empresa', column: 'Q2.7', kind: 'continua' },
  { id: 'role', label: 'Años en la posición actual', column: 'Q2.8', kind: 'continua' },
  { id: 'industry', label: 'Sector / industria', column: 'Q2.9', kind: 'categórica' }
]

export const RULES = [
  'La temática es exclusivamente la de la cátedra; la aplicación que se proponga sale de ella.',
  'Se cruzan exactamente 2 de los 5 temas.',
  'Todas las mediciones se toman desde la perspectiva del liderado/colaborador: él mismo responde sobre sí (apego, empatía, CCO) o sobre su jefe directo (liderazgo transformacional, líder como proveedor de seguridad).',
  'Las variables demográficas (edad, género, nivel educativo, experiencia, industria, etc.) ofrecen cruces adicionales.'
]

export const DATASET =
  'Base común de la cátedra, exportada de Qualtrics (con y sin etiquetas, en .xlsx y .sav): una fila por respuesta. Usá solo las respuestas finalizadas (columna Finished) y revisá valores imposibles (por ejemplo, edades de 999 o más) antes de puntuar.'

/** The course's data analysis guide, condensed. */
export const ANALYSIS_STEPS: { title: string; detail: string }[] = [
  { title: 'Preparar y puntuar', detail: 'Filtrá las respuestas finalizadas, invertí los ítems reversos (máximo + 1 − valor si la escala empieza en 1; máximo − valor si empieza en 0) y calculá cada escala y subescala.' },
  { title: 'Confiabilidad', detail: 'Alfa de Cronbach por escala y subescala: al menos 0,70 (0,75 ideal). Si da menos, va como limitación. Se informa en Método o en Resultados («Calidad de los datos»).' },
  { title: 'Descriptivos', detail: 'Mínimo, máximo, rango, media y desvío de cada variable, en una tabla, junto con la demografía de la muestra.' },
  { title: 'Normalidad y valores atípicos', detail: 'Asimetría: entre −0,5 y 0,5 está bien; hasta ±1 es moderada; más allá, no es normal. Atípicos: más de 3 desvíos de la media (|z| > 3); si son plausibles, winsorizalos y anotalo.' },
  { title: 'Relaciones simples', detail: 'Correlaciones de Pearson (datos normales) o Spearman (no normales) entre tus dos temas; t de Student o Mann-Whitney para comparar grupos (p. ej., género). Una cola solo si la hipótesis es direccional.' },
  { title: 'Comparaciones múltiples', detail: 'Con muchas pruebas, corregí los p: Bonferroni (0,05 ÷ número de pruebas) o FDR. En una matriz de k variables hay k(k − 1)/2 pruebas.' },
  { title: 'Regresión múltiple', detail: 'Para controlar por demografía o probar interacciones: predictores estandarizados (z), residuos normales, VIF < 5 (ideal 1–3). Informá R², F, p y las contribuciones parciales.' },
  { title: 'Comparar correlaciones', detail: 'Si una hipótesis dice que una correlación es más fuerte que otra, compará los coeficientes (z de Fisher) en lugar de mirar solo si cada una es significativa.' },
  { title: 'Moderación y gráficos', detail: 'La moderación prueba si la relación cambia según otra variable (interacción). Graficá los efectos significativos: dispersión con recta de ajuste o gráficos de regresión parcial, con figura numerada y nota.' }
]

/** The workshop's guide to framing the project, condensed: guidelines, not sections the template imposes. */
export const PROBLEM_SECTIONS: { id: 'relevance' | 'question' | 'hypotheses'; heading: string; guidance: string }[] = [
  {
    id: 'relevance',
    heading: 'Planteo y Relevancia del Problema',
    guidance:
      'Tres párrafos. 1) Presentá el tema con claridad, delimitado y encuadrado en el ámbito organizacional. 2) Qué se sabe y qué no del tema hoy, citando las fuentes consultadas. 3) El impacto de la investigación según sus dimensiones de relevancia: práctica (efectos en la organización que hay que abordar), teórica (tema poco o no investigado), contextual (más relevante en este entorno) y estratégica (informa decisiones o la estrategia). Explicá también tu motivación. Usá datos reales o estadísticas, mostrá la tensión con la práctica organizacional actual o marcá la brecha teórica.'
  },
  {
    id: 'question',
    heading: 'Pregunta de Investigación',
    guidance:
      'El corazón del trabajo: orienta el diseño, el análisis y la aplicación. Clara, específica, relevante (impacto práctico y teórico) y respondible con el análisis de los datos en el tiempo disponible. Nombra tus 2 variables clave y un grupo o contexto específico. Relacional (si A influye, afecta o predice B en ese grupo) o comparativa (si B difiere cuando varía A). No incluye la respuesta (no es una tautología) ni juicios de valor.'
  },
  {
    id: 'hypotheses',
    heading: 'Hipótesis',
    guidance:
      'Afirmación anticipada y fundamentada que la investigación confirmará o refutará, alineada con el tema y la pregunta. Específica (anticipa un resultado), vincula las variables de la pregunta, falsable y medible con los datos; puede describir el tipo de efecto esperado. Sin juicios de valor ni términos vagos. Formulá la alternativa (H₁: existe la relación o diferencia) y la nula (H₀, su inversa: esa relación o diferencia no existe); la que se tratará de falsear es la nula.'
  }
]

export interface Phase {
  id: string
  title: string
  detail: string
  /** The delivery (1–3) it's handed in with. */
  delivery: 1 | 2 | 3
  /** Share of its delivery's time. */
  weight: number
  /** Focus sessions to plan for it. */
  pomodoros?: number
}

/**
 * From the course's writing advice: the body first, introduction and conclusions last, then a full careful read.
 * Delivery 1 is the project (question, hypotheses, method), 2 the theory and the data, 3 the complete work.
 */
export const PHASES: Phase[] = [
  { id: 'scope', delivery: 1, title: 'Elegir los 2 temas y delimitar la pregunta', detail: 'Combinación de la cátedra, desde la perspectiva del colaborador, con las variables demográficas a cruzar. Escribir el tema y su relevancia, la pregunta (relacional o comparativa) y las hipótesis H₁ y H₀.', weight: 3, pomodoros: 2 },
  { id: 'method', delivery: 1, title: 'Escribir la metodología', detail: 'Diseño, muestra, instrumentos (con su validación y confiabilidad), procedimiento y plan de análisis.', weight: 7, pomodoros: 6 },
  { id: 'literature', delivery: 2, title: 'Revisar la literatura de los 2 temas', detail: 'Leer y completar la matriz de literatura con los papers de cada tema y los que los cruzan.', weight: 17, pomodoros: 12 },
  { id: 'theory', delivery: 2, title: 'Escribir el marco teórico y las hipótesis', detail: 'Definir los constructos con sus autores y fundamentar cada hipótesis en la literatura.', weight: 12, pomodoros: 10 },
  { id: 'data', delivery: 2, title: 'Preparar los datos y calcular las escalas', detail: 'Filtrar respuestas, invertir ítems, puntuar escalas y subescalas, alfa de Cronbach.', weight: 7, pomodoros: 6 },
  { id: 'analysis', delivery: 2, title: 'Analizar los datos', detail: 'Descriptivos, normalidad y atípicos, correlaciones, cruces demográficos, regresión y corrección por comparaciones múltiples.', weight: 13, pomodoros: 10 },
  { id: 'results', delivery: 3, title: 'Escribir los resultados', detail: 'Tablas y figuras en formato APA, en el orden de las hipótesis.', weight: 8, pomodoros: 6 },
  { id: 'discussion', delivery: 3, title: 'Escribir la discusión y la aplicación', detail: 'Interpretar los resultados frente a la literatura, limitaciones, implicancias y la aplicación práctica para las organizaciones.', weight: 9, pomodoros: 8 },
  { id: 'intro', delivery: 3, title: 'Escribir la introducción y las conclusiones', detail: 'Se escriben al final, con el cuerpo terminado: funcionan como prólogo y resumen.', weight: 6, pomodoros: 5 },
  { id: 'abstract', delivery: 3, title: 'Escribir el resumen y las palabras clave', detail: 'Hasta 250 palabras en un solo párrafo.', weight: 2, pomodoros: 2 },
  { id: 'revision', delivery: 3, title: 'Leer todo y corregir', detail: 'Lectura integral: claridad, repeticiones, APA 7, formato UCEMA, extensión máxima de 18.000 palabras y citas de todas las ideas ajenas (Turnitin).', weight: 8, pomodoros: 8 }
]

// ---------- calendar ----------

/** The course year the Pautas speak of («del corriente año»). */
export const COURSE_YEAR = 2026

/** Weeks between the workshop's deliveries. */
export const DELIVERY_WEEKS = 4

/** The 3rd-term workshop started on 24/9. */
export const WORKSHOP_START = new Date(COURSE_YEAR, 8, 24)

/** Its deliveries: 15/10 and then every 4 weeks through December (12/11, 10/12). The last one is the final work. */
export const DELIVERIES: Date[] = (() => {
  const out: Date[] = []
  for (let d = new Date(COURSE_YEAR, 9, 15); d.getFullYear() === COURSE_YEAR; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * DELIVERY_WEEKS)) out.push(d)
  return out
})()

/** The final delivery: the complete work. */
export const DEADLINE = DELIVERIES[DELIVERIES.length - 1]

/** The tutor has to approve the work before it's sent: plan on a week before the final delivery. */
export const APPROVAL = new Date(COURSE_YEAR, DEADLINE.getMonth(), DEADLINE.getDate() - 7)

export const SUBMISSION_EMAIL = 'mbatrabajofinal@ucema.edu.ar'

export const fmtDeadline = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const fmtDelivery = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)

/** Days to the final delivery (0 on the day itself, negative once it's past). */
export function daysLeft(now = new Date()): number {
  return daysBetween(now, DEADLINE)
}

/** The next delivery (today's counts), numbered from 1, with the days left to it. */
export function nextDelivery(now = new Date()): { n: number; date: Date; left: number; final: boolean } | undefined {
  const i = DELIVERIES.findIndex((d) => daysBetween(now, d) >= 0)
  return i < 0 ? undefined : { n: i + 1, date: DELIVERIES[i], left: daysBetween(now, DELIVERIES[i]), final: i === DELIVERIES.length - 1 }
}

export const deliveryLabel = (n: number) => (n === DELIVERIES.length ? `Entrega ${n}: trabajo final` : `Entrega ${n}`)

// ---------- the student's choices ----------

/** The chosen pair, in model order (predictor first). */
export function chosenPair(r: ResearchSettings): Construct[] {
  return CONSTRUCT_ORDER.filter((id) => r.constructs.includes(id)).map((id) => CONSTRUCTS[id])
}

export const pairLabel = (r: ResearchSettings, short = false) => chosenPair(r).map((c) => (short ? c.short : c.label)).join(' × ')

/** Which of the five topics a text talks about. */
export function topicsIn(text: string): ConstructId[] {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return CONSTRUCT_ORDER.filter((id) => CONSTRUCTS[id].pattern.test(t))
}

const FOLLOWER = /(colaborador|liderad|subordinad|seguidor|empleado|trabajador|follower|perspectiva del)/
/** The two kinds of question the workshop accepts, on accent-folded text. */
const RELATIONAL = /(relacion|influ|afect|predic|asoci|vincul|impact|efecto|incide)/
const COMPARATIVE = /(diferen|difier|compar|variar|varian|variacion|segun|mayor|menor)/
/** Value judgments and hedges the guide rules out of questions and hypotheses. */
const JUDGMENT = /\b(mejor(es)?|peor(es)?|buen[oa]?s?|mal[oa]?s?|deberi\w*|ideal(es)?|correct[oa]s?|podria\w*|quizas?|tal vez|algun[oa]?s?)\b/g
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export interface FrameworkCheck {
  id: string
  ok: boolean
  severity: 'error' | 'warn' | 'info'
  title: string
  detail?: string
}

/** Whether what the student wrote stays inside the course's framework. */
export function frameworkChecks(s: Pick<Settings, 'thesisTitle' | 'researchQuestion' | 'research'>, now = new Date()): FrameworkCheck[] {
  const r = s.research
  const pair = chosenPair(r)
  const names = (ids: ConstructId[]) => ids.map((id) => CONSTRUCTS[id].label).join(', ')
  const out: FrameworkCheck[] = []

  out.push({
    id: 'pair',
    ok: pair.length === 2,
    severity: 'error',
    title: pair.length === 2 ? `Combinación: ${pairLabel(r)}` : pair.length ? 'Elegiste 1 tema: falta el segundo' : 'Elegí 2 de los 5 temas',
    detail: 'La cátedra pide cruzar exactamente 2.'
  })

  const fields: { id: string; label: string; empty: string; text: string }[] = [
    { id: 'title', label: 'El título', empty: 'vacío', text: s.thesisTitle },
    { id: 'question', label: 'La pregunta de investigación', empty: 'vacía', text: s.researchQuestion },
    { id: 'hypotheses', label: 'Las hipótesis', empty: 'sin escribir', text: r.hypotheses }
  ]
  for (const f of fields) {
    if (!f.text.trim()) {
      out.push({ id: f.id, ok: false, severity: 'warn', title: `${f.label}: todavía ${f.empty}`, detail: 'Se completa en «Tu planteo», más arriba en este marco.' })
      continue
    }
    if (pair.length !== 2) continue
    const found = topicsIn(f.text)
    const missing = r.constructs.filter((id) => !found.includes(id))
    const outside = found.filter((id) => !r.constructs.includes(id))
    out.push({
      id: f.id,
      ok: !missing.length && !outside.length,
      severity: 'warn',
      title: missing.length ? `${f.label} no nombra: ${names(missing)}` : outside.length ? `${f.label} incluye un tema fuera de tu combinación: ${names(outside)}` : `${f.label} nombra tus 2 temas`,
      detail: outside.length ? 'Puede aparecer como contexto (la temática general los menciona), pero no como variable a medir.' : undefined
    })
  }

  const perspective = fold(`${s.researchQuestion} ${r.hypotheses}`)
  if (s.researchQuestion.trim())
    out.push({
      id: 'perspective',
      ok: FOLLOWER.test(perspective),
      severity: 'warn',
      title: FOLLOWER.test(perspective) ? 'Perspectiva del colaborador explícita' : 'Aclará que se mide desde la perspectiva del colaborador',
      detail: 'Quien responde es el liderado: sobre sí mismo o sobre su jefe directo.'
    })

  // The workshop's guide: a relational or comparative question, without value judgments; H₁ and H₀, specific.
  const question = fold(s.researchQuestion)
  if (question) {
    const kind = RELATIONAL.test(question) ? 'relacional' : COMPARATIVE.test(question) ? 'comparativa' : null
    out.push({
      id: 'question-form',
      ok: s.researchQuestion.includes('?') && !!kind,
      severity: 'warn',
      title: !s.researchQuestion.includes('?') ? 'Formulá la pregunta entre signos de interrogación' : kind ? `Pregunta ${kind}` : 'No queda claro si la pregunta es relacional o comparativa',
      detail: kind ? 'Con 2 variables clave y un grupo o contexto específico.' : 'Relacional: si A influye, afecta o predice B en un grupo. Comparativa: si B difiere cuando varía A.'
    })
  }
  const hyp = fold(r.hypotheses)
  if (hyp) {
    const missing = [!/\bh\s*[1₁]/.test(hyp) && !/alternativa/.test(hyp) && 'H₁ (alternativa)', !/\bh\s*[0₀]/.test(hyp) && !/\bnula\b/.test(hyp) && 'H₀ (nula)'].filter(Boolean)
    out.push({
      id: 'hypotheses-form',
      ok: !missing.length,
      severity: 'warn',
      title: missing.length ? `Hipótesis: falta ${missing.join(' y ')}` : 'Hipótesis alternativa y nula',
      detail: 'La alternativa anticipa la relación o diferencia; la nula, que no existe. La que se tratará de falsear es la nula.'
    })
  }
  const judged = [...`${question} ${hyp}`.matchAll(JUDGMENT)].map((m) => m[0])
  if (question || hyp)
    out.push({
      id: 'judgment',
      ok: !judged.length,
      severity: 'warn',
      title: judged.length ? `Juicio de valor o término vago: «${[...new Set(judged)].join('», «')}»` : 'Sin juicios de valor ni términos vagos',
      detail: 'La pregunta y las hipótesis nombran variables medibles y anticipan un resultado específico.'
    })

  out.push({
    id: 'demographics',
    ok: r.demographics.length > 0,
    severity: 'info',
    title: r.demographics.length ? `${r.demographics.length} variable${r.demographics.length > 1 ? 's' : ''} demográfica${r.demographics.length > 1 ? 's' : ''} para cruzar` : 'Sin variables demográficas elegidas',
    detail: 'Opcionales: cruces adicionales.'
  })

  const left = daysLeft(now)
  const next = nextDelivery(now)
  out.push({
    id: 'deadline',
    ok: left >= 0,
    severity: left >= 0 ? 'info' : 'error',
    title: !next ? 'La entrega final ya pasó' : next.left ? `${deliveryLabel(next.n)} en ${next.left} día${next.left === 1 ? '' : 's'}` : `${deliveryLabel(next.n)}: hoy`,
    detail: next ? `${fmtDelivery(next.date)}.${next.final ? '' : ` Entrega final: ${fmtDelivery(DEADLINE)}.`}` : fmtDeadline(DEADLINE)
  })
  return out
}

// ---------- for the assistant ----------

/** Marks the block so the app can verify it reached each assistant. */
export const FRAMEWORK_TAG = 'marco_de_investigacion'

/**
 * The framework as every assistant receives it. It only changes when the
 * student's choices do (no "days left": that goes in each message's context),
 * so a conversation's instructions stay the same from one day to the next.
 */
export function researchBlock(s: Pick<Settings, 'research'>): string {
  const r = s.research
  const pair = chosenPair(r)
  const topics = CONSTRUCT_ORDER.map((id, i) => {
    const c = CONSTRUCTS[id]
    const mark = r.constructs.includes(id) ? ' [ELEGIDO]' : ''
    return `${i + 1}. ${c.label}${mark} (${c.en}). ${c.rates === 'leader' ? 'El colaborador evalúa a su jefe directo' : 'Autoinforme del colaborador'}. Instrumento: ${c.instrument}; ${c.items}; ${c.scale}. Puntuación: ${c.scoring} Columnas: ${c.columns}.`
  })
  const demos = DEMOGRAPHICS.filter((d) => r.demographics.includes(d.id))

  const choice =
    pair.length === 2
      ? `Combinación elegida por el estudiante: ${pair[0].label} × ${pair[1].label}. Sugerencia de dirección del modelo: ${pair[0].label} como predictor y ${pair[1].label} como resultado (a discutir con el tutor).`
      : pair.length === 1
        ? `El estudiante eligió solo ${pair[0].label}: le falta el segundo tema. Ayudalo a elegirlo según su interés y la literatura.`
        : 'El estudiante todavía no eligió sus 2 temas: si la conversación lo permite, ayudalo a elegirlos (qué combinación le interesa, cuál tiene literatura y datos que la sostengan).'

  return `<${FRAMEWORK_TAG}>
Marco obligatorio de la cátedra (Taller de Trabajo Final, MBA UCEMA 2026). Aplicalo siempre, en cada respuesta, aunque el estudiante no lo mencione.
Temática obligatoria y exclusiva: ${THEME}
Proyecto de la cátedra: «${PROJECT.title}» (${PROJECT.researchers}).
Los 5 temas de investigación (el estudiante cruza exactamente 2):
${topics.join('\n')}
${choice}
Reglas:
- Todas las mediciones son desde la perspectiva del liderado/colaborador. Nunca propongas medir el liderazgo con la autoevaluación del líder (Q5.2) como variable principal.
- Si el estudiante propone un tema, una variable o un enfoque fuera de estos 5 temas o de su combinación, señalalo con amabilidad y reencauzalo. Los otros temas pueden aparecer como contexto, no como variables a medir.
- Al juzgar la relevancia de un paper, sugerir lecturas o armar argumentos, priorizá lo que trata su combinación y la relación entre sus 2 temas.
- Variables demográficas para cruces adicionales: ${DEMOGRAPHICS.map((d) => `${d.label} (${d.column})`).join(', ')}.${demos.length ? ` Elegidas por el estudiante: ${demos.map((d) => d.label).join(', ')}.` : ' Todavía no eligió ninguna.'}
- Datos: ${DATASET} Demografía en Q2.2–Q2.9 (Q2.1 es un código de estudio).
- Codificación de la base: ${CODING_NOTE}
- Análisis según el instructivo de la cátedra: ${ANALYSIS_STEPS.map((a) => `${a.title.toLowerCase()} (${a.detail})`).join(' ')} La app calcula estos análisis en la pestaña «Análisis de datos»: cuando haya resultados, usá solo esos números; nunca inventes estadísticos.
Pautas del taller para el planteo (criterios, no secciones obligatorias de la plantilla: cuando el estudiante trabaje el tema, la pregunta o las hipótesis, revisalos contra estos criterios y señalá lo que falte):
${PROBLEM_SECTIONS.map((p) => `- ${p.heading}: ${p.guidance}`).join('\n')}
${r.hypotheses.trim() ? `Hipótesis de trabajo del estudiante (en sus palabras): ${r.hypotheses.trim()}\n` : ''}Calendario (3.er trimestre): el taller empezó el ${fmtDelivery(WORKSHOP_START)} y tiene una entrega cada ${DELIVERY_WEEKS} semanas: ${DELIVERIES.map((d, i) => `${deliveryLabel(i + 1).toLowerCase()} el ${fmtDelivery(d)} (${PHASES.filter((p) => p.delivery === i + 1).map((p) => p.title.toLowerCase()).join('; ')})`).join('; ')}. La entrega final (${fmtDeadline(DEADLINE)}) es fija e inamovible, en PDF a ${SUBMISSION_EMAIL}, con la aprobación previa del tutor (planificá tenerla una semana antes). Cuando ayudes a planificar, que cada entrega llegue con sus etapas completas.
Requisitos formales (Pautas UCEMA): trabajo individual y original; máximo ${(18000).toLocaleString('es-AR')} palabras incluyendo resumen, bibliografía y notas al pie; español; Calibri 11, interlineado doble, alineación izquierda, sangría de 1,27 cm, papel carta, márgenes de 2,54 cm, notas al pie; normas APA (7.ª edición); portada con universidad, título, autor, tutor con su grado y fecha; autorizaciones firmadas en la última página.
Uso de IA (Pautas UCEMA 8.e): permitido para corregir redacción y gramática y para verificar formato y APA; no debe reemplazar el análisis, la argumentación ni la construcción original del trabajo; todo lo que aporte la IA lo revisa y valida el estudiante. Todos los trabajos pasan por Turnitin (originalidad y detección de texto generado por IA).
</${FRAMEWORK_TAG}>`
}

/** The framework in a few lines, for the one-shot writing helpers (same tag, so the verification finds it). */
export function researchBrief(s: Pick<Settings, 'research' | 'researchQuestion'>): string {
  const r = s.research
  const pair = chosenPair(r)
  return `<${FRAMEWORK_TAG}>
Tesis de MBA (UCEMA 2026) dentro de la temática obligatoria: ${THEME}
${pair.length === 2 ? `Combinación elegida por el estudiante: ${pair[0].label} × ${pair[1].label}.` : 'El estudiante todavía no eligió sus 2 temas.'} Todas las mediciones son desde la perspectiva del liderado/colaborador.${s.researchQuestion.trim() ? `\nPregunta de investigación: ${s.researchQuestion.trim()}` : ''}${r.hypotheses.trim() ? `\nHipótesis: ${r.hypotheses.trim()}` : ''}${r.demographics.length ? `\nVariables demográficas: ${DEMOGRAPHICS.filter((d) => r.demographics.includes(d.id)).map((d) => d.label).join(', ')}.` : ''}
Usá la terminología de estos constructos con precisión, en español académico y APA 7. La IA no reemplaza el análisis ni la argumentación del estudiante (Pautas UCEMA).
</${FRAMEWORK_TAG}>`
}

/** How the course's Qualtrics export codes each scale (checked against the labelled export). */
export const CODING_NOTE =
  'en la exportación numérica, ECR-RS va de 1 a 7; EQ de 1 (totalmente en desacuerdo) a 4 (totalmente de acuerdo); HSA-TFL y LSPS de 1 a 5 (restar 1 para la escala 0–4 del instrumento); CCO de 1 (nunca) a 5 (siempre). Los ítems del EQ están en Q4.1_1–29: 1–13 empatía cognitiva, 14–22 reactividad emocional, 23–29 habilidades sociales. La edad numérica (Q2.2) viene corrida: edad = código − 956; en Q2.6 el código 1 es 0 años y el 71 es 1 año. La exportación «Con etiquetas» trae los valores reales.'

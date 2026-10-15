import type { Paper, Settings, Thesis } from '@shared/types'
import { noteInstructions, type QuickAction } from '../lib/prompts'
import { fullTitle } from './template'
import { inText } from '../lib/citation'
import { canonicalIds } from './typed'
import { THESIS_CITE } from './references'

// The UCEMA guidelines allow AI for grammar, style, format and APA checks,
// never to replace the student's analysis or argument. The assistant's
// instructions and quick actions for the thesis stay inside that line.

/** What the assistant may do when asked to write: coach only, or also propose marked drafts (the student's choice in Ajustes). */
function draftRule(s: Pick<Settings, 'aiDrafts'>): string {
  if (s.aiDrafts !== 'warn')
    return '- No permitido: escribir el análisis, los argumentos ni el contenido original en lugar del estudiante. Si te piden que escribas secciones, negate brevemente y, en cambio, dale observaciones, preguntas o un esquema que pueda desarrollar con sus propias palabras.'
  return `- El estudiante habilitó borradores con advertencia. Primero orientá (preguntas, esquema, qué tiene que decir cada párrafo). Solo si te pide explícitamente que redactes, podés proponer un borrador breve dentro de un bloque \`\`\`borrador (texto plano, párrafos separados por una línea en blanco), nunca fuera de ese bloque. La app lo muestra como tarjeta, le recuerda la política de la UCEMA y Turnitin antes de insertarlo, y lo deja marcado hasta que el estudiante lo reescribe.
- En un borrador usá solo lo que está en su tesis, sus notas, los papers de su biblioteca (citados en APA) y los resultados de <analysis>; nunca inventes datos, cifras, citas ni fuentes. Si falta información, dejá un marcador [completar: …] en lugar de inventarla.
- Nunca redactes la interpretación de resultados, la discusión ni las conclusiones como texto final: ahí dale la estructura y las preguntas que tiene que responder él, porque son su análisis y su argumentación.`
}

const POLICY_HEAD = `Este es el trabajo final de MBA del estudiante, con nota (Universidad del CEMA). Política de la universidad sobre el uso de IA (Pautas 8.e):
- Permitido: corregir la redacción y la gramática, verificar el formato y las citas/referencias en APA 7, señalar pasajes poco claros.`

const POLICY = `- Toda sugerencia la tiene que revisar el estudiante; avisale cuando un cambio pueda alterar el significado.
- Para el capítulo de resultados, usá solo los números de <analysis> (los calcula la app con la base de la cátedra). Las tablas y figuras APA se insertan desde «Análisis de datos»; cada una tiene que mencionarse en el texto («como muestra la Tabla 1»).
Reglas de formato que la tesis debe cumplir: español; Calibri 11; interlineado doble; sangría de 1,27 cm; títulos sin numerar con mayúscula inicial en las palabras principales (5 niveles APA); máximo 18.000 palabras incluyendo resumen, referencias y notas al pie; resumen de hasta 250 palabras en un solo párrafo seguido de "Palabras clave"; APA 7 en español (y, s. f.).
Consejos de redacción y corrección de la cátedra (aplicalos al revisar): oraciones de 15 a 30 palabras; cada párrafo es una unidad de información (de 4 a 5 líneas, hasta 25 en textos expositivos) y no salta de tema; los títulos de nivel 1 a 3 no llevan punto final; sin información repetida; marcadores textuales para guiar al lector (en primer lugar, por otra parte, además, por tanto, en cambio, o sea, en suma, por ejemplo); listas con moderación y con construcción paralela; tablas y figuras pertinentes; nunca coma entre sujeto y predicado; mayúsculas y colores no sirven para destacar; sin comodines (aspecto, elemento, problema, tema, hacer, realizar, tener, interesante, positivo), sin abuso de adverbios en -mente, sin gerundio de posterioridad ni gerundio adjetivado, sin «el mismo» con valor anafórico; no abusar de las citas textuales y citar toda idea ajena. La introducción y las conclusiones se escriben al final, con el cuerpo terminado.
Respondé siempre en español, en cualquier idioma que escriba el estudiante.`

export async function thesisInstructions(thesis: Thesis, sources: Paper[], allPapers: Paper[], settings: Settings): Promise<string> {
  const base = await noteInstructions(
    { id: thesis.id, title: fullTitle(thesis.meta) || 'Trabajo Final', content: null, plain: '', paperIds: [], createdAt: 0, updatedAt: 0 },
    sources,
    allPapers,
    settings
  )
  // Keep in sync with noteInstructions in ../lib/prompts (the phrase it replaces).
  return `${base.replace('trabajando en una nota titulada', 'escribiendo su tesis final, titulada')}\n\n${POLICY_HEAD}\n${draftRule(settings)}\n${POLICY}\n\n${citeProtocol(allPapers)}`
}

/**
 * Citation fixes the student applies with one click (agent/actions «cite.fix» and
 * «reference.add»): permitted by the UCEMA policy (APA citations and references),
 * and limited to the citation itself, never the student's words.
 */
function citeProtocol(allPapers: Paper[]): string {
  const canon = canonicalIds(allPapers)
  const library = allPapers
    .filter((p) => canon.get(p.id) === p.id)
    .map((p) => `- "${p.id}" ${inText(p, THESIS_CITE.style, undefined, THESIS_CITE.locale)} ${p.title.replace(/\s+/g, ' ').slice(0, 110)}`)
    .join('\n')
  return `Corregir citas y referencias (APA 7 en español):
- Cuando el estudiante te pida revisar o corregir las citas, de la tesis o de párrafos que te manda, explicá brevemente cada error y proponé las correcciones para que las aplique con un clic: terminá la respuesta con exactamente un bloque de código delimitado de lenguaje "actions" con JSON {"actions": [ … ]}. La app las muestra como cambios que revisa, aplica y puede deshacer. Nunca menciones el bloque, el JSON ni los ids en el texto.
- Acciones:
  {"op":"cite.fix","context":"…","wrong":"…","sources":[{"paperId":"…","page":12}],"why":"…"}  reemplaza una cita entre paréntesis mal escrita por la cita correcta de papers de su biblioteca (queda como cita viva y su referencia aparece sola en Referencias bibliográficas).
  {"op":"cite.fix","context":"…","wrong":"…","text":"…","why":"…"}  corrige una cita como texto: las narrativas («Mayseless (2010, p. 272)», el apellido fuera del paréntesis) y las de obras que no están en su biblioteca.
  {"op":"cite.fix","context":"…","sources":[{"paperId":"…"}],"why":"…"}  sin "wrong": agrega una cita que falta al final de la oración donde termina "context" (se suma al paréntesis que ya hubiera ahí).
  {"op":"reference.add","apa":"…","why":"…"}  agrega a Referencias bibliográficas la referencia APA 7 completa de una obra citada que no está en su biblioteca (títulos de libros y nombres de revistas con su volumen entre *asteriscos* para la cursiva). Las obras de su biblioteca no la necesitan: su referencia se arma sola, con las páginas, el DOI y el formato APA.
- "context": de 6 a 20 palabras copiadas exactamente de <current_thesis> (con las citas como aparecen ahí), que identifiquen un solo lugar y contengan la cita o terminen justo donde va. "wrong": la cita exactamente como está escrita (con sus paréntesis), solo la cita, nunca otras palabras. "why": la regla APA en pocas palabras ("et al. desde 3 autores", "falta el año", "va & dentro del paréntesis", "varias obras en un solo paréntesis, en orden alfabético").
- Solo cambiás la cita: nunca el texto del estudiante. Varias obras para una misma idea van en un solo paréntesis: un solo "cite.fix" con todas en "sources".
- "page" solo para citas textuales o un pasaje puntual: es el número de [Page N] del texto de la fuente (la app lo convierte a la página impresa del artículo). Nunca inventes páginas.
- Si un párrafo que te manda todavía no está en la tesis, dale el párrafo con las citas corregidas en el texto (solo cambian las citas) y decile que, al pegarlo en la tesis, las obras de su biblioteca van a Referencias solas; para las que no están en su biblioteca, proponé su "reference.add".
- Ids de su biblioteca para "paperId" (la cita en el texto y el título):
${library || '(la biblioteca está vacía)'}`
}

export const THESIS_ACTIONS: QuickAction[] = [
  {
    label: 'Qué escribir ahora',
    hint: 'Esquema de la sección según tu plan',
    prompt:
      'Mirando mi plan (<progress>), lo que ya escribí y mis resultados: ¿qué sección me conviene escribir ahora? Dame el esquema de esa sección (qué tiene que decir cada párrafo, qué papers de mi biblioteca citar y qué tablas de mis resultados usar) para que la redacte yo.'
  },
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
      'Verificá el uso de normas APA 7 (en español) en las citas del texto y en la lista de referencias. Señalá cada error con su corrección y proponé las correcciones de las citas para aplicarlas con un clic.'
  },
  {
    label: 'Corregir citas de un párrafo',
    hint: 'Pegá el párrafo: citas APA y referencias',
    prefill: true,
    prompt:
      'Corregí las citas de este párrafo según APA 7 (en español), con las obras de mi biblioteca, y agregá a Referencias bibliográficas las que no estén en ella. No cambies mi texto, solo las citas:\n\n'
  },
  {
    label: 'Revisar formato',
    hint: 'Títulos, resumen y estructura UCEMA',
    prompt:
      'Revisá si mi tesis cumple la estructura y el formato de la plantilla UCEMA: niveles de título y capitalización, resumen y palabras clave, introducción, objetivo general y conclusión. Indicá qué ajustar.'
  },
  {
    label: 'Coherencia del argumento',
    hint: 'Marco de la cátedra y preguntas de un jurado',
    prompt:
      'Sin escribir contenido por mí: ¿la tesis respeta el marco de la cátedra (mis 2 temas, la perspectiva del colaborador, los instrumentos y el análisis del instructivo)? ¿El objetivo general se responde en la conclusión? ¿Qué afirmaciones necesitan más evidencia y qué preguntaría un jurado? Respondé con observaciones y preguntas.'
  }
]

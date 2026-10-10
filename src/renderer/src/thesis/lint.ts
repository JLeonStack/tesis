import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

// Offline style review for academic Spanish: repeated words, long sentences,
// filler, common usage errors and anglicisms, APA number style, spacing.
// Instant, private, and it never rewrites anything on its own.

export type LintTone = 'warn' | 'info' | 'long'

export interface LintIssue {
  from: number
  to: number
  rule: string
  tone: LintTone
  title: string
  detail: string
  /** Replacements offered as one-click fixes ('' deletes). */
  fixes: string[]
  /** Offer AI synonyms for the flagged word. */
  synonyms?: boolean
  /** Key used to ignore this kind of finding. */
  ignoreKey: string
}

type Found = Omit<LintIssue, 'from' | 'to'> & { start: number; end: number }

const L = '\\p{L}'
const word = (s: string) => new RegExp(`(?<![${L}])(?:${s})(?![${L}])`, 'giu')

interface PhraseRule {
  re: RegExp
  rule: string
  title: string
  detail: string
  /** Replacements, or a function of the matched text (for conjugated forms). */
  fixes: string[] | ((match: string) => string[])
  tone?: LintTone
}

// «jugar un rol» in its common forms → «desempeñar un papel» / «cumplir una función», same person and tense.
const JUGAR: Record<string, [string, string]> = {
  jugar: ['desempeñar', 'cumplir'],
  juega: ['desempeña', 'cumple'],
  juegan: ['desempeñan', 'cumplen'],
  jugó: ['desempeñó', 'cumplió'],
  jugaron: ['desempeñaron', 'cumplieron'],
  jugará: ['desempeñará', 'cumplirá'],
  jugarán: ['desempeñarán', 'cumplirán'],
  jugaría: ['desempeñaría', 'cumpliría'],
  jugarían: ['desempeñarían', 'cumplirían'],
  jugaba: ['desempeñaba', 'cumplía'],
  jugaban: ['desempeñaban', 'cumplían'],
  juegue: ['desempeñe', 'cumpla'],
  jueguen: ['desempeñen', 'cumplan'],
  jugando: ['desempeñando', 'cumpliendo'],
  jugado: ['desempeñado', 'cumplido']
}

const PHRASES: PhraseRule[] = [
  { re: word('en base a'), rule: 'uso', title: '«en base a»', detail: 'La RAE recomienda «sobre la base de», «con base en» o «según».', fixes: ['sobre la base de', 'con base en', 'según'] },
  { re: word('de acuerdo a'), rule: 'uso', title: '«de acuerdo a»', detail: 'En registro formal se prefiere «de acuerdo con».', fixes: ['de acuerdo con'] },
  { re: word('en relación a'), rule: 'uso', title: '«en relación a»', detail: 'Lo recomendado es «en relación con» o «con relación a».', fixes: ['en relación con', 'con relación a'] },
  { re: word('en función a'), rule: 'uso', title: '«en función a»', detail: 'La forma correcta es «en función de».', fixes: ['en función de'] },
  { re: word('bajo el punto de vista'), rule: 'uso', title: '«bajo el punto de vista»', detail: 'Se dice «desde el punto de vista».', fixes: ['desde el punto de vista'] },
  { re: word('a nivel de'), rule: 'uso', title: '«a nivel de»', detail: 'Solo es correcto con sentido de altura o jerarquía. Probá «en», «en el ámbito de» o «entre».', fixes: ['en el ámbito de', 'en'] },
  { re: word('de cara a'), rule: 'uso', title: '«de cara a»', detail: 'Coloquial en textos académicos. Probá «con vistas a» o «para».', fixes: ['con vistas a', 'para'] },
  { re: word('a la hora de'), rule: 'uso', title: '«a la hora de»', detail: 'Coloquial. Probá «al» + infinitivo o «cuando».', fixes: ['al', 'cuando'] },
  { re: word('en orden a'), rule: 'uso', title: '«en orden a»', detail: 'Calco del inglés «in order to». Usá «para» o «con el fin de».', fixes: ['para', 'con el fin de'] },
  { re: word('a día de hoy'), rule: 'uso', title: '«a día de hoy»', detail: 'Preferí «hoy», «actualmente» o «en la actualidad».', fixes: ['actualmente', 'en la actualidad'] },
  { re: word('y/o'), rule: 'uso', title: '«y/o»', detail: 'La RAE desaconseja «y/o»: «o» ya incluye ambas posibilidades.', fixes: ['o', 'y'] },
  { re: word('debe(?:n|ría|rían)? de(?= [\\p{L}]+(?:ar|er|ir)(?![\\p{L}]))'), rule: 'uso', title: '«deber de» + infinitivo', detail: '«Deber de» expresa suposición. Para obligación se usa «deber» sin «de».', fixes: [] },
  {
    re: word(`(?:${Object.keys(JUGAR).join('|')}) un (?:rol|papel)`),
    rule: 'anglicismo',
    title: '«jugar un rol»',
    detail: 'Calco del inglés «to play a role». Probá «desempeñar un papel» o «cumplir una función».',
    fixes: (m) => {
      const [a, b] = JUGAR[m.split(' ')[0].toLowerCase()] ?? JUGAR.jugar
      return [`${a} un papel`, `${b} una función`]
    }
  },
  { re: word('reportar(?:on|á|án|a|an|ó)?'), rule: 'anglicismo', title: '«reportar»', detail: 'En el sentido de «informar» es un anglicismo.', fixes: ['informar', 'señalar'] },
  { re: word('impactar(?:on|á|án|a|an|ó)? (?:en|sobre)'), rule: 'anglicismo', title: '«impactar en»', detail: 'Mejor «afectar», «influir en» o «repercutir en».', fixes: ['influir en', 'repercutir en', 'afectar a'] },
  { re: word('asumir que|asume que|asumen que|asumimos que'), rule: 'anglicismo', title: '«asumir que»', detail: 'Con sentido de «suponer» es un calco del inglés «assume».', fixes: ['suponer que', 'partir de que'] },
  { re: word('remarcar|remarca|remarcan'), rule: 'anglicismo', title: '«remarcar»', detail: 'Significa «volver a marcar». Para énfasis usá «destacar» o «subrayar».', fixes: ['destacar', 'subrayar'] },
  { re: word('cabe destacar que|es importante (?:destacar|mencionar|señalar|resaltar) que|vale la pena mencionar que'), rule: 'relleno', title: 'Expresión de relleno', detail: 'Suele sobrar: el texto gana fuerza si se afirma directamente.', fixes: [''] },
  { re: word('cosa|cosas'), rule: 'vago', title: 'Palabra imprecisa', detail: '«Cosa» es vaga en un texto académico. Nombrá el concepto concreto.', fixes: [], tone: 'info' },
  { re: word('muy|bastante|realmente|básicamente|obviamente|claramente|totalmente|sumamente'), rule: 'intensificador', title: 'Intensificador', detail: 'Los intensificadores debilitan el tono académico. Mejor precisar o cuantificar.', fixes: [''], tone: 'info' },
  { re: word('de alguna manera|de algún modo|en cierto sentido'), rule: 'vago', title: 'Expresión imprecisa', detail: 'Evitá la vaguedad: explicá de qué manera.', fixes: [''], tone: 'info' },
  { re: word('etc\\.?|etcétera'), rule: 'etc', title: '«etc.»', detail: 'En textos académicos conviene enumerar todo o cerrar con «entre otros».', fixes: ['entre otros'], tone: 'info' },
  { re: word('yo|creo que|pienso que|me parece que|opino que|en mi opinión'), rule: 'persona', title: 'Primera persona', detail: 'Suele preferirse la forma impersonal: «se considera», «se observa», «puede afirmarse».', fixes: [], tone: 'info' }
]

const NUMBER_WORDS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
// Digits 0–9 standing alone in prose (not decimals, percentages, ranges or units).
const LONE_DIGIT = /(?<![\p{L}\p{N}.,/%-])([0-9])(?![\p{N}.,:/%°-]|\s*(?:%|por ciento))/gu
// Contexts where APA keeps numerals.
const KEEP_NUMERAL = /(?:^|[^\p{L}])(?:p|pp|tabla|figura|apéndice|capítulo|nivel|paso|hipótesis|n|ítem|pregunta|año|página|versión|cap)\.?\s*$/iu

const STOP = new Set(
  'además algunas algunos aquellas aquellos cuales cuando desde donde durante dicha dicho embargo entonces entre estas estos había hacia hasta mayor manera mediante menor menos mientras misma mismo muchas muchos nuestra nuestro otras otros parte porque puede pueden según siempre siendo sobre también tanto tiene tienen todas todos través forma cada ellos ellas cual general caso casos'.split(' ')
)
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const stem = (w: string) => (w.length >= 8 ? w.slice(0, 6) : w)

function lintText(text: string): Found[] {
  const out: Found[] = []

  for (const r of PHRASES) {
    r.re.lastIndex = 0
    for (const m of text.matchAll(r.re)) {
      out.push({
        start: m.index!,
        end: m.index! + m[0].length,
        rule: r.rule,
        tone: r.tone ?? 'warn',
        title: r.title,
        detail: r.detail,
        fixes: typeof r.fixes === 'function' ? r.fixes(m[0]) : r.fixes,
        ignoreKey: `${r.rule}:${fold(m[0])}`
      })
    }
  }

  for (const m of text.matchAll(/ {2,}/g)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, rule: 'espacios', tone: 'warn', title: 'Espacios dobles', detail: 'Hay más de un espacio seguido.', fixes: [' '], ignoreKey: 'espacios' })
  }
  for (const m of text.matchAll(/ +(?=[,.;:)])/g)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, rule: 'espacios', tone: 'warn', title: 'Espacio antes de puntuación', detail: 'No va espacio antes de coma, punto, punto y coma, dos puntos o paréntesis de cierre.', fixes: [''], ignoreKey: 'espacio-puntuacion' })
  }

  for (const m of text.matchAll(LONE_DIGIT)) {
    if (KEEP_NUMERAL.test(text.slice(Math.max(0, m.index! - 14), m.index!))) continue
    const n = Number(m[1])
    out.push({
      start: m.index!,
      end: m.index! + 1,
      rule: 'numeros',
      tone: 'info',
      title: 'Número en cifras',
      detail: 'APA 7: los números del cero al nueve se escriben con letras (salvo medidas, porcentajes, estadísticas, fechas o números de página).',
      fixes: [NUMBER_WORDS[n]],
      ignoreKey: 'numeros'
    })
  }

  // Sentences: long ones, and words repeated close together.
  const sentences = text.matchAll(/[^.!?…]+(?:[.!?…]+|$)/g)
  const recent: { key: string; at: number }[] = []
  let wordIndex = 0
  for (const s of sentences) {
    const words = [...s[0].matchAll(/[\p{L}][\p{L}'’-]*/gu)]
    if (words.length > 40) {
      const lead = s[0].match(/^\s*/)![0].length
      out.push({
        start: s.index! + lead,
        end: s.index! + s[0].trimEnd().length,
        rule: 'larga',
        tone: 'long',
        title: `Oración larga (${words.length} palabras)`,
        detail: 'Las oraciones de más de 40 palabras cuestan de seguir. Considerá dividirla.',
        fixes: [],
        ignoreKey: `larga:${fold(s[0].trim().slice(0, 40))}`
      })
    }
    for (const w of words) {
      wordIndex++
      const f = fold(w[0])
      if (f.length < 5 || STOP.has(f)) continue
      const key = stem(f)
      const prev = recent.find((r) => r.key === key && wordIndex - r.at <= 30)
      if (prev) {
        const at = s.index! + w.index!
        out.push({
          start: at,
          end: at + w[0].length,
          rule: 'repeticion',
          tone: 'info',
          title: `«${w[0]}» repetida`,
          detail: 'Aparece de nuevo a pocas palabras. Probá un sinónimo, un pronombre o reestructurar.',
          fixes: [],
          synonyms: true,
          ignoreKey: `repeticion:${key}`
        })
      }
      recent.push({ key, at: wordIndex })
      if (recent.length > 60) recent.shift()
    }
  }
  return out
}

// ---------- plugin ----------

const SKIP_SECTIONS = new Set(['toc', 'referencias'])
const IGNORE_KEY = 'thesis-lint-ignore'
const ENABLED_KEY = 'thesis-lint-enabled'

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
function store(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // ignore
  }
}

const ignored = new Set<string>(load<string[]>(IGNORE_KEY, []))
const perBlock = new WeakMap<PMNode, Found[]>()

function blockIssues(block: PMNode): Found[] {
  let hit = perBlock.get(block)
  if (!hit) {
    // One char per position: atoms and hard breaks count as U+FFFC.
    hit = lintText(block.textBetween(0, block.content.size, undefined, '￼'))
    perBlock.set(block, hit)
  }
  return hit
}

function collect(doc: PMNode): LintIssue[] {
  const out: LintIssue[] = []
  doc.forEach((section, secPos) => {
    if (SKIP_SECTIONS.has(section.attrs.kind)) return
    section.descendants((node, pos) => {
      if (node.type.name === 'heading') return false
      if (!node.isTextblock) return true
      const start = secPos + 1 + pos + 1
      for (const f of blockIssues(node)) {
        if (ignored.has(f.ignoreKey)) continue
        const { start: s, end: e, ...rest } = f
        out.push({ ...rest, from: start + s, to: start + e })
      }
      return false
    })
  })
  return out
}

interface LintState {
  enabled: boolean
  issues: LintIssue[]
  decos: DecorationSet
}

export const lintKey = new PluginKey<LintState>('thesisLint')

function build(doc: PMNode, enabled: boolean): LintState {
  if (!enabled) return { enabled, issues: [], decos: DecorationSet.empty }
  const issues = collect(doc)
  const decos = DecorationSet.create(
    doc,
    issues.map((i) => Decoration.inline(i.from, i.to, { class: `lint lint-${i.tone}`, nodeName: 'span' }, { issue: i }))
  )
  return { enabled, issues, decos }
}

export const lintIssues = (state: EditorState): LintIssue[] => lintKey.getState(state)?.issues ?? []
export const lintEnabled = (state: EditorState): boolean => lintKey.getState(state)?.enabled ?? false

/** Window event asking the UI to show the card for an issue under the pointer. */
export const LINT_EVENT = 'thesis:lint'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    styleCheck: {
      toggleStyleCheck: () => ReturnType
      ignoreLint: (issue: LintIssue) => ReturnType
      applyLintFix: (issue: LintIssue, fix: string) => ReturnType
    }
  }
}

export const StyleCheck = Extension.create({
  name: 'styleCheck',

  addCommands() {
    return {
      toggleStyleCheck:
        () =>
        ({ state, tr, dispatch }) => {
          const next = !lintEnabled(state)
          store(ENABLED_KEY, next)
          dispatch?.(tr.setMeta(lintKey, { enabled: next }))
          return true
        },
      ignoreLint:
        (issue) =>
        ({ tr, dispatch }) => {
          ignored.add(issue.ignoreKey)
          store(IGNORE_KEY, [...ignored])
          dispatch?.(tr.setMeta(lintKey, { refresh: true }))
          return true
        },
      applyLintFix:
        (issue, fix) =>
        ({ state, tr, dispatch }) => {
          const current = state.doc.textBetween(issue.from, issue.to)
          if (!current) return false
          let text = fix
          // Keep sentence-initial capitals.
          if (text && /^\p{Lu}/u.test(current)) text = text.charAt(0).toUpperCase() + text.slice(1)
          let to = issue.to
          // Deleting a word shouldn't leave a double space behind.
          if (!text && state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size)) === ' ') to++
          if (dispatch) {
            if (text) tr.insertText(text, issue.from, to)
            else tr.delete(issue.from, to)
          }
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<LintState>({
        key: lintKey,
        state: {
          init: (_c, state) => build(state.doc, load(ENABLED_KEY, true)),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(lintKey) as { enabled?: boolean; refresh?: boolean } | undefined
            if (meta?.enabled !== undefined) return build(state.doc, meta.enabled)
            if (meta?.refresh || tr.docChanged) return build(state.doc, prev.enabled)
            return prev
          }
        },
        props: {
          decorations: (state) => lintKey.getState(state)?.decos,
          handleClick(view, pos, event) {
            const hits = lintIssues(view.state).filter((i) => pos >= i.from && pos <= i.to)
            if (!hits.length) return false
            // The most specific finding wins (a word over its whole sentence).
            const issue = hits.sort((a, b) => a.to - a.from - (b.to - b.from))[0]
            const target = (event.target as HTMLElement).closest('.lint') ?? (event.target as HTMLElement)
            window.dispatchEvent(new CustomEvent(LINT_EVENT, { detail: { issue, rect: target.getBoundingClientRect() } }))
            return false
          }
        }
      })
    ]
  }
})

export const LINT_RULE_LABELS: Record<string, string> = {
  uso: 'Uso',
  anglicismo: 'Anglicismo',
  relleno: 'Relleno',
  vago: 'Precisión',
  intensificador: 'Estilo',
  etc: 'Estilo',
  persona: 'Registro',
  espacios: 'Puntuación',
  numeros: 'APA',
  larga: 'Claridad',
  repeticion: 'Repetición'
}

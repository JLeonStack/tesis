import { describe, expect, it } from 'vitest'
import type { Paper } from '@shared/types'
import {
  CITE_CHAR,
  locateQuote,
  quoteIn,
  NOTE_CHAR,
  PassageIndex,
  citeInsertOffset,
  findReference,
  glossaryTerms,
  instrumentRefs,
  isCited,
  needsSupport,
  passagesOf,
  queryTerms,
  sentenceAt,
  sentenceKey,
  splitSentences,
  uncitedIn
} from './support'

const paper = (id: string, family: string, year: string, title: string): Paper => ({
  id,
  fileName: `${id}.pdf`,
  title,
  authors: [{ family, given: 'A.' }],
  year,
  type: 'article',
  tags: [],
  status: 'unread',
  textStatus: 'ready',
  addedAt: 0,
  updatedAt: 0
})

describe('splitSentences', () => {
  it('splits on periods followed by a capital, not on abbreviations or initials', () => {
    const t = 'Fraley et al. (2011) proponen una medida por vínculo. R. C. Fraley la validó en varias muestras (p. 4). ¿Es estable? Sí, según los datos (Autor, s. f.). Fin'
    expect(splitSentences(t).map((s) => s.text)).toEqual([
      'Fraley et al. (2011) proponen una medida por vínculo.',
      'R. C. Fraley la validó en varias muestras (p. 4).',
      '¿Es estable?',
      'Sí, según los datos (Autor, s. f.).',
      'Fin'
    ])
  })

  it('keeps citation and footnote atoms inside the sentence they close', () => {
    const t = `El líder es una base segura ${CITE_CHAR}.${NOTE_CHAR} Los seguidores lo perciben así.`
    const [a, b] = splitSentences(t)
    expect(a.text).toBe(`El líder es una base segura ${CITE_CHAR}.${NOTE_CHAR}`)
    expect(b.text).toBe('Los seguidores lo perciben así.')
    expect(t.slice(b.start, b.end)).toBe(b.text)
  })

  it('finds the sentence at a caret, also at its very end', () => {
    const t = 'Primera oración larga. Segunda oración más larga.'
    expect(sentenceAt(t, 3)?.text).toBe('Primera oración larga.')
    expect(sentenceAt(t, t.length)?.text).toBe('Segunda oración más larga.')
  })
})

describe('citations in a sentence', () => {
  it('sees live citations and hand-typed APA ones', () => {
    expect(isCited(`El apego predice la confianza ${CITE_CHAR}.`)).toBe(true)
    expect(isCited('El apego predice la confianza (Popper y Mayseless, 2003, p. 45).')).toBe(true)
    expect(isCited('Según Bass (1985), el líder transforma a sus seguidores.')).toBe(true)
    expect(isCited('Fraley et al. (2011) proponen medir el apego por vínculo.')).toBe(true)
    expect(isCited('El apego predice la confianza en el líder (en general).')).toBe(false)
  })

  it('asks for support only for claims', () => {
    expect(needsSupport('Los líderes transformacionales actúan como una base segura para sus seguidores.')).toBe(true)
    expect(needsSupport('Esta tesis analiza la relación entre el apego y el liderazgo.')).toBe(false)
    expect(needsSupport('Se espera que la empatía se asocie con el CCO de los colaboradores.')).toBe(false)
    expect(needsSupport('La correlación fue positiva y moderada, r = .35, p < .001.')).toBe(false)
    expect(needsSupport('Como muestra la Tabla 2, la empatía cognitiva es mayor en mujeres.')).toBe(false)
    expect(needsSupport('¿Influye el apego del colaborador en cómo percibe a su jefe?')).toBe(false)
    expect(needsSupport('Es un tema relevante.')).toBe(false)
  })

  it('lists the uncited claims of a paragraph', () => {
    const t = `El liderazgo transformacional se asocia con mayor confianza de los seguidores ${CITE_CHAR}. Los colaboradores con apego seguro perciben más apoyo de su jefe directo. Este trabajo estudia esa relación en Argentina.`
    expect(uncitedIn(t).map((s) => s.text)).toEqual(['Los colaboradores con apego seguro perciben más apoyo de su jefe directo.'])
  })

  it('keys sentences without citations or case', () => {
    expect(sentenceKey(`El Apego, predice ${CITE_CHAR}.`)).toBe(sentenceKey('el apego predice.'))
  })
})

describe('citeInsertOffset', () => {
  it('goes before the final period, or joins a citation already there', () => {
    const s = 'El líder es una base segura.'
    expect(citeInsertOffset(s)).toEqual({ at: s.length - 1, existing: null, typed: null })
    const cited = `El líder es una base segura ${CITE_CHAR}.`
    expect(citeInsertOffset(cited)).toEqual({ at: cited.length - 1, existing: cited.length - 2, typed: null })
    const typed = 'El líder es una base segura (Popper y Mayseless, 2003).'
    expect(citeInsertOffset(typed).typed).toEqual({ start: typed.indexOf('('), end: typed.length - 1 })
    expect(citeInsertOffset('Se mide con la LSPS (15 ítems).').typed).toBeNull()
    const noted = `Una base segura.${NOTE_CHAR}`
    expect(citeInsertOffset(noted).at).toBe(noted.length - 2)
    expect(citeInsertOffset('Sin punto final').at).toBe('Sin punto final'.length)
  })
})

describe('library search', () => {
  const pages = [
    { page: 3, text: 'Transformational leaders act as a secure base for their followers. Followers who feel secure explore more and take initiative. This mirrors the parent–child bond.' },
    { page: 4, text: 'Attachment anxiety was unrelated to organizational citizenship behavior in our sample. Avoidance showed a small negative effect on helping coworkers.' },
    { page: 9, text: 'Bass, B. M. (1985). Leadership and performance. Free Press. Bowlby, J. (1969). Attachment. Basic Books. Popper, M. (2003). Back to basics. doi.org/10.1/a doi.org/10.1/b' }
  ]

  it('cuts pages into passages and skips reference lists', () => {
    const ps = passagesOf('p1', pages)
    expect(ps.some((p) => p.page === 9)).toBe(false)
    expect(ps.find((p) => p.page === 3)?.text).toContain('secure base')
  })

  it('ranks the passage that matches a Spanish claim through its English terms', () => {
    const index = new PassageIndex()
    index.add('p1', passagesOf('p1', pages))
    index.add('p2', passagesOf('p2', [{ page: 1, text: 'Market orientation improves export performance in small firms. Managers rarely measure it.' }]))
    const claim = 'El líder transformacional funciona como una base segura para sus seguidores.'
    const q = queryTerms([
      { text: claim, weight: 1 },
      { text: glossaryTerms(claim), weight: 0.8 }
    ])
    const hits = index.search(q)
    expect(hits[0].passage.paperId).toBe('p1')
    expect(hits[0].passage.page).toBe(3)
    expect(hits.every((h) => h.passage.paperId !== 'p2')).toBe(true)
  })
})

describe('instrument references', () => {
  const library = [paper('fraley', 'Fraley', '2011', 'The Experiences in Close Relationships—Relationship Structures Questionnaire'), paper('other', 'Bass', '1985', 'Leadership and performance')]

  it('matches a course reference to the library by author and year', () => {
    expect(findReference('Fraley, R. C., Heffernan, M. E., Vicary, A. M., & Brumbaugh, C. C. (2011). The Experiences in Close Relationships.', library)?.id).toBe('fraley')
  })

  it('points at the instrument named in a claim, with or without the paper', () => {
    const refs = instrumentRefs('El apego se midió con el ECR-RS, que evalúa evitación y ansiedad por vínculo.', library)
    expect(refs.map((r) => r.construct)).toEqual(['attachment', 'attachment'])
    expect(refs[0].paperId).toBe('fraley')
    expect(refs[1].paperId).toBeUndefined()
    expect(instrumentRefs('El CCO es una variable de desempeño.', library)).toEqual([])
    expect(instrumentRefs('La escala de CCO tiene 16 ítems.', library).every((r) => r.construct === 'ocb')).toBe(true)
  })
})

describe('locating quotes in the paper', () => {
  const pages = [
    { page: 4, text: 'Leaders who provide a secure base foster proactive work be-\nhavior among employees.' },
    { page: 5, text: 'Attachment avoidance was negatively related to LMX quality across studies.' }
  ]
  it('finds the quote on its real page, even when the model gave another', () => {
    expect(locateQuote(pages, 'Attachment avoidance was negatively related to LMX quality', 4)?.page).toBe(5)
    expect(locateQuote(pages, 'secure base foster proactive work behavior', 5)?.page).toBe(4)
    expect(locateQuote(pages, 'Leaders always increase engagement', 4)).toBeNull()
  })
  it('falls back to the closest real sentence when the model paraphrased', () => {
    expect(quoteIn(pages[1].text, 'avoidance related negatively to LMX')).toEqual({ quote: pages[1].text, exact: false })
  })
})

describe('sentences glued by a missing space', () => {
  it('ends the sentence after a citation even without the space', () => {
    expect(splitSentences(`…el éxito de la empresa${CITE_CHAR}.Desde la teoría del apego, el líder.`).map((x) => x.text)).toEqual([`…el éxito de la empresa${CITE_CHAR}.`, 'Desde la teoría del apego, el líder.'])
    expect(splitSentences('la empresa (Underwood et al., 2016).Desde la teoría.').length).toBe(2)
    // Not inside an acronym or an abbreviation.
    expect(splitSentences('Trabajó en EE.UU. y en la U.E. con jefes.').length).toBe(1)
  })
})

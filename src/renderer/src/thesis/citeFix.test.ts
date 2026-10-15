import { describe, expect, it } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { citeFixTransaction, manualReferenceFor, manualReferences, planCiteFix, referenceTransaction, type Leaf } from './citeFix'

const schema = new Schema({
  nodes: {
    doc: { content: 'section+' },
    section: { content: 'block*', attrs: { kind: { default: 'cuerpo' } } },
    paragraph: { group: 'block', content: 'inline*' },
    referenceList: { group: 'block', atom: true },
    text: { group: 'inline' },
    citation: { group: 'inline', inline: true, atom: true, attrs: { paperId: { default: null }, page: { default: null }, extra: { default: [] } } }
  },
  marks: { italic: {} }
})

const LABEL: Record<string, string> = { bass: 'Bass, 1985', popper: 'Popper y Mayseless, 2003', mayseless: 'Mayseless, 2010' }
const leaf: Leaf = (n) => (n.type.name === 'citation' ? `(${[n.attrs.paperId, ...n.attrs.extra.map((c: { paperId: string }) => c.paperId)].map((id: string) => LABEL[id]).join('; ')})` : ' ')
const part = (c: { paperId: string }) => LABEL[c.paperId]

const t = (s: string) => schema.text(s)
const para = (...inline: PMNode[]) => schema.nodes.paragraph.create(null, inline)
const thesis = (...body: PMNode[]) =>
  schema.nodes.doc.create(null, [
    schema.nodes.section.create({ kind: 'cuerpo' }, body),
    schema.nodes.section.create({ kind: 'referencias' }, [schema.nodes.referenceList.create(), para()])
  ])
const state = (doc: PMNode) => EditorState.create({ doc })
const text = (doc: PMNode) => doc.child(0).textBetween(0, doc.child(0).content.size, '\n', leaf)

describe('citation fixes from the assistant', () => {
  const doc = thesis(
    para(t('El líder funciona como figura de apego (Mayseless 2010). Según Mayseless (2010), el líder brinda seguridad a sus seguidores.')),
    para(t('Los seguidores con apego seguro confían más en el líder.'))
  )

  it('replaces a citation typed with errors by a live one, and nothing else', () => {
    const fix = { context: 'funciona como figura de apego (Mayseless 2010)', wrong: '(Mayseless 2010)', sources: [{ paperId: 'mayseless' }, { paperId: 'popper', page: 4 }] }
    expect(planCiteFix(doc, fix, leaf)).toMatchObject({ ok: true, kind: 'replace', written: '(Mayseless 2010)' })
    const after = state(doc).apply(citeFixTransaction(state(doc), fix, leaf, part)!).doc
    expect(text(after)).toContain('figura de apego (Mayseless, 2010; Popper y Mayseless, 2003). Según')
  })

  it('corrects a narrative citation as text, but never the words around it', () => {
    const ok = { context: 'Según Mayseless (2010), el líder brinda', wrong: 'Mayseless (2010)', text: 'Mayseless (2010, p. 272)' }
    const after = state(doc).apply(citeFixTransaction(state(doc), ok, leaf, part)!).doc
    expect(text(after)).toContain('Según Mayseless (2010, p. 272), el líder brinda')
    expect(planCiteFix(doc, { ...ok, wrong: 'Mayseless (2010), el líder brinda', text: 'Mayseless (2010), el jefe ofrece' }, leaf)).toEqual({ ok: false, reason: 'La corrección cambia tu texto, no solo la cita' })
    // A narrative citation can't become a parenthesis.
    expect(planCiteFix(doc, { context: ok.context, wrong: 'Mayseless (2010)', sources: [{ paperId: 'mayseless' }] }, leaf).ok).toBe(false)
    expect(planCiteFix(doc, { context: ok.context, wrong: 'el líder brinda', text: '(Bass, 1985)' }, leaf)).toEqual({ ok: false, reason: 'Solo se corrigen citas' })
  })

  it('adds a missing citation before the final period, in the parenthesis already there', () => {
    const fix = { context: 'Los seguidores con apego seguro confían más en el líder', sources: [{ paperId: 'bass' }] }
    const once = state(doc).apply(citeFixTransaction(state(doc), fix, leaf, part)!).doc
    expect(text(once)).toContain('confían más en el líder (Bass, 1985).')
    const twice = state(once).apply(citeFixTransaction(state(once), { ...fix, context: 'Los seguidores con apego seguro confían más en el líder (Bass, 1985)', sources: [{ paperId: 'popper' }] }, leaf, part)!).doc
    expect(text(twice)).toContain('en el líder (Bass, 1985; Popper y Mayseless, 2003).')
  })

  it('finds the passage whatever the quotes, accents or spaces', () => {
    expect(planCiteFix(doc, { context: 'el lider  funciona como figura de apego', sources: [{ paperId: 'bass' }] }, leaf).ok).toBe(true)
    expect(planCiteFix(doc, { context: 'una frase que no existe en la tesis', sources: [{ paperId: 'bass' }] }, leaf)).toEqual({ ok: false, reason: 'Ese pasaje no está en la tesis' })
  })
})

describe('references outside the library', () => {
  it('adds the reference once, with italics, and it satisfies the typed citation', () => {
    const doc = thesis(para(t('La gente cambia de trabajo (The Workforce Institute, 2023).')))
    const apa = 'The Workforce Institute. (2023). *Informe global de la fuerza laboral*. UKG.'
    const after = state(doc).apply(referenceTransaction(state(doc), apa)!).doc
    expect(manualReferences(after)).toEqual(['The Workforce Institute. (2023). Informe global de la fuerza laboral. UKG.'])
    expect(after.child(1).lastChild!.child(1).marks.map((m) => m.type.name)).toEqual(['italic'])
    expect(referenceTransaction(state(after), apa)).toBeNull()
    expect(manualReferenceFor(manualReferences(after), 'The Workforce Institute', '2023')).toBeTruthy()
    expect(referenceTransaction(state(doc), 'una referencia sin año')).toBeNull()
  })
})

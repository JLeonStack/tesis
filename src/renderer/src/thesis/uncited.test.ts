import { describe, expect, it } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Paper } from '@shared/types'
import { inTextGroup } from '../lib/citation'
import { claimAt, supportTransaction, uncitedOf } from './uncited'

// The thesis schema in miniature: sections by kind, paragraphs, headings, quotes, citations and footnotes.
const schema = new Schema({
  nodes: {
    doc: { content: 'section+' },
    section: { content: 'block+', attrs: { kind: { default: 'cuerpo' } } },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    blockquote: { group: 'block', content: 'paragraph+', attrs: { paperId: { default: null } } },
    text: { group: 'inline' },
    citation: { group: 'inline', inline: true, atom: true, attrs: { paperId: { default: null }, page: { default: null }, extra: { default: [] } } },
    footnote: { group: 'inline', inline: true, atom: true, attrs: { text: { default: '' } } }
  }
})

const t = (s: string) => schema.text(s)
const cite = (paperId: string) => schema.nodes.citation.create({ paperId })
const para = (...inline: PMNode[]) => schema.nodes.paragraph.create(null, inline)
const section = (kind: string, ...blocks: PMNode[]) => schema.nodes.section.create({ kind }, blocks)

const CLAIM = 'Los colaboradores con apego seguro perciben más apoyo de su jefe directo.'

function thesis() {
  return schema.nodes.doc.create(null, [
    section('resumen', para(t('El liderazgo transformacional aumenta la confianza de los seguidores en general.'))),
    section(
      'cuerpo',
      schema.nodes.heading.create({ level: 1 }, [t('El apego en el trabajo y la seguridad')]),
      para(t('El liderazgo transformacional aumenta la confianza de los seguidores '), cite('bass'), t(`. ${CLAIM} Este trabajo estudia esa relación.`)),
      schema.nodes.blockquote.create({ paperId: 'popper' }, [para(t('Leaders function as security providers for their followers, much like parents do.'))])
    )
  ])
}

const textOf = (doc: PMNode) =>
  doc.textBetween(0, doc.content.size, '\n', (n) => (n.type.name === 'citation' ? `[${[n.attrs.paperId, ...n.attrs.extra.map((c: { paperId: string }) => c.paperId)].join(';')}]` : ''))

describe('uncited claims in the thesis', () => {
  it('flags only the body claims without a citation', () => {
    const doc = thesis()
    const found = uncitedOf(doc)
    expect(found.map((u) => u.text)).toEqual([CLAIM])
    expect(doc.textBetween(found[0].from, found[0].to)).toBe(CLAIM)
  })

  it('takes the sentence at the caret, or the selection inside it', () => {
    const doc = thesis()
    const { from, to } = uncitedOf(doc)[0]
    const atCaret = claimAt(EditorState.create({ doc, selection: TextSelection.create(doc, from + 5) }))
    expect(atCaret?.text).toBe(CLAIM)
    expect(atCaret?.sentence).toEqual({ from, to })
    expect(atCaret?.citedIds).toEqual([])
    const selected = claimAt(EditorState.create({ doc, selection: TextSelection.create(doc, from, from + 34) }))
    expect(selected?.text).toBe('Los colaboradores con apego seguro')
    expect(selected?.sentence).toEqual({ from, to })
    const first = claimAt(EditorState.create({ doc, selection: TextSelection.create(doc, from - 10) }))
    expect(first?.citedIds).toEqual(['bass'])
  })
})

describe('citing a sentence', () => {
  it('inserts the citation before the final period, then joins a second source to it', () => {
    let state = EditorState.create({ doc: thesis() })
    const range = uncitedOf(state.doc)[0]
    const tr = supportTransaction(state, range, { paperId: 'popper' })
    expect(tr).not.toBeNull()
    state = state.apply(tr as never)
    expect(textOf(state.doc)).toContain('perciben más apoyo de su jefe directo [popper]. Este trabajo')
    expect(uncitedOf(state.doc)).toEqual([])

    const again = claimAt(EditorState.create({ doc: state.doc, selection: TextSelection.create(state.doc, range.from + 3) }))!
    expect(supportTransaction(state, again.sentence, { paperId: 'popper' })).toBe('already')
    state = state.apply(supportTransaction(state, again.sentence, { paperId: 'fraley', page: 4 }) as never)
    expect(textOf(state.doc)).toContain('jefe directo [popper;fraley]. Este trabajo')
  })
})

describe('citing a sentence that already has a typed citation', () => {
  it('joins the same parenthesis, in alphabetical order', () => {
    const typedClaim = 'El líder puede ocupar el lugar de una figura de apego (Mayseless, 2010; Popper y Mayseless, 2003).'
    let state = EditorState.create({ doc: schema.nodes.doc.create(null, [section('cuerpo', para(t(typedClaim)))]) })
    const range = claimAt(EditorState.create({ doc: state.doc, selection: TextSelection.create(state.doc, 6) }))!.sentence
    state = state.apply(supportTransaction(state, range, { paperId: 'davidovitz', page: 3 }, 'Davidovitz et al., 2007, p. 633') as never)
    expect(textOf(state.doc)).toBe('El líder puede ocupar el lugar de una figura de apego (Davidovitz et al., 2007, p. 633; Mayseless, 2010; Popper y Mayseless, 2003).')
  })
})

describe('inTextGroup', () => {
  const p = (id: string, family: string[], year: string): Paper => ({
    id,
    fileName: '',
    title: id,
    authors: family.map((f) => ({ family: f, given: 'A.' })),
    year,
    type: 'article',
    tags: [],
    status: 'unread',
    textStatus: 'ready',
    addedAt: 0,
    updatedAt: 0
  })
  it('orders several sources alphabetically in one parenthesis (APA 7, Spanish)', () => {
    const popper = p('popper', ['Popper', 'Mayseless'], '2003')
    const bass = p('bass', ['Bass'], '1985')
    expect(inTextGroup([{ paper: popper, page: 45 }, { paper: bass }], 'apa', 'es')).toBe('(Bass, 1985; Popper y Mayseless, 2003, p. 45)')
    expect(inTextGroup([{ paper: bass }], 'apa', 'es')).toBe('(Bass, 1985)')
  })
})

import { describe, expect, it } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { adjacentCitation } from './citeJoin'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*' },
    text: { group: 'inline' },
    citation: { group: 'inline', inline: true, atom: true, attrs: { paperId: { default: null }, page: { default: null }, extra: { default: [] } } }
  }
})

const doc = (...inline: PMNode[]) => schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, inline)])
const t = (s: string) => schema.text(s)
const cite = (paperId: string) => schema.nodes.citation.create({ paperId })
/** Position right after `s` in the document's first paragraph (citations count as one). */
const after = (d: PMNode, s: string) => 1 + d.textBetween(1, d.content.size - 1, '\n', '￼').indexOf(s) + s.length

describe('citing next to another citation', () => {
  it('finds the live citation just before the caret, spaces aside, or just after it', () => {
    const d = doc(t('El líder es una base segura '), cite('bass'), t(' .'))
    const near = adjacentCitation(after(d, '￼ '), after(d, '￼ '), d)
    expect(near?.kind === 'live' && near.node.attrs.paperId).toBe('bass')
    const before = after(d, 'segura ')
    expect(adjacentCitation(before, before, d)?.kind).toBe('live')
  })

  it('finds a parenthesis typed by hand before the caret, but not any parenthesis', () => {
    const d = doc(t('La seguridad del seguidor (Mayseless, 2010). Se midió con la LSPS (15 ítems).'))
    const near = adjacentCitation(after(d, '2010)'), after(d, '2010)'), d)
    expect(near).toEqual({ kind: 'typed', from: after(d, 'seguidor '), to: after(d, '2010)'), text: '(Mayseless, 2010)' })
    expect(adjacentCitation(after(d, 'ítems)'), after(d, 'ítems)'), d)).toBeNull()
  })

  it('cites anew in the middle of plain text', () => {
    const d = doc(t('Una oración sin citas.'))
    expect(adjacentCitation(after(d, 'citas'), after(d, 'citas'), d)).toBeNull()
  })
})

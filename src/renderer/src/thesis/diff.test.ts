import { describe, expect, it } from 'vitest'
import { diff, diffStats, diffText } from './diff'

describe('diff', () => {
  it('keeps equal items and marks the rest', () => {
    const ops = diff(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])
    expect(ops.map((o) => `${o.type}:${o.value}`)).toEqual(['same:a', 'add:x', 'del:b', 'same:c', 'same:d', 'add:e'])
  })

  it('handles empty sides', () => {
    expect(diff([], ['a'])).toEqual([{ type: 'add', value: 'a' }])
    expect(diff(['a'], [])).toEqual([{ type: 'del', value: 'a' }])
  })
})

describe('diffText', () => {
  it('reads a reworded paragraph as an edit', () => {
    const d = diffText('Introducción\nEl liderazgo importa mucho en las pymes.', 'Introducción\nEl liderazgo importa bastante en las pymes.')
    expect(d[0]).toEqual({ type: 'same', text: 'Introducción' })
    expect(d[1].type).toBe('edit')
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 })
  })

  it('reads an unrelated paragraph as removed and added', () => {
    const d = diffText('Uno dos tres cuatro.', 'Cinco seis siete ocho.')
    expect(d.map((p) => p.type)).toEqual(['del', 'add'])
  })

  it('finds no changes in the same text', () => {
    expect(diffStats(diffText('a\nb', 'a\n\nb'))).toEqual({ added: 0, removed: 0 })
  })
})

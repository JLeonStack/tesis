import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, VOICE_TAG, mergeLists, parseList, pickThesisSamples, sampleExcerpts, voiceBlock } from './voice'

const sample = (text: string, addedAt: number) => ({ id: String(addedAt), text, source: 'pegado' as const, addedAt })

describe('voiceBlock', () => {
  it('is empty when the voice is off', () => {
    expect(voiceBlock({ voice: { ...DEFAULT_VOICE, enabled: false, description: 'Directo' } })).toBe('')
  })

  it('carries the description, traits, lists and the academic-register rule', () => {
    const block = voiceBlock({ voice: { ...DEFAULT_VOICE, description: 'Directo y ordenado', traits: 'Abre con la idea principal.', prefer: 'dicho de otro modo\nen la práctica', person: 'nosotros' } })
    expect(block.startsWith(`<${VOICE_TAG}>`)).toBe(true)
    expect(block).toContain('Directo y ordenado')
    expect(block).toContain('Abre con la idea principal.')
    expect(block).toContain('dicho de otro modo; en la práctica')
    expect(block).toContain('primera plural')
    expect(block).toContain('cabe destacar')
    expect(block).toContain('gana el registro')
  })

  it('adds the student’s own paragraphs only when asked', () => {
    const voice = { ...DEFAULT_VOICE, samples: [sample('Primera muestra escrita por el estudiante.', 1)] }
    expect(voiceBlock({ voice })).not.toContain('Primera muestra')
    expect(voiceBlock({ voice }, { samples: true })).toContain('Primera muestra')
  })
})

describe('lists', () => {
  it('splits by line and comma, keeps parentheses, drops repeats', () => {
    expect(parseList('a, b\n\nA\nen este sentido (como muletilla, a veces)')).toEqual(['a', 'b', 'en este sentido (como muletilla, a veces)'])
  })

  it('merges without duplicating what the student already wrote', () => {
    expect(mergeLists('por ende\nen la práctica', ['En la práctica', 'a la vez'])).toBe('por ende\nen la práctica\na la vez')
  })
})

describe('samples', () => {
  it('takes the newest samples first, within the budget, cut at a sentence', () => {
    const long = 'Una oración completa. '.repeat(60)
    const out = sampleExcerpts([sample('vieja', 1), sample(long, 2)], 500)
    expect(out).toHaveLength(1)
    expect(out[0].endsWith('.')).toBe(true)
    expect(out[0].length).toBeLessThanOrEqual(500)
  })

  it('picks the longest thesis paragraphs not saved yet', () => {
    expect(pickThesisSamples(['corto', 'más largo que el otro', 'ya guardado'], [sample('ya guardado', 1)], 1)).toEqual(['más largo que el otro'])
  })
})

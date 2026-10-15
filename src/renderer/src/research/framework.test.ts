import { describe, expect, it } from 'vitest'
import type { Settings } from '@shared/types'
import { frameworkChecks, researchBlock } from './framework'
import { HEADING_GUIDANCE, normalizeHeading } from '../thesis/template'

const settings = (researchQuestion: string, hypotheses: string) =>
  ({ thesisTitle: '', researchQuestion, research: { constructs: ['security', 'ocb'], demographics: [], hypotheses } }) as unknown as Settings
const check = (s: Settings, id: string) => frameworkChecks(s).find((c) => c.id === id)

describe('workshop guide: question and hypotheses', () => {
  it('accepts a relational question with H₁ and H₀', () => {
    const s = settings(
      '¿Se relaciona la percepción del líder como proveedor de seguridad con el CCO de los colaboradores?',
      'H₁: A mayor percepción del líder como proveedor de seguridad, mayor CCO. H₀: No existe relación entre ambas variables.'
    )
    expect(check(s, 'question-form')).toMatchObject({ ok: true, title: 'Pregunta relacional' })
    expect(check(s, 'hypotheses-form')?.ok).toBe(true)
    expect(check(s, 'judgment')?.ok).toBe(true)
  })

  it('flags a missing null hypothesis, a statement without «?» and value judgments', () => {
    const s = settings('Los mejores líderes generan más CCO', 'H1: Un buen líder podría aumentar el CCO.')
    expect(check(s, 'question-form')?.ok).toBe(false)
    expect(check(s, 'hypotheses-form')?.title).toContain('H₀')
    expect(check(s, 'judgment')?.title).toMatch(/mejores.*buen.*podria/)
  })

  it('tells a comparative question apart', () => {
    expect(check(settings('¿Difiere el CCO de los colaboradores según su género?', ''), 'question-form')?.title).toBe('Pregunta comparativa')
  })
})

describe('workshop guide: as guidance', () => {
  it('guides the problem, question and hypothesis sections of the template', () => {
    expect(HEADING_GUIDANCE[normalizeHeading('Planteo y Relevancia del Problema')]).toMatch(/práctica.*teórica.*contextual.*estratégica/)
    expect(HEADING_GUIDANCE[normalizeHeading('Hipótesis')]).toContain('H₀')
  })

  it('the assistants get the guide', () => {
    expect(researchBlock(settings('', ''))).toContain('Pautas del taller para el planteo')
  })
})

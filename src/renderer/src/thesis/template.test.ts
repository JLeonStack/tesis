import { describe, expect, it } from 'vitest'
import { BODY_OUTLINE, defaultSectionContent, sectionTitle } from './template'

describe('thesis template', () => {
  it('lays out the body as the workshop asks, run-in headings for level 4', () => {
    const body = defaultSectionContent('cuerpo')
    const headings = body.flatMap((n) =>
      n.type === 'heading' ? [`${n.attrs!.level} ${n.content![0].text}`] : n.content?.[0].marks?.[0].type === 'runIn' ? [`4 ${n.content[0].text}`] : []
    )
    expect(headings).toEqual(BODY_OUTLINE.map((o) => `${o.level} ${o.text}`))
    expect(headings.slice(0, 6)).toEqual([
      '1 Introducción',
      '2 Estado del Arte y Revisión Bibliográfica',
      '2 Planteo y Relevancia del Problema',
      '2 Pregunta de Investigación',
      '2 Hipótesis',
      '1 Objetivo General'
    ])
    expect(headings).toContain('4 Procesamiento Estadístico.')
    expect(headings.at(-1)).toBe('2 Conclusión, Discusión y Aplicación')
  })

  it("uses the student's section titles, falling back to the template's", () => {
    expect(sectionTitle('referencias')).toBe('Referencias Bibliográficas')
    expect(sectionTitle('apendices', 'Anexos')).toBe('Anexos')
    expect(sectionTitle('toc', '  ')).toBe('Tabla de Contenidos')
    expect(sectionTitle('cuerpo', 'x')).toBeUndefined()
  })
})

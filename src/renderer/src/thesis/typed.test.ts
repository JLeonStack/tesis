import { describe, expect, it } from 'vitest'
import type { Paper } from '@shared/types'
import { referenceIds, resolveCite, typedCitations } from './typed'

const paper = (id: string, families: string[], year: string, extra: Partial<Paper> = {}): Paper => ({
  id,
  fileName: '',
  title: id,
  authors: families.map((family) => ({ family, given: 'A.' })),
  year,
  type: 'article',
  tags: [],
  status: 'read',
  textStatus: 'ready',
  addedAt: 0,
  updatedAt: 0,
  ...extra
})

const short = (text: string) => typedCitations(text).map((c) => `${c.families.join('+')}${c.etAl ? ' et al.' : ''} ${c.year}`)

describe('typedCitations', () => {
  it('reads parenthetical citations, several per parenthesis, with pages', () => {
    expect(short('se asocia con mayor engagement (Laguía et al., 2025; Molero et al., 2019, p. 185) y proactividad (Wu & Parker, 2016).')).toEqual([
      'Laguía et al. 2025',
      'Molero et al. 2019',
      'Wu+Parker 2016'
    ])
    expect(short('(Fraley, Waller y Brennan, 2000)')).toEqual(['Fraley+Waller+Brennan 2000'])
    expect(short('(Fraley et al., 2000, 2011)')).toEqual(['Fraley et al. 2000', 'Fraley et al. 2011'])
    expect(short('(véase Mayseless, 2010a)')).toEqual(['Mayseless 2010a'])
    expect(short('(Dávila de León y Finkelstein, 2011)')).toEqual(['Dávila de León+Finkelstein 2011'])
  })

  it('reads narrative citations', () => {
    expect(short('Según Molero et al. (2019), el LSPS mide la seguridad; Wu y Parker (2016, p. 1030) lo vinculan con la proactividad.')).toEqual([
      'Molero et al. 2019',
      'Wu+Parker 2016'
    ])
    expect(short('el metaanálisis de Warnock et al. (2024) excluyó esos estudios')).toEqual(['Warnock et al. 2024'])
  })

  it('lists only the source read for a secondary citation', () => {
    expect(short('el 69 % (The Workforce Institute, 2023, citado en McConnell et al., 2025).')).toEqual(['McConnell et al. 2025'])
  })

  it('ignores parentheses that are not citations', () => {
    expect(short('la seguridad que perciben en su jefe (LSPS), medida en 2019 (n = 2019) con la ECR-RS (Tabla 2).')).toEqual([])
  })
})

describe('resolving typed citations to the library', () => {
  const lib = [
    paper('molero', ['Molero', 'Mikulincer', 'Shaver', 'Laguía', 'Moriano'], '2019', { doi: '10.5093/jwop2019a20', volume: '35', issue: '3', pages: '183-193' }),
    paper('molero-dup', ['Molero', 'Mikulincer', 'Shaver', 'Laguía', 'Moriano'], '2019', { doi: 'https://doi.org/10.5093/JWOP2019A20' }),
    paper('wu', ['Wu', 'Parker'], '2016'),
    paper('laguia', ['Laguia', 'Edú-Valsania', 'Navas-Jiménez'], '2025'),
    paper('popper', ['Popper', 'Mayseless'], '2003'),
    paper('mayseless-a', ['Mayseless'], '2010', { title: 'Attachment and the leader-follower relationship' }),
    paper('mayseless-b', ['Mayseless'], '2010', { title: 'Who are the leaders' })
  ]
  const byId = Object.fromEntries(lib.map((p) => [p.id, p]))
  const resolve = (t: string) => typedCitations(t).map((c) => resolveCite(c, lib))

  it('matches family and year, accents aside, and picks the most complete duplicate', () => {
    expect(resolve('(Molero et al., 2019)')).toEqual([{ paperId: 'molero', ambiguous: false }])
    expect(resolve('(Laguía et al., 2025)')[0].paperId).toBe('laguia')
    expect(resolve('Popper y Mayseless (2003)')[0].paperId).toBe('popper')
    expect(resolve('(Wu & Parker, 2015)')[0].paperId).toBeNull()
    // Two authors written for a three-author paper is not the same work.
    expect(resolve('(Laguía y Edú-Valsania, 2025)')[0].paperId).toBeNull()
  })

  it('flags the same author and year for different works, unless a / b picks one', () => {
    expect(resolve('(Mayseless, 2010)')[0].ambiguous).toBe(true)
    expect(resolve('(Mayseless, 2010b)')[0]).toEqual({ paperId: 'mayseless-b', ambiguous: false })
  })

  it('lists each work once, live and typed citations together', () => {
    const typed = typedCitations('(Molero et al., 2019; Wu & Parker, 2016). Wu y Parker (2016) agregan…')
    expect(referenceIds(['molero-dup', 'popper'], typed, byId)).toEqual(['molero', 'popper', 'wu'])
  })
})

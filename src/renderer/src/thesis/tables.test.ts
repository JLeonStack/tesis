import { describe, expect, it } from 'vitest'
import { apaInline, apaRuns } from './tables'

describe('APA inline italics', () => {
  it('keeps significance stars outside italics', () => {
    expect(apaInline('* *p* < .05. ** *p* < .01.')).toBe('* <i>p</i> &lt; .05. ** <i>p</i> &lt; .01.')
  })
  it('splits into Word runs', () => {
    expect(apaRuns('*r*(248) = .31, *** *p* < .001')).toEqual([
      { text: 'r', italic: true },
      { text: '(248) = .31, *** ', italic: false },
      { text: 'p', italic: true },
      { text: ' < .001', italic: false }
    ])
  })
})

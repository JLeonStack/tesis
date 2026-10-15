import { describe, expect, it } from 'vitest'
import type { Paper, PaperGuide, ResearchSettings } from '@shared/types'
import { coverage, paperConstructs } from './coverage'

const paper = (id: string, title: string, extra: Partial<Paper> = {}) => ({ id, title, authors: [], tags: [], ...extra }) as unknown as Paper
const research = { constructs: ['attachment', 'ocb'] } as unknown as ResearchSettings

describe('paper constructs', () => {
  it('falls back to the title and abstract', () => {
    expect(paperConstructs(paper('a', 'Attachment styles and organizational citizenship behavior'))).toEqual(['attachment', 'ocb'])
  })
  it('prefers the guide over the title', () => {
    expect(paperConstructs(paper('a', 'Attachment at work'), { constructs: ['tfl'] } as PaperGuide)).toEqual(['tfl'])
  })
  it('keeps manual tags, even empty ones', () => {
    expect(paperConstructs(paper('a', 'Attachment at work', { constructs: [], constructsManual: true }), { constructs: ['tfl'] } as PaperGuide)).toEqual([])
  })
  it('counts the cross', () => {
    const c = coverage([paper('a', 'Attachment and OCB'), paper('b', 'Attachment theory'), paper('c', 'Empathy')], {}, research)
    expect(c).toMatchObject({ cross: 1, total: 3, by: { attachment: 2, ocb: 1, empathy: 1 } })
  })
})

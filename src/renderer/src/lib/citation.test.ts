import { describe, expect, it } from 'vitest'
import type { Paper } from '@shared/types'
import { cleanText, formatReference, inText, looksTitleCase, missingReferenceData, pageRange, toSentenceCase } from './citation'

const base = (extra: Partial<Paper>): Paper => ({
  id: 'x',
  fileName: '',
  title: 'Title',
  authors: [],
  type: 'article',
  tags: [],
  status: 'read',
  textStatus: 'ready',
  addedAt: 0,
  updatedAt: 0,
  ...extra
})
const apa = (p: Partial<Paper>) => formatReference(base(p), 'apa', 'es')

describe('APA 7 references (Spanish)', () => {
  it('formats a journal article with an en dash in the page range', () => {
    expect(
      apa({
        title: 'Attachment and the leader—follower relationship',
        authors: [{ family: 'Mayseless', given: 'Ofra' }],
        year: '2010',
        venue: 'Journal of Social and Personal Relationships',
        volume: '27',
        issue: '2',
        pages: '271-280',
        doi: '10.1177/0265407509360904'
      })
    ).toBe('Mayseless, O. (2010). Attachment and the leader—follower relationship. *Journal of Social and Personal Relationships*, *27*(2), 271–280. https://doi.org/10.1177/0265407509360904')
  })

  it('cites the article number when the journal has no pages, and decodes entities', () => {
    expect(
      apa({
        title: 'Beyond the global attachment model',
        authors: [{ family: 'Greškovičová', given: 'Katarína' }, { family: 'Lisá', given: 'Elena' }],
        year: '2023',
        venue: 'Leadership &amp; Organization Development Journal',
        volume: '14',
        articleNumber: '1158992'
      })
    ).toBe('Greškovičová, K. y Lisá, E. (2023). Beyond the global attachment model. *Leadership & Organization Development Journal*, *14*, Artículo 1158992.')
  })

  it('formats a chapter with its editors and pages', () => {
    expect(
      apa({
        type: 'chapter',
        title: 'Attachment and leadership',
        authors: [{ family: 'Popper', given: 'Micha' }],
        editors: [{ family: 'Mikulincer', given: 'Mario' }, { family: 'Shaver', given: 'Phillip R.' }],
        year: '2007',
        venue: 'Attachment in adulthood',
        pages: '428-56',
        publisher: 'Guilford Press'
      })
    ).toBe('Popper, M. (2007). Attachment and leadership. En M. Mikulincer y P. R. Shaver (Eds.), *Attachment in adulthood* (pp. 428–456). Guilford Press.')
  })

  it('italicizes standalone works and writes hyphenated initials', () => {
    expect(apa({ type: 'report', title: 'State of the workplace', authors: [{ family: 'Dubois', given: 'Jean-Paul' }], year: '2023', publisher: 'Gallup' })).toBe(
      'Dubois, J.-P. (2023). *State of the workplace*. Gallup.'
    )
    expect(apa({ type: 'thesis', title: 'Apego y liderazgo', authors: [{ family: 'Pérez', given: 'Ana' }], year: '2021', publisher: 'Tesis de maestría, Universidad del CEMA' })).toBe(
      'Pérez, A. (2021). *Apego y liderazgo* [Tesis de maestría, Universidad del CEMA].'
    )
  })

  it('lists what a reference lacks', () => {
    expect(missingReferenceData(base({ authors: [{ family: 'A', given: 'B' }], year: '2025', venue: 'Anuario de Psicología', volume: '55' }))).toEqual(['páginas o número de artículo'])
  })
})

describe('in-text page locators', () => {
  const p = base({ authors: [{ family: 'Wu', given: 'C.' }, { family: 'Parker', given: 'S.' }], year: '2016' })
  it('uses p. for one page and pp. with an en dash for a range', () => {
    expect(inText(p, 'apa', 1030, 'es')).toBe('(Wu y Parker, 2016, p. 1030)')
    expect(inText(p, 'apa', '1030-32', 'es')).toBe('(Wu y Parker, 2016, pp. 1030–1032)')
  })
})

describe('text cleanup and title case', () => {
  it('normalizes ranges and entities', () => {
    expect(pageRange('615-25')).toBe('615–625')
    expect(pageRange('e1234')).toBe('e1234')
    expect(cleanText('Leader&#8211;follower <i>attachments</i>')).toBe('Leader–follower attachments')
  })

  it('spots Title Case and turns it into sentence case, keeping acronyms and the subtitle', () => {
    expect(looksTitleCase('The Role of Leader Support in Facilitating Proactive Work Behavior')).toBe(true)
    expect(looksTitleCase('The security to lead: a systematic review of leader and follower attachment styles')).toBe(false)
    expect(toSentenceCase('Liderazgo de Base Segura: Teoría e Investigación')).toBe('Liderazgo de base segura: Teoría e investigación')
    expect(toSentenceCase('The Development and Validation of the LSPS')).toBe('The development and validation of the LSPS')
  })
})

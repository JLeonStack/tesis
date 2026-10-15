import { describe, expect, it } from 'vitest'
import type { Paper } from '@shared/types'
import { rekey, sourceFor } from './sourceKeys'

const paper = (id: string): Paper => ({ id, fileName: '', title: id, authors: [], type: 'article', tags: [], status: 'read', textStatus: 'ready', addedAt: 0, updatedAt: 0 })
const papers = Object.fromEntries(['mayseless', 'popper', 'harms', 'keller'].map((id) => [id, paper(id)]))

describe('source keys of a chat message', () => {
  // The answer was written when the thesis cited Mayseless and Popper; it has since cited Harms, which sorts first.
  const written = ['mayseless', 'popper']
  const now = [papers.harms, papers.mayseless, papers.popper]

  it('points each key to the paper it meant when written', () => {
    expect(sourceFor('S1', written, now, papers)?.id).toBe('mayseless')
    expect(sourceFor('S2', written, now, papers)?.id).toBe('popper')
    expect(sourceFor('S3', written, now, papers)).toBeUndefined()
  })

  it('falls back to the current list for messages saved before keys were kept', () => {
    expect(sourceFor('S1', undefined, now, papers)?.id).toBe('harms')
    expect(sourceFor('Sx', undefined, now, papers)).toBeUndefined()
  })

  it('renumbers an earlier answer for a thread with other sources, naming the ones gone', () => {
    expect(rekey('Lo dice Mayseless [S1, p. 5] y también [S2, pp. 3–4; S1, p. 7].', written, now, (id) => id)).toBe(
      'Lo dice Mayseless [S2, p. 5] y también [S3, pp. 3–4; S2, p. 7].'
    )
    expect(rekey('Ver [S2, p. 1].', written, [papers.mayseless], (id) => `${id} 2003`)).toBe('Ver [«popper 2003», p. 1].')
    expect(rekey('Sin fuentes guardadas [S1].', undefined, now, (id) => id)).toBe('Sin fuentes guardadas [S1].')
  })
})

import type { Paper } from '@shared/types'

// Answers cite their sources as [S3, p. 4], numbered by the chat's source list
// at the time. That list changes (the thesis cites a new work, a paper is
// deleted), so each message keeps the paper ids its keys were numbered with.

/** The paper an [S3] points to: by the sources the message was written with, else the current list (older messages). */
export function sourceFor(key: string, written: string[] | undefined, current: Paper[], papers: Record<string, Paper>): Paper | undefined {
  const i = Number(key.replace(/^S/, '')) - 1
  if (!Number.isInteger(i) || i < 0) return undefined
  if (written) return written[i] ? papers[written[i]] : undefined
  return current[i]
}

/**
 * An earlier message's [S#] keys renumbered for a thread whose source list
 * differs (a fresh thread replays the conversation). A source no longer in the
 * list is named instead, so the model doesn't read it as another paper.
 */
export function rekey(text: string, written: string[] | undefined, current: Paper[], label: (id: string) => string): string {
  if (!written) return text
  const now = new Map(current.map((p, i) => [p.id, i + 1]))
  return text.replace(/\[[^[\]]*\bS\d+\b[^[\]]*\]/g, (group) =>
    group.replace(/\bS(\d+)\b/g, (key, n: string) => {
      const id = written[Number(n) - 1]
      if (!id) return key
      const j = now.get(id)
      return j ? `S${j}` : `«${label(id)}»`
    })
  )
}

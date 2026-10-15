// Comparing two states of the thesis: paragraphs first, then words inside the
// paragraphs that changed, so a reworded sentence reads as an edit and not as a
// paragraph removed and another added.

export type DiffOp<T> = { type: 'same' | 'add' | 'del'; value: T }

/** Longest-common-subsequence diff; common ends are trimmed first so long, mostly equal texts stay cheap. */
export function diff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = Object.is): DiffOp<T>[] {
  let start = 0
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  // lcs[i][j]: common length of a[start+i..endA) and b[start+j..endB).
  const lcs = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[at(i, j)] = eq(a[start + i], b[start + j]) ? lcs[at(i + 1, j + 1)] + 1 : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)])

  const out: DiffOp<T>[] = a.slice(0, start).map((value) => ({ type: 'same', value }))
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[start + i], b[start + j])) {
      out.push({ type: 'same', value: a[start + i] })
      i++
      j++
    } else if (j < m && (i === n || lcs[at(i, j + 1)] >= lcs[at(i + 1, j)])) {
      out.push({ type: 'add', value: b[start + j++] })
    } else {
      out.push({ type: 'del', value: a[start + i++] })
    }
  }
  for (let k = endA; k < a.length; k++) out.push({ type: 'same', value: a[k] })
  return out
}

export type ParagraphDiff =
  | { type: 'same'; text: string }
  | { type: 'add'; text: string }
  | { type: 'del'; text: string }
  /** A paragraph that was reworded: its words, marked. */
  | { type: 'edit'; words: DiffOp<string>[] }

const paragraphs = (text: string) => text.split('\n').map((p) => p.trim()).filter(Boolean)
/** Words with the space after them, so joining the pieces gives the text back. */
const words = (p: string) => p.match(/\S+\s*/g) ?? []

/** How the text went from `before` to `after`, paragraph by paragraph. */
export function diffText(before: string, after: string): ParagraphDiff[] {
  const ops = diff(paragraphs(before), paragraphs(after))
  const out: ParagraphDiff[] = []
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.type === 'same') {
      out.push({ type: 'same', text: op.value })
      continue
    }
    // A run of removed paragraphs next to a run of added ones: pair them up as edits when they still share most words.
    const dels: string[] = []
    const adds: string[] = []
    while (k < ops.length && ops[k].type !== 'same') {
      ;(ops[k].type === 'del' ? dels : adds).push(ops[k].value)
      k++
    }
    k--
    const pairs = Math.min(dels.length, adds.length)
    for (let p = 0; p < Math.max(dels.length, adds.length); p++) {
      if (p < pairs) {
        const w = diff(words(dels[p]), words(adds[p]), (x, y) => x.trim() === y.trim())
        const kept = w.filter((o) => o.type === 'same').length
        if (kept / Math.max(1, Math.max(words(dels[p]).length, words(adds[p]).length)) >= 0.4) {
          out.push({ type: 'edit', words: w })
          continue
        }
      }
      if (p < dels.length) out.push({ type: 'del', text: dels[p] })
      if (p < adds.length) out.push({ type: 'add', text: adds[p] })
    }
  }
  return out
}

/** Words added and removed, for a one-line summary. */
export function diffStats(d: ParagraphDiff[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const p of d) {
    if (p.type === 'add') added += words(p.text).length
    else if (p.type === 'del') removed += words(p.text).length
    else if (p.type === 'edit')
      for (const w of p.words) {
        if (w.type === 'add') added++
        else if (w.type === 'del') removed++
      }
  }
  return { added, removed }
}

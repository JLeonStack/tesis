import type { Cell } from '@shared/types'

// Reads the first sheet of an .xlsx (Qualtrics export) or a .csv into rows of
// cells. Just enough of OOXML for survey data: shared and inline strings,
// numbers, booleans. Unzipping uses the browser's own DecompressionStream, so
// there is no dependency to trust with the file.

/** The entries of a zip archive, by name, inflated on demand. */
async function unzip(buf: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const v = new DataView(buf)
  // End of central directory: scan back from the end for its signature.
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido.')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out = new Map<string, () => Promise<string>>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    out.set(name, async () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
      const data = new Uint8Array(buf, start, size)
      if (method === 0) return dec.decode(data)
      if (method !== 8) throw new Error(`Compresión no soportada en ${name}.`)
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return await new Response(stream).text()
    })
  }
  return out
}

/** "AB" → 27 (1-based). */
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

const textOf = (el: Element) => Array.from(el.getElementsByTagName('t'), (t) => t.textContent ?? '').join('')

export async function readXlsx(buf: ArrayBuffer): Promise<Cell[][]> {
  const files = await unzip(buf)
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const shared: string[] = []
  const ss = files.get('xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(parse(await ss()).getElementsByTagName('si'))) shared.push(textOf(si))
  // The first sheet, as the workbook lists it.
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))[0]
  if (!sheetName) throw new Error('El .xlsx no tiene hojas.')
  const doc = parse(await files.get(sheetName)!())
  const rows: Cell[][] = []
  for (const row of Array.from(doc.getElementsByTagName('row'))) {
    const r = Number(row.getAttribute('r')) - 1
    const cells: Cell[] = []
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const i = colIndex(c.getAttribute('r') ?? '')
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null
      let cell: Cell = null
      if (t === 'inlineStr') cell = textOf(c)
      else if (t === 's') cell = v == null ? null : (shared[Number(v)] ?? null)
      else if (t === 'str') cell = v
      else if (t === 'b') cell = v === '1' ? 1 : 0
      else if (v != null && v !== '') cell = Number(v)
      cells[i < 0 ? cells.length : i] = cell === '' ? null : cell
    }
    rows[r >= 0 ? r : rows.length] = Array.from(cells, (c) => c ?? null)
  }
  return Array.from(rows, (r) => r ?? [])
}

/** RFC 4180 CSV (comma or semicolon, quoted fields); numbers become numbers. */
export function readCsv(text: string): Cell[][] {
  const first = text.slice(0, text.indexOf('\n') >>> 0)
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) row.push(field), (field = '')
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) rows.push([...row, field])
  return rows.map((r) =>
    r.map((f) => {
      const t = f.trim()
      if (!t) return null
      const n = Number(t.replace(/^(-?\d+),(\d+)$/, '$1.$2'))
      return Number.isFinite(n) ? n : t
    })
  )
}

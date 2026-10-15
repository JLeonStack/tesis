import type { Note, Paper } from '@shared/types'
import { activeTab, toast, useStore } from '../store'
import { formatReference, inTextGroup, plainRef, toBibtex } from './citation'

interface JNode {
  type: string
  attrs?: Record<string, any>
  content?: JNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, any> }[]
}

/** Paper ids cited anywhere in a note (citation nodes and source quotes). */
export function citedPaperIds(content: unknown): string[] {
  const ids = new Set<string>()
  const walk = (n?: JNode) => {
    if (!n) return
    if ((n.type === 'citation' || n.type === 'blockquote') && n.attrs?.paperId) ids.add(n.attrs.paperId)
    for (const c of n.type === 'citation' ? (n.attrs?.extra ?? []) : []) ids.add(c.paperId)
    n.content?.forEach(walk)
  }
  walk(content as JNode)
  return [...ids]
}

export function notePapers(note: Note): Paper[] {
  const papers = useStore.getState().papers
  const ids = new Set([...note.paperIds, ...citedPaperIds(note.content)])
  return [...ids].map((id) => papers[id]).filter(Boolean)
}

export function bibliography(papers: Paper[]): string[] {
  const style = useStore.getState().settings.citationStyle
  return papers.map((p) => formatReference(p, style)).sort((a, b) => a.localeCompare(b))
}

function inline(nodes: JNode[] = []): string {
  const { papers, settings } = useStore.getState()
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'citation') {
        const cites: { paperId: string; page?: number | null }[] = [{ paperId: n.attrs?.paperId, page: n.attrs?.page }, ...(n.attrs?.extra ?? [])]
        return inTextGroup(cites.flatMap((c) => (papers[c.paperId] ? [{ paper: papers[c.paperId], page: c.page }] : [])), settings.citationStyle)
      }
      let t = n.text ?? ''
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') t = `**${t}**`
        else if (m.type === 'italic') t = `*${t}*`
        else if (m.type === 'code') t = `\`${t}\``
        else if (m.type === 'strike') t = `~~${t}~~`
        else if (m.type === 'highlight') t = `==${t}==`
        else if (m.type === 'link') t = `[${t}](${m.attrs?.href})`
      }
      return t
    })
    .join('')
}

function block(n: JNode, indent = ''): string {
  switch (n.type) {
    case 'heading':
      return `${'#'.repeat(n.attrs?.level ?? 1)} ${inline(n.content)}`
    case 'paragraph':
      return indent + inline(n.content)
    case 'blockquote':
      return (n.content ?? []).map((c) => block(c).replace(/^/gm, '> ')).join('\n>\n')
    case 'bulletList':
      return (n.content ?? []).map((li) => listItem(li, `${indent}- `, indent)).join('\n')
    case 'orderedList':
      return (n.content ?? []).map((li, i) => listItem(li, `${indent}${i + 1}. `, indent)).join('\n')
    case 'taskList':
      return (n.content ?? []).map((li) => listItem(li, `${indent}- [${li.attrs?.checked ? 'x' : ' '}] `, indent)).join('\n')
    case 'codeBlock':
      return `\`\`\`\n${inline(n.content)}\n\`\`\``
    case 'horizontalRule':
      return '---'
    default:
      return inline(n.content)
  }
}

function listItem(li: JNode, bullet: string, indent: string): string {
  const [first, ...rest] = li.content ?? []
  const head = bullet + (first ? block(first) : '')
  const tail = rest.map((c) => block(c, `${indent}  `)).join('\n')
  return tail ? `${head}\n${tail}` : head
}

export function noteToMarkdown(note: Note): string {
  const doc = note.content as JNode | null
  const body = (doc?.content ?? []).map((n) => block(n)).join('\n\n')
  const refs = bibliography(notePapers(note))
  const title = note.title ? `# ${note.title}\n\n` : ''
  return `${title}${body}${refs.length ? `\n\n## Referencias\n\n${refs.join('\n\n')}` : ''}\n`
}

const fileSafe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Sin título'

export async function exportActiveNote(): Promise<void> {
  const s = useStore.getState()
  const tab = activeTab()
  const note = tab?.kind === 'note' ? s.notes[tab.id] : s.sideNoteId ? s.notes[s.sideNoteId] : null
  if (!note) return toast('Abrí una nota para exportarla')
  const path = await window.api.shell.saveFile(`${fileSafe(note.title)}.md`, noteToMarkdown(note), [
    { name: 'Markdown', extensions: ['md'] }
  ])
  if (path) toast('Nota exportada')
}

export async function exportBibliography(): Promise<void> {
  const papers = Object.values(useStore.getState().papers)
  if (!papers.length) return toast('Tu biblioteca está vacía')
  const path = await window.api.shell.saveFile('library.bib', papers.map(toBibtex).join('\n\n') + '\n', [
    { name: 'BibTeX', extensions: ['bib'] }
  ])
  if (path) toast(`Se exportaron ${papers.length} referencias`)
}

export async function copyText(text: string, what = 'Copiado'): Promise<void> {
  await navigator.clipboard.writeText(text)
  toast(what)
}

export async function copyReference(p: Paper): Promise<void> {
  const ref = formatReference(p, useStore.getState().settings.citationStyle)
  const html = ref.replace(/\*([^*]+)\*/g, '<i>$1</i>')
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([plainRef(ref)], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' })
    })
  ])
  toast('Referencia copiada')
}

import type { Note, Paper, Settings } from '@shared/types'
import { authorLine, STYLE_LABELS } from './citation'
import { getPaperText } from './ingest'

// Total characters of source text we hand the model (~90k tokens).
const BUDGET = 360_000

export interface Source {
  key: string // S1, S2…
  paper: Paper
}

function thesisBlock(s: Settings): string {
  const lines: string[] = []
  if (s.thesisTitle.trim()) lines.push(`Thesis working title: "${s.thesisTitle.trim()}"`)
  if (s.researchQuestion.trim()) lines.push(`Research question: ${s.researchQuestion.trim()}`)
  return lines.length ? lines.join('\n') : 'The student has not described their thesis yet.'
}

const RULES = (style: string) => `How to answer:
- Ground claims in the sources. Cite inline with the exact format [S1, p. 12] (source id, then page). Several: [S1, p. 3; S2, p. 8]. Never invent pages, quotes or findings.
- If the sources don't cover something, say so in one line, then answer from general knowledge and label it as such.
- Be concise and scannable: short paragraphs, bullet lists, **bold** key terms, Markdown headings only for long answers. No preamble, no closing offers.
- Quote exactly and briefly when quoting.
- Always reply in Spanish (Rioplatense academic register, as at Universidad del CEMA), even when the student writes in another language or the source is in English. Keep quotes verbatim in their original language and add a Spanish translation in parentheses right after.
- When asked for references or citations, format them in ${style} style.`

async function sourceBlocks(sources: Source[]): Promise<string> {
  const per = Math.floor(BUDGET / Math.max(1, sources.length))
  const blocks = await Promise.all(
    sources.map(async ({ key, paper }) => {
      const pages = (await getPaperText(paper.id)) ?? []
      let body = ''
      for (const p of pages) {
        const chunk = `\n[Page ${p.page}]\n${p.text}\n`
        if (body.length + chunk.length > per) {
          body += `\n[… truncated after page ${p.page - 1} of ${pages.length}]`
          break
        }
        body += chunk
      }
      if (!pages.length) body = paper.abstract ? `(Full text unavailable. Abstract:)\n${paper.abstract}` : '(Text not available.)'
      const attrs = `id="${key}" title="${paper.title.replace(/"/g, "'")}" authors="${authorLine(paper, 6)}" year="${paper.year ?? ''}"`
      return `<source ${attrs}>${body}</source>`
    })
  )
  return blocks.join('\n\n')
}

export async function paperInstructions(paper: Paper, settings: Settings): Promise<string> {
  return `You are the research assistant inside Thesis Studio, a desktop app where an MBA student reads academic papers, annotates them and writes their thesis. The student is currently reading source S1.

${thesisBlock(settings)}

${RULES(STYLE_LABELS[settings.citationStyle])}
- "This paper" means S1.

Sources:
${await sourceBlocks([{ key: 'S1', paper }])}`
}

export async function noteInstructions(note: Note, papers: Paper[], allPapers: Paper[], settings: Settings): Promise<string> {
  const sources = papers.map((paper, i) => ({ key: `S${i + 1}`, paper }))
  const catalog = allPapers
    .filter((p) => !papers.includes(p))
    .slice(0, 150)
    .map((p) => `- "${p.title}" — ${authorLine(p) || 'unknown authors'}${p.year ? ` (${p.year})` : ''}${p.abstract ? `: ${p.abstract.slice(0, 280)}…` : ''}`)
    .join('\n')
  return `You are the research assistant inside Thesis Studio, a desktop app where an MBA student reads papers and writes their thesis. The student is working on a note titled "${note.title || 'Untitled'}". You help them organize ideas, strengthen arguments, find supporting sources and write clearly in an academic register. The current note content is attached to each message.

${thesisBlock(settings)}

${RULES(STYLE_LABELS[settings.citationStyle])}
- When suggesting other papers from the library catalog, name them by title and author.

${sources.length ? `Sources linked to this note:\n${await sourceBlocks(sources)}` : 'No papers are linked to this note yet.'}

${catalog ? `Other papers in the student's library (titles and abstracts only):\n${catalog}` : ''}`
}

export interface QuickAction {
  label: string
  /** One line on what you get back, so the choice is quick (Hick's law). */
  hint: string
  prompt: string
}

export const PAPER_ACTIONS: QuickAction[] = [
  {
    label: 'Summarize',
    hint: 'Question, method, findings and limits',
    prompt:
      'Summarize this paper for my thesis: the research question, method and data, key findings, and limitations. Cite pages.'
  },
  {
    label: 'Relevance to my thesis',
    hint: 'Where it supports or challenges your argument',
    prompt:
      'How does this paper relate to my thesis? Which of my arguments could it support or challenge, and which exact passages would I cite? Cite pages.'
  },
  {
    label: 'Critique',
    hint: 'What an examiner would question',
    prompt:
      'Critically evaluate this paper: strengths, weaknesses, threats to validity, and what a thesis examiner might question. Cite pages.'
  },
  {
    label: 'Key quotes',
    hint: 'Five citable passages with pages',
    prompt: 'Pick the 5 most quotable passages for an MBA thesis, verbatim with page numbers, each with one line on how to use it.'
  }
]

export const NOTE_ACTIONS: QuickAction[] = [
  {
    label: 'Organize my ideas',
    hint: 'Turn the note into a clear outline',
    prompt: 'Reorganize the ideas in my note into a clear, logical outline with headings and bullets. Keep my content, group related points and flag duplicates.'
  },
  {
    label: 'Find gaps',
    hint: 'Weak or unsupported claims, and fixes',
    prompt: 'What are the gaps, weak arguments or unsupported claims in my note? For each, suggest what evidence would fix it and which of my papers might provide it.'
  },
  {
    label: 'Suggest sources',
    hint: 'Papers from your library for each claim',
    prompt: 'For the main claims in my note, suggest which papers from my library support or challenge them, and why.'
  },
  {
    label: 'Polish writing',
    hint: 'Academic register, same meaning',
    prompt: 'Rewrite my note in a clear academic register suitable for an MBA thesis. Preserve meaning and citations. Return only the rewritten text.'
  }
]

export const explainPrompt = (quote: string, page: number) =>
  `Explain this passage from page ${page} in plain language, and how it fits the paper's argument:\n\n> ${quote.replace(/\n+/g, ' ')}`

export const quotePrefix = (quote: string, page: number) => `Regarding this passage (p. ${page}):\n> ${quote.replace(/\n+/g, ' ')}\n\n`

# Thesis Studio

A fast desktop workspace for writing an MBA thesis: read and annotate papers, collect quotes into notes, and work with an AI research assistant that runs on your **ChatGPT or Claude subscription**.

## Run it

```bash
bun install      # installs deps and copies pdf.js assets
bun run dev      # development with hot reload
bun run build && bun run start   # production build
bun run dist     # macOS .dmg in dist/
```

**Assistant requirement:** pick the subscription in **Settings → Assistant**. No API key is needed for either one.

- **ChatGPT:** the [Codex CLI](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with ChatGPT (`codex login`, or **Connect ChatGPT** in the app). Models: GPT-6 Luna (default) and GPT-6 Sol.
- **Claude:** the [Claude Code CLI](https://claude.com/claude-code) (`curl -fsSL https://claude.ai/install.sh | bash`), signed in with your Pro/Max plan (`claude auth login`, or **Connect Claude** in the app). Models: Sonnet 5.5 (default) and Opus 5.5.

The chat's **effort** (Low → Max, plus Ultra on GPT-6 Sol) defaults to **Medium** and can be changed in Settings or right in the composer. Writing helpers, translations and metadata extraction keep their own lighter effort.

Your library lives in `~/Documents/Thesis Studio/`. PDFs go in `Papers/`; notes, highlights and chats are plain JSON in `.data/`, so they are easy to back up or sync.

## What it does

| Area | Features |
|---|---|
| **Library** | Drag PDFs anywhere. Duplicate detection. Automatic metadata: DOI → Crossref, title search → Crossref, then AI extraction as a fallback. Status (to read / reading / read), stars, tags and reading progress. |
| **Reader** | pdf.js with virtualized rendering. Text selection. 5 highlight colors, comments, find in paper, highlights translated into Spanish automatically (the Highlights panel and the highlight's popover show the Spanish first and the original below, like notes; the translation is stored on the highlight and reused when you send it to a note), pinch/⌘± zoom, night reading, and it resumes where you left off. |
| **Reading guide & skim mode** | One click maps a paper before you read it: a three-line TL;DR, how it bears on *your* thesis, a section roadmap marked **Read / Skim / Skip**, key terms, and questions to read with. **Skim mode** (⌘⌥S) underlines the key sentences right on the page by role: goal, method, finding, limitation. Step through them with J / K, or click one to highlight, note, explain or ask. When the paper defines its key terms, those defining sentences are found too: they get their own **Definition** marks in skim mode, sit under each term in the Guide tab with a jump link, and *Resaltar todas* turns them into purple highlights with the term as the comment. Shows full-read and skim time. Guides are cached in `.data/guides.json`; quotes are located in the PDF text, so marks land on the exact words even when the model gets the page wrong. |
| **Recall check & Repaso** | When you finish a paper (or from the Guide tab), answer its 3–4 core questions from memory while the PDF is blurred. The assistant grades each answer against the paper (Bien / Incompleta / Faltó, with what was missing and the pages to reread), your answers go to the paper's note under *En mis palabras*, and the paper comes back for review in 1 day if recall was weak, then 2, 5, 12… days. Due reviews, and finished papers never checked, show under **Repaso** on Home. Retrieval practice and spacing are the two study techniques with the strongest evidence (Dunlosky et al., 2013). Kept in `.data/recalls.json`. |
| **Term definitions & library citations** | Key terms from the reading guide get a dotted underline on the page; hover for the Spanish definition and the paper's own wording, click to jump to where the paper defines it. In-text citations of papers already in your library ("Popper & Mayseless, 2003") are tinted blue, or green once you've read them; hover to see which paper, click to open it. Toggle with the book button in the reader toolbar. |
| **Literature matrix** | Every paper in the same comparable columns: question, theory, method, context and sample, findings, limitations, and relevance to your thesis (⌘⌥L, or *Literature matrix* in the sidebar). Filled from the reading guides; *Completar guías* builds the missing ones one by one. Search, filter by relevance, sort by relevance, year or author, click a row to expand it, and export to CSV or copy as a Markdown table. |
| **Selection toolbar** | Highlight (`H`), send quote to note (`N`), explain (`E`), ask (`A`), copy. |
| **Thesis** | UCEMA MBA template built in: cover, dedication, acknowledgments, abstract + keywords, live table of contents, body, APA 7 (Spanish) references generated from your citations, appendices and the authorizations page. Every section is a Letter sheet in Calibri 11, double spaced, 1.27 cm indents and 2.54 cm margins. Five APA heading levels (4–5 run in, type `####`), footnotes (⌘⌥F), live word count against the 18,000-word limit and a Requisitos checklist. Exports to Word (native footnotes, TOC field, page numbers) and PDF (paginated with Paged.js, Calibri embedded from your local Office install, Carlito otherwise). Writing help: a floating toolbar on any selection (synonyms, corrections, rewrites, connectors, title case), a style review that underlines calques and filler, ghost-text autocomplete that finishes the sentence you started, and «Ideas» (guiding questions, no text written for you). |
| **Notes** | Rich editor with Markdown shortcuts. Quotes keep a link to their source page, and quotes not already in Spanish are translated automatically: the Spanish version (with the citation) goes first and the original stays right below. Many quotes at once, like *Highlights → To note*, are translated in a single request. **Live citations** (⌘⇧C) re-render when you edit metadata or change citation style. Side-by-side note next to the paper (⌘⇧N). Export to Markdown with a References section. |
| **Assistant** | Always answers in Spanish (quotes stay verbatim, with a translation). Streams answers grounded in the full text, with clickable page citations `[S1, p. 4]`. Quick actions (summarize, relevance to my thesis, critique, key quotes; for notes: organize ideas, find gaps, suggest sources, polish). One click adds an answer to a note with real citations. Knows your thesis title and research question. |
| **Whiteboard** | [Excalidraw](https://excalidraw.com) in its own tab (⌘⌥B, or *Whiteboard* in the sidebar) to sketch ideas. It runs in a persistent, sandboxed session, so your drawing is still there after a restart; ⌘= / ⌘- / ⌘0 zoom the canvas. Use Excalidraw's menu to save a `.excalidraw` file now and then as a backup. |
| **Citing** | APA 7, Harvard, MLA 9 and Chicago references. In-text citations, BibTeX per paper or for the whole library. Per-note bibliography. |
| **Everywhere** | ⌘K command palette, light/dark/system theme, resizable panes, undo for deletions. |

## Architecture

```
src/main/        Electron main: window, menu, IPC, JSON store, Crossref, Codex and Claude bridges
src/preload/     Typed, sandboxed `window.api` bridge
src/shared/      Domain types + API contract shared by both sides
src/renderer/    React UI (zustand store, pdf.js reader, TipTap editor, assistant)
  components/ui/      shadcn/ui primitives (Radix + Tailwind)
  components/motion/  beUI animated components (tabs, color selector, toasts, …)
  components/agents/  beUI chat components (message scroller, prompt input)
```

- **UI stack:** Tailwind CSS v4 (tokens in `styles/globals.css`, pdf.js/editor rules in `styles/content.css`), [shadcn/ui](https://ui.shadcn.com) for dialogs, menus, selects and the ⌘K palette, and [beUI](https://beui.dev) (built on Motion) for spring tabs, color pickers, the toast stack, shimmer loading states and the chat composer. Add more with `bunx shadcn@latest add <name>` or `bunx shadcn@latest add @beui/<name>`.

- **ChatGPT connection:** `src/main/codex.ts` keeps one warm `codex app-server` process and speaks its JSON-RPC over stdio. Each paper or note gets its own thread, and the paper text goes in the thread's developer instructions (so it is prompt-cached). The thread is **pre-warmed** when you open a paper, so your first question doesn't wait on setup. Codex's machine-access tools are disabled and the sandbox is read-only: it is used purely as a chat model.
- **Claude connection:** `src/main/claude.ts` runs one warm `claude -p` process per chat in streaming-JSON mode, with the paper text as the system prompt (written to a temp file, since it can be too large for argv). Every tool is off, no settings, MCP servers, skills or CLAUDE.md are loaded, nothing is persisted, and API-key variables are stripped so it always bills to the subscription. Which bridge answers is decided by the model id (`src/shared/ai.ts`).
- **Speed:** only pages near the viewport render. Zoom renders off-screen and then swaps, so there's no blank flash. The last 4 tabs stay mounted, so switching is instant. Streaming markdown is re-parsed at most once per frame. Writes are optimistic in the UI and persisted with debounced, atomic writes in main.
- **Security:** `contextIsolation`, `sandbox`, a strict CSP, no remote content, and external links open in your browser. The one exception is the whiteboard: a `<webview>` that may only load `excalidraw.com`, with no preload, no Node, its own `persist:excalidraw` session and only clipboard/file permissions (see `guardWhiteboard` in `src/main/index.ts`).

## Laws of UX, applied

Every law on [lawsofux.com](https://lawsofux.com), and where it lives in the app.

| Law | Where |
|---|---|
| **Aesthetic-Usability Effect** | Conduit brand: warm neutrals, Neue Montreal + Season Mix, flower art with halftone grain, soft depth, light and dark themes. |
| **Choice Overload** | Library filters and search, library grouped by status, Cite panel folds rarely used fields, at most 3 follow-up suggestions. |
| **Chunking** | Library grouped by Reading / To read / Read, notes by Pinned, highlights by page, Cite split into Citation / Details / Publication / Tags & abstract. |
| **Cognitive Bias** | Every claim carries a clickable page chip and the composer says "Click a cited page to check it". Critique is a one-click action. AI-filled metadata asks you to double-check. |
| **Cognitive Load** | Everything is collapsible and remembers its state. Collapsed panels become rails. The assistant's context card is one line until you open it. |
| **Doherty Threshold (<400 ms)** | Warm AI threads, token streaming, instant "Reading and thinking…" with a seconds counter after 3 s, copy turns into a check, optimistic saves, instant tab switching. |
| **Fitts's Law** | Rails on the window edges with 36 px targets, full-width section headers, full-width suggestion cards, selection toolbar right above the selected text. |
| **Flow** | Follow-up suggestions under each answer, "Jump to latest" while scrolled up, single-key shortcuts on selections, no modal interruptions. |
| **Goal-Gradient Effect** | Setup checklist with a progress bar, library "n/m read" bar, per-paper reading progress, a toast when you finish a paper. |
| **Hick's Law** | Four quick actions, one marked "Start here", each with a one-line hint. Depth is Fast / Balanced / Thorough, not raw parameters. |
| **Jakob's Law** | Three-pane layout, tabs, ⌘K palette, Finder-style disclosure chevrons, ⌥-click to fold every section in a group, VS Code-style rails, standard macOS menus. |
| **Law of Common Region** | Context card, setup card, recent lists and the Citation block each sit on their own surface. |
| **Law of Prägnanz** | One chevron, one pill marker and one chip shape, reused everywhere. |
| **Law of Proximity** | Message actions sit under their message, section actions sit in the section header, quotes sit above the question they belong to. |
| **Law of Similarity** | One collapsible component for every section. Papers are orange and notes green everywhere. Citation chips look the same in chat and notes. Links are blue, text is not. |
| **Law of Uniform Connectedness** | Highlight color bars tie a quote to its color, marker pills tie a section to its category, the quote rule ties a passage to its question. |
| **Mental Model** | The context card says exactly what the assistant reads (paper, sources, thesis, model). Collapsing a panel leaves a rail, so nothing "disappears". |
| **Miller's Law** | Lists are chunked into small groups. Palette shows ≤ 8 results per group. At most 3 follow-ups. |
| **Occam's Razor** | Panel toggles live on the panels (no duplicates in the tab bar). Panels only show what the active document needs. |
| **Paradox of the Active User** | Guidance in context: "select a passage and press A", shortcuts in every tooltip, ⌥-click hint on section headers. |
| **Pareto Principle** | Citation and Details open by default; Publication and Tags & abstract fold. The assistant gets the most attention. |
| **Parkinson's Law** | Metadata fills itself (DOI → Crossref → AI), one-click follow-ups, one-click "Add to note", commit-on-blur fields. |
| **Peak-End Rule** | Answers end with "Add to note" and next steps. Finishing a paper is celebrated. Errors end with "Try again". Clearing a chat, removing a highlight or deleting a note offers Undo. |
| **Postel's Law** | PDFs dropped anywhere, DOIs with or without `https://doi.org/`, authors as "Family, Given" or "Given Family", tags with or without `#`, citations like `[S1, pp. 11, 15–16]`. |
| **Selective Attention** | A dot on the Assistant tab or rail when an answer is being written or arrives out of view. Nothing is styled like an ad or banner. |
| **Serial Position Effect** | Rail: search first, settings last. Panel collapse at the far right. Message actions: "Add to note" first, Regenerate last. |
| **Tesler's Law** | The app builds the assistant's context, formats citations and bibliographies, and keeps citations live. |
| **Von Restorff Effect** | Blue is reserved for AI; one recommended action. Status uses dots **and** labels (never color alone), and motion respects Reduce Motion. |
| **Working Memory** | Collapsed sections keep a count and summary. Follow-ups skip what you already asked. The quote you're asking about stays pinned above the composer. |
| **Zeigarnik Effect** | Rails keep counts and badges, the setup card says what's next even when folded, "Answer continues below" while streaming. |

## Keyboard

| | |
|---|---|
| ⌘K | Command palette |
| ⌘O / ⌘N | Import PDFs / New note |
| ⌘J | Toggle assistant (collapses the panel to a rail) |
| ⌘⇧N | Side note next to the paper |
| ⌘⌥T | Open the thesis |
| ⌘⌥B | Open the whiteboard |
| ⌘⌥L | Open the literature matrix |
| ⌘⌥F | Footnote (in the thesis) |
| ⌘. | Writing helpers at the caret (in the thesis) |
| Tab / ⌥→ | Accept the autocomplete suggestion / one word of it |
| ⌥↩ | Ask for a continuation now |
| ⌘⇧C | Insert citation (in a note) |
| ⌘F | Find in paper |
| ⌘⌥S | Skim mode (builds the reading guide the first time) |
| J / K | Next / previous key sentence (skim mode) |
| ⌘= ⌘- ⌘0 | Zoom in / out / fit width |
| ⌘\\ | Toggle sidebar (collapses it to a rail) |
| H N E A | With text selected: highlight / note / explain / ask |
| ⌥-click a section header | Fold or unfold every section in that group |

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, Check, NotebookPen, RotateCcw, Sparkles, X, Plug, Eraser, Quote, ListChecks, Scale, Target, TextQuote, Search, Wand2, BookMarked, Loader2, ArrowDown, ChevronsDownUp, ChevronsUpDown, FileText, AlertCircle, GraduationCap } from 'lucide-react'
import { MessageScroller } from '@/components/agents/message-scroller'
import { PromptInput, type PromptAction } from '@/components/agents/prompt-input'
import { ThinkingShimmer } from '@/components/agents/loading-states/thinking-shimmer'
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg'
import { Button as MotionButton } from '@/components/motion/button'
import { Button } from '@/components/ui/button'
import { EmptyState, IconButton } from '../components/common'
import { Collapsible } from '../components/Collapsible'
import type { AiEffort, AiProvider, ChatMessage, Note, Paper, Thesis } from '@shared/types'
import { AI_PROVIDERS, EFFORT_LABELS, modelsFor } from '@shared/ai'
import {
  appendMessages,
  clearChat,
  jumpTo,
  openTab,
  setStreaming,
  toast,
  useStore,
  refreshAccount,
  patchSettings,
  aiEffort,
  aiModel,
  type Composer as ComposerRequest
} from '../store'
import { renderMarkdown, markdownToHtml, replaceCites } from '../lib/markdown'
import { NOTE_ACTIONS, PAPER_ACTIONS, noteInstructions, paperInstructions, quotePrefix, type QuickAction } from '../lib/prompts'
import { authorLine, inText, shortLabel, shortTitle } from '../lib/citation'
import { notePapers, copyText } from '../lib/exporting'
import { insertIntoNote, targetNote } from '../editor/noteBridge'
import { uid } from '../lib/util'
import { cn } from '@/lib/utils'
import { generateJSON } from '@tiptap/core'
import { buildExtensions } from '../editor/extensions'
import { THESIS_ACTIONS, thesisInstructions } from '../thesis/prompts'
import { liveThesis } from '../thesis/bridge'
import { analyze } from '../thesis/analyze'
import { thesisDoc } from '../thesis/model'
import { fullTitle } from '../thesis/template'

// Chats that already have a live thread in this session, with the setup it
// runs on. Others (or a chat whose model changed) get their earlier transcript
// replayed so conversations survive restarts and model switches.
const warm = new Map<string, string>()

/** What a live thread depends on: Claude fixes the effort per process, ChatGPT per turn. */
function threadSetup(): string {
  const s = useStore.getState().settings
  return s.provider === 'claude' ? `${aiModel(s).id}|${aiEffort(s)}` : aiModel(s).id
}

interface Ctx {
  chatId: string
  label: string
  kind: 'paper' | 'note' | 'thesis'
  sources: Paper[]
  paper?: Paper
  note?: Note
  thesis?: Thesis
}

// Cited papers of a saved thesis, cached per saved version (the selector below runs on every store change).
const thesisCited = new WeakMap<Thesis, string[]>()
function citedIn(t: Thesis): string[] {
  let ids = thesisCited.get(t)
  if (!ids) thesisCited.set(t, (ids = analyze(thesisDoc(t)).citedIds))
  return ids
}

/**
 * The chat context follows the active tab. It only changes when something the
 * model sees changes (not on every reading-progress save or keystroke).
 */
function useChatContext(): Ctx | null {
  const active = useStore((s) => s.active)
  const key = useStore((s) => {
    if (!s.active) return ''
    const [k, id] = s.active.split(':')
    if (k === 'paper') {
      const p = s.papers[id]
      return p ? `${p.id}|${p.title}|${p.year}|${p.authors.length}|${p.textStatus}` : ''
    }
    if (k === 'thesis') {
      const t = s.theses[id]
      return t ? `${t.id}|${fullTitle(t.meta)}|${citedIn(t).join(',')}` : ''
    }
    const n = s.notes[id]
    return n ? `${n.id}|${n.title}|${notePapers(n).map((p) => p.id).join(',')}` : ''
  })
  return useMemo(() => {
    if (!active || !key) return null
    const s = useStore.getState()
    const [kind, id] = active.split(':') as ['paper' | 'note' | 'thesis', string]
    if (kind === 'thesis') {
      const thesis = s.theses[id]
      const sources = citedIn(thesis).map((pid) => s.papers[pid]).filter(Boolean)
      return { chatId: active, label: fullTitle(thesis.meta) || 'Tesis', kind, sources, thesis }
    }
    if (kind === 'paper') {
      const paper = s.papers[id]
      return { chatId: active, label: paper.title, kind, sources: [paper], paper }
    }
    const note = s.notes[id]
    return { chatId: active, label: note.title || 'Untitled note', kind, sources: notePapers(note), note }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key])
}

async function buildInstructions(ctx: Ctx): Promise<string> {
  const s = useStore.getState()
  if (ctx.kind === 'paper') return paperInstructions(s.papers[ctx.paper!.id] ?? ctx.paper!, s.settings)
  if (ctx.kind === 'thesis') return thesisInstructions(s.theses[ctx.thesis!.id] ?? ctx.thesis!, ctx.sources, Object.values(s.papers), s.settings)
  const note = s.notes[ctx.note!.id] ?? ctx.note!
  return noteInstructions(note, ctx.sources, Object.values(s.papers), s.settings)
}

export function AssistantPanel() {
  const ctx = useChatContext()
  const account = useStore((s) => s.account)
  const settings = useStore((s) => s.settings)
  const textReady = ctx?.paper ? ctx.paper.textStatus !== 'pending' : true

  // Pre-warm a thread with the paper loaded so the first answer starts fast (Doherty threshold).
  useEffect(() => {
    if (!ctx || !account?.connected || !textReady) return
    const t = setTimeout(async () => {
      const instructions = await buildInstructions(ctx)
      void window.api.ai.prepare({ chatId: ctx.chatId, instructions, model: aiModel(settings).id, effort: aiEffort(settings) })
    }, 500)
    return () => clearTimeout(t)
  }, [ctx, account?.connected, textReady, settings.provider, settings.model, settings.effort, settings.thesisTitle, settings.researchQuestion, settings.citationStyle])

  if (account && !account.connected) return <ConnectCard provider={account.provider} error={account.error} />
  if (!ctx) {
    return (
      <EmptyState
        bloom
        icon={<Sparkles />}
        title="Open a paper or a note to chat about it"
        description="The assistant reads the full text, cites pages, and knows your thesis topic."
      />
    )
  }
  return <Chat key={ctx.chatId} ctx={ctx} />
}

function ConnectCard({ provider, error }: { provider: AiProvider; error?: string }) {
  const [busy, setBusy] = useState(false)
  const missing = error === 'cli-missing'
  const p = AI_PROVIDERS[provider]
  return (
    <EmptyState
      bloom
      icon={<Plug />}
      title={missing ? `Install the ${p.cli} to use your ${p.label} plan` : `Connect your ${p.label} account`}
      description={
        missing
          ? `Thesis Studio talks to ${p.label} through ${p.vendor}’s official ${p.cli}. Install it, then retry. You can switch providers in Settings.`
          : `Sign in once in your browser. Answers use your existing ${p.label} plan. No API key needed.`
      }
    >
      {missing ? (
        <>
          <code className="rounded-lg border bg-muted px-2.5 py-1.5 font-mono text-xs select-all">{p.install}</code>
          <Button variant="outline" size="sm" onClick={() => void refreshAccount()}>
            Retry
          </Button>
        </>
      ) : (
        <MotionButton
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const a = await window.api.ai.login(provider)
              if (provider === useStore.getState().settings.provider) useStore.setState({ account: a })
              if (a.connected) {
                toast(`${p.label} connected`, undefined, { status: 'success' })
                void refreshAccount()
              }
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Waiting for browser…' : `Connect ${p.label}`}
        </MotionButton>
      )}
    </EmptyState>
  )
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  Summarize: <ListChecks />,
  'Relevance to my thesis': <Target />,
  Critique: <Scale />,
  'Key quotes': <TextQuote />,
  'Organize my ideas': <ListChecks />,
  'Find gaps': <Search />,
  'Suggest sources': <BookMarked />,
  'Polish writing': <Wand2 />,
  'Revisar redacción': <Wand2 />,
  'Verificar APA': <BookMarked />,
  'Revisar formato': <ListChecks />,
  'Coherencia del argumento': <Scale />
}

function Chat({ ctx }: { ctx: Ctx }) {
  const chat = useStore((s) => s.chats[ctx.chatId])
  const streaming = useStore((s) => !!s.streaming[ctx.chatId])
  const composer = useStore((s) => (s.composer?.chatId === ctx.chatId ? s.composer : null))
  const provider = useStore((s) => s.settings.provider)
  const model = useStore((s) => aiModel(s.settings))
  const effort = useStore((s) => aiEffort(s.settings))
  const messages = chat?.messages ?? EMPTY
  const viewportRef = useRef<HTMLElement>(null)
  const [following, setFollowing] = useState(true)

  const resolveCite = useCallback(
    (key: string) => {
      const p = ctx.sources[Number(key.slice(1)) - 1]
      return p ? shortLabel(p) : null
    },
    [ctx.sources]
  )

  const send = useCallback(
    async (text: string, quote?: ChatMessage['quote']) => {
      const body = text.trim()
      if ((!body && !quote) || useStore.getState().streaming[ctx.chatId]) return
      const now = Date.now()
      const prior = useStore.getState().chats[ctx.chatId]?.messages ?? []
      appendMessages(
        ctx.chatId,
        { id: uid(), role: 'user', text: body, quote, createdAt: now },
        { id: uid(), role: 'assistant', text: '', createdAt: now + 1 }
      )
      setStreaming(ctx.chatId, true)

      let prompt = (quote ? quotePrefix(quote.text, quote.page) : '') + (body || 'What does this passage mean, and why does it matter here?')
      if (ctx.kind === 'note') {
        const note = useStore.getState().notes[ctx.note!.id]
        prompt += `\n\n<current_note title="${note?.title ?? ''}">\n${(note?.plain ?? '').slice(0, 40000)}\n</current_note>`
      }
      if (ctx.kind === 'thesis') {
        const live = liveThesis(ctx.thesis!.id)
        const text = live ? live.doc.textBetween(0, live.doc.content.size, '\n', ' ') : ''
        prompt += `\n\n<current_thesis title="${ctx.label.replace(/"/g, "'")}">\n${text.slice(0, 140000)}\n</current_thesis>`
      }
      const setup = threadSetup()
      if (warm.get(ctx.chatId) !== setup && prior.length) {
        const transcript = prior
          .filter((m) => !m.error)
          .slice(-10)
          .map((m) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.text.slice(0, 1500)}`)
          .join('\n\n')
        prompt = `(Earlier in this conversation:)\n${transcript}\n\n(New message:)\n${prompt}`
      }
      warm.set(ctx.chatId, setup)
      const s = useStore.getState().settings
      const instructions = await buildInstructions(ctx)
      await window.api.ai.send({ chatId: ctx.chatId, instructions, model: aiModel(s).id, effort: aiEffort(s), text: prompt })
    },
    [ctx]
  )

  const addToNote = (m: ChatMessage) => {
    const style = useStore.getState().settings.citationStyle
    // Turn [S1, p. 4] markers into citation nodes via a placeholder span.
    const md = replaceCites(m.text, (key, page) => {
      const p = ctx.sources[Number(key.slice(1)) - 1]
      return p ? `<span data-citation data-paper-id="${p.id}"${page ? ` data-page="${page}"` : ''}>${inText(p, style, page)}</span>` : null
    })
    const json = generateJSON(markdownToHtml(md), buildExtensions(''))
    const paperId = ctx.kind === 'paper' ? ctx.paper!.id : undefined
    insertIntoNote(targetNote(paperId), json.content ?? [], paperId)
  }

  const retry = () => {
    const msgs = useStore.getState().chats[ctx.chatId]?.messages ?? []
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    const idx = msgs.lastIndexOf(lastUser)
    useStore.setState((s) => ({ chats: { ...s.chats, [ctx.chatId]: { ...s.chats[ctx.chatId], messages: msgs.slice(0, idx) } } }))
    void send(lastUser.text, lastUser.quote)
  }

  const quick = ctx.kind === 'paper' ? PAPER_ACTIONS : ctx.kind === 'thesis' ? THESIS_ACTIONS : NOTE_ACTIONS
  const promptActions: PromptAction[] = quick.map((a) => ({ value: a.label, label: a.label, icon: ACTION_ICONS[a.label] }))
  const modelOptions = useMemo(() => modelsFor(provider).map((m) => ({ value: m.id, label: m.label })), [provider])
  const effortOptions = useMemo(() => model.efforts.map((e) => ({ value: e, label: `${EFFORT_LABELS[e]} effort` })), [model])

  // Working memory: follow-ups only offer what hasn't been asked in this conversation yet.
  const unused = quick.filter((a) => !messages.some((m) => m.role === 'user' && m.text === a.prompt))
  const lastMsg = messages[messages.length - 1]
  const showFollowUps = !streaming && lastMsg?.role === 'assistant' && !lastMsg.error && unused.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextCard ctx={ctx} canClear={messages.length > 0} onClear={() => (clearChat(ctx.chatId), warm.delete(ctx.chatId))} />

      {messages.length === 0 ? (
        <Suggestions actions={quick} onPick={(p) => void send(p)} kind={ctx.kind} />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <MessageScroller
            busy={streaming}
            viewportRef={viewportRef}
            onFollowChange={setFollowing}
            className="min-h-0 flex-1"
            contentClassName="flex flex-col gap-5 px-4 py-4 select-text"
          >
            {messages.map((m, i) => (
              <MessageView
                key={m.id}
                m={m}
                last={i === messages.length - 1}
                streaming={streaming && i === messages.length - 1}
                resolveCite={resolveCite}
                onCite={(key, page) => {
                  const p = ctx.sources[Number(key.slice(1)) - 1]
                  if (p) jumpTo(p.id, page ?? 1)
                }}
                onAddToNote={() => addToNote(m)}
                onRetry={retry}
              />
            ))}
            {showFollowUps && <FollowUps actions={unused.slice(0, 3)} onPick={(p) => void send(p)} />}
          </MessageScroller>
          <AnimatePresence>
            {!following && (
              <motion.div
                className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.15 }}
              >
                <button
                  onClick={() => viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' })}
                  className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-popover px-3 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-accent"
                >
                  <ArrowDown className="size-3.5" />
                  {streaming ? 'Answer continues below' : 'Jump to latest'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <Composer
        composer={composer}
        streaming={streaming}
        onSend={send}
        onStop={() => void window.api.ai.interrupt(ctx.chatId)}
        actions={promptActions}
        onAction={(label) => {
          const a = quick.find((x) => x.label === label)
          if (a) void send(a.prompt)
        }}
        models={modelOptions}
        model={model.id}
        efforts={effortOptions}
        effort={effort}
        placeholder={ctx.kind === 'paper' ? 'Ask about this paper…' : ctx.kind === 'thesis' ? 'Preguntá sobre tu tesis…' : 'Ask about your note or library…'}
      />
    </div>
  )
}

const EMPTY: ChatMessage[] = []

/**
 * What the assistant can see right now (mental model, Tesler's law). One line
 * when collapsed; open it to check the source, thesis focus and model.
 */
function ContextCard({ ctx, canClear, onClear }: { ctx: Ctx; canClear: boolean; onClear: () => void }) {
  const thesis = useStore((s) => s.settings.thesisTitle.trim())
  const paper = useStore((s) => (ctx.paper ? s.papers[ctx.paper.id] : undefined))
  const model = useStore((s) => `${aiModel(s.settings).label} · ${EFFORT_LABELS[aiEffort(s.settings)]} effort`)

  const status =
    ctx.kind !== 'paper'
      ? { text: ctx.sources.length ? `+ ${ctx.sources.length} source${ctx.sources.length > 1 ? 's' : ''}` : 'No sources', tone: 'bg-status-read' }
      : paper?.textStatus === 'pending'
        ? { text: 'Reading PDF…', tone: 'bg-status-reading animate-pulse' }
        : paper?.textStatus === 'error'
          ? { text: 'No text layer', tone: 'bg-destructive' }
          : { text: 'Full text', tone: 'bg-status-read' }

  return (
    <Collapsible
      id="assistant.context"
      defaultOpen={false}
      variant="title"
      className="flex-none border-b px-3.5 py-1"
      title={
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground" title={ctx.label}>
          {ctx.kind === 'paper' ? (
            <FileText className="size-3.5 flex-none text-kind-paper" />
          ) : ctx.kind === 'thesis' ? (
            <GraduationCap className="size-3.5 flex-none text-brand" />
          ) : (
            <NotebookPen className="size-3.5 flex-none text-kind-note" />
          )}
          <strong className="truncate font-[550] text-foreground/85">{shortTitle(ctx.label)}</strong>
        </span>
      }
      count={
        <span className="flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] text-muted-foreground">
          <span aria-hidden className={cn('size-1.5 rounded-full', status.tone)} />
          {status.text}
        </span>
      }
      actions={
        canClear && (
          <IconButton label="New conversation" size="icon-xs" onClick={onClear}>
            <Eraser />
          </IconButton>
        )
      }
      contentClassName="pb-3 pt-1"
    >
      <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-faint">Reads</dt>
        <dd className="min-w-0">
          {ctx.kind === 'paper' && paper ? (
            <span className="text-muted-foreground">
              {authorLine(paper, 2) || 'Unknown author'}
              {paper.year ? ` · ${paper.year}` : ''}
              {paper.pageCount ? ` · ${paper.pageCount} pages` : ''}
            </span>
          ) : (
            <span className="flex flex-wrap gap-1">
              <span className="text-muted-foreground">This note{ctx.sources.length ? ', plus:' : ''}</span>
              {ctx.sources.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openTab({ kind: 'paper', id: p.id })}
                  className="max-w-full truncate rounded-md bg-muted px-1.5 text-[11.5px] text-foreground hover:bg-accent"
                  title={p.title}
                >
                  {shortLabel(p)}
                </button>
              ))}
            </span>
          )}
        </dd>
        <dt className="text-faint">Thesis</dt>
        <dd className="min-w-0">
          {thesis ? (
            <span className="line-clamp-2 text-muted-foreground">{thesis}</span>
          ) : (
            <button className="text-brand-text hover:underline" onClick={() => useStore.setState({ settingsOpen: true })}>
              Add your topic for sharper answers
            </button>
          )}
        </dd>
        <dt className="text-faint">Model</dt>
        <dd className="text-muted-foreground">{model}</dd>
      </dl>
    </Collapsible>
  )
}

function Suggestions({ actions, onPick, kind }: { actions: QuickAction[]; onPick: (prompt: string) => void; kind: 'paper' | 'note' | 'thesis' }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-4 pb-2">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="flex flex-col items-start gap-2"
      >
        <span className="bloom-tile grid size-9 place-items-center rounded-xl [&_svg]:size-4">
          <Sparkles />
        </span>
        <p className="font-heading text-[19px] leading-tight font-medium">
          {kind === 'paper' ? 'I’ve read this paper. Where should we start?' : kind === 'thesis' ? 'Revisemos tu tesis.' : 'Let’s shape this note.'}
        </p>
      </motion.div>
      {/* Hick's law: four choices, one recommended; each says what you get back. */}
      <SharedLayoutBg inset={0} className="gap-1.5" pillClassName="rounded-xl bg-brand-soft">
        {actions.map((a, i) => (
          <motion.button
            key={a.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * (i + 1), type: 'spring', stiffness: 400, damping: 32 }}
            onClick={() => onPick(a.prompt)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
              i === 0 && 'border-brand/30 bg-brand-soft/50'
            )}
          >
            <span className={cn('grid size-7 flex-none place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5', i === 0 && 'bg-brand text-white')}>
              {ACTION_ICONS[a.label]}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {a.label}
                {i === 0 && <span className="rounded-full bg-brand/12 px-1.5 text-[10px] font-semibold tracking-wide text-brand-text uppercase">Start here</span>}
              </span>
              <span className="truncate text-[11.5px] text-muted-foreground">{a.hint}</span>
            </span>
          </motion.button>
        ))}
      </SharedLayoutBg>
      {kind === 'paper' && (
        <p className="text-[11.5px] text-faint">
          Or select a passage in the paper and press <kbd className="font-sans font-semibold text-muted-foreground">A</kbd> to ask about it.
        </p>
      )}
    </div>
  )
}

/** Flow + peak-end: the next useful step is one click, right under the answer. */
function FollowUps({ actions, onPick }: { actions: QuickAction[]; onPick: (prompt: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.2 }}
      className="-mt-2 flex flex-wrap items-center gap-1.5 select-none"
    >
      <span className="text-[11px] text-faint">Next</span>
      {actions.map((a) => (
        <button
          key={a.label}
          title={a.hint}
          onClick={() => onPick(a.prompt)}
          className="flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text [&_svg]:size-3.5"
        >
          {ACTION_ICONS[a.label]}
          {a.label}
        </button>
      ))}
    </motion.div>
  )
}

const LONG_ANSWER = 1400
const LONG_QUESTION = 420

const MessageView = memo(function MessageView({
  m,
  last,
  streaming,
  resolveCite,
  onCite,
  onAddToNote,
  onRetry
}: {
  m: ChatMessage
  last: boolean
  streaming: boolean
  resolveCite: (key: string) => string | null
  onCite: (key: string, page?: number) => void
  onAddToNote: () => void
  onRetry: () => void
}) {
  const html = useThrottledMarkdown(m.role === 'assistant' ? m.text : '', resolveCite, streaming)
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (m.role === 'user') {
    const long = m.text.length > LONG_QUESTION
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        className="flex flex-col items-end gap-1.5"
      >
        {m.quote && <QuoteChip quote={m.quote} />}
        {m.text && (
          <div className="flex max-w-[88%] flex-col items-end">
            <div className={cn('rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-[13.5px] whitespace-pre-wrap', long && !collapsed && 'line-clamp-6')}>{m.text}</div>
            {long && (
              <button className="px-1 pt-0.5 text-[11.5px] text-faint hover:text-foreground" onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    )
  }

  if (m.error) {
    // Peak-end: a failure ends with a way forward, not a dead end.
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-[13px]">
        <AlertCircle className="mt-0.5 size-4 flex-none text-destructive" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-foreground">{m.text || 'Something went wrong.'}</p>
          {last && (
            <Button variant="outline" size="xs" className="self-start" onClick={onRetry}>
              <RotateCcw /> Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  const long = !streaming && m.text.length > LONG_ANSWER
  const copy = () => {
    void copyText(m.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="group flex flex-col gap-1">
      {!m.text && streaming ? (
        <Thinking />
      ) : (
        <div className="relative">
          <div
            className={cn('md', collapsed && 'max-h-[7.5em] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]')}
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={(e) => {
              const chip = (e.target as HTMLElement).closest<HTMLElement>('.cite-chip')
              if (chip) onCite(chip.dataset.src!, chip.dataset.page ? Number(chip.dataset.page) : undefined)
            }}
          />
          {collapsed && (
            <button onClick={() => setCollapsed(false)} className="mt-1 text-xs font-medium text-brand-text hover:underline">
              Show full answer · {Math.round(m.text.split(/\s+/).length / 10) * 10} words
            </button>
          )}
        </div>
      )}
      <AnimatePresence>
        {!streaming && m.text && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn(
              '-ml-2 flex gap-0.5 transition-opacity',
              last ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
            )}
          >
            {/* Serial position: the key action first, regenerate last. */}
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onAddToNote}>
              <NotebookPen /> Add to note
            </Button>
            <IconButton label={copied ? 'Copied' : 'Copy'} size="icon-xs" onClick={copy}>
              {copied ? <Check className="text-success" /> : <Copy />}
            </IconButton>
            {long && (
              <IconButton label={collapsed ? 'Expand answer' : 'Collapse answer'} size="icon-xs" onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
              </IconButton>
            )}
            {last && (
              <IconButton label="Regenerate" size="icon-xs" onClick={onRetry}>
                <RotateCcw />
              </IconButton>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

/** Doherty threshold: instant feedback, then a visible clock if the model takes a while. */
function Thinking() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSecs((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="flex items-center gap-2 py-1 text-[13px]">
      <ThinkingShimmer>Reading and thinking…</ThinkingShimmer>
      {secs >= 3 && <span className="text-[11.5px] text-faint tabular-nums">{secs}s</span>}
    </span>
  )
}

function QuoteChip({ quote, onRemove }: { quote: NonNullable<ChatMessage['quote']>; onRemove?: () => void }) {
  return (
    <div className="flex max-w-full items-start gap-1.5 border-l-2 border-brand py-0.5 pl-2 text-xs text-muted-foreground">
      <Quote className="mt-0.5 size-3 flex-none text-brand" />
      <span className="line-clamp-2 font-serif italic">{quote.text}</span>
      <em className="flex-none not-italic text-faint">p. {quote.page}</em>
      {onRemove && (
        <button aria-label="Remove quote" onClick={onRemove} className="grid size-4 flex-none place-items-center rounded hover:bg-accent">
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

/** Re-parse markdown at most once per frame while tokens stream in. */
function useThrottledMarkdown(text: string, resolve: (k: string) => string | null, streaming: boolean): string {
  const [html, setHtml] = useState(() => (text ? renderMarkdown(text, resolve) : ''))
  const frame = useRef(0)
  useEffect(() => {
    if (!streaming) {
      setHtml(text ? renderMarkdown(text, resolve) : '')
      return
    }
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setHtml(renderMarkdown(text, resolve)))
    return () => cancelAnimationFrame(frame.current)
  }, [text, resolve, streaming])
  return html
}

function Composer({
  composer,
  streaming,
  onSend,
  onStop,
  actions,
  onAction,
  models,
  model,
  efforts,
  effort,
  placeholder
}: {
  composer: ComposerRequest | null
  streaming: boolean
  onSend: (text: string, quote?: ChatMessage['quote']) => Promise<void>
  onStop: () => void
  actions: PromptAction[]
  onAction: (value: string) => void
  models: { value: string; label: string }[]
  model: string
  efforts: { value: string; label: string }[]
  effort: string
  placeholder: string
}) {
  const [text, setText] = useState('')
  const [quote, setQuote] = useState<ChatMessage['quote']>()
  const hostRef = useRef<HTMLDivElement>(null)

  // Requests from the reader ("Ask", "Explain") land here.
  useEffect(() => {
    if (!composer) return
    if (composer.quote) setQuote(composer.quote)
    if (composer.autoSend && composer.prefill) void onSend(composer.prefill)
    else if (composer.prefill) setText(composer.prefill)
    requestAnimationFrame(() => hostRef.current?.querySelector('textarea')?.focus())
    useStore.setState({ composer: null })
  }, [composer, onSend])

  return (
    <div ref={hostRef} className="flex flex-none flex-col gap-1.5 px-3 pt-2 pb-2.5">
      <AnimatePresence>
        {quote && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <QuoteChip quote={quote} onRemove={() => setQuote(undefined)} />
          </motion.div>
        )}
      </AnimatePresence>
      <PromptInput
        value={text}
        onValueChange={setText}
        onSubmit={(v) => {
          void onSend(v, quote)
          setText('')
          setQuote(undefined)
        }}
        loading={streaming}
        onStop={onStop}
        actions={actions}
        onAction={onAction}
        models={models}
        model={model}
        onModelChange={(m) => patchSettings({ model: m })}
        efforts={efforts}
        effort={effort}
        onEffortChange={(e) => patchSettings({ effort: e as AiEffort })}
        minRows={1}
        maxRows={8}
        placeholder={quote ? 'Ask about this passage…' : placeholder}
        className="bg-background shadow-xs focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/20"
      />
      {/* Cognitive bias: answers can be wrong, so checking the cited page is one click. */}
      <p className="text-center text-[11px] text-faint">Click a cited page to check it · ⇧↩ new line</p>
    </div>
  )
}

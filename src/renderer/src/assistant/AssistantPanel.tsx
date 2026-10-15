import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { History, GitBranch, SquarePen, Trash2, Timer, Copy, Check, NotebookPen, RotateCcw, Sparkles, X, Plug, Quote, ListChecks, Scale, Target, TextQuote, Search, Wand2, BookMarked, Loader2, ArrowDown, ChevronsDownUp, ChevronsUpDown, FileText, AlertCircle, GraduationCap, ListTodo, BookOpenText, CalendarRange, Sun, CalendarClock, Split, ChartNetwork, Lightbulb, BookOpen, Compass, Telescope, Link2, Table2, Trophy, FlaskConical, Filter, Crosshair, ChartColumn, PenLine } from 'lucide-react'
import { MessageScroller } from '@/components/agents/message-scroller'
import { PromptInput, type PromptAction } from '@/components/agents/prompt-input'
import { ThinkingShimmer } from '@/components/agents/loading-states/thinking-shimmer'
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg'
import { Button as MotionButton } from '@/components/motion/button'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EmptyState, IconButton } from '../components/common'
import { Collapsible } from '../components/Collapsible'
import { Segmented } from '../components/Segmented'
import type { AiEffort, AiProvider, Chat as ChatDoc, ChatMessage, Note, Paper, Thesis } from '@shared/types'
import { AI_PROVIDERS, EFFORT_LABELS, modelsFor } from '@shared/ai'
import {
  appendMessages,
  conversationsOf,
  deleteConversation,
  forkConversation,
  newConversation,
  openConversation,
  jumpTo,
  openTab,
  setStreaming,
  toast,
  useStore,
  refreshAccount,
  patchSettings,
  aiEffort,
  aiModel,
  tabKey,
  AGENT_TAB,
  MATRIX_TAB,
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
import { thesisPlainText, thesisReferenceIds } from '../thesis/references'
import { thesisDoc } from '../thesis/model'
import { fullTitle } from '../thesis/template'
import { TASK_ACTIONS, tasksContext, tasksInstructions } from '../tasks/assist'
import { actionsProtocol, isChange, parseActions, runMatrix, type Action } from '../agent/actions'
import { timerContext, usePomodoro } from '../pomodoro/timer'
import { ActionsCard } from '../agent/ActionsCard'
import { DraftCard, splitDrafts } from '../agent/drafts'
import { AGENT_ACTIONS, agentContext, agentInstructions, agentSources, readMaterial } from '../agent/context'
import { WIKI_ACTIONS, wikiInstructions, wikiSources } from '../wiki/knowledge'
import { MATRIX_ACTIONS, matrixInstructions, matrixViewContext } from '../matrix/model'

import { warm } from './threads'
import { rekey, sourceFor } from './sourceKeys'
import { progressContext } from '../progress/model'
import { analysisContext } from '../analysis/use'

/** What a live thread depends on: Claude fixes the effort per process, ChatGPT per turn. */
function threadSetup(): string {
  const s = useStore.getState().settings
  return s.provider === 'claude' ? `${aiModel(s).id}|${aiEffort(s)}` : aiModel(s).id
}

/** Cheap fingerprint of a thread's instructions: when they change, main starts a fresh thread. */
function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i)
  return `${text.length}:${h >>> 0}`
}

type CtxKind = 'paper' | 'note' | 'thesis' | 'tasks' | 'wiki' | 'matrix' | 'agent'

interface Ctx {
  chatId: string
  label: string
  kind: CtxKind
  sources: Paper[]
  paper?: Paper
  note?: Note
  thesis?: Thesis
}

// Cited papers of a saved thesis, cached per saved version (the selector below runs on every store change).
const thesisCited = new WeakMap<Thesis, string[]>()
function citedIn(t: Thesis): string[] {
  let ids = thesisCited.get(t)
  if (!ids) thesisCited.set(t, (ids = thesisReferenceIds(analyze(thesisDoc(t)))))
  return ids
}

/**
 * The chat context follows the active tab. It only changes when something the
 * model sees changes (not on every reading-progress save or keystroke).
 */
function useHereKey(): string {
  return useStore((s) => {
    if (!s.active) return ''
    const [k, id] = s.active.split(':')
    if (k === 'tasks') return 'tasks'
    if (k === 'agent') return ''
    // The matrix cites the whole library, in the general assistant's order.
    if (k === 'matrix') return `matrix|${Object.keys(s.papers).length}`
    // The wiki's sources (and so its citation keys) follow what's been saved.
    if (k === 'wiki') return `wiki|${Object.keys(s.annotations).length}|${Object.keys(s.notes).length}|${Object.keys(s.guides).length}|${Object.keys(s.recalls).length}|${Object.keys(s.papers).length}`
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
}

/** The general assistant's chat: its own tab, or the side panel set to "General" (the same conversation). */
// On the whiteboard it's always the general one: it's the one that draws.
// The research framework belongs to the whole thesis: the general assistant too.
const useGeneral = () => useStore((s) => !!s.active?.startsWith('agent:') || !!s.active?.startsWith('board:') || !!s.active?.startsWith('research:') || s.assistantScope === 'general' || !s.active)

function useChatContext(): Ctx | null {
  const active = useStore((s) => s.active)
  const key = useHereKey()
  const general = useGeneral()
  // The general assistant cites the library by S-keys in the order papers were added.
  const library = useStore((s) => Object.keys(s.papers).length)
  return useMemo(() => {
    const s = useStore.getState()
    if (general) return { chatId: tabKey(AGENT_TAB), label: 'Asistente', kind: 'agent', sources: agentSources(s) }
    if (!active || !key) return null
    const [kind, id] = active.split(':') as [CtxKind, string]
    if (kind === 'tasks') return { chatId: active, label: 'Tareas y cronograma', kind, sources: [] }
    if (kind === 'wiki') return { chatId: active, label: 'Conocimiento', kind, sources: wikiSources(s) }
    if (kind === 'matrix') return { chatId: active, label: 'Matriz de literatura', kind, sources: agentSources(s) }
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
    return { chatId: active, label: note.title || 'Nota sin título', kind, sources: notePapers(note), note }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, general, general && library])
}

/** Side chats can act in the app too: which ids they may use, and the lists that exist. */
function sideActions(ctx: Ctx): string {
  const s = useStore.getState()
  const lists = Object.values(s.lists).map((l) => `"${l.name.replace(/"/g, "'")}"`)
  // The matrix lists each paper's id with its row.
  const ids = ctx.kind === 'matrix' ? '' : `\n- Ids de los papers: ${ctx.sources.map((p, i) => `S${i + 1} = "${p.id}"`).join(', ') || 'ninguno'}.`
  const here = ctx.kind === 'paper' ? ' "Este paper" es S1.' : ctx.kind === 'note' ? ` El id de esta nota es "${ctx.note?.id}".` : ''
  return `${actionsProtocol(ctx.kind === 'matrix' ? 'matrix' : 'side')}${ids}${here}
- Listas de lectura existentes: ${lists.join(', ') || 'ninguna todavía'}.`
}

async function buildInstructions(ctx: Ctx): Promise<string> {
  const s = useStore.getState()
  if (ctx.kind === 'paper') return `${await paperInstructions(s.papers[ctx.paper!.id] ?? ctx.paper!, s.settings)}\n\n${sideActions(ctx)}`
  if (ctx.kind === 'agent') return agentInstructions(s, ctx.sources)
  if (ctx.kind === 'thesis') return thesisInstructions(s.theses[ctx.thesis!.id] ?? ctx.thesis!, ctx.sources, Object.values(s.papers), s.settings)
  if (ctx.kind === 'tasks') return tasksInstructions(s.settings, Object.values(s.papers))
  if (ctx.kind === 'wiki') return wikiInstructions(s, ctx.sources, s.settings)
  if (ctx.kind === 'matrix') return matrixInstructions(s, ctx.sources, sideActions(ctx))
  const note = s.notes[ctx.note!.id] ?? ctx.note!
  return `${await noteInstructions(note, ctx.sources, Object.values(s.papers), s.settings)}\n\n${sideActions(ctx)}`
}

export function AssistantPanel() {
  return (
    <>
      <ScopeSwitch />
      <ChatPanel />
    </>
  )
}

const HERE_LABEL: Record<string, string> = { paper: 'Este paper', note: 'Esta nota', thesis: 'Tesis', tasks: 'Tareas', wiki: 'Conocimiento', matrix: 'Matriz' }

/**
 * The side panel can hold the general assistant (one conversation that follows
 * you around the app) or a chat about just what's open.
 */
function ScopeSwitch() {
  const here = useHereKey()
  const kind = useStore((s) => s.active?.split(':')[0] ?? '')
  const scope = useStore((s) => s.assistantScope)
  if (!here || kind === 'agent') return null
  return (
    <div className="flex flex-none items-center gap-2 border-b px-3 py-1.5">
      <Segmented
        size="sm"
        value={scope}
        onChange={(v) => useStore.setState({ assistantScope: v })}
        items={[
          { value: 'general', label: 'General', icon: <Sparkles className="text-brand" />, title: 'El asistente de toda la app: ve lo que estás haciendo y puede actuar en cualquier parte' },
          { value: 'here', label: HERE_LABEL[kind] ?? 'Aquí', title: 'Una charla solo sobre lo que tenés abierto' }
        ]}
      />
    </div>
  )
}

function ChatPanel() {
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
        title="Abrí un paper, una nota, tus tareas o el wiki para charlar sobre eso"
        description="El asistente lee lo que tenés abierto, cita páginas y conoce el tema de tu tesis."
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
      title={missing ? `Instalá el ${p.cli} para usar tu plan de ${p.label}` : `Conectá tu cuenta de ${p.label}`}
      description={
        missing
          ? `Thesis Studio se comunica con ${p.label} a través del ${p.cli} oficial de ${p.vendor}. Instalalo y volvé a intentar. Podés cambiar de proveedor en Ajustes.`
          : `Iniciá sesión una sola vez en tu navegador. Las respuestas usan tu plan de ${p.label} que ya tenés. No necesitás una clave de API.`
      }
    >
      {missing ? (
        <>
          <code className="rounded-lg border bg-muted px-2.5 py-1.5 font-mono text-xs select-all">{p.install}</code>
          <Button variant="outline" size="sm" onClick={() => void refreshAccount()}>
            Reintentar
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
                toast(`${p.label} conectado`, undefined, { status: 'success' })
                void refreshAccount()
              }
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Esperando al navegador…' : `Conectar ${p.label}`}
        </MotionButton>
      )}
    </EmptyState>
  )
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  Resumir: <ListChecks />,
  'Relevancia para mi tesis': <Target />,
  Crítica: <Scale />,
  'Citas clave': <TextQuote />,
  'Ordenar mis ideas': <ListChecks />,
  'Encontrar huecos': <Search />,
  'Sugerir fuentes': <BookMarked />,
  'Pulir la redacción': <Wand2 />,
  'Revisar redacción': <Wand2 />,
  'Verificar APA': <BookMarked />,
  'Corregir citas de un párrafo': <Quote />,
  'Revisar formato': <ListChecks />,
  'Coherencia del argumento': <Scale />,
  'Planificar la tesis': <CalendarRange />,
  '¿Qué hago hoy?': <Sun />,
  'Mi día en pomodoros': <Timer />,
  'Reprogramar vencidas': <CalendarClock />,
  'Dividir en pasos': <Split />,
  'Temas principales': <ListChecks />,
  Conexiones: <ChartNetwork />,
  Huecos: <Search />,
  'Esqueleto del marco teórico': <Lightbulb />,
  '¿Qué leo ahora?': <BookOpen />,
  'Profundizar en un tema': <Telescope />,
  'Papers relacionados': <Link2 />,
  'Mi marco de tesis': <Crosshair />,
  'Mi semana': <Compass />,
  'Plan de hoy': <Sun />,
  'Revisión semanal': <CalendarRange />,
  'Mis resultados': <ChartColumn />,
  'Qué escribir ahora': <PenLine />,
  'Filtrar por tema': <Filter />,
  'Patrones y huecos': <Search />,
  'Rankear para mi tesis': <Trophy />,
  'Comparar métodos': <FlaskConical />
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

  // Each answer's [S#] keys follow the sources it was written with (the list changes as the thesis cites more).
  const sourceOf = useCallback((key: string, m: ChatMessage) => sourceFor(key, m.sources, ctx.sources, useStore.getState().papers), [ctx.sources])
  const resolveCite = useCallback(
    (key: string, m: ChatMessage) => {
      const p = sourceOf(key, m)
      return p ? shortLabel(p) : null
    },
    [sourceOf]
  )

  const send = useCallback(
    async (text: string, quote?: ChatMessage['quote'], auto?: ChatMessage['auto']) => {
      const body = text.trim()
      if ((!body && !quote) || useStore.getState().streaming[ctx.chatId]) return
      const now = Date.now()
      const prior = useStore.getState().chats[ctx.chatId]?.messages ?? []
      const sources = ctx.sources.map((p) => p.id)
      appendMessages(
        ctx.chatId,
        { id: uid(), role: 'user', text: body, quote, auto, sources, createdAt: now },
        { id: uid(), role: 'assistant', text: '', sources, createdAt: now + 1 }
      )
      setStreaming(ctx.chatId, true)

      let prompt = (quote ? quotePrefix(quote.text, quote.page) : '') + (body || '¿Qué significa este pasaje y por qué importa acá?')
      if ((ctx.kind === 'agent' || ctx.kind === 'matrix') && quote) {
        const i = ctx.sources.findIndex((p) => p.id === quote.paperId)
        if (i >= 0) prompt = `(El pasaje de abajo es del paper S${i + 1}.)\n${prompt}`
      }
      if (ctx.kind === 'note') {
        const note = useStore.getState().notes[ctx.note!.id]
        prompt += `\n\n<current_note title="${note?.title ?? ''}">\n${(note?.plain ?? '').slice(0, 40000)}\n</current_note>`
      }
      if (ctx.kind === 'thesis') {
        const live = liveThesis(ctx.thesis!.id)
        // Citations read as written («(Bass, 1985)»), so the assistant can check them and name them in a fix.
        const text = live ? thesisPlainText(live.doc) : ''
        prompt += `\n\n<current_thesis title="${ctx.label.replace(/"/g, "'")}">\n${text.slice(0, 140000)}\n</current_thesis>`
        prompt += `\n${progressContext()}\n${analysisContext()}`
      }
      if (ctx.kind === 'tasks') {
        const st = useStore.getState()
        prompt += tasksContext(Object.values(st.tasks), st.selectedTask)
        prompt += `\n${progressContext()}`
      }
      if (ctx.kind === 'agent') prompt += await agentContext(useStore.getState(), ctx.sources)
      if (ctx.kind === 'matrix') prompt += matrixViewContext(useStore.getState(), ctx.sources)
      // Paper and note chats can drive the timer too: they hear about it only while one runs.
      if ((ctx.kind === 'paper' || ctx.kind === 'note') && usePomodoro.getState().run) prompt += `\n\n${timerContext()}`
      const s = useStore.getState().settings
      const instructions = await buildInstructions(ctx)
      // New instructions (a new source, new highlights) mean a fresh thread: bring the conversation along.
      const setup = `${threadSetup()}|${fingerprint(instructions)}`
      if (warm.get(ctx.chatId) !== setup && prior.length) {
        const transcript = prior
          .filter((m) => !m.error)
          .slice(-10)
          .map((m) => {
            // Renumbered to this thread's sources: the earlier answer may have numbered them otherwise.
            const papers = useStore.getState().papers
            const text = rekey(transcriptText(m), m.sources, ctx.sources, (id) => (papers[id] ? shortLabel(papers[id]) : 'fuente eliminada'))
            return `${m.role === 'user' ? 'Estudiante' : 'Asistente'}: ${text.slice(0, 1500)}`
          })
          .join('\n\n')
        prompt = `(Antes en esta conversación:)\n${transcript}\n\n(Mensaje nuevo:)\n${prompt}`
      }
      warm.set(ctx.chatId, setup)
      await window.api.ai.send({ chatId: ctx.chatId, instructions, model: aiModel(s).id, effort: aiEffort(s), text: prompt })
    },
    [ctx]
  )

  const addToNote = (m: ChatMessage) => {
    const style = useStore.getState().settings.citationStyle
    // Turn [S1, p. 4] markers into citation nodes via a placeholder span.
    const md = replaceCites(parseActions(m.text).prose, (key, page) => {
      const p = sourceOf(key, m)
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
    void send(lastUser.text, lastUser.quote, lastUser.auto)
  }

  // The general assistant asked to read something: hand it over and let it continue (at most 3 rounds in a row).
  const lastMessage = messages[messages.length - 1]
  useEffect(() => {
    // Only fresh answers: reopening the app doesn't pick up an old request.
    if ((ctx.kind !== 'agent' && ctx.kind !== 'matrix') || streaming || lastMessage?.role !== 'assistant' || lastMessage.error || Date.now() - lastMessage.createdAt > 600_000) return
    const reads = (parseActions(lastMessage.text).actions ?? []).filter((a): a is Extract<Action, { op: 'read' }> => a.op === 'read')
    if (!reads.length) return
    const msgs = useStore.getState().chats[ctx.chatId]?.messages ?? []
    let rounds = 0
    for (let i = msgs.length - 2; i >= 0 && msgs[i].auto; i -= 2) rounds++
    if (rounds >= 3) return
    let cancelled = false
    void readMaterial(reads, useStore.getState(), ctx.sources).then((r) => {
      if (r && !cancelled && useStore.getState().chats[ctx.chatId]?.messages.at(-1)?.id === lastMessage.id) void send(r.text, undefined, { label: r.label })
    })
    return () => {
      cancelled = true
    }
  }, [ctx, streaming, lastMessage, send])

  // The assistant's pick for the matrix shows up there as soon as the answer lands, if the matrix is on screen.
  useEffect(() => {
    if (streaming || lastMessage?.role !== 'assistant' || lastMessage.error || shownInMatrix.has(lastMessage.id) || Date.now() - lastMessage.createdAt > 600_000) return
    const view = parseActions(lastMessage.text).actions?.find((a): a is Extract<Action, { op: 'matrix.show' | 'matrix.clear' }> => a.op === 'matrix.show' || a.op === 'matrix.clear')
    if (!view) return
    shownInMatrix.add(lastMessage.id)
    if (useStore.getState().active === tabKey(MATRIX_TAB)) runMatrix(view)
  }, [streaming, lastMessage])

  /** A quick action either asks right away or waits in the composer for the student to finish it. */
  const pick = (a: QuickAction) => (a.prefill ? useStore.setState({ composer: { chatId: ctx.chatId, prefill: a.prompt, nonce: Date.now() } }) : void send(a.prompt))

  const quick =
    ctx.kind === 'paper'
      ? PAPER_ACTIONS
      : ctx.kind === 'thesis'
        ? THESIS_ACTIONS
        : ctx.kind === 'tasks'
          ? TASK_ACTIONS
          : ctx.kind === 'wiki'
            ? WIKI_ACTIONS
            : ctx.kind === 'matrix'
              ? MATRIX_ACTIONS
              : ctx.kind === 'agent'
              ? AGENT_ACTIONS
              : NOTE_ACTIONS
  const promptActions: PromptAction[] = quick.map((a) => ({ value: a.label, label: a.label, icon: ACTION_ICONS[a.label] }))
  const modelOptions = useMemo(() => modelsFor(provider).map((m) => ({ value: m.id, label: m.label })), [provider])
  const effortOptions = useMemo(() => model.efforts.map((e) => ({ value: e, label: `Esfuerzo ${EFFORT_LABELS[e]}` })), [model])

  // Working memory: follow-ups only offer what hasn't been asked in this conversation yet.
  const unused = quick.filter((a) => !messages.some((m) => m.role === 'user' && (a.prefill ? m.text.startsWith(a.prompt) : m.text === a.prompt)))
  const lastMsg = messages[messages.length - 1]
  const showFollowUps = !streaming && lastMsg?.role === 'assistant' && !lastMsg.error && unused.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextCard ctx={ctx} canClear={messages.length > 0} onClear={() => newConversation(ctx.chatId)} />

      {messages.length === 0 ? (
        <Suggestions actions={quick} onPick={pick} kind={ctx.kind} />
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
                chatId={ctx.chatId}
                last={i === messages.length - 1}
                streaming={streaming && i === messages.length - 1}
                resolveCite={resolveCite}
                onCite={(key, page) => {
                  const p = sourceOf(key, m)
                  if (p) jumpTo(p.id, page ?? 1)
                }}
                onAddToNote={() => addToNote(m)}
                onRetry={retry}
              />
            ))}
            {showFollowUps && <FollowUps actions={unused.slice(0, 3)} onPick={pick} />}
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
                  {streaming ? 'La respuesta continúa abajo' : 'Ir a lo último'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <Composer
        chatId={ctx.chatId}
        composer={composer}
        streaming={streaming}
        onSend={send}
        onStop={() => void window.api.ai.interrupt(ctx.chatId)}
        actions={promptActions}
        onAction={(label) => {
          const a = quick.find((x) => x.label === label)
          if (a) pick(a)
        }}
        models={modelOptions}
        model={model.id}
        efforts={effortOptions}
        effort={effort}
        placeholder={
          ctx.kind === 'paper'
            ? 'Preguntá sobre este paper…'
            : ctx.kind === 'thesis'
              ? 'Preguntá sobre tu tesis…'
              : ctx.kind === 'tasks'
                ? 'Pedí un plan o cambios: «pasá lo de esta semana al lunes»…'
                : ctx.kind === 'wiki'
                  ? 'Preguntá sobre lo que guardaste…'
                  : ctx.kind === 'matrix'
                    ? 'Preguntá o filtrá: «¿cuáles estudian liderazgo en pymes?»…'
                  : ctx.kind === 'agent'
                    ? 'Preguntá o pedí algo: «sumá este paper a las candidatas», «¿qué leo sobre liderazgo?»…'
                    : 'Preguntá sobre tu nota o tu biblioteca…'
        }
      />
    </div>
  )
}

const EMPTY: ChatMessage[] = []

/** Answers whose matrix filter was already shown (so reopening the chat doesn't undo the student's own filtering). */
const shownInMatrix = new Set<string>()

/** A message as replayed to a fresh thread: material read and proposed changes become one line each. */
function transcriptText(m: ChatMessage): string {
  if (m.auto) return `[La app te dio el texto que pediste: ${m.auto.label}.]`
  if (m.role !== 'assistant') return m.text
  const { prose, actions } = parseActions(m.text)
  if (!actions) return m.text
  const changes = actions.filter(isChange).length
  const reads = actions.filter((a) => a.op === 'read').length
  const shown = actions.find((a): a is Extract<Action, { op: 'matrix.show' }> => a.op === 'matrix.show')
  const done = m.applied ? `el estudiante aplicó ${m.applied.ops.length}` : 'no aplicados'
  return `${prose}${changes ? `\n[Propuso ${changes} cambios en la app: ${done}.]` : ''}${reads ? '\n[Pidió leer material.]' : ''}${shown ? `\n[Mostró en la matriz «${shown.label}»: ${shown.papers.length} papers.]` : ''}`
}

/**
 * What the assistant can see right now (mental model, Tesler's law). One line
 * when collapsed; open it to check the source, thesis focus and model.
 */
const relTime = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })
function ago(ts: number): string {
  const min = Math.round((ts - Date.now()) / 60_000)
  if (min > -1) return 'recién'
  if (min > -60) return relTime.format(min, 'minute')
  if (min > -60 * 24) return relTime.format(Math.round(min / 60), 'hour')
  if (min > -60 * 24 * 7) return relTime.format(Math.round(min / 1440), 'day')
  return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

/** Past conversations in this context, and branches saved to pick up later. */
function ConversationHistory({ chatId }: { chatId: string }) {
  const chats = useStore((s) => s.chats)
  const past = useMemo(() => conversationsOf(chatId, chats), [chatId, chats])
  const [open, setOpen] = useState(false)
  if (!past.length) return null
  const branches = past.filter((c) => c.branch)
  const others = past.filter((c) => !c.branch)
  const row = (c: ChatDoc) => {
    const asked = c.messages.filter((m) => m.role === 'user' && !m.auto).length
    return (
      <div key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-accent">
        <button
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
          onClick={() => {
            setOpen(false)
            openConversation(chatId, c.id)
          }}
        >
          {c.branch && <GitBranch className="mt-0.5 size-3.5 flex-none text-brand" />}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="w-full truncate text-[12.5px] font-medium">{c.title || conversationTitleFallback}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {c.branch ? `De «${c.branch.from}» · ` : ''}
              {ago(c.updatedAt)} · {asked} {asked === 1 ? 'pregunta' : 'preguntas'}
            </span>
          </span>
        </button>
        <IconButton
          label={c.branch ? 'Eliminar rama' : 'Eliminar conversación'}
          size="icon-xs"
          className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => deleteConversation(c.id)}
        >
          <Trash2 />
        </IconButton>
      </div>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          label={branches.length ? `Ramas (${branches.length}) y conversaciones anteriores (${others.length})` : `Conversaciones anteriores (${past.length})`}
          size="icon-xs"
          active={open}
        >
          <History />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 rounded-xl p-1.5">
        <div className="flex max-h-96 flex-col overflow-y-auto">
          {branches.length > 0 && (
            <>
              <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Ramas para retomar</p>
              {branches.map(row)}
            </>
          )}
          {others.length > 0 && (
            <>
              <p className={cn('px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase', branches.length ? 'pt-3' : 'pt-1.5')}>
                Conversaciones anteriores
              </p>
              {others.map(row)}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
const conversationTitleFallback = 'Conversación'

function ContextCard({ ctx, canClear, onClear }: { ctx: Ctx; canClear: boolean; onClear: () => void }) {
  const thesis = useStore((s) => s.settings.thesisTitle.trim())
  const paper = useStore((s) => (ctx.paper ? s.papers[ctx.paper.id] : undefined))
  const model = useStore((s) => `${aiModel(s.settings).label} · Esfuerzo ${EFFORT_LABELS[aiEffort(s.settings)]}`)

  const branch = useStore((s) => s.chats[ctx.chatId]?.branch)
  const taskCount = useStore((s) => (ctx.kind === 'tasks' ? Object.keys(s.tasks).length : 0))
  const status =
    ctx.kind === 'tasks'
      ? { text: `${taskCount} ${taskCount === 1 ? 'tarea' : 'tareas'}`, tone: 'bg-bloom-pink' }
      : ctx.kind === 'wiki' || ctx.kind === 'agent' || ctx.kind === 'matrix'
        ? { text: `${ctx.sources.length} ${ctx.sources.length === 1 ? 'paper' : 'papers'}`, tone: ctx.kind === 'agent' ? 'bg-brand' : ctx.kind === 'matrix' ? 'bg-bloom-teal' : 'bg-bloom-amber' }
        : ctx.kind !== 'paper'
      ? { text: ctx.sources.length ? `+ ${ctx.sources.length} ${ctx.sources.length > 1 ? 'fuentes' : 'fuente'}` : 'Sin fuentes', tone: 'bg-status-read' }
      : paper?.textStatus === 'pending'
        ? { text: 'Leyendo PDF…', tone: 'bg-status-reading animate-pulse' }
        : paper?.textStatus === 'error'
          ? { text: 'Sin capa de texto', tone: 'bg-destructive' }
          : { text: 'Texto completo', tone: 'bg-status-read' }

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
          ) : ctx.kind === 'tasks' ? (
            <ListTodo className="size-3.5 flex-none text-bloom-pink" />
          ) : ctx.kind === 'wiki' ? (
            <BookOpenText className="size-3.5 flex-none text-bloom-amber" />
          ) : ctx.kind === 'matrix' ? (
            <Table2 className="size-3.5 flex-none text-bloom-teal" />
          ) : ctx.kind === 'agent' ? (
            <Sparkles className="size-3.5 flex-none text-brand" />
          ) : (
            <NotebookPen className="size-3.5 flex-none text-kind-note" />
          )}
          <strong className="truncate font-[550] text-foreground/85">{shortTitle(ctx.label)}</strong>
          {branch && (
            <span className="flex min-w-0 items-center gap-1 rounded-full bg-brand-soft px-1.5 py-px text-[10.5px] text-brand-text" title={`Rama de «${branch.from}»`}>
              <GitBranch className="size-3 flex-none" />
              <span className="max-w-28 truncate">{branch.name}</span>
            </span>
          )}
        </span>
      }
      count={
        <span className="flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] text-muted-foreground">
          <span aria-hidden className={cn('size-1.5 rounded-full', status.tone)} />
          {status.text}
        </span>
      }
      actions={
        <span className="flex items-center gap-0.5">
          <ConversationHistory chatId={ctx.chatId} />
          {canClear && (
            <IconButton label="Nueva conversación (la actual queda en el historial)" size="icon-xs" onClick={onClear}>
              <SquarePen />
            </IconButton>
          )}
        </span>
      }
      contentClassName="pb-3 pt-1"
    >
      <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-faint">Lee</dt>
        <dd className="min-w-0">
          {ctx.kind === 'paper' && paper ? (
            <span className="text-muted-foreground">
              {authorLine(paper, 2) || 'Autor desconocido'}
              {paper.year ? ` · ${paper.year}` : ''}
              {paper.pageCount ? ` · ${paper.pageCount} páginas` : ''}
            </span>
          ) : ctx.kind === 'tasks' ? (
            <span className="text-muted-foreground">Tus tareas y fechas, el día de hoy y tu biblioteca. Los cambios que proponga los aplicás vos.</span>
          ) : ctx.kind === 'agent' ? (
            <span className="text-muted-foreground">
              Lo que estás haciendo (la pantalla, la página en la que estás, lo que seleccionaste, tus resaltados y notas recientes), el catálogo de tu biblioteca, tus listas, tareas y tesis. Lee el texto completo de un paper, una nota o tu tesis cuando hace falta. Los cambios que proponga los aplicás vos.
            </span>
          ) : ctx.kind === 'matrix' ? (
            <span className="text-muted-foreground">
              La fila de la matriz de cada paper (o su resumen, si todavía no tiene guía), las filas que estás viendo y las que seleccionaste. Lee el texto completo de un paper cuando hace falta, y puede filtrar y ordenar la matriz por un tema.
            </span>
          ) : ctx.kind === 'wiki' ? (
            <span className="text-muted-foreground">Tus resaltados, comentarios, notas, el glosario y tus respuestas de repaso (no el texto completo de los papers).</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              <span className="text-muted-foreground">Esta nota{ctx.sources.length ? ', además:' : ''}</span>
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
        <dt className="text-faint">Tesis</dt>
        <dd className="min-w-0">
          {thesis ? (
            <span className="line-clamp-2 text-muted-foreground">{thesis}</span>
          ) : (
            <button className="text-brand-text hover:underline" onClick={() => useStore.setState({ settingsOpen: true })}>
              Agregá el tema de tu tesis para respuestas más precisas
            </button>
          )}
        </dd>
        <dt className="text-faint">Modelo</dt>
        <dd className="text-muted-foreground">{model}</dd>
      </dl>
    </Collapsible>
  )
}

function Suggestions({ actions, onPick, kind }: { actions: QuickAction[]; onPick: (a: QuickAction) => void; kind: CtxKind }) {
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
          {kind === 'paper'
            ? 'Leí este paper. ¿Por dónde empezamos?'
            : kind === 'thesis'
              ? 'Revisemos tu tesis.'
              : kind === 'tasks'
                ? 'Organicemos tu plan.'
                : kind === 'wiki'
                  ? 'Veamos qué sabés hasta ahora.'
                  : kind === 'matrix'
                    ? 'Leamos tu literatura de punta a punta.'
                  : kind === 'agent'
                    ? '¿En qué te ayudo hoy?'
                    : 'Demos forma a esta nota.'}
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
            onClick={() => onPick(a)}
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
                {i === 0 && <span className="rounded-full bg-brand/12 px-1.5 text-[10px] font-semibold tracking-wide text-brand-text uppercase">Empezá acá</span>}
              </span>
              <span className="truncate text-[11.5px] text-muted-foreground">{a.hint}</span>
            </span>
          </motion.button>
        ))}
      </SharedLayoutBg>
      {kind === 'paper' && (
        <p className="text-[11.5px] text-faint">
          O seleccioná un pasaje del paper y presioná <kbd className="font-sans font-semibold text-muted-foreground">A</kbd> para preguntar sobre él.
        </p>
      )}
    </div>
  )
}

/** Flow + peak-end: the next useful step is one click, right under the answer. */
function FollowUps({ actions, onPick }: { actions: QuickAction[]; onPick: (a: QuickAction) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.2 }}
      className="-mt-2 flex flex-wrap items-center gap-1.5 select-none"
    >
      <span className="text-[11px] text-faint">Siguiente</span>
      {actions.map((a) => (
        <button
          key={a.label}
          title={a.hint}
          onClick={() => onPick(a)}
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
  chatId,
  last,
  streaming,
  resolveCite,
  onCite,
  onAddToNote,
  onRetry
}: {
  m: ChatMessage
  chatId: string
  last: boolean
  streaming: boolean
  resolveCite: (key: string, m: ChatMessage) => string | null
  onCite: (key: string, page?: number) => void
  onAddToNote: () => void
  onRetry: () => void
}) {
  // Proposed task changes come as a ```tasks block: shown as a card, not as text.
  // Draft paragraphs come as ```borrador blocks: a card with its own safeguards.
  const parsed = useMemo(() => {
    if (m.role !== 'assistant') return null
    const p = parseActions(m.text)
    const { prose, drafts } = splitDrafts(p.prose)
    return { ...p, prose, drafts }
  }, [m.role, m.text])
  const resolve = useCallback((key: string) => resolveCite(key, m), [resolveCite, m])
  const html = useThrottledMarkdown(parsed?.prose ?? '', resolve, streaming)
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (m.auto) {
    // Sent by the app (what the assistant asked to read): one quiet line, not the full text.
    return (
      <div className="flex items-center gap-1.5 self-center rounded-full border bg-background px-2.5 py-1 text-[11.5px] text-muted-foreground">
        <BookOpen className="size-3 text-brand" /> {m.auto.label}
      </div>
    )
  }

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
                {collapsed ? 'Mostrar menos' : 'Mostrar más'}
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
          <p className="text-foreground">{m.text || 'Algo salió mal.'}</p>
          {last && (
            <Button variant="outline" size="xs" className="self-start" onClick={onRetry}>
              <RotateCcw /> Intentar de nuevo
            </Button>
          )}
        </div>
      </div>
    )
  }

  const prose = parsed?.prose ?? m.text
  const long = !streaming && prose.length > LONG_ANSWER
  const copy = () => {
    void copyText(prose)
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
              Mostrar respuesta completa · {Math.round(prose.split(/\s+/).length / 10) * 10} palabras
            </button>
          )}
        </div>
      )}
      {m.partial && !streaming && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <AlertCircle className="size-3.5 flex-none text-status-reading" />
          La respuesta quedó cortada: la app se cerró antes de que terminara.
          {last && (
            <button onClick={onRetry} className="font-medium text-brand-text hover:underline">
              Pedirla de nuevo
            </button>
          )}
        </p>
      )}
      {parsed?.drafts.map((d, i) => <DraftCard key={i} text={d.text} done={d.done && !streaming} label="Borrador propuesto por el asistente" />)}
      {parsed && !m.partial && (parsed.actions?.some((a) => a.op !== 'read') || parsed.pending) && (
        <div className="mt-1.5">
          <ActionsCard chatId={chatId} messageId={m.id} actions={parsed.actions} pending={parsed.pending} applied={m.applied} />
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
              <NotebookPen /> Agregar a nota
            </Button>
            <IconButton label={copied ? 'Copiado' : 'Copiar'} size="icon-xs" onClick={copy}>
              {copied ? <Check className="text-success" /> : <Copy />}
            </IconButton>
            <ForkButton chatId={chatId} messageId={m.id} />
            {long && (
              <IconButton label={collapsed ? 'Expandir respuesta' : 'Contraer respuesta'} size="icon-xs" onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
              </IconButton>
            )}
            {last && (
              <IconButton label="Regenerar" size="icon-xs" onClick={onRetry}>
                <RotateCcw />
              </IconButton>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

/** Forks the conversation at this answer: a named branch to follow later, or right now. */
function ForkButton({ chatId, messageId }: { chatId: string; messageId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const fork = (now: boolean) => {
    forkConversation(chatId, messageId, name, now)
    setOpen(false)
    setName('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label="Bifurcar desde acá (crear una rama)" size="icon-xs" active={open}>
          <GitBranch />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 rounded-xl p-3">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            fork(false)
          }}
        >
          <div>
            <p className="text-[13px] font-semibold">Nueva rama</p>
            <p className="text-[11.5px] text-muted-foreground">Copia la conversación hasta esta respuesta para seguir ese hilo por separado.</p>
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre: «Profundizar en el método»…"
            className="h-8 rounded-md border bg-background px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <div className="flex justify-end gap-1.5">
            <Button type="submit" variant="outline" size="xs">
              Guardar para después
            </Button>
            <Button type="button" size="xs" onClick={() => fork(true)}>
              <GitBranch /> Abrir ahora
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** Doherty threshold: instant feedback, then a visible clock if the model takes a while. */
function Thinking() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSecs((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="flex items-center gap-2 py-1 text-[13px]">
      <ThinkingShimmer>Leyendo y pensando…</ThinkingShimmer>
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
        <button aria-label="Quitar cita" onClick={onRemove} className="grid size-4 flex-none place-items-center rounded hover:bg-accent">
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

/** Unsent composer text per chat; lives for the app session. */
const drafts = new Map<string, { text: string; quote?: ChatMessage['quote'] }>()

function Composer({
  chatId,
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
  chatId: string
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
  const [text, setText] = useState(() => drafts.get(chatId)?.text ?? '')
  const [quote, setQuote] = useState<ChatMessage['quote']>(() => drafts.get(chatId)?.quote)
  const hostRef = useRef<HTMLDivElement>(null)

  // The panel remounts on every tab switch, so the unsent draft is kept outside React.
  useEffect(() => {
    if (text || quote) drafts.set(chatId, { text, quote })
    else drafts.delete(chatId)
  }, [chatId, text, quote])

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
        placeholder={quote ? 'Preguntá sobre este pasaje…' : placeholder}
        className="bg-background shadow-xs focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/20"
      />
      {/* Cognitive bias: answers can be wrong, so checking the cited page is one click. */}
      <p className="text-center text-[11px] text-faint">Hacé clic en una página citada para verificarla · ⇧↩ nueva línea</p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Brain, Eye, EyeOff, NotebookPen, RotateCcw } from 'lucide-react'
import type { RecallAttempt, RecallVerdict } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ThinkingShimmer } from '@/components/agents/loading-states/thinking-shimmer'
import { cn } from '@/lib/utils'
import { jumpTo, notesForPaper, openTab, providerLabel, toast, useStore } from '../store'
import { VERDICT_LABEL, gradeRecall, recallQuestions, recordAttempt, saveAnswersToNote } from '../lib/recall'
import { errorText } from '../lib/guide'
import { timeAgo } from '../lib/util'

const VERDICT_DOT: Record<RecallVerdict, string> = { right: 'bg-status-read', partial: 'bg-status-reading', missed: 'bg-destructive/70' }

/** Answers in progress survive switching tabs. */
const drafts = new Map<string, string[]>()

const close = () => useStore.setState({ recallFor: null })

/**
 * Recall check for one paper: answer from memory (the PDF is blurred), get
 * graded against the text, keep your own words in the paper's note.
 */
export function RecallView({ paperId }: { paperId: string }) {
  const questions = recallQuestions(paperId)
  const hidden = useStore((s) => s.recallFor?.paperId === paperId && s.recallFor.hidePaper)
  const last = useStore((s) => s.recalls[paperId]?.attempts.at(-1))
  const connected = useStore((s) => !!s.account?.connected)
  const [answers, setAnswers] = useState<string[]>(() => drafts.get(paperId) ?? questions.map(() => ''))
  const [phase, setPhase] = useState<{ kind: 'answer' } | { kind: 'grading'; since: number } | { kind: 'result'; attempt: RecallAttempt }>({ kind: 'answer' })

  useEffect(() => void drafts.set(paperId, answers), [paperId, answers])

  const setHidden = (hidePaper: boolean) => useStore.setState({ recallFor: { paperId, hidePaper } })

  const grade = async () => {
    setPhase({ kind: 'grading', since: Date.now() })
    try {
      const r = await gradeRecall(
        paperId,
        questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' }))
      )
      const attempt = recordAttempt(paperId, r.answers, r.summary)
      saveAnswersToNote(paperId, attempt)
      drafts.delete(paperId)
      setHidden(false)
      setPhase({ kind: 'result', attempt })
    } catch (e) {
      setPhase({ kind: 'answer' })
      toast('No se pudo corregir', { label: 'Reintentar', run: () => void grade() }, { status: 'error', description: errorText(e) })
    }
  }

  if (phase.kind === 'grading') return <Grading since={phase.since} />
  if (phase.kind === 'result')
    return (
      <Result
        paperId={paperId}
        attempt={phase.attempt}
        onRetry={() => {
          setAnswers(questions.map(() => ''))
          setHidden(true)
          setPhase({ kind: 'answer' })
        }}
      />
    )

  const filled = answers.some((a) => a.trim())
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title="Comprobá lo que leíste" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          Respondé de memoria y con tus palabras, aunque sea a medias: recordar es lo que fija lo leído. Después se corrige con el paper.
        </p>
        {last && (
          <p className="mt-1.5 text-[11.5px] text-faint">
            Último intento {timeAgo(last.at)}: {Math.round(last.score * 100)}%
          </p>
        )}
        <div className="mt-4 flex flex-col gap-4">
          {questions.map((q, i) => (
            <label key={i} className="flex flex-col gap-1.5">
              <span className="text-[13px] leading-snug font-medium">
                <span className="mr-1.5 text-faint tabular-nums">{i + 1}.</span>
                {q}
              </span>
              <textarea
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && filled && connected && void grade()}
                rows={3}
                placeholder="Lo que recuerdes…"
                className="min-h-[72px] resize-y rounded-lg border bg-background px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-faint focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2 border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setHidden(!hidden)}>
          {hidden ? <Eye /> : <EyeOff />} {hidden ? 'Ver el paper' : 'Ocultar el paper'}
        </Button>
        <span className="flex-1" />
        {connected ? (
          <Button size="sm" disabled={!filled} onClick={() => void grade()} title="⌘↩">
            <Brain /> Corregir
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => useStore.setState({ settingsOpen: true })}>
            Conectar {providerLabel()}
          </Button>
        )}
      </div>
    </div>
  )
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex h-10 flex-none items-center gap-1 px-2">
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={close}>
        <ArrowLeft /> Guía
      </Button>
      <span className="ml-1 text-[13px] font-semibold">{title}</span>
    </div>
  )
}

function Grading({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.round((now - since) / 1000)
  return (
    <div className="flex flex-col gap-3 px-4 pt-5">
      <span className="flex items-center gap-2 text-[13px]">
        <ThinkingShimmer>Corrigiendo con el paper…</ThinkingShimmer>
        {secs >= 3 && <span className="text-[11.5px] text-faint tabular-nums">{secs}s</span>}
      </span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-[40%]" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[80%]" />
        </div>
      ))}
    </div>
  )
}

function Result({ paperId, attempt, onRetry }: { paperId: string; attempt: RecallAttempt; onRetry: () => void }) {
  const due = useStore((s) => s.recalls[paperId]?.dueAt)
  const right = attempt.answers.filter((a) => a.verdict === 'right').length
  const days = due ? Math.max(1, Math.round((due - Date.now()) / 86_400_000)) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title="Resultado" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
        <div className="rounded-xl border bg-background p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-semibold tabular-nums">{Math.round(attempt.score * 100)}%</span>
            <span className="text-[12.5px] text-muted-foreground">
              {right} de {attempt.answers.length} bien
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-status-read"
              initial={{ width: 0 }}
              animate={{ width: `${attempt.score * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
          </div>
          {attempt.summary && <p className="mt-2.5 text-[12.5px] leading-snug">{attempt.summary}</p>}
          {days && <p className="mt-1.5 text-[11.5px] text-faint">Próximo repaso en {days === 1 ? '1 día' : `${days} días`}.</p>}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {attempt.answers.map((a, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, type: 'spring', stiffness: 420, damping: 34 }}
              className="rounded-lg border p-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex flex-none items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', VERDICT_DOT[a.verdict])} /> {VERDICT_LABEL[a.verdict]}
                </span>
                <span className="text-[12.5px] leading-snug font-medium">{a.question}</span>
              </div>
              {a.answer && <p className="mt-1.5 border-l-2 pl-2 text-[12.5px] leading-snug text-muted-foreground">{a.answer}</p>}
              <p className="mt-1.5 text-[12.5px] leading-snug">{a.feedback}</p>
              {a.pages.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {a.pages.map((p) => (
                    <button key={p} className="cite-chip !m-0" onClick={() => jumpTo(paperId, p)}>
                      p. {p}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2 border-t px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            const note = notesForPaper(paperId)[0]
            if (note) openTab({ kind: 'note', id: note.id })
          }}
        >
          <NotebookPen /> Ver en la nota
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onRetry}>
          <RotateCcw /> Otra vez
        </Button>
        <Button size="sm" onClick={close}>
          Listo
        </Button>
      </div>
    </div>
  )
}

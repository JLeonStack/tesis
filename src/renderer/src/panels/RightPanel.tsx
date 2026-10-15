import { useEffect, type ReactNode } from 'react'
import { Sparkles, Highlighter, Info, Library, PanelRightClose, PanelRightOpen, ListTree, ListChecks, Compass, BookCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, type RightTab } from '../store'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { HighlightsPanel } from './HighlightsPanel'
import { GuidePanel } from './GuidePanel'
import { InfoPanel } from './InfoPanel'
import { SourcesPanel } from './SourcesPanel'
import { ChecksPanel, OutlinePanel } from '../thesis/ThesisPanels'
import { EvidencePanel, useUncitedCount } from '../thesis/EvidencePanel'
import { useEvidence } from '../thesis/evidence'
import { Segmented } from '../components/Segmented'
import { IconButton } from '../components/common'
import { Rail, RailButton } from '../components/Rail'
import { mod } from '../lib/util'

interface PanelTab {
  value: RightTab
  label: string
  icon: ReactNode
  count?: number
  /** Work in progress for this tab (a pulsing dot). */
  busy?: boolean
}

/** Tabs follow the active document: only what it needs (Occam's razor, Hick's law). */
function usePanelTabs() {
  const active = useStore((s) => s.active)
  const kind = active?.split(':')[0]
  const id = active?.split(':')[1] ?? ''
  const hlCount = useStore((s) => (kind === 'paper' ? Object.values(s.annotations).filter((a) => a.paperId === id).length : 0))
  const guiding = useStore((s) => kind === 'paper' && !!s.guiding[id])
  const uncited = useUncitedCount(kind === 'thesis' ? id : null)
  const backing = useEvidence((s) => s.status === 'searching' || s.status === 'checking' || s.status === 'reading')
  const tabs: PanelTab[] = [
    { value: 'assistant', label: 'Asistente', icon: <Sparkles className="text-brand" /> },
    ...(kind === 'paper'
      ? [
          { value: 'guide' as const, label: 'Guía', icon: <Compass />, busy: guiding },
          { value: 'highlights' as const, label: 'Resaltados', icon: <Highlighter className="text-bloom-amber" />, count: hlCount || undefined },
          { value: 'info' as const, label: 'Cita', icon: <Info /> }
        ]
      : kind === 'note'
        ? [{ value: 'info' as const, label: 'Fuentes', icon: <Library /> }]
        : kind === 'thesis'
          ? [
              { value: 'outline' as const, label: 'Esquema', icon: <ListTree /> },
              { value: 'support' as const, label: 'Respaldo', icon: <BookCheck className="text-success" />, count: uncited || undefined, busy: backing },
              { value: 'checks' as const, label: 'Requisitos', icon: <ListChecks className="text-kind-note" /> }
            ]
          : [])
  ]
  const tab = useStore((s) => s.rightTab)
  const current = tabs.some((t) => t.value === tab) ? tab : 'assistant'
  return { tabs, current, kind, id }
}

/** Assistant activity for badges: writing now, or an answer you haven't seen. */
function useAssistantDot(): 'busy' | 'new' | null {
  const busy = useStore((s) => Object.values(s.streaming).some(Boolean))
  const unseen = useStore((s) => s.assistantUnseen)
  return busy ? 'busy' : unseen ? 'new' : null
}

export function RightPanel() {
  const { tabs, current, kind, id } = usePanelTabs()
  const dot = useAssistantDot()
  const compact = useStore((s) => tabs.length > 3 && s.rightW < 480)

  // Seeing the assistant clears its "new answer" badge.
  useEffect(() => {
    if (current === 'assistant' && useStore.getState().assistantUnseen) useStore.setState({ assistantUnseen: false })
  }, [current, dot])

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l bg-card">
      <div className="drag flex h-[46px] flex-none items-center gap-1 border-b pr-1.5 pl-2.5">
        <div className="no-drag min-w-0">
          <Segmented
            value={current}
            onChange={(v) => useStore.setState({ rightTab: v })}
            items={tabs.map((t) => {
              const status = t.value === 'assistant' ? dot : t.busy ? 'busy' : null
              // Too many tabs for a narrow panel: inactive ones show only their icon.
              const text = compact && t.value !== current ? null : t.label
              return {
                value: t.value,
                icon: t.icon,
                count: t.count,
                title: t.label,
                label:
                  status && current !== t.value ? (
                    <span className="flex items-center gap-1.5">
                      {text}
                      <span
                        aria-label={status === 'busy' ? 'trabajando' : 'respuesta nueva'}
                        className={`size-1.5 rounded-full bg-brand ${status === 'busy' ? 'animate-pulse' : ''}`}
                      />
                    </span>
                  ) : (
                    text
                  )
              }
            })}
          />
        </div>
        <span className="flex-1" />
        {/* Serial position: collapse sits at the far end, where panel controls are expected. */}
        <IconButton className="no-drag" label="Contraer panel" keys={[mod, 'J']} onClick={() => useStore.setState({ rightOpen: false })}>
          <PanelRightClose />
        </IconButton>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${current}-${kind}`}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {current === 'assistant' && <AssistantPanel />}
          {current === 'guide' && kind === 'paper' && <GuidePanel paperId={id} />}
          {current === 'highlights' && kind === 'paper' && <HighlightsPanel paperId={id} />}
          {current === 'info' && kind === 'paper' && <InfoPanel paperId={id} />}
          {current === 'info' && kind === 'note' && <SourcesPanel noteId={id} />}
          {current === 'outline' && kind === 'thesis' && <OutlinePanel thesisId={id} />}
          {current === 'support' && kind === 'thesis' && <EvidencePanel thesisId={id} />}
          {current === 'checks' && kind === 'thesis' && <ChecksPanel thesisId={id} />}
        </motion.div>
      </AnimatePresence>
    </aside>
  )
}

/** The right panel, collapsed: every tab stays one click away. */
export function RightRail() {
  const { tabs } = usePanelTabs()
  const dot = useAssistantDot()
  const open = (tab: RightTab) => useStore.setState({ rightOpen: true, rightTab: tab })
  return (
    <Rail side="right">
      <div className="drag flex h-[46px] w-full flex-none items-center justify-center border-b">
        <IconButton className="no-drag" label="Expandir panel" keys={[mod, 'J']} side="left" onClick={() => useStore.setState({ rightOpen: true })}>
          <PanelRightOpen />
        </IconButton>
      </div>
      <div className="flex flex-col items-center gap-1 pt-2">
        {tabs.map((t) => (
          <RailButton
            key={t.value}
            side="right"
            label={t.label}
            keys={t.value === 'assistant' ? [mod, 'J'] : undefined}
            icon={t.icon}
            badge={t.count}
            dot={t.value === 'assistant' ? dot : t.busy ? 'busy' : null}
            onClick={() => open(t.value)}
          />
        ))}
      </div>
    </Rail>
  )
}

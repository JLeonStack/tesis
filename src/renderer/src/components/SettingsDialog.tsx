import { useState, type ReactNode } from 'react'
import { Loader2, CheckCircle2, FolderOpen, Monitor, Sun, Moon } from 'lucide-react'
import type { AiEffort, AiProvider, CitationStyle } from '@shared/types'
import { AI_PROVIDERS, EFFORT_HINTS, EFFORT_LABELS, modelsFor } from '@shared/ai'
import { aiEffort, aiModel, patchSettings, refreshAccount, setProvider, toast, useStore } from '../store'
import { STYLE_LABELS } from '../lib/citation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Collapsible } from './Collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button as MotionButton } from '@/components/motion/button'
import { Segmented } from './Segmented'
import { TRANSLATE_LANGUAGES } from '../lib/translate'

const PROVIDERS = (Object.keys(AI_PROVIDERS) as AiProvider[]).map((p) => ({ value: p, label: AI_PROVIDERS[p].label }))
const SHORT_EFFORT: Partial<Record<AiEffort, string>> = { xhigh: 'X-High' }

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && useStore.setState({ settingsOpen: false })}>
      <DialogContent className="flex max-h-[84vh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Thesis, citation, assistant and appearance preferences</DialogDescription>
        </DialogHeader>
        {open && <Body />}
      </DialogContent>
    </Dialog>
  )
}

/** Settings sections fold like every other section; the description stays as the collapsed summary. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Collapsible
      id={`settings.${title.toLowerCase()}`}
      group="settings"
      variant="title"
      title={title}
      summary={description}
      className="py-3 not-first:border-t"
      contentClassName="flex flex-col gap-3 pt-1 pb-2"
    >
      {description && <p className="-mt-1 text-[12.5px] text-muted-foreground">{description}</p>}
      {children}
    </Collapsible>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11.5px] font-[550] text-muted-foreground">{children}</span>
}

function Body() {
  const settings = useStore((s) => s.settings)
  const account = useStore((s) => s.account)
  const libraryDir = useStore((s) => s.libraryDir)
  const [busy, setBusy] = useState(false)
  const provider = AI_PROVIDERS[settings.provider]
  const models = modelsFor(settings.provider)
  const model = aiModel(settings)
  const effort = aiEffort(settings)

  const connect = async () => {
    const target = settings.provider
    setBusy(true)
    try {
      const a = await window.api.ai.login(target)
      if (target === useStore.getState().settings.provider) useStore.setState({ account: a })
      if (a.connected) {
        toast(`${AI_PROVIDERS[target].label} connected`, undefined, { status: 'success' })
        await refreshAccount()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-2">
      <Section title="Your thesis" description="The assistant uses this to judge relevance and tailor every answer.">
        <label className="flex flex-col gap-1.5">
          <Label>Working title</Label>
          <Input
            defaultValue={settings.thesisTitle}
            placeholder="e.g. Digital transformation in Latin American SMEs"
            onBlur={(e) => patchSettings({ thesisTitle: e.target.value.trim() })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>Research question & scope</Label>
          <Textarea
            rows={3}
            defaultValue={settings.researchQuestion}
            placeholder="e.g. How does ERP adoption affect operational efficiency in family-owned manufacturers?"
            onBlur={(e) => patchSettings({ researchQuestion: e.target.value.trim() })}
            className="resize-none"
          />
        </label>
      </Section>

      <Section title="Citation style">
        <div className="max-w-[420px]">
          <Segmented
            fill
            value={settings.citationStyle}
            onChange={(s) => patchSettings({ citationStyle: s })}
            items={(Object.keys(STYLE_LABELS) as CitationStyle[]).map((s) => ({ value: s, label: STYLE_LABELS[s] }))}
          />
        </div>
      </Section>

      <Section title="Assistant">
        <div className="flex flex-col gap-1.5">
          <Label>Subscription</Label>
          <div className="max-w-[320px]">
            <Segmented fill value={settings.provider} onChange={setProvider} items={PROVIDERS} />
          </div>
        </div>
        <div className="flex min-h-9 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          {account == null ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking connection…
            </span>
          ) : account.connected ? (
            <span className="flex min-w-0 items-center gap-2 font-[550] text-success">
              <CheckCircle2 className="size-4 flex-none" />
              <span className="truncate">
                Connected to {provider.label}
                {account.email ? ` as ${account.email}` : ''}
              </span>
              {account.plan && (
                <Badge variant="secondary" className="uppercase">
                  {account.plan}
                </Badge>
              )}
            </span>
          ) : account.error === 'cli-missing' ? (
            <span className="min-w-0 text-muted-foreground">
              Install the {provider.cli} first: <code className="font-mono text-xs select-all">{provider.install}</code>
            </span>
          ) : (
            <span className="text-muted-foreground">Not connected</span>
          )}
          <span className="flex-1" />
          {account && !account.connected && account.error !== 'cli-missing' && (
            <MotionButton size="sm" disabled={busy} onClick={() => void connect()}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} Connect {provider.label}
            </MotionButton>
          )}
          {account?.error === 'cli-missing' && (
            <Button variant="outline" size="sm" onClick={() => void refreshAccount()}>
              Retry
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <Label>Model</Label>
            <Select value={model.id} onValueChange={(v) => patchSettings({ model: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m, i) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                    {i === 0 ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Translate selections to</Label>
            <Select value={settings.translateTo} onValueChange={(v) => patchSettings({ translateTo: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSLATE_LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Effort</Label>
            <Segmented
              fill
              value={effort}
              onChange={(e) => patchSettings({ effort: e })}
              items={model.efforts.map((e) => ({ value: e, label: SHORT_EFFORT[e] ?? EFFORT_LABELS[e], title: EFFORT_HINTS[e] }))}
            />
            <span className="text-[11.5px] text-faint">
              {EFFORT_HINTS[effort]}. Applies to the chat; writing helpers and translations keep their own lighter setting.
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Runs through {provider.vendor}’s official {provider.cli} with your {provider.label} plan. Paper text is sent to {provider.vendor} only
          when you use the assistant.
        </p>
      </Section>

      <Section title="Appearance">
        <div className="max-w-[320px]">
          <Segmented
            fill
            value={settings.theme}
            onChange={(t) => patchSettings({ theme: t })}
            items={[
              { value: 'system', label: 'System', icon: <Monitor /> },
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> }
            ]}
          />
        </div>
      </Section>

      <Section title="Library">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{libraryDir}</span>
          <Button variant="outline" size="sm" onClick={() => window.api.papers.reveal('')}>
            <FolderOpen /> Show in Finder
          </Button>
        </div>
      </Section>
    </div>
  )
}

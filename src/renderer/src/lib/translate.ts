import type { AiEvent } from '@shared/types'
import { aiModel, providerLabel, useStore } from '../store'

// Translations run on their own warm Codex thread so they stream back fast and
// never clutter the paper's chat. One turn at a time: a new request interrupts
// the previous one and waits for it to settle before starting.

const CHAT = 'translate'
const MAX_TURNS = 12 // fresh thread now and then so context stays small and fast
const TIMEOUT = 90_000

export const TRANSLATE_LANGUAGES = [
  'Spanish',
  'Spanish (Latin America)',
  'Spanish (Spain)',
  'English',
  'Portuguese',
  'French',
  'German'
] as const

/** Short name for buttons: "Spanish (Spain)" → "Spanish". */
export const langShort = (lang: string) => lang.replace(/\s*\(.*\)$/, '')

export interface TranslationState {
  text: string
  done: boolean
  error?: string
}

/** How to translate a passage from a paper; shared with the quotes saved to notes. */
export const translationRules = (lang: string) => `- Keep the exact meaning and the academic register. Use the standard ${langShort(lang)} terminology of the field; when a key concept has no settled translation, add the original term in parentheses the first time, e.g. "capacidades dinámicas (dynamic capabilities)".
- Keep numbers, statistics, variable names, abbreviations, author names and in-text citations such as (Smith, 2020) unchanged.
- The passage was copied from a PDF: rejoin words split by line-break hyphens, ignore stray line breaks, running headers and footnote markers.
- The selection may start or end partway through a word or sentence. Complete a cut-off word at either edge when its meaning is obvious ("perfor" → performance); never output invented word fragments.
- If the passage is already in ${langShort(lang)}, return it unchanged.`

const instructions = (lang: string) => `You translate passages from academic papers (business, management, economics, social science) into ${lang}.
- Reply with the translation only: no preamble, notes, labels or surrounding quotation marks.
${translationRules(lang)}
- Every message is a new, independent passage.`

const cache = new Map<string, string>()
let turns = 0
let listening = false
let job: { id: number; text: string; onUpdate: (s: TranslationState) => void; cancelled: boolean } | null = null
let settle: (() => void) | null = null
let busy: Promise<void> = Promise.resolve()
let seq = 0

function opts() {
  const { settings } = useStore.getState()
  return { chatId: CHAT, instructions: instructions(settings.translateTo), model: aiModel().id, effort: 'low' }
}

function listen(): void {
  if (listening) return
  listening = true
  window.api.ai.onEvent((e: AiEvent) => {
    if (e.type === 'status' || e.chatId !== CHAT || !job) return
    const j = job
    if (e.type === 'delta') {
      j.text += e.delta
      if (!j.cancelled) j.onUpdate({ text: j.text, done: false })
      return
    }
    // done / error: the turn is over either way.
    const text = e.type === 'done' ? (e.text || j.text).trim() : j.text
    if (!j.cancelled) {
      if (e.type === 'error' && !text) j.onUpdate({ text: '', done: true, error: e.message })
      else j.onUpdate({ text, done: true })
    }
    job = null
    settle?.()
    settle = null
  })
}

/** Starts a warm translation thread so the first request doesn't wait on setup. */
export function prewarmTranslator(): void {
  if (!useStore.getState().account?.connected) return
  void window.api.ai.prepare(opts())
}

export function cachedTranslation(text: string): string | undefined {
  return cache.get(`${useStore.getState().settings.translateTo}\n${clean(text)}`)
}

const clean = (t: string) => t.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim()

/**
 * Translates `text` into the language chosen in Settings, streaming partial
 * results to `onUpdate`. Returns a function that cancels the request.
 */
export function translate(text: string, onUpdate: (s: TranslationState) => void): () => void {
  const lang = useStore.getState().settings.translateTo
  const source = clean(text)
  const key = `${lang}\n${source}`
  const hit = cache.get(key)
  if (hit) {
    onUpdate({ text: hit, done: true })
    return () => {}
  }
  if (!useStore.getState().account?.connected) {
    onUpdate({ text: '', done: true, error: `Connect your ${providerLabel()} account in Settings to translate.` })
    return () => {}
  }

  listen()
  const id = ++seq
  let cancelled = false
  const wrapped = (s: TranslationState) => {
    if (s.done && !s.error && s.text) {
      cache.set(key, s.text)
      if (cache.size > 200) cache.delete(cache.keys().next().value!)
    }
    if (!cancelled) onUpdate(s)
  }

  // Stop whatever is running, then start once it has settled.
  if (job) {
    job.cancelled = true
    void window.api.ai.interrupt(CHAT)
  }
  const prev = busy
  busy = (async () => {
    await prev
    if (cancelled) return
    if (++turns > MAX_TURNS) {
      turns = 1
      await window.api.ai.reset(CHAT)
    }
    const done = new Promise<void>((res) => {
      settle = res
      setTimeout(res, TIMEOUT)
    })
    job = { id, text: '', onUpdate: wrapped, cancelled: false }
    await window.api.ai.send({ ...opts(), text: source })
    await done
    if (job?.id === id) {
      // Timed out without a terminal event.
      job = null
      wrapped({ text: '', done: true, error: 'Translation timed out. Try again.' })
    }
  })()

  return () => {
    cancelled = true
    if (job?.id === id) {
      job.cancelled = true
      void window.api.ai.interrupt(CHAT)
    }
  }
}

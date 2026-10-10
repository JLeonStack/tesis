import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import type { AiAccount, AiEvent } from '../shared/types'
import type { ChatStartOptions, ExtractOptions } from '../shared/api'
import { resolveEffort, resolveModel } from '../shared/ai'

/**
 * Bridge to the user's Claude subscription (Pro / Max) through the official
 * Claude Code CLI (`claude -p` with streaming JSON over stdio). Each chat is
 * one warm process that holds the conversation; text deltas stream to the
 * renderer.
 *
 * Claude Code is an agent; here it runs as a plain research assistant: every
 * tool is off, no settings, MCP servers, skills or CLAUDE.md are loaded and
 * nothing is saved to disk. API keys are stripped from the environment so
 * requests always use the subscription.
 */

type Result = { text: string; error?: string }
type Session = {
  proc: ChildProcessWithoutNullStreams
  key: string
  /** System prompt file, removed when the process exits. */
  file: string
  busy: boolean
  interrupted: boolean
  text: string
  stderr: string
  /** Set for structured requests; chats stream to the renderer instead. */
  waiter?: (r: Result) => void
}

export class ClaudeBridge {
  private sessions = new Map<string, Session>() // chatId -> process
  private assistChannels = new Map<string, { queue: Promise<unknown>; turns: number }>()
  private binary: string | null = null
  private seq = 0
  /** Prompt files left behind by a previous run that didn't exit cleanly. */
  private cleaned: Promise<void>

  constructor(
    private emit: (e: AiEvent) => void,
    private workDir: string
  ) {
    this.cleaned = rm(join(workDir, 'claude'), { recursive: true, force: true }).catch(() => {})
  }

  // ---------- process lifecycle ----------

  private async findBinary(): Promise<string | null> {
    if (this.binary) return this.binary
    const home = homedir()
    const candidates = [
      process.env.CLAUDE_BIN,
      join(home, '.local/bin/claude'),
      join(home, '.claude/local/claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      join(home, '.bun/bin/claude'),
      join(home, '.npm-global/bin/claude')
    ].filter(Boolean) as string[]
    for (const c of candidates) if (existsSync(c)) return (this.binary = c)
    // GUI apps don't inherit the shell PATH; ask a login shell.
    const found = await new Promise<string | null>((res) => {
      execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v claude'], { timeout: 5000 }, (err, out) =>
        res(err ? null : out.trim().split('\n').pop() || null)
      )
    })
    return (this.binary = found && existsSync(found) ? found : null)
  }

  /** Without API keys (so the subscription is used) or the variables of a parent Claude Code session. */
  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'CLAUDE_CONFIG_DIR' || (!/^(ANTHROPIC_|CLAUDE)/.test(k) && k !== 'AI_AGENT')) env[k] = v
    }
    env.PATH = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:${join(homedir(), '.local/bin')}`
    return env
  }

  private async start(chatId: string, opts: ChatStartOptions & { schema?: object }, key: string): Promise<Session> {
    const bin = await this.findBinary()
    if (!bin) throw new Error('CLAUDE_NOT_FOUND')
    const model = resolveModel('claude', opts.model)
    // Paper text can be hundreds of KB: too big for argv, so it goes in a file.
    await this.cleaned
    const dir = join(this.workDir, 'claude')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${key}-${++this.seq}.md`)
    await writeFile(file, opts.instructions, 'utf8')
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', model.id,
      '--effort', resolveEffort(model, claudeEffort(opts.effort)),
      '--system-prompt-file', file,
      '--tools', '',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : [])
    ]
    const proc = spawn(bin, args, { cwd: this.workDir, env: this.env(), stdio: ['pipe', 'pipe', 'pipe'] })
    const s: Session = { proc, key, file, busy: false, interrupted: false, text: '', stderr: '' }
    createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(chatId, s, l))
    proc.stderr.on('data', (d: Buffer) => (s.stderr = (s.stderr + d.toString()).slice(-500)))
    proc.on('exit', () => this.onExit(chatId, s))
    proc.on('error', () => this.onExit(chatId, s))
    proc.stdin.on('error', () => {}) // the exit handler reports it
    this.sessions.set(chatId, s)
    return s
  }

  private onExit(chatId: string, s: Session): void {
    void rm(s.file, { force: true })
    if (this.sessions.get(chatId) === s) this.sessions.delete(chatId)
    if (!s.busy) return
    s.busy = false
    const message = friendlyError(s.stderr.trim() || 'The assistant process stopped. Try again.')
    if (s.waiter) s.waiter({ text: '', error: message })
    else this.emit({ type: 'error', chatId, message })
    s.waiter = undefined
  }

  private drop(chatId: string): void {
    const s = this.sessions.get(chatId)
    if (!s) return
    this.sessions.delete(chatId)
    s.waiter?.({ text: '', error: 'CANCELLED' })
    s.waiter = undefined
    s.busy = false
    s.proc.kill()
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.drop(id)
  }

  // ---------- stream-json ----------

  private write(s: Session, msg: object): void {
    s.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  private onLine(chatId: string, s: Session, line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'stream_event') {
      const ev = msg.event
      if (ev?.type !== 'content_block_delta' || ev.delta?.type !== 'text_delta' || msg.parent_tool_use_id) return
      s.text += ev.delta.text
      if (!s.waiter) this.emit({ type: 'delta', chatId, delta: ev.delta.text })
      return
    }
    if (msg.type !== 'result' || !s.busy) return
    const interrupted = s.interrupted
    const streamed = s.text
    s.busy = false
    s.interrupted = false
    s.text = ''
    let text = streamed
    if (msg.structured_output != null) text = JSON.stringify(msg.structured_output)
    else if (!interrupted && typeof msg.result === 'string' && msg.result) text = msg.result
    const error = interrupted
      ? s.waiter
        ? 'CANCELLED'
        : undefined
      : msg.is_error || msg.subtype !== 'success'
        ? friendlyError(typeof msg.result === 'string' && msg.result ? msg.result : (msg.errors ?? []).join(' ') || 'The request failed.')
        : undefined
    const waiter = s.waiter
    s.waiter = undefined
    // A newer process took over this chat while this turn was running.
    if (this.sessions.get(chatId) !== s) s.proc.kill()
    if (waiter) waiter({ text, error })
    else if (error) this.emit({ type: 'error', chatId, message: error })
    else this.emit({ type: 'done', chatId, text })
  }

  private turn(s: Session, text: string): void {
    s.busy = true
    s.text = ''
    this.write(s, { type: 'user', message: { role: 'user', content: text } })
  }

  // ---------- account ----------

  async account(): Promise<AiAccount> {
    const bin = await this.findBinary()
    if (!bin) return { provider: 'claude', connected: false, error: 'cli-missing' }
    return new Promise((res) => {
      execFile(bin, ['auth', 'status', '--json'], { env: this.env(), timeout: 15_000 }, (_err, out) => {
        try {
          const a = JSON.parse(out)
          if (!a.loggedIn) return res({ provider: 'claude', connected: false })
          res({ provider: 'claude', connected: true, email: a.email ?? null, plan: a.subscriptionType ?? a.authMethod ?? null })
        } catch {
          res({ provider: 'claude', connected: false })
        }
      })
    })
  }

  /** The CLI opens the browser itself and exits once the sign-in completes. */
  async login(): Promise<AiAccount> {
    const bin = await this.findBinary()
    if (!bin) return { provider: 'claude', connected: false, error: 'cli-missing' }
    await new Promise<void>((res) => {
      const proc = spawn(bin, ['auth', 'login', '--claudeai'], { env: this.env(), stdio: ['pipe', 'ignore', 'ignore'] })
      const timer = setTimeout(() => proc.kill(), 5 * 60_000)
      proc.on('exit', () => (clearTimeout(timer), res()))
      proc.on('error', () => (clearTimeout(timer), res()))
    })
    return this.account()
  }

  // ---------- chats ----------

  /** Returns a warm process whose model, effort and instructions match; starts one if needed. */
  async prepare(opts: ChatStartOptions & { schema?: object }): Promise<Session> {
    const model = resolveModel('claude', opts.model)
    const effort = resolveEffort(model, claudeEffort(opts.effort))
    const key = createHash('sha1')
      .update(`${model.id}\n${effort}\n${opts.schema ? JSON.stringify(opts.schema) : ''}\n${opts.instructions}`)
      .digest('hex')
    const existing = this.sessions.get(opts.chatId)
    if (existing && existing.key === key) return existing
    if (existing && !existing.busy) this.drop(opts.chatId)
    return this.start(opts.chatId, opts, key)
  }

  async send(opts: ChatStartOptions & { text: string }): Promise<void> {
    try {
      const s = await this.prepare(opts)
      this.turn(s, opts.text)
    } catch (e) {
      const msg = (e as Error).message
      this.emit({
        type: 'error',
        chatId: opts.chatId,
        message: msg === 'CLAUDE_NOT_FOUND' ? 'Claude Code CLI not found. Install it from claude.com/claude-code.' : friendlyError(msg)
      })
    }
  }

  async interrupt(chatId: string): Promise<void> {
    const s = this.sessions.get(chatId)
    if (!s?.busy) return
    s.interrupted = true
    this.write(s, { type: 'control_request', request_id: `interrupt-${++this.seq}`, request: { subtype: 'interrupt' } })
  }

  reset(chatId: string): void {
    this.drop(chatId)
  }

  private ask(s: Session, prompt: string): Promise<unknown> {
    const result = new Promise<Result>((res) => (s.waiter = res))
    this.turn(s, prompt)
    return result.then(({ text, error }) => {
      if (error) throw new Error(error)
      return JSON.parse(text)
    })
  }

  /**
   * Structured request on a warm, reusable process, for writing helpers that
   * must answer in a second or two. A newer request cancels the one in flight.
   */
  async assist(opts: { instructions: string; prompt: string; schema: object; model?: string | null; channel?: string; effort?: string }): Promise<unknown> {
    const chatId = `assist:${opts.channel ?? 'writing'}`
    let ch = this.assistChannels.get(chatId)
    if (!ch) this.assistChannels.set(chatId, (ch = { queue: Promise.resolve(), turns: 0 }))
    const channel = ch
    // Claude would still answer an interrupted request in the next turn, so a superseded one takes its process with it.
    if (this.sessions.get(chatId)?.busy) this.drop(chatId)
    const run = channel.queue.then(async () => {
      // A fresh process now and then keeps the context small and fast.
      if (++channel.turns > 16) {
        channel.turns = 1
        this.drop(chatId)
      }
      const s = await this.prepare({ chatId, instructions: opts.instructions, model: opts.model, effort: opts.effort ?? 'low', schema: opts.schema })
      return this.ask(s, opts.prompt)
    })
    channel.queue = run.catch(() => {})
    return run
  }

  /** One-shot request constrained by a JSON schema. */
  async extract(prompt: string, schema: object, opts: ExtractOptions = {}): Promise<unknown> {
    const chatId = `oneshot:${++this.seq}`
    const s = await this.start(
      chatId,
      {
        chatId,
        instructions: opts.instructions ?? 'You extract structured data precisely. Never invent values; use empty strings when unknown.',
        model: opts.model,
        effort: opts.effort ?? 'low',
        schema
      },
      'oneshot'
    )
    try {
      return await this.ask(s, prompt)
    } finally {
      this.drop(chatId)
    }
  }
}

/** Claude has no "none" or "minimal" effort; the lowest is "low". */
function claudeEffort(effort: string | undefined): string | undefined {
  return effort === 'none' || effort === 'minimal' ? 'low' : effort
}

function friendlyError(msg: string): string {
  if (/usage limit|rate limit|429|limit reached/i.test(msg)) return 'You reached your Claude usage limit for now. Try again later.'
  if (/unauthorized|401|log ?in|auth|oauth/i.test(msg)) return 'Your Claude session expired. Reconnect from Settings.'
  if (/network|ENOTFOUND|ECONN|timed out|overloaded|529/i.test(msg)) return 'Network problem reaching Claude. Check your connection.'
  return msg
}

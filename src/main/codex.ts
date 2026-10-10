import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { shell } from 'electron'
import type { AiAccount, AiEvent } from '../shared/types'
import type { ChatStartOptions, ExtractOptions } from '../shared/api'
import { resolveModel } from '../shared/ai'

/**
 * Bridge to the user's ChatGPT subscription through the official Codex CLI
 * (`codex app-server`, JSON-RPC over stdio). We keep one warm process, one
 * warm thread per chat, and stream token deltas to the renderer.
 *
 * Codex is an agent; here it runs as a plain research assistant: tools that
 * touch the machine are disabled, the sandbox is read-only and nothing needs
 * approval.
 */

const DISABLED_FEATURES = [
  'apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
  'multi_agent', 'goals', 'in_app_browser', 'shell_tool', 'unified_exec', 'skill_search', 'tool_suggest',
  'remote_plugin', 'view_image', 'workspace_dependencies', 'shell_snapshot', 'memories'
]

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }
type ThreadState = { threadId: string; key: string; turnId?: string; text: string }

export class CodexBridge {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private threads = new Map<string, ThreadState>() // chatId -> thread
  private threadToChat = new Map<string, string>()
  private preparing = new Map<string, Promise<ThreadState>>()
  private oneShot = new Map<string, (r: { text: string; error?: string }) => void>()
  /** Per channel (writing helpers, autocomplete): one request at a time, the newest wins. */
  private assistChannels = new Map<string, { queue: Promise<unknown>; turns: number }>()
  private loginWaiter: ((ok: boolean) => void) | null = null
  private binary: string | null = null
  private lastError = ''

  constructor(
    private emit: (e: AiEvent) => void,
    private workDir: string
  ) {}

  // ---------- process lifecycle ----------

  private async findBinary(): Promise<string | null> {
    if (this.binary) return this.binary
    const home = homedir()
    const candidates = [
      process.env.CODEX_BIN,
      join(home, '.local/bin/codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      join(home, '.bun/bin/codex'),
      join(home, '.npm-global/bin/codex')
    ].filter(Boolean) as string[]
    for (const c of candidates) if (existsSync(c)) return (this.binary = c)
    // GUI apps don't inherit the shell PATH; ask a login shell.
    const found = await new Promise<string | null>((res) => {
      execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v codex'], { timeout: 5000 }, (err, out) =>
        res(err ? null : out.trim().split('\n').pop() || null)
      )
    })
    return (this.binary = found && existsSync(found) ? found : null)
  }

  private ensure(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      const bin = await this.findBinary()
      if (!bin) throw new Error('CODEX_NOT_FOUND')
      const args = ['app-server', ...DISABLED_FEATURES.flatMap((f) => ['--disable', f]), '-c', 'project_doc_max_bytes=0']
      const proc = spawn(bin, args, {
        env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:${join(homedir(), '.local/bin')}` },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.proc = proc
      createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(l))
      proc.stderr.on('data', (d: Buffer) => (this.lastError = d.toString().slice(-500)))
      proc.on('exit', () => this.onExit())
      proc.on('error', () => this.onExit())
      await this.request('initialize', {
        clientInfo: { name: 'thesis_studio', title: 'Thesis Studio', version: '0.3.1' },
        capabilities: null
      })
      this.notify('initialized')
    })()
    this.ready.catch(() => (this.ready = null))
    return this.ready
  }

  private onExit(): void {
    this.proc = null
    this.ready = null
    for (const p of this.pending.values()) p.reject(new Error(this.lastError || 'Codex stopped unexpectedly'))
    this.pending.clear()
    for (const [chatId, t] of this.threads) {
      if (t.turnId) this.emit({ type: 'error', chatId, message: 'The assistant process stopped. Try again.' })
    }
    this.threads.clear()
    this.threadToChat.clear()
  }

  dispose(): void {
    this.proc?.kill()
  }

  // ---------- JSON-RPC ----------

  private write(msg: object): void {
    this.proc?.stdin.write(JSON.stringify(msg) + '\n')
  }

  private notify(method: string, params?: object): void {
    this.write(params ? { method, params } : { method })
  }

  private request<T = any>(method: string, params: object): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('Codex is not running'))
      const id = ++this.seq
      this.pending.set(id, { resolve, reject })
      this.write({ id, method, params })
    })
  }

  private onLine(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    // Response to one of our requests
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'Request failed'))
      else p.resolve(msg.result)
      return
    }
    // Server -> client request (approvals, etc.). We never grant anything.
    if (msg.id != null && msg.method) {
      this.write({ id: msg.id, error: { code: -32601, message: 'Not supported by Thesis Studio' } })
      return
    }
    this.onNotification(msg.method, msg.params ?? {})
  }

  private onNotification(method: string, p: any): void {
    switch (method) {
      case 'item/agentMessage/delta': {
        const chatId = this.threadToChat.get(p.threadId)
        const t = chatId ? this.threads.get(chatId) : undefined
        if (chatId && t) {
          t.text += p.delta
          if (!chatId.startsWith('oneshot:') && !chatId.startsWith('assist:')) this.emit({ type: 'delta', chatId, delta: p.delta })
        }
        break
      }
      case 'turn/completed': {
        const chatId = this.threadToChat.get(p.threadId)
        const t = chatId ? this.threads.get(chatId) : undefined
        if (!chatId || !t) break
        const turn = p.turn ?? {}
        // Prefer the authoritative final message when present.
        const finalText =
          (turn.items ?? [])
            .filter((i: any) => i.type === 'agentMessage')
            .map((i: any) => i.text)
            .join('\n\n') || t.text
        t.turnId = undefined
        t.text = ''
        const error = turn.status === 'failed' ? turn.error?.message ?? 'The request failed.' : undefined
        const waiter = this.oneShot.get(chatId)
        if (waiter) {
          this.oneShot.delete(chatId)
          waiter({ text: finalText, error: error ?? (turn.status === 'interrupted' ? 'CANCELLED' : undefined) })
          // Assist threads stay warm for the next request.
          if (!chatId.startsWith('assist:')) this.dropThread(chatId)
        } else if (error) this.emit({ type: 'error', chatId, message: friendlyError(error) })
        else this.emit({ type: 'done', chatId, text: finalText })
        break
      }
      case 'error': {
        if (p.willRetry) break
        const chatId = this.threadToChat.get(p.threadId)
        if (chatId && !this.oneShot.has(chatId)) {
          this.emit({ type: 'error', chatId, message: friendlyError(p.error?.message ?? 'Unknown error') })
        }
        break
      }
      case 'account/login/completed':
        this.loginWaiter?.(!!p.success)
        this.loginWaiter = null
        break
      case 'account/updated':
        void this.account().then((account) => this.emit({ type: 'status', account }))
        break
    }
  }

  // ---------- account ----------

  async account(): Promise<AiAccount> {
    try {
      await this.ensure()
      const r = await this.request('account/read', {})
      const a = r.account
      if (!a) return { provider: 'chatgpt', connected: false }
      return { provider: 'chatgpt', connected: true, email: a.email ?? null, plan: a.planType ?? a.type }
    } catch (e) {
      const msg = (e as Error).message
      return { provider: 'chatgpt', connected: false, error: msg === 'CODEX_NOT_FOUND' ? 'cli-missing' : msg }
    }
  }

  async login(): Promise<AiAccount> {
    await this.ensure()
    const r = await this.request('account/login/start', { type: 'chatgpt' })
    if (r.authUrl) void shell.openExternal(r.authUrl)
    await new Promise<boolean>((res) => {
      this.loginWaiter = res
      setTimeout(() => res(false), 5 * 60_000)
    })
    return this.account()
  }

  // ---------- chats ----------

  private async startThread(chatId: string, opts: ChatStartOptions, key: string): Promise<ThreadState> {
    await this.ensure()
    const r = await this.request('thread/start', {
      cwd: this.workDir,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      ephemeral: true,
      model: resolveModel('chatgpt', opts.model).id,
      developerInstructions: opts.instructions,
      serviceName: 'thesis_studio'
    })
    const state: ThreadState = { threadId: r.thread.id, key, text: '' }
    this.threads.set(chatId, state)
    this.threadToChat.set(state.threadId, chatId)
    return state
  }

  private dropThread(chatId: string): void {
    const t = this.threads.get(chatId)
    if (!t) return
    this.threads.delete(chatId)
    this.threadToChat.delete(t.threadId)
    void this.request('thread/unsubscribe', { threadId: t.threadId }).catch(() => {})
  }

  /** Returns a warm thread whose instructions match; starts one if needed. */
  async prepare(opts: ChatStartOptions): Promise<ThreadState> {
    const key = createHash('sha1').update(`${opts.model ?? ''}\n${opts.instructions}`).digest('hex')
    const existing = this.threads.get(opts.chatId)
    if (existing && existing.key === key) return existing
    const inflight = this.preparing.get(opts.chatId + key)
    if (inflight) return inflight
    if (existing && !existing.turnId) this.dropThread(opts.chatId)
    const p = this.startThread(opts.chatId, opts, key).finally(() => this.preparing.delete(opts.chatId + key))
    this.preparing.set(opts.chatId + key, p)
    return p
  }

  async send(opts: ChatStartOptions & { text: string }): Promise<void> {
    try {
      const t = await this.prepare(opts)
      t.text = ''
      const r = await this.request('turn/start', {
        threadId: t.threadId,
        input: [{ type: 'text', text: opts.text, text_elements: [] }],
        effort: opts.effort || null
      })
      t.turnId = r.turn?.id
    } catch (e) {
      const msg = (e as Error).message
      this.emit({
        type: 'error',
        chatId: opts.chatId,
        message: msg === 'CODEX_NOT_FOUND' ? 'Codex CLI not found. Install it with “npm i -g @openai/codex”.' : friendlyError(msg)
      })
    }
  }

  async interrupt(chatId: string): Promise<void> {
    const t = this.threads.get(chatId)
    if (t?.turnId) await this.request('turn/interrupt', { threadId: t.threadId, turnId: t.turnId }).catch(() => {})
  }

  reset(chatId: string): void {
    this.dropThread(chatId)
  }

  /**
   * Structured request on a warm, reusable thread, for writing helpers that
   * must answer in a second or two. A newer request cancels the one in flight.
   */
  async assist(opts: { instructions: string; prompt: string; schema: object; model?: string | null; channel?: string; effort?: string }): Promise<unknown> {
    const chatId = `assist:${opts.channel ?? 'writing'}`
    let ch = this.assistChannels.get(chatId)
    if (!ch) this.assistChannels.set(chatId, (ch = { queue: Promise.resolve(), turns: 0 }))
    const channel = ch
    if (this.threads.get(chatId)?.turnId) await this.interrupt(chatId)
    const run = channel.queue.then(async () => {
      // A fresh thread now and then keeps the context small and fast.
      if (++channel.turns > 16) {
        channel.turns = 1
        this.dropThread(chatId)
      }
      const t = await this.prepare({ chatId, instructions: opts.instructions, model: opts.model })
      const result = new Promise<{ text: string; error?: string }>((res) => this.oneShot.set(chatId, res))
      const r = await this.request('turn/start', {
        threadId: t.threadId,
        input: [{ type: 'text', text: opts.prompt, text_elements: [] }],
        effort: opts.effort ?? 'low',
        outputSchema: opts.schema
      })
      t.turnId = r.turn?.id
      const { text, error } = await result
      if (error) throw new Error(error === 'CANCELLED' ? error : friendlyError(error))
      return JSON.parse(text)
    })
    channel.queue = run.catch(() => {})
    return run
  }

  /** One-shot request constrained by a JSON schema. */
  async extract(prompt: string, schema: object, opts: ExtractOptions = {}): Promise<unknown> {
    const chatId = `oneshot:${++this.seq}`
    const t = await this.startThread(
      chatId,
      {
        chatId,
        instructions: opts.instructions ?? 'You extract structured data precisely. Never invent values; use empty strings when unknown.',
        model: opts.model
      },
      'oneshot'
    )
    const result = new Promise<{ text: string; error?: string }>((res) => this.oneShot.set(chatId, res))
    await this.request('turn/start', {
      threadId: t.threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      effort: opts.effort ?? 'low',
      outputSchema: schema
    })
    const { text, error } = await result
    if (error) throw new Error(friendlyError(error))
    return JSON.parse(text)
  }
}

function friendlyError(msg: string): string {
  if (/usage limit|rate limit|429/i.test(msg)) return 'You reached your ChatGPT usage limit for now. Try again later.'
  if (/unauthorized|401|login|auth/i.test(msg)) return 'Your ChatGPT session expired. Reconnect from Settings.'
  if (/network|ENOTFOUND|ECONN|timed out|stream disconnected/i.test(msg)) return 'Network problem reaching ChatGPT. Check your connection.'
  return msg
}

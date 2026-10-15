import type { AiEffort, AiModel, AiProvider } from './types'

/** The subscriptions the assistant can run on, and the official CLI each one goes through. */
export const AI_PROVIDERS: Record<AiProvider, { label: string; vendor: string; cli: string; install: string }> = {
  chatgpt: { label: 'ChatGPT', vendor: 'OpenAI', cli: 'Codex CLI', install: 'npm i -g @openai/codex' },
  claude: { label: 'Claude', vendor: 'Anthropic', cli: 'Claude Code CLI', install: 'curl -fsSL https://claude.ai/install.sh | bash' }
}

/** The only models offered, per provider. The first one of each provider is its default. */
export const AI_MODELS: AiModel[] = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'chatgpt', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', provider: 'chatgpt', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', provider: 'claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', provider: 'claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }
]

export const DEFAULT_PROVIDER: AiProvider = 'claude'
export const DEFAULT_EFFORT: AiEffort = 'high'

export const EFFORT_ORDER: AiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export const EFFORT_LABELS: Record<AiEffort, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo',
  ultra: 'Ultra'
}

export const EFFORT_HINTS: Record<AiEffort, string> = {
  low: 'Respuestas más rápidas, razonamiento liviano',
  medium: 'Equilibrio entre velocidad y profundidad',
  high: 'Razonamiento más profundo para preguntas difíciles (recomendado)',
  xhigh: 'Todavía más profundo; bastante más lento',
  max: 'Profundidad máxima; lento y consume más de tu plan',
  ultra: 'El razonamiento más largo; el más lento'
}

export function providerOf(model: string | null | undefined): AiProvider {
  return model?.startsWith('claude') ? 'claude' : 'chatgpt'
}

export function modelsFor(provider: AiProvider): AiModel[] {
  return AI_MODELS.filter((m) => m.provider === provider)
}

/** The saved model when it belongs to the provider, otherwise the provider's default. */
export function resolveModel(provider: AiProvider, model: string | null | undefined): AiModel {
  const own = modelsFor(provider)
  return own.find((m) => m.id === model) ?? own[0]
}

/** The requested effort, or the closest lower level the model supports. */
export function resolveEffort(model: AiModel, effort: string | null | undefined): AiEffort {
  const i = EFFORT_ORDER.indexOf(effort as AiEffort)
  if (i < 0) return model.efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : model.efforts[0]
  for (let j = i; j >= 0; j--) if (model.efforts.includes(EFFORT_ORDER[j])) return EFFORT_ORDER[j]
  return model.efforts[0]
}

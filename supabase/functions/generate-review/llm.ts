// LLM calls use the OpenAI-compatible chat completions API.
//
// Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL for any compatible provider
// (OpenAI, DashScope compatible mode, OpenRouter, DeepSeek, self-hosted gateways).
// OPENAI_* and DASHSCOPE_* are accepted as legacy aliases so existing local envs
// do not break during the migration.
//
// Keys only live in Edge Function environment variables, never in frontend code.

export interface LlmOptions {
  system: string
  user: string
  /** 1.2-1.3. The default model temperature is too polite for this product. */
  temperature: number
  maxTokens: number
}

interface OpenAiCompatibleConfig {
  baseUrl: string
  apiKey: string
  model: string
  apiKeyEnv: string
}

export async function callLlm(opts: LlmOptions): Promise<string> {
  return callOpenAiCompatible(opts, resolveConfig())
}

function resolveConfig(): OpenAiCompatibleConfig {
  const apiKey =
    Deno.env.get('LLM_API_KEY') ??
    Deno.env.get('OPENAI_API_KEY') ??
    Deno.env.get('DASHSCOPE_API_KEY') ??
    ''
  const apiKeyEnv = Deno.env.get('LLM_API_KEY')
    ? 'LLM_API_KEY'
    : Deno.env.get('OPENAI_API_KEY')
      ? 'OPENAI_API_KEY'
      : 'DASHSCOPE_API_KEY'

  return {
    baseUrl:
      Deno.env.get('LLM_BASE_URL') ??
      Deno.env.get('OPENAI_BASE_URL') ??
      Deno.env.get('DASHSCOPE_BASE_URL') ??
      'https://api.openai.com/v1',
    apiKey,
    model:
      Deno.env.get('LLM_MODEL') ??
      Deno.env.get('OPENAI_MODEL') ??
      Deno.env.get('DASHSCOPE_MODEL') ??
      'gpt-4o-mini',
    apiKeyEnv,
  }
}

/**
 * Reasoning models (DeepSeek R1, OpenAI o-series) often reject temperature.
 *
 * The app prefers higher-temperature chat models because funny reviews are the
 * whole point. Reasoning models can work, but tend to be flatter here.
 */
function ignoresTemperature(model: string): boolean {
  const m = model.toLowerCase()
  return /^deepseek-r1/.test(m) || /^(o1|o3|o4)\b/.test(m)
}

async function callOpenAiCompatible(
  { system, user, temperature, maxTokens }: LlmOptions,
  config: OpenAiCompatibleConfig,
): Promise<string> {
  if (!config.apiKey) throw new Error(`${config.apiKeyEnv} not set`)

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  if (ignoresTemperature(config.model)) {
    console.warn(
      `${config.model} does not accept temperature; using the model default for this generation.`,
    )
  } else {
    body.temperature = temperature
  }

  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const json = await res.json()
  const message = json?.choices?.[0]?.message

  // Some compatible reasoning APIs include reasoning_content alongside content.
  // Only user-facing content may leave the Edge Function.
  return String(message?.content ?? '').trim()
}

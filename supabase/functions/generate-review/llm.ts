// LLM 调用。三家可选，靠 LLM_PROVIDER 切：
//
//   anthropic  —— Claude
//   openai     —— OpenAI
//   dashscope  —— 阿里云百炼（DeepSeek / Qwen），走 OpenAI 兼容模式
//
// 百炼对这个产品有个额外好处：服务在境内，从北京/上海调延迟低、不用翻墙，
// 和「先跑国内版」的阶段目标一致。
//
// key 只存在 Edge Function 的环境变量里，绝不进前端、绝不进仓库（CLAUDE.md 第 7 节）。

export type Provider = 'anthropic' | 'openai' | 'dashscope'

export interface LlmOptions {
  system: string
  user: string
  /** 1.2–1.3。默认值太一本正经，出不来效果（CLAUDE.md 第 7 节） */
  temperature: number
  maxTokens: number
}

export function resolveProvider(): Provider {
  const raw = (Deno.env.get('LLM_PROVIDER') ?? 'anthropic').toLowerCase()
  if (raw === 'openai') return 'openai'
  if (raw === 'dashscope' || raw === 'bailian' || raw === 'aliyun') return 'dashscope'
  return 'anthropic'
}

export async function callLlm(opts: LlmOptions): Promise<string> {
  switch (resolveProvider()) {
    case 'openai':
      return callOpenAiCompatible(opts, {
        baseUrl: Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
        apiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
        model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
        keyName: 'OPENAI_API_KEY',
      })

    case 'dashscope':
      return callOpenAiCompatible(opts, {
        // 百炼的 base_url 现在是按工作空间和地域分的：
        //   https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
        // 老的 https://dashscope.aliyuncs.com/compatible-mode/v1 也仍然可用。
        // 两种都别写死，整个走 env（CLAUDE.md 8.5）。
        baseUrl:
          Deno.env.get('DASHSCOPE_BASE_URL') ??
          'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: Deno.env.get('DASHSCOPE_API_KEY') ?? '',
        model: Deno.env.get('DASHSCOPE_MODEL') ?? 'deepseek-v3.2',
        keyName: 'DASHSCOPE_API_KEY',
      })

    default:
      return callAnthropic(opts)
  }
}

async function callAnthropic({ system, user, temperature, maxTokens }: LlmOptions): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const json = await res.json()
  const blocks: unknown[] = Array.isArray(json?.content) ? json.content : []
  return blocks
    .map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as { text: unknown }).text) : ''))
    .join('')
    .trim()
}

interface OpenAiCompatTarget {
  baseUrl: string
  apiKey: string
  model: string
  keyName: string
}

/**
 * 推理模型（deepseek-r1 系列、o 系列）不接受 temperature/top_p，传了会直接报错。
 *
 * 但这个产品**就是靠 temperature 1.25 出效果的** —— 默认温度写出来的东西一本正经，
 * 不好笑就没有传播，没有传播这产品就不成立。所以这类模型只是"能用"，不是好选择。
 */
function ignoresTemperature(model: string): boolean {
  const m = model.toLowerCase()
  return /^deepseek-r1/.test(m) || /^(o1|o3|o4)\b/.test(m)
}

async function callOpenAiCompatible(
  { system, user, temperature, maxTokens }: LlmOptions,
  target: OpenAiCompatTarget,
): Promise<string> {
  if (!target.apiKey) throw new Error(`${target.keyName} not set`)

  const body: Record<string, unknown> = {
    model: target.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  if (ignoresTemperature(target.model)) {
    console.warn(
      `${target.model} 不支持 temperature，本次按模型默认值生成。` +
        `这类推理模型写出来的锐评偏平，建议换 deepseek-v3.2 这类对话模型。`,
    )
  } else {
    body.temperature = temperature
  }

  const url = `${target.baseUrl.replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(
      `${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 300)}`,
    )
  }

  const json = await res.json()
  const message = json?.choices?.[0]?.message

  // 推理模型会把思考过程放在 reasoning_content，正文仍在 content。
  // 只取 content —— 思考过程绝不能出现在展示给用户的锐评里。
  return String(message?.content ?? '').trim()
}

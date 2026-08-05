import { createClient } from 'jsr:@supabase/supabase-js@2'

import { dedupeByGroup, tagPhrases, TAG_KEYS } from '../_shared/quick-tags.ts'
import { buildSystemPrompt, buildUserPrompt, type Locale } from './prompt.ts'
import { callLlm } from './llm.ts'

/**
 * generate-review —— 唯一调 LLM 的地方。
 *
 * API key 只存在这儿的环境变量里，绝不进前端、绝不进仓库（CLAUDE.md 第 7 节）。
 * 这个函数**只生成，不落库**：用户必须先预览、能改，再由前端走 insert 发布（10.3）。
 */

const STYLES = new Set([
  'wenyan',
  'xiaohongshu',
  'waimai',
  'eulogy',
  'luxun',
  'documentary',
  'michelin',
  'rap',
])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

function clampRating(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, n))
}

/**
 * 模型偶尔会不听话地加 markdown、包引号、写标题。与其反复调 prompt，不如出口处削一刀。
 */
function sanitize(text: string, lang: Locale): string {
  let out = text.trim()

  out = out.replace(/^```[a-z]*\s*/i, '').replace(/```$/g, '')
  out = out.replace(/^#{1,6}\s+.*$/gm, '') // 标题行整行去掉
  out = out.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
  out = out.replace(/\s*\n+\s*/g, ' ') // 强制单段
  out = out.trim()

  // 整段被引号包起来的情况，去掉首尾一层
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
  ]
  for (const [open, close] of pairs) {
    if (out.startsWith(open) && out.endsWith(close) && out.length > 2) {
      out = out.slice(open.length, -close.length).trim()
      break
    }
  }

  // 中文按字数、英文按词数，各自截断
  const limit = lang === 'zh' ? 160 : 900
  return out.length > limit ? `${out.slice(0, limit).trimEnd()}…` : out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'server_misconfigured' }, 500)
  }

  // —— 身份：必须是登录用户（匿名号也算），否则限流没有挂靠对象
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()

  // scripts/seed-reviews.ts 拿 service_role 直接批量生成，跳过限流。
  // 这个 key 本来就能绕过一切，在这儿多挡一道没有意义，只会让 seed 脚本没法跑。
  const isAdmin = bearer !== '' && bearer === serviceKey

  let userId = 'seed-admin'
  if (!isAdmin) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
    userId = userData.user.id
  }

  // —— 入参
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const toiletId = typeof body.toilet_id === 'string' ? body.toilet_id : ''
  if (!toiletId) return json({ error: 'missing_toilet_id' }, 400)

  const style = typeof body.style === 'string' && STYLES.has(body.style) ? body.style : 'xiaohongshu'
  const lang: Locale = body.lang === 'en' ? 'en' : 'zh'

  // 只接受已知 key，未知的直接丢 —— 不让任意字符串顺着 tags 进 prompt
  const rawTags = Array.isArray(body.quick_tags) ? body.quick_tags : []
  const known = new Set(TAG_KEYS)
  // 只接受已知 key；同一互斥组里只留一个，别把「排大队 + 完全不用等」一起塞给模型。
  // 前端已经做了单选，这里再挡一次 —— 请求是客户端发的，不能只靠 UI 约束。
  const tagKeys = dedupeByGroup(
    rawTags.filter((k): k is string => typeof k === 'string' && known.has(k)),
  ).slice(0, 8)

  const rawNote =
    typeof body.raw_note === 'string' && body.raw_note.trim()
      ? body.raw_note.trim().slice(0, 200)
      : null

  const admin = createClient(supabaseUrl, serviceKey)

  // —— 频率限制：同一 user_id 每分钟最多 3 条（CLAUDE.md 第 9 节）。
  // 这里挡的是生成成本；数据库那边还有个触发器挡真正的写入。
  if (!isAdmin) {
    const since = new Date(Date.now() - 60_000).toISOString()
    const { count } = await admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since)

    if ((count ?? 0) >= 3) return json({ error: 'rate_limited' }, 429)
  }

  // —— 厕所信息：从库里读，不信前端传的名字
  const { data: toilet } = await admin
    .from('toilets')
    .select('name, name_en, category')
    .eq('id', toiletId)
    .maybeSingle()

  if (!toilet) return json({ error: 'toilet_not_found' }, 404)

  const toiletName =
    (lang === 'en' ? toilet.name_en || toilet.name : toilet.name) ?? '(unnamed)'

  // —— 生成
  const system = buildSystemPrompt(lang, style)
  const userPrompt = buildUserPrompt({
    toiletName,
    category: toilet.category ?? null,
    clean: clampRating(body.clean),
    smell: clampRating(body.smell),
    queue: clampRating(body.queue),
    privacy: clampRating(body.privacy),
    tagPhrases: tagPhrases(tagKeys, lang),
    rawNote,
    style,
    lang,
  })

  try {
    const raw = await callLlm({
      system,
      user: userPrompt,
      // 默认值太一本正经，出不来效果（CLAUDE.md 第 7 节）
      temperature: 1.25,
      maxTokens: 400,
    })

    const text = sanitize(raw, lang)
    if (!text) return json({ error: 'empty_generation' }, 502)

    return json({ text, style, lang })
  } catch (e) {
    console.error('generate-review failed:', e)
    // 具体错误只进日志，不回给客户端 —— 里面可能带 key 片段或上游细节
    return json({ error: 'generate_failed' }, 502)
  }
})

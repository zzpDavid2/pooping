/**
 * 开发用假评价（CLAUDE.md 6.2）。
 *
 *   pnpm seed:reviews -- --limit=20 --per=3 --lang=zh
 *
 * 一石三鸟：填满前端、跑通整条 LLM 链路、**一次性读到几十条生成结果，
 * 直接判断梗到底好不好笑**。最后一条才是重点 —— 这是产品最核心的假设。
 *
 * 全部标 is_seed = true。上线前必须清掉：
 *   delete from reviews where is_seed = true;
 */

import './env.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { QUICK_TAG_DEFS, dedupeByGroup } from '../supabase/functions/_shared/quick-tags.ts'

const STYLES = [
  'wenyan',
  'xiaohongshu',
  'waimai',
  'eulogy',
  'luxun',
  'documentary',
  'michelin',
  'rap',
] as const

const SEED_NICKNAMES = [
  '蹲位观察员',
  '一号坑常客',
  '纸巾自带者',
  '憋不住了',
  '洗手液鉴定师',
  'Stall Critic',
  'Emergency Visitor',
  'Paper Skeptic',
]

function arg(name: string, fallback: string): string {
  return (
    process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
  )
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * 评分和标签要相关，不能各随机各的。
 * 「干净 5 分 + 地上有水 + 味道感人」这种组合会让模型写出自相矛盾的东西，
 * 读起来不是好笑，是坏掉。
 */
function coherentSample(): {
  clean: number
  smell: number
  queue: number
  privacy: number
  tags: string[]
} {
  const mood = Math.random()
  const base = mood < 0.35 ? 2 : mood < 0.7 ? 3 : 4

  const jitter = () => Math.min(5, Math.max(1, base + randomInt(-1, 1)))
  const clean = jitter()
  const smell = jitter()

  const wantedTone = base <= 2 ? 'bad' : base >= 4 ? 'good' : null
  const pool = QUICK_TAG_DEFS.filter(
    (t) => wantedTone === null || t.tone === wantedTone || t.tone === 'neutral',
  )

  const tags: string[] = []
  const want = randomInt(1, 3)
  while (tags.length < want && tags.length < pool.length) {
    const key = pick(pool).key
    if (!tags.includes(key)) tags.push(key)
  }

  // 同组只留一个，别生成「味道感人 + 一股烟味」这种自相矛盾的输入
  return { clean, smell, queue: jitter(), privacy: jitter(), tags: dedupeByGroup(tags) }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，照着 .env.example 配')
  }

  const limit = Number(arg('limit', '15'))
  const perToilet = Number(arg('per', '3'))
  const langArg = arg('lang', 'mix') // zh | en | mix

  const supabase: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false },
  })

  // seed 评价挂在一个真实用户上：reviews.user_id 有外键，不能瞎填 uuid
  const seedUserId = await ensureSeedUser(supabase)

  const { data: toilets, error } = await supabase
    .from('toilets')
    .select('id, name')
    .eq('status', 'published')
    .limit(limit)

  if (error) throw new Error(`读 toilets 失败：${error.message}`)
  if (!toilets?.length) {
    throw new Error('库里一个厕所都没有，先跑 pnpm import:osm -- --city=beijing')
  }

  console.log(`为 ${toilets.length} 个厕所生成评价，每个 ${perToilet} 条\n`)

  let made = 0
  let failed = 0

  for (const toilet of toilets) {
    for (let i = 0; i < perToilet; i++) {
      const sample = coherentSample()
      const style = pick(STYLES)
      const lang = langArg === 'mix' ? (Math.random() < 0.7 ? 'zh' : 'en') : langArg

      // 调**真实的** Edge Function，不是本地模板 —— 就是要跑通整条链路
      const res = await fetch(`${url}/functions/v1/generate-review`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // service_role 走 admin 通道，跳过频率限制（见 function 里的 isAdmin）
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          toilet_id: toilet.id,
          clean: sample.clean,
          smell: sample.smell,
          queue: sample.queue,
          privacy: sample.privacy,
          quick_tags: sample.tags,
          raw_note: null,
          style,
          lang,
        }),
      })

      if (!res.ok) {
        console.error(`  ✗ ${toilet.name}: ${res.status} ${(await res.text()).slice(0, 160)}`)
        failed++
        continue
      }

      const { text } = (await res.json()) as { text: string }

      const { error: insertErr } = await supabase.from('reviews').insert({
        toilet_id: toilet.id,
        user_id: seedUserId,
        clean: sample.clean,
        smell: sample.smell,
        queue: sample.queue,
        privacy: sample.privacy,
        quick_tags: sample.tags,
        ai_text: text,
        ai_style: style,
        is_ai: true,
        lang,
        nickname: pick(SEED_NICKNAMES),
        is_seed: true,
      })

      if (insertErr) {
        console.error(`  ✗ 写库失败：${insertErr.message}`)
        failed++
        continue
      }

      made++
      // 直接打到终端，方便一口气读完判断好不好笑 —— 这才是跑这个脚本的主要目的
      console.log(`[${style}/${lang}] ${toilet.name}\n  ${text}\n`)
    }
  }

  console.log(`✓ 生成 ${made} 条，失败 ${failed} 条`)
  console.log('  上线前记得清：delete from reviews where is_seed = true;')
}

/** seed 用户复用同一个，反复跑脚本不会攒出一堆僵尸账号。 */
async function ensureSeedUser(supabase: SupabaseClient): Promise<string> {
  const email = 'seed@pooping.local'

  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = list?.users.find((u) => u.email === email)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { nickname: 'seed' },
  })
  if (error || !data.user) throw new Error(`建 seed 用户失败：${error?.message}`)
  return data.user.id
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

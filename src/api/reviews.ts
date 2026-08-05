import { supabase, isSupabaseConfigured } from './client'
import { ensureSession } from './auth'
import {
  ok,
  fail,
  fromThrown,
  type Locale,
  type FeaturedReview,
  type Result,
  type Review,
  type ReviewStyle,
} from './types'

interface ReviewRow {
  id: string
  toilet_id: string
  user_id: string
  clean: number | null
  smell: number | null
  queue: number | null
  privacy: number | null
  quick_tags: string[] | null
  raw_note: string | null
  ai_text: string
  ai_style: string | null
  is_ai: boolean | null
  lang: string | null
  edited_by_user: boolean | null
  is_seed: boolean | null
  nickname: string | null
  funny_up: number | null
  funny_down: number | null
  funny_score: number | null
  funny_vote?: number | null
  created_at: string
}

interface ToiletJoinRow {
  id: string
  name: string
  name_en: string | null
  voted_name: string | null
  building: string | null
  floor: string | null
}

interface FeaturedReviewRow extends ReviewRow {
  toilets: ToiletJoinRow | ToiletJoinRow[] | null
}

function mapReviewRow(r: ReviewRow): Review {
  return {
    id: r.id,
    toiletId: r.toilet_id,
    userId: r.user_id,
    clean: r.clean,
    smell: r.smell,
    queue: r.queue,
    privacy: r.privacy,
    quickTags: r.quick_tags ?? [],
    rawNote: r.raw_note,
    aiText: r.ai_text,
    aiStyle: (r.ai_style as ReviewStyle | null) ?? null,
    isAi: r.is_ai ?? true,
    lang: (r.lang === 'en' ? 'en' : 'zh') as Locale,
    editedByUser: r.edited_by_user ?? false,
    isSeed: r.is_seed ?? false,
    nickname: r.nickname,
    funnyUp: r.funny_up ?? 0,
    funnyDown: r.funny_down ?? 0,
    funnyScore: r.funny_score ?? 0,
    funnyVote: voteValue(r.funny_vote),
    createdAt: r.created_at,
  }
}

const REVIEW_COLUMNS =
  'id,toilet_id,user_id,clean,smell,queue,privacy,quick_tags,raw_note,ai_text,ai_style,is_ai,lang,edited_by_user,is_seed,nickname,funny_up,funny_down,funny_score,created_at'

function voteValue(v: number | null | undefined): -1 | 0 | 1 {
  return v === 1 || v === -1 ? v : 0
}

export async function getReviews(
  toiletId: string,
  limit = 50,
): Promise<Result<Review[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { data, error } = await supabase
      .rpc('toilet_reviews', { p_toilet_id: toiletId, p_limit: limit })

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(((data ?? []) as ReviewRow[]).map(mapReviewRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function getTopReviews(
  limit = 30,
  offset = 0,
): Promise<Result<FeaturedReview[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select(
        `${REVIEW_COLUMNS},toilets!inner(id,name,name_en,voted_name,building,floor,status)`,
      )
      .eq('toilets.status', 'published')
      .order('funny_score', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.max(limit, 1) - 1)

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(
      ((data ?? []) as unknown as FeaturedReviewRow[])
        .map((r) => ({ row: r, toilet: Array.isArray(r.toilets) ? r.toilets[0] : r.toilets }))
        .filter((x): x is { row: FeaturedReviewRow; toilet: ToiletJoinRow } => Boolean(x.toilet))
        .map(({ row, toilet }) => ({
          ...mapReviewRow(row),
          toilet: {
            id: toilet.id,
            name: toilet.name,
            nameEn: toilet.name_en,
            votedName: toilet.voted_name,
            building: toilet.building,
            floor: toilet.floor,
          },
        })),
    )
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

/** 首页用：最近的几条锐评，用来证明"这里有好玩的东西"。 */
export async function getRecentReviews(limit = 20): Promise<Result<Review[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select(REVIEW_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(((data ?? []) as ReviewRow[]).map(mapReviewRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function voteReviewFunny(
  reviewId: string,
  value: -1 | 1,
): Promise<Result<Review | null>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { error } = await supabase.rpc('vote_review_funny', {
      p_review_id: reviewId,
      p_value: value,
    })
    if (error) return fail(error.code || 'db_error', error.message)

    const { data, error: readError } = await supabase
      .rpc('review_by_id', { p_review_id: reviewId })
      .single()
    if (readError) return fail(readError.code || 'db_error', readError.message)
    return ok(data ? mapReviewRow(data as ReviewRow) : null)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

// ------------------------------------------------------------------ 生成

export interface GenerateInput {
  toiletId: string
  clean: number
  smell: number
  queue: number
  privacy: number
  quickTags: string[]
  rawNote?: string
  style: ReviewStyle
  lang: Locale
}

export interface GeneratedReview {
  text: string
  style: ReviewStyle
  lang: Locale
}

/**
 * 调 Edge Function 生成锐评。**只生成，不落库** —— 用户必须先预览、可改，
 * 再走 createReview 发布（CLAUDE.md 10.3）。
 * API key 全程只在 Edge Function 侧，前端拿不到也不需要。
 */
export async function generateReview(
  input: GenerateInput,
): Promise<Result<GeneratedReview>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase.functions.invoke('generate-review', {
      body: {
        toilet_id: input.toiletId,
        clean: input.clean,
        smell: input.smell,
        queue: input.queue,
        privacy: input.privacy,
        quick_tags: input.quickTags,
        raw_note: input.rawNote?.trim() || null,
        style: input.style,
        lang: input.lang,
      },
    })

    if (error) {
      // FunctionsHttpError 把状态码藏在 context 里，限流要单独认出来给用户友好提示
      const ctx = (error as { context?: Response }).context
      if (ctx?.status === 429) {
        return fail('rate_limited', 'too many requests')
      }
      return fail('generate_failed', error.message)
    }

    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    if (!text) return fail('generate_failed', '生成结果为空 / empty generation')

    return ok({ text, style: input.style, lang: input.lang })
  } catch (e) {
    return fromThrown(e, 'generate_failed')
  }
}

// ------------------------------------------------------------------ 发布

export interface CreateReviewInput extends Omit<GenerateInput, 'style'> {
  /** 用户预览后（可能改过）的最终文本，或用户自己写的原文 */
  aiText: string
  /** AI 写的必须给文风；自己写的传 null */
  style: ReviewStyle | null
  /** false = 用户自己写的。数据库有约束保证它和 style 一致 */
  isAi: boolean
  editedByUser: boolean
  nickname?: string | null
}

export async function createReview(
  input: CreateReviewInput,
): Promise<Result<Review>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const text = input.aiText.trim()
  if (!text) return fail('invalid_input', '评价内容不能为空 / review text is empty')

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        toilet_id: input.toiletId,
        user_id: session.data.id,
        clean: input.clean,
        smell: input.smell,
        queue: input.queue,
        privacy: input.privacy,
        quick_tags: input.quickTags,
        raw_note: input.rawNote?.trim() || null,
        ai_text: text.slice(0, 600),
        ai_style: input.isAi ? input.style : null,
        is_ai: input.isAi,
        lang: input.lang,
        edited_by_user: input.editedByUser,
        nickname: input.nickname ?? session.data.nickname,
      })
      .select(REVIEW_COLUMNS)
      .single()

    if (error) {
      // 频率限制触发器抛的是 errcode 54000，消息里带 rate_limited
      if (error.code === '54000' || error.message.includes('rate_limited')) {
        return fail('rate_limited', error.message)
      }
      return fail(error.code || 'db_error', error.message)
    }

    return ok(mapReviewRow(data as ReviewRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function deleteReview(id: string): Promise<Result<true>> {
  try {
    const { error } = await supabase.from('reviews').delete().eq('id', id)
    if (error) return fail(error.code || 'db_error', error.message)
    return ok(true)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

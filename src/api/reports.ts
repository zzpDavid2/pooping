import { supabase, isSupabaseConfigured } from './client'
import { ensureSession } from './auth'
import { ok, fail, fromThrown, type ReportReason, type Result, type ToiletReportReason } from './types'

/**
 * 举报入口。V1 只写表，不做处理流程（CLAUDE.md 第 9 节）。
 * 同一用户对同一条评价只能报一次，重复提交按成功处理 —— 用户不需要知道自己报过了。
 */
export async function reportReview(
  reviewId: string,
  reason: ReportReason,
  note?: string,
): Promise<Result<true>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { error } = await supabase.from('reports').insert({
      review_id: reviewId,
      user_id: session.data.id,
      reason,
      note: note?.trim().slice(0, 500) || null,
    })

    // 23505 = unique_violation，说明已经报过，对用户来说等同于成功
    if (error && error.code !== '23505') {
      return fail(error.code || 'db_error', error.message)
    }
    return ok(true)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

/**
 * 上报"这个厕所点位有问题"（不存在了/关了/其它）。
 * reason 可以不填——用户就是想说"这里不对劲"，不一定说得出具体原因。
 */
export async function reportToilet(
  toiletId: string,
  reason?: ToiletReportReason,
  note?: string,
): Promise<Result<true>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { error } = await supabase.from('toilet_reports').insert({
      toilet_id: toiletId,
      user_id: session.data.id,
      reason: reason ?? null,
      note: note?.trim().slice(0, 500) || null,
    })

    if (error && error.code !== '23505') {
      return fail(error.code || 'db_error', error.message)
    }
    return ok(true)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

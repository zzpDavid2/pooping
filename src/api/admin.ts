import { supabase, isSupabaseConfigured } from './client'
import {
  ok,
  fail,
  fromThrown,
  type Result,
  type ToiletReportReason,
} from './types'

/** 被上报、还没处理的点位。管理端列表用。 */
export interface FlaggedToilet {
  toiletId: string
  name: string
  address: string | null
  source: string | null
  lat: number
  lng: number
  reviewCount: number
  reportCount: number
  reasons: ToiletReportReason[]
  /** 用户在"其它"里写的补充说明 */
  notes: string[]
  lastReportedAt: string
}

interface FlaggedRow {
  toilet_id: string
  toilet_name: string
  address: string | null
  source: string | null
  lat: number
  lng: number
  review_count: number | null
  report_count: number | string | null
  reasons: string[] | null
  notes: string[] | null
  last_reported_at: string
}

/**
 * 我是不是管理员。
 *
 * 出错一律当成"不是"——管理端只是多出来的一块 UI，
 * 拿不到答案时少显示，比错误地显示出来安全。
 * 真正的权限判断在数据库里（每个管理端 RPC 第一句就查 is_admin()）。
 */
export async function getIsAdmin(): Promise<Result<boolean>> {
  if (!isSupabaseConfigured) return ok(false)

  try {
    const { data, error } = await supabase.rpc('is_admin')
    if (error) return ok(false)
    return ok(data === true)
  } catch {
    return ok(false)
  }
}

export async function getFlaggedToilets(): Promise<Result<FlaggedToilet[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  try {
    const { data, error } = await supabase.rpc('admin_flagged_toilets')
    if (error) {
      if (error.message.includes('forbidden')) {
        return fail('forbidden', error.message)
      }
      return fail(error.code || 'db_error', error.message)
    }

    return ok(
      ((data ?? []) as FlaggedRow[]).map((r) => ({
        toiletId: r.toilet_id,
        name: r.toilet_name,
        address: r.address,
        source: r.source,
        lat: r.lat,
        lng: r.lng,
        reviewCount: r.review_count ?? 0,
        reportCount: Number(r.report_count ?? 0),
        reasons: (r.reasons ?? []) as ToiletReportReason[],
        notes: r.notes ?? [],
        lastReportedAt: r.last_reported_at,
      })),
    )
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

/** 把这个点位下所有未处理的上报标记为已处理，返回处理了几条。 */
export async function resolveToiletReports(
  toiletId: string,
): Promise<Result<number>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  try {
    const { data, error } = await supabase.rpc('admin_resolve_toilet_reports', {
      p_toilet_id: toiletId,
    })
    if (error) {
      if (error.message.includes('forbidden')) {
        return fail('forbidden', error.message)
      }
      return fail(error.code || 'db_error', error.message)
    }
    return ok(Number(data ?? 0))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

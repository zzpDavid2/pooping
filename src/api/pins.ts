import { supabase, isSupabaseConfigured } from './client'
import { ensureSession } from './auth'
import { ok, fail, fromThrown, type Result } from './types'

export interface ToiletPin {
  toiletId: string
  pin: string
  note: string | null
  updatedAt: string
}

interface PinRow {
  toilet_id: string
  pin: string
  note: string | null
  updated_at: string
}

function mapRow(r: PinRow): ToiletPin {
  return {
    toiletId: r.toilet_id,
    pin: r.pin,
    note: r.note,
    updatedAt: r.updated_at,
  }
}

/**
 * 用户自己记的门锁密码，**只有本人读得到**（RLS 锁在 auth.uid() 上，见 migration）。
 * 没存过返回 null，不是错误——大多数厕所本来就不需要密码。
 */
export async function getMyPin(toiletId: string): Promise<Result<ToiletPin | null>> {
  if (!isSupabaseConfigured) return ok(null)

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase
      .from('toilet_pins')
      .select('toilet_id,pin,note,updated_at')
      .eq('toilet_id', toiletId)
      .eq('user_id', session.data.id)
      .maybeSingle()

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(data ? mapRow(data as PinRow) : null)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

/**
 * 存密码，也用于改密码——同一个人对同一个厕所只有一条记录（表上有唯一约束），
 * 所以 upsert 一把梭，前端不用区分"第一次存"和"改"。
 */
export async function saveMyPin(
  toiletId: string,
  pin: string,
  note?: string,
): Promise<Result<ToiletPin>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const trimmed = pin.trim()
  if (!trimmed) return fail('invalid_input', '密码不能为空 / pin is empty')

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase
      .from('toilet_pins')
      .upsert(
        {
          toilet_id: toiletId,
          user_id: session.data.id,
          pin: trimmed.slice(0, 40),
          note: note?.trim().slice(0, 200) || null,
        },
        { onConflict: 'toilet_id,user_id' },
      )
      .select('toilet_id,pin,note,updated_at')
      .single()

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(mapRow(data as PinRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function deleteMyPin(toiletId: string): Promise<Result<true>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { error } = await supabase
      .from('toilet_pins')
      .delete()
      .eq('toilet_id', toiletId)
      .eq('user_id', session.data.id)

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(true)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

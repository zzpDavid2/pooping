import { supabase, isSupabaseConfigured } from './client'
import { ensureSession } from './auth'
import {
  ok,
  fail,
  fromThrown,
  type Category,
  type Gender,
  type LatLng,
  type Result,
  type SeatType,
  type Toilet,
  type ToiletFilters,
} from './types'

/** RPC 返回的原始行。字段名是 snake_case，只在本文件里出现。 */
interface ToiletRow {
  id: string
  name: string
  name_en: string | null
  voted_name: string | null
  lat: number
  lng: number
  distance_m?: number | null
  address: string | null
  address_en: string | null
  building: string | null
  floor: string | null
  gender: string | null
  category: string | null
  has_paper: boolean | null
  has_soap: boolean | null
  has_dryer: boolean | null
  has_hook: boolean | null
  accessible: boolean | null
  baby_changing: boolean | null
  seat_type: string | null
  stall_count: number | null
  is_free: boolean | null
  needs_code: boolean | null
  open_24h: boolean | null
  review_count: number | null
  avg_clean: number | string | null
  avg_queue: number | string | null
  avg_smell: number | string | null
  avg_privacy: number | string | null
  source: string | null
  funny_up: number | null
  funny_down: number | null
  funny_score: number | null
  funny_vote?: number | null
  /** 只有 toilet_by_id 会算这个；列表查询里是 undefined */
  can_fix_location?: boolean | null
}

export function mapToiletRow(r: ToiletRow): Toilet {
  return {
    id: r.id,
    name: r.name,
    nameEn: r.name_en,
    votedName: r.voted_name,
    lat: r.lat,
    lng: r.lng,
    distanceM: r.distance_m ?? null,
    address: r.address,
    addressEn: r.address_en,
    building: r.building,
    floor: r.floor,
    gender: (r.gender as Gender | null) ?? null,
    category: (r.category as Category | null) ?? null,
    hasPaper: r.has_paper,
    hasSoap: r.has_soap,
    hasDryer: r.has_dryer,
    hasHook: r.has_hook,
    accessible: r.accessible,
    babyChanging: r.baby_changing,
    seatType: (r.seat_type as SeatType | null) ?? null,
    stallCount: r.stall_count,
    isFree: r.is_free,
    needsCode: r.needs_code,
    open24h: r.open_24h,
    reviewCount: r.review_count ?? 0,
    avgClean: numeric(r.avg_clean),
    avgQueue: numeric(r.avg_queue),
    avgSmell: numeric(r.avg_smell),
    avgPrivacy: numeric(r.avg_privacy),
    source: r.source,
    funnyUp: r.funny_up ?? 0,
    funnyDown: r.funny_down ?? 0,
    funnyScore: r.funny_score ?? 0,
    funnyVote: voteValue(r.funny_vote),
    canFixLocation: r.can_fix_location === true,
  }
}

// Postgres numeric 经 PostgREST 会变成字符串，统一转回 number
function numeric(v: number | string | null): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function voteValue(v: number | null | undefined): -1 | 0 | 1 {
  return v === 1 || v === -1 ? v : 0
}

export interface NearbyOptions extends LatLng {
  /** 米。默认 1500 —— 内急的人走不了更远。 */
  radiusM?: number
  limit?: number
  filters?: ToiletFilters
}

/**
 * 附近厕所，按距离升序。走 PostGIS 的 ST_DWithin + GiST 索引。
 * 传入坐标必须是 WGS-84；地图上如果拿到的是 GCJ-02，先经 src/map/coords.ts 转回来。
 */
export async function getNearbyToilets(
  opts: NearbyOptions,
): Promise<Result<Toilet[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  const { lat, lng, radiusM = 1500, limit = 100, filters = {} } = opts

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail('invalid_input', '坐标无效 / invalid coordinates')
  }

  try {
    const { data, error } = await supabase.rpc('nearby_toilets', {
      p_lat: lat,
      p_lng: lng,
      p_radius: Math.round(radiusM),
      p_limit: limit,
      // 筛选是"或有或无"，只在勾选时才收紧条件；null 表示不筛
      p_has_paper: filters.hasPaper ? true : null,
      p_is_free: filters.isFree ? true : null,
      p_accessible: filters.accessible ? true : null,
      p_seated: filters.seated ? true : null,
    })

    if (error) return fail(error.code || 'db_error', error.message)
    return ok(((data ?? []) as ToiletRow[]).map(mapToiletRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export interface CreateToiletInput extends LatLng {
  name: string
  nameEn?: string | null
  address?: string | null
  category?: Category
}

/**
 * 用户报一个新厕所。
 *
 * 坐标必须是 WGS-84 —— 从地图拿的话用 MapHandle.getCenter()，
 * 它已经把 GCJ-02 转回来了，别自己从底图坐标里读。
 */
export async function createToilet(
  input: CreateToiletInput,
): Promise<Result<string>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const name = input.name.trim()
  if (!name) return fail('invalid_input', '名字不能为空 / name is required')

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase.rpc('create_ugc_toilet', {
      p_name: name,
      p_name_en: input.nameEn?.trim() || null,
      p_lat: input.lat,
      p_lng: input.lng,
      p_address: input.address?.trim() || null,
      p_category: input.category ?? 'public',
    })

    if (error) {
      if (error.code === '54000' || error.message.includes('rate_limited')) {
        return fail('rate_limited', error.message)
      }
      if (error.message.includes('invalid_input')) {
        return fail('invalid_input', error.message)
      }
      return fail(error.code || 'db_error', error.message)
    }

    return ok(String(data))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

/**
 * 修正一个已有点位的坐标。
 *
 * 谁能改由数据库说了算（见 add_location_fix migration）：
 * 管理员谁的都能改，普通用户只能改自己报的、且一次最多挪 3 公里。
 * 这里只负责把数据库那几种拒绝理由翻译成 UI 能挑文案的 code。
 */
export async function fixToiletLocation(
  toiletId: string,
  lat: number,
  lng: number,
): Promise<Result<{ lat: number; lng: number; movedM: number }>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail('invalid_input', '坐标无效 / invalid coordinates')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase.rpc('fix_toilet_location', {
      p_toilet_id: toiletId,
      p_lat: lat,
      p_lng: lng,
    })

    if (error) {
      for (const code of ['forbidden', 'too_far', 'rate_limited', 'not_found', 'invalid_input']) {
        if (error.message.includes(code)) return fail(code, error.message)
      }
      return fail(error.code || 'db_error', error.message)
    }

    const row = ((data ?? []) as Array<{ lat: number; lng: number; moved_m: number }>)[0]
    if (!row) return fail('db_error', '没有返回结果 / no result')

    return ok({ lat: row.lat, lng: row.lng, movedM: row.moved_m })
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function getToiletById(id: string): Promise<Result<Toilet | null>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { data, error } = await supabase.rpc('toilet_by_id', { p_id: id })
    if (error) return fail(error.code || 'db_error', error.message)

    const rows = (data ?? []) as ToiletRow[]
    const first = rows[0]
    return ok(first ? mapToiletRow(first) : null)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function getTopToilets(
  limit = 30,
  offset = 0,
): Promise<Result<Toilet[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { data, error } = await supabase.rpc('top_toilets', {
      p_limit: limit,
      p_offset: offset,
    })
    if (error) return fail(error.code || 'db_error', error.message)
    return ok(((data ?? []) as ToiletRow[]).map(mapToiletRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function voteToiletFunny(
  toiletId: string,
  value: -1 | 1,
): Promise<Result<Toilet | null>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { error } = await supabase.rpc('vote_toilet_funny', {
      p_toilet_id: toiletId,
      p_value: value,
    })
    if (error) return fail(error.code || 'db_error', error.message)
    return getToiletById(toiletId)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

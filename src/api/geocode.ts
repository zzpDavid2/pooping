import { supabase, isSupabaseConfigured } from './client'
import { ensureSession } from './auth'
import { ok, fail, fromThrown, type LatLng, type Result } from './types'
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/map/coords'
import type { Region } from '@/map/region'

export interface GeocodeResult extends LatLng {
  label: string
}

interface RawResult {
  label: string
  lat: number
  lng: number
}

/**
 * 搜地址定位，用来给"报个新厕所"配一个不用挪动人就能选点的入口。
 *
 * `near` 是当前地图中心（WGS-84），用来让搜索结果按"离这儿近不近"排序 ——
 * 同名地点全国到处都是，没有这个参考点，搜"人民广场"会随缘蹦出几千公里外的重名地方。
 *
 * 国内走高德，输入输出都是 GCJ-02 —— 这里做双向转换，调用方（地图适配器的 moveTo）
 * 全程只处理 WGS-84，不用关心坐标系，跟 getCenter() 的约定一致。
 */
export async function searchAddress(
  query: string,
  region: Region,
  near: LatLng | null,
): Promise<Result<GeocodeResult[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const trimmed = query.trim()
  if (!trimmed) return ok([])

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase.functions.invoke('geocode-address', {
      body: {
        query: trimmed,
        region,
        near: near && region === 'cn' ? wgs84ToGcj02(near) : near,
      },
    })
    if (error) return fromThrown(error)

    const raw = (data?.results ?? []) as RawResult[]
    return ok(
      raw.map((r) => ({
        label: r.label,
        ...(region === 'cn' ? gcj02ToWgs84({ lat: r.lat, lng: r.lng }) : { lat: r.lat, lng: r.lng }),
      })),
    )
  } catch (e) {
    return fromThrown(e)
  }
}

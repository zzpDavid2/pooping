import type { Toilet } from '@/api/types'
import { distanceMeters } from '@/map/coords'
import type { LatLng } from '@/api/types'

/**
 * 首屏静态化（CLAUDE.md 8.3）。
 *
 * Supabase 在新加坡，国内到那儿 200ms 起步，慢的时候 1s+。首屏不等它：
 * 构建时把首发城市的点位烤成一个 JSON，和站点一起走 CDN，打开就有东西看，
 * 真实数据到了再无感替换。
 *
 * 文件由 `pnpm prebuild:static` 生成；没有这个文件时静默降级成纯 API 模式。
 */

export interface BootstrapPayload {
  generatedAt: string
  city: string
  toilets: Toilet[]
}

let cache: Promise<BootstrapPayload | null> | null = null

export function loadBootstrap(): Promise<BootstrapPayload | null> {
  if (cache) return cache

  cache = fetch(`${import.meta.env.BASE_URL}data/bootstrap.json`, { cache: 'force-cache' })
    .then((res) => (res.ok ? (res.json() as Promise<BootstrapPayload>) : null))
    .then((payload) => {
      if (!payload || !Array.isArray(payload.toilets)) return null
      return payload
    })
    .catch(() => null) // 没生成过就是没有，不是错误

  return cache
}

/** 静态数据没有 distance_m，本地按当前位置算一遍再排序。 */
export function withDistance(toilets: Toilet[], from: LatLng | null): Toilet[] {
  if (!from) return toilets
  return toilets
    .map((t) => ({ ...t, distanceM: distanceMeters(from, t) }))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))
}

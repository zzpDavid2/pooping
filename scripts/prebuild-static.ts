/**
 * 首屏静态化（CLAUDE.md 8.3）。
 *
 *   pnpm prebuild:static -- --city=beijing --radius=8000
 *
 * 把首发城市的点位在构建时烤成 public/data/bootstrap.json，和站点一起走 CDN。
 * Supabase 在新加坡，国内到那儿 200ms 起步 —— 首屏不该等它。
 *
 * 没跑过这个脚本也不影响：前端读不到文件就静默降级成纯 API 模式。
 */

import './env.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  beijing: { lat: 39.9042, lng: 116.4074 },
  shanghai: { lat: 31.2304, lng: 121.4737 },
  portland: { lat: 45.5152, lng: -122.6784 },
}

function arg(name: string, fallback: string): string {
  return (
    process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
  )
}

async function main(): Promise<void> {
  const city = arg('city', 'beijing')
  const radius = Number(arg('radius', '8000'))
  const center = CITY_CENTERS[city]
  if (!center) {
    throw new Error(`未知城市 ${city}，可选：${Object.keys(CITY_CENTERS).join(', ')}`)
  }

  // 只读，用 anon key 就够；service_role 不该出现在构建流程里
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.warn('⚠ 没配 Supabase，跳过静态预生成（前端会降级成纯 API 模式）')
    return
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('nearby_toilets', {
    p_lat: center.lat,
    p_lng: center.lng,
    p_radius: radius,
    p_limit: 300,
    p_has_paper: null,
    p_is_free: null,
    p_accessible: null,
    p_seated: null,
  })

  if (error) throw new Error(`查询失败：${error.message}`)

  // 直接写成前端的 camelCase 形状，省掉运行时一次映射
  const toilets = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    nameEn: r.name_en,
    votedName: r.voted_name,
    lat: r.lat,
    lng: r.lng,
    distanceM: null,
    address: r.address,
    addressEn: r.address_en,
    building: r.building,
    floor: r.floor,
    gender: r.gender,
    category: r.category,
    hasPaper: r.has_paper,
    hasSoap: r.has_soap,
    hasDryer: r.has_dryer,
    hasHook: r.has_hook,
    accessible: r.accessible,
    babyChanging: r.baby_changing,
    seatType: r.seat_type,
    stallCount: r.stall_count,
    isFree: r.is_free,
    needsCode: r.needs_code,
    open24h: r.open_24h,
    reviewCount: r.review_count ?? 0,
    avgClean: r.avg_clean === null ? null : Number(r.avg_clean),
    avgQueue: r.avg_queue === null ? null : Number(r.avg_queue),
    avgSmell: r.avg_smell === null ? null : Number(r.avg_smell),
    avgPrivacy: r.avg_privacy === null ? null : Number(r.avg_privacy),
    source: r.source,
    funnyUp: r.funny_up ?? 0,
    funnyDown: r.funny_down ?? 0,
    funnyScore: r.funny_score ?? 0,
    funnyVote: 0,
  }))

  const outPath = resolve(ROOT, 'public/data/bootstrap.json')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), city, toilets }),
  )

  console.log(`✓ ${toilets.length} 个点位写入 public/data/bootstrap.json（${city}）`)
}

// 这一步是锦上添花：拿不到数据就退回纯 API 模式，绝不让它把整个构建拖挂。
// 没网、没配 env、DB 没起，都不该是"发不了版"的理由。
main().catch((e) => {
  console.warn(`⚠ 静态预生成跳过：${e instanceof Error ? e.message : e}`)
  process.exit(0)
})

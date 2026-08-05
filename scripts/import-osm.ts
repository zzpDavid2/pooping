/**
 * 从 OpenStreetMap 导入厕所点位（CLAUDE.md 第 6 节）。
 *
 *   pnpm import:osm -- --city=beijing
 *   pnpm import:osm -- --bbox=39.80,116.25,40.02,116.55
 *
 * ODbL 协议，标注来源即可使用 —— 库里 source='osm'，UI 上会带 OSM 署名。
 * 用 osm_id 唯一索引做幂等，重复跑不会产生脏数据。
 */

import './env.ts'
import { createClient } from '@supabase/supabase-js'

interface Bbox {
  south: number
  west: number
  north: number
  east: number
}

/**
 * 首发区域。密度 > 覆盖：先把一个区域做透，再谈下一个。
 * 现阶段先跑国内版（在北京/上海实测），所以这两个城市排在前面。
 */
const CITIES: Record<string, Bbox> = {
  beijing: { south: 39.78, west: 116.20, north: 40.03, east: 116.58 },
  shanghai: { south: 31.13, west: 121.36, north: 31.33, east: 121.60 },
  // Reed College 校园 + Portland 市中心
  portland: { south: 45.45, west: -122.8, north: 45.65, east: -122.5 },
  reed: { south: 45.475, west: -122.638, north: 45.487, east: -122.625 },
}

/**
 * Overpass 镜像，按顺序试。
 *
 * 主实例经常 429/504（全球公共资源，本来就挤），单点必然翻车。
 * kumi 通常最快；osm.jp 在亚洲延迟低，从国内跑这个脚本时往往是它救场。
 * 设 OVERPASS_URL 可以强制只用某一个。
 */
const OVERPASS_MIRRORS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
      'https://overpass.osm.jp/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ]

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function parseArgs(): { bbox: Bbox; label: string } {
  const args = process.argv.slice(2)
  const get = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

  const bboxArg = get('bbox')
  if (bboxArg) {
    const parts = bboxArg.split(',').map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error('--bbox 格式：south,west,north,east')
    }
    const [south, west, north, east] = parts as [number, number, number, number]
    return { bbox: { south, west, north, east }, label: bboxArg }
  }

  const city = get('city') ?? 'beijing'
  const bbox = CITIES[city]
  if (!bbox) {
    throw new Error(`未知城市 ${city}，可选：${Object.keys(CITIES).join(', ')}`)
  }
  return { bbox, label: city }
}

/**
 * node / way / relation 的 id 各自独立编号，会撞车。
 * 加个前缀塞进同一个 bigint 里，保证 osm_id 全局唯一。
 */
function compositeOsmId(el: OsmElement): number {
  const offset = el.type === 'node' ? 0 : el.type === 'way' ? 1e12 : 2e12
  return offset + el.id
}

function coordsOf(el: OsmElement): { lat: number; lng: number } | null {
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  return { lat, lng: lon }
}

// 三态：yes → true，no → false，没标注 → null（不能当成 false，见 FacilityWall 的注释）
function tri(v: string | undefined, yes = 'yes', no = 'no'): boolean | null {
  if (v === undefined) return null
  if (v === yes) return true
  if (v === no) return false
  return null
}

function mapGender(tags: Record<string, string>): string | null {
  if (tags['unisex'] === 'yes') return 'unisex'
  const male = tags['male'] === 'yes'
  const female = tags['female'] === 'yes'
  if (male && female) return 'both'
  if (male) return 'male'
  if (female) return 'female'
  return null
}

function mapSeatType(tags: Record<string, string>): string | null {
  const pos = tags['toilets:position']
  if (!pos) return null
  const hasSeated = pos.includes('seated')
  const hasSquat = pos.includes('squat')
  if (hasSeated && hasSquat) return 'both'
  if (hasSeated) return 'seated'
  if (hasSquat) return 'squat'
  return null
}

function mapCategory(tags: Record<string, string>): string {
  const access = tags['access']
  if (access === 'customers') return 'restaurant'
  if (tags['building'] || tags['indoor'] === 'yes') return 'other'
  return 'public'
}

/**
 * 名字。
 *
 * 实测北京 207 个采样点里只有 14% 带 name，11% 带 operator，9% 带 ref。
 * 也就是说**绝大多数厕所在 OSM 上根本没有名字**，导入后列表会是一整屏「公共厕所」。
 *
 * 这不是 bug，是数据现状。能区分它们的是距离和评价 —— 而评价正是这个产品的护城河。
 * 这里只做力所能及的事：有 ref（公厕编号）或 operator 就拼上去，多少能分出个前后。
 */
function buildName(
  tags: Record<string, string>,
): { name: string; nameEn: string | null } {
  const zh = (tags['name:zh'] ?? tags['name'])?.trim()
  const en = tags['name:en']?.trim()

  if (zh || en) {
    return { name: zh || en!, nameEn: en || null }
  }

  // 没名字：用管理方兜底。ref 多数是十几位的政府编号，
  // 「公共厕所 101102101094」比「公共厕所」更难读，所以只收短编号。
  const operator = tags['operator']?.trim()
  const ref = tags['ref']?.trim()
  const hint = operator || (ref && ref.length <= 6 ? ref : '')

  return {
    name: hint ? `公共厕所（${hint}）` : '公共厕所',
    nameEn: hint ? `Public toilet (${hint})` : 'Public toilet',
  }
}

async function fetchOverpass(bbox: Bbox): Promise<OsmElement[]> {
  const { south, west, north, east } = bbox
  const area = `${south},${west},${north},${east}`

  // way / relation 也要：不少厕所是按面画的，只查 node 会漏掉一大半
  const query = `[out:json][timeout:90];
(
  node["amenity"="toilets"](${area});
  way["amenity"="toilets"](${area});
  relation["amenity"="toilets"](${area});
);
out center tags;`

  console.log(`→ Overpass 查询 ${area}`)

  let lastError = ''
  for (const mirror of OVERPASS_MIRRORS) {
    const host = new URL(mirror).host
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // Overpass 对没有 User-Agent 的请求直接回 406。
          // OSM 的使用规范也要求脚本表明身份并留联系方式。
          'user-agent': 'pooping-import/0.1 (+https://pooping.me)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      })

      if (!res.ok) {
        // 429 = 排队中，504 = 超时，都是"这台忙"，换一台就好
        lastError = `${host} → ${res.status}`
        console.log(`  ${lastError}，换下一个镜像`)
        continue
      }

      const json = (await res.json()) as { elements?: OsmElement[] }
      console.log(`  ${host} ✓`)
      return json.elements ?? []
    } catch (e) {
      lastError = `${host} → ${e instanceof Error ? e.message : String(e)}`
      console.log(`  ${lastError}，换下一个镜像`)
    }
  }

  throw new Error(
    `所有 Overpass 镜像都失败了（最后一个：${lastError}）。\n` +
      `  Overpass 是公共资源，忙起来很正常，过几分钟再试。\n` +
      `  也可以用 OVERPASS_URL 指定自己的实例。`,
  )
}

async function main(): Promise<void> {
  const { bbox, label } = parseArgs()

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，先照着 .env.example 配 .env.local')
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const elements = await fetchOverpass(bbox)
  console.log(`← 拿到 ${elements.length} 个元素`)

  let imported = 0
  let skipped = 0

  for (const el of elements) {
    const coords = coordsOf(el)
    if (!coords) {
      skipped++
      continue
    }

    const tags = el.tags ?? {}
    const { name, nameEn } = buildName(tags)

    const { error } = await supabase.rpc('upsert_osm_toilet', {
      p_osm_id: compositeOsmId(el),
      p_name: name,
      p_name_en: nameEn,
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_address:
        [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null,
      p_gender: mapGender(tags),
      p_category: mapCategory(tags),
      p_has_paper: tri(tags['toilets:paper_supplied']),
      p_has_soap: tri(tags['toilets:soap']),
      p_has_dryer: tri(tags['toilets:hand_drying']),
      p_accessible: tri(tags['wheelchair']),
      p_baby_changing: tri(tags['changing_table']),
      p_seat_type: mapSeatType(tags),
      p_is_free: tags['fee'] === undefined ? null : tags['fee'] === 'no',
      p_needs_code: tags['access'] === 'customers' ? true : null,
      p_open_24h: tags['opening_hours'] === '24/7' ? true : null,
    })

    if (error) {
      console.error(`  ✗ ${el.type}/${el.id}: ${error.message}`)
      skipped++
      continue
    }
    imported++
  }

  console.log(`\n✓ ${label}: 导入 ${imported} 个，跳过 ${skipped} 个`)
  if (imported === 0) {
    console.log('  一个都没进？先确认 migrations 跑过了（pnpm db:reset）')
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

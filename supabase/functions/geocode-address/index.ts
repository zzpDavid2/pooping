/**
 * geocode-address —— 唯一调地理编码服务的地方。
 *
 * 国内走高德"输入提示"接口（不是纯地理编码 geocode/geo）：
 * 后者是给"我已经知道完整地址，转成坐标"用的，同名地点满中国都是，
 * 不带位置偏好就会随缘搜出几千公里外的重名地方。
 * 输入提示专门给"搜索框边打字边联想"场景设计，支持传一个参考坐标（当前地图中心）
 * 让结果按"离这儿近不近"排序，才是我们要的效果。
 *
 * key 只存在这儿的环境变量里，绝不进前端（CLAUDE.md 第 7 节同款规则）。
 * 高德返回的坐标是 GCJ-02，这个函数原样透传 —— WGS-84 转换交给前端 src/map/coords.ts，
 * 那是坐标转换的唯一出口，不在这儿重复一份转换算法。
 *
 * 没有自己校验 JWT：config.toml 里没覆盖这个函数，走 Supabase 默认的 verify_jwt = true，
 * 网关会挡掉未登录的请求，不用像 generate-review 那样手动写一遍。
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

interface GeocodeResult {
  label: string
  lat: number
  lng: number
}

interface AmapTip {
  name: string
  district: string
  address: string
  location: string // "lng,lat"，纯行政区建议时可能是空字符串
}

async function geocodeCn(query: string, near: { lat: number; lng: number } | null): Promise<GeocodeResult[]> {
  const key = Deno.env.get('AMAP_GEOCODE_KEY')
  if (!key) throw new Error('missing_amap_key')

  const params = new URLSearchParams({ keywords: query, key })
  if (near) params.set('location', `${near.lng},${near.lat}`)

  const url = `https://restapi.amap.com/v3/assistant/inputtips?${params}`
  const res = await fetch(url)
  const body = (await res.json()) as { status: string; tips?: AmapTip[] }

  if (body.status !== '1') return []

  return (body.tips ?? [])
    .filter((t) => t.location) // 没有坐标的纯行政区建议，我们放不了图钉，过滤掉
    .slice(0, 5)
    .map((t) => {
      const [lng, lat] = t.location.split(',').map(Number)
      const label = [t.name, t.district].filter(Boolean).join(' · ')
      return { label, lat, lng }
    })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : ''
  if (!query) return json({ error: 'missing_query' }, 400)

  const region = body.region === 'intl' ? 'intl' : 'cn'
  if (region === 'intl') {
    // 海外地理编码还没接（当前阶段先做国内测试，见 README）。
    // 以后要补的话接 MapTiler Geocoding，只加一个分支，接口形状不用变。
    return json({ error: 'region_not_supported' }, 400)
  }

  const nearBody = body.near as { lat?: unknown; lng?: unknown } | undefined
  const near =
    nearBody && typeof nearBody.lat === 'number' && typeof nearBody.lng === 'number'
      ? { lat: nearBody.lat, lng: nearBody.lng }
      : null

  try {
    const results = await geocodeCn(query, near)
    return json({ results })
  } catch (e) {
    console.error('geocode-address failed:', e)
    return json({ error: 'geocode_failed' }, 502)
  }
})

import type { LatLng } from '@/api/types'

/**
 * 地区决定两件事：用哪家瓦片、要不要做 GCJ-02 偏移。
 * 只有这两件事 —— 不要往这里塞业务判断。
 */
export type Region = 'cn' | 'intl'

const STORAGE_KEY = 'pooping.region'

/** 各城市默认落点（WGS-84）。定位失败时地图落在这儿，而不是大西洋 0,0。 */
export const CITY_CENTERS = {
  beijing: { lat: 39.9042, lng: 116.4074 },
  shanghai: { lat: 31.2304, lng: 121.4737 },
  portland: { lat: 45.5152, lng: -122.6784 },
} as const satisfies Record<string, LatLng>

export type CityKey = keyof typeof CITY_CENTERS

function readOverride(): Region | null {
  if (typeof window === 'undefined') return null

  // ?region=cn 优先，方便在真机上直接切换验证，不用改代码重新部署
  const fromUrl = new URLSearchParams(window.location.search).get('region')
  if (fromUrl === 'cn' || fromUrl === 'intl') {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromUrl)
    } catch {
      /* 隐私模式下 localStorage 会抛，忽略 */
    }
    return fromUrl
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'cn' || saved === 'intl') return saved
  } catch {
    /* 同上 */
  }
  return null
}

/** 没有覆盖值时的猜测。故意保守：宁可猜错成 cn，也不要在国内加载境外矢量瓦片。 */
function guessRegion(): Region {
  if (typeof window === 'undefined') return 'cn'
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    if (tz === 'Asia/Shanghai' || tz === 'Asia/Chongqing' || tz === 'Asia/Urumqi') {
      return 'cn'
    }
    if (tz) return 'intl'
  } catch {
    /* 老浏览器没有 Intl.DateTimeFormat().resolvedOptions() */
  }
  return navigator.language?.toLowerCase().startsWith('zh-cn') ? 'cn' : 'intl'
}

export function resolveRegion(): Region {
  const override = readOverride()
  if (override) return override

  const fromEnv = import.meta.env.VITE_DEFAULT_REGION?.trim()
  if (fromEnv === 'cn' || fromEnv === 'intl') return fromEnv

  return guessRegion()
}

export function setRegion(region: Region): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, region)
  } catch {
    /* 忽略 */
  }
}

/** cn 用高德瓦片，底图是 GCJ-02，撒点前必须偏移。 */
export function regionNeedsGcjShift(region: Region): boolean {
  return region === 'cn'
}

export function defaultCenterFor(region: Region): LatLng {
  return region === 'cn' ? CITY_CENTERS.beijing : CITY_CENTERS.portland
}

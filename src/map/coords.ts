import type { LatLng } from '@/api/types'

/**
 * 坐标系转换。
 *
 * 数据库里**永远**只存 WGS-84（CLAUDE.md 第 4 节）。
 * 高德/腾讯的瓦片画的是 GCJ-02，直接把 WGS-84 的点撒上去，在北京上海会偏 300–600 米，
 * 足以把你导到马路对面那栋楼。所以偏移只在这一层、只在渲染时做。
 */

const PI = Math.PI
const A = 6378245.0 // 克拉索夫斯基椭球长半轴
const EE = 0.006_693_421_622_965_943 // 第一偏心率平方

/** 粗略国界盒。国外坐标 GCJ-02 与 WGS-84 相同，不做偏移。 */
export function outOfChina({ lat, lng }: LatLng): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

/** WGS-84 → GCJ-02（火星坐标）。用于把库里的点画到高德瓦片上。 */
export function wgs84ToGcj02(p: LatLng): LatLng {
  if (outOfChina(p)) return { ...p }

  const dLatRaw = transformLat(p.lng - 105.0, p.lat - 35.0)
  const dLngRaw = transformLng(p.lng - 105.0, p.lat - 35.0)

  const radLat = (p.lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)

  const dLat = (dLatRaw * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  const dLng = (dLngRaw * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)

  return { lat: p.lat + dLat, lng: p.lng + dLng }
}

/**
 * GCJ-02 → WGS-84。用于把用户在高德底图上点的位置换回可入库的真实坐标。
 *
 * 正变换没有解析逆，用迭代逼近：每轮把误差折回去，3 轮已经到厘米级，
 * 比"直接减一次偏移量"的常见写法准一个数量级。
 */
export function gcj02ToWgs84(p: LatLng): LatLng {
  if (outOfChina(p)) return { ...p }

  let guess: LatLng = { ...p }
  for (let i = 0; i < 3; i++) {
    const shifted = wgs84ToGcj02(guess)
    guess = {
      lat: guess.lat + (p.lat - shifted.lat),
      lng: guess.lng + (p.lng - shifted.lng),
    }
  }
  return guess
}

/** 两点球面距离，米。Haversine，够用了。 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * PI) / 180
  const dLng = ((b.lng - a.lng) * PI) / 180
  const lat1 = (a.lat * PI) / 180
  const lat2 = (b.lat * PI) / 180

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

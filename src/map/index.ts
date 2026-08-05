/**
 * 地图层的桶文件。
 *
 * ⚠️ **只有懒加载的模块能 import 这里**（目前是 src/components/MapView.tsx）。
 *
 * 这个文件 re-export 了 adapter，而 adapter 静态引用 maplibre-gl（~800KB）。
 * 任何在首屏就被加载的模块只要 `from '@/map'`，哪怕只取一个 resolveRegion，
 * 打包时也会把整个地图库拽进入口 chunk —— 首屏白等 218KB(gzip)。
 *
 * 首屏要用坐标/地区工具，直接引具体文件：
 *   import { resolveRegion } from '@/map/region'
 *   import { distanceMeters } from '@/map/coords'
 *   import type { MapHandle } from '@/map/adapter'   // 纯类型，编译后会被抹掉，安全
 */
export { createMap, type MapHandle, type MapMarker, type CreateMapOptions } from './adapter'
export { tileConfigFor, hasIntlTiles, type TileConfig } from './tiles'
export {
  resolveRegion,
  setRegion,
  regionNeedsGcjShift,
  defaultCenterFor,
  CITY_CENTERS,
  type Region,
  type CityKey,
} from './region'
export { wgs84ToGcj02, gcj02ToWgs84, distanceMeters, outOfChina } from './coords'

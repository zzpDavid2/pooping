import type { StyleSpecification } from 'maplibre-gl'
import type { Region } from './region'

/**
 * 瓦片源。**换底图只改这个文件**（CLAUDE.md 3.2 / 8.2）。
 *
 * 国内用高德栅格：矢量瓦片从境外拉到国内会明显卡，这是国内体感最差的一环。
 * 栅格瓦片单张几十 KB、CDN 在境内，且能被 service worker 缓存住（见 vite.config.ts）。
 */

const AMAP_SUBDOMAINS = ['webrd01', 'webrd02', 'webrd03', 'webrd04']

// style=8 是路网+注记的简版底图，比默认样式干净，也更省流量
function amapTiles(lang: 'zh_cn' | 'en'): string[] {
  const override = import.meta.env.VITE_AMAP_TILE_URL?.trim()
  if (override) return [override]

  return AMAP_SUBDOMAINS.map(
    (sub) =>
      `https://${sub}.is.autonavi.com/appmaptile?lang=${lang}&size=1&scale=1&style=8&x={x}&y={y}&z={z}`,
  )
}

const AMAP_ATTRIBUTION = '&copy; 高德地图 AutoNavi'
const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors'

function rasterStyle(tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    // 字形/雪碧图都指向外部会违反 3.3 铁律，栅格底图不需要它们，直接省掉
    sources: {
      base: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution,
        maxzoom: 18,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f3f0ec' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 1 } },
    ],
  }
}

/**
 * 海外默认底图：CARTO Voyager 栅格，**不需要 key**。
 *
 * 之前没配 key 时给的是一张空底图，结果就是海外版打开一片白 —— 那不叫降级，那叫坏了。
 * 底图必须默认就有。要换自己的（Protomaps / MapTiler / 自建）就填 env，见下面。
 */
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd']

function cartoTiles(): string[] {
  return CARTO_SUBDOMAINS.map(
    (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`,
  )
}

function intlStyle(): StyleSpecification {
  // 自建/自选瓦片优先，URL 整个走 env（8.5），代码里不写死任何服务商
  const custom = import.meta.env.VITE_TILE_URL_INTL?.trim()
  if (custom) {
    return rasterStyle([custom], import.meta.env.VITE_TILE_ATTRIBUTION ?? OSM_ATTRIBUTION)
  }

  const maptilerKey = import.meta.env.VITE_MAPTILER_KEY?.trim()
  if (maptilerKey) {
    return rasterStyle(
      [`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`],
      '&copy; MapTiler &copy; OpenStreetMap contributors',
    )
  }

  return rasterStyle(cartoTiles(), `&copy; CARTO ${OSM_ATTRIBUTION}`)
}

export interface TileConfig {
  style: StyleSpecification
  /** 底图坐标系是不是 GCJ-02 —— 决定撒点前要不要偏移 */
  gcj02: boolean
  maxZoom: number
  attributionText: string
}

export function tileConfigFor(region: Region, lang: 'zh' | 'en'): TileConfig {
  if (region === 'cn') {
    return {
      style: rasterStyle(amapTiles(lang === 'en' ? 'en' : 'zh_cn'), AMAP_ATTRIBUTION),
      gcj02: true,
      maxZoom: 18,
      attributionText: '高德地图 AutoNavi',
    }
  }

  return {
    style: intlStyle(),
    gcj02: false,
    maxZoom: 19,
    attributionText: 'OpenStreetMap',
  }
}

/**
 * 海外底图永远有（默认走 CARTO，不需要 key），所以这里恒为 true。
 * 保留这个函数是因为 UI 还在用它决定要不要提示；等确定不再需要提示了可以一起删。
 */
export function hasIntlTiles(): boolean {
  return true
}

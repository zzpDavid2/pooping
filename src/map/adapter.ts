import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { LatLng } from '@/api/types'
import { COLORS, PIN, SELECTED, USER_DOT, radiusExpression } from '@/constants/mapStyle'
import { distanceMeters, gcj02ToWgs84, wgs84ToGcj02 } from './coords'
import { tileConfigFor } from './tiles'
import type { Region } from './region'

/**
 * MapLibre 的唯一出口（CLAUDE.md 3.2）。组件不 import maplibre-gl。
 *
 * 对外的坐标**一律是 WGS-84**。GCJ-02 偏移完全封在这层里。
 *
 * 点位用 GeoJSON 图层画，不用 DOM Marker —— DOM Marker 是每帧渲染后用 CSS 摆位置的，
 * 拖动时永远慢底图半拍。图层由 GPU 和底图同帧画完，跟手。
 *
 * **外观参数不在这个文件里**，全在 src/constants/mapStyle.ts，那里有调整指引。
 */

export interface MapMarker extends LatLng {
  id: string
  reviewCount: number
}

export interface CreateMapOptions {
  container: HTMLElement
  region: Region
  lang: 'zh' | 'en'
  center: LatLng
  zoom?: number
  onSelectMarker?: (id: string) => void
  onMoveEnd?: (center: LatLng, zoom: number, radiusM: number) => void
}

export interface MapHandle {
  setMarkers(markers: MapMarker[]): void
  setSelected(id: string | null): void
  setUserLocation(p: LatLng | null): void
  setPadding(padding: { top?: number; right?: number; bottom?: number; left?: number }): void
  moveTo(p: LatLng, zoom?: number): void
  fitBounds(points: LatLng[], paddingPx?: number): void
  getCenter(): LatLng
  getZoom(): number
  /** 当前视野半径（米）：中心到视口角落的距离。查询半径要跟着它走。 */
  getRadiusMeters(): number
  resize(): void
  destroy(): void
}

const SRC_TOILETS = 'pooping-toilets'
const SRC_USER = 'pooping-user'
const LAYER_DOT = 'pooping-toilet-dot'
const LAYER_SELECTED_HALO = 'pooping-toilet-selected-halo'
const LAYER_SELECTED_ICON = 'pooping-toilet-selected-icon'
const IMG_SELECTED = 'pooping-selected-icon'

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

/**
 * 把 emoji 画成一张位图给 symbol 图层用。
 *
 * 为什么不用 text-field 直接写字：那需要 style 里配 glyphs（字体服务器），
 * 是个外部请求，违反 3.3 铁律。icon-image 走本地生成的位图，零请求。
 */
function makeEmojiIcon(ratio = 2): { width: number; height: number; data: Uint8Array } | null {
  const box = Math.ceil((SELECTED.discRadius + 3) * 2 * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = box
  canvas.height = box
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const c = box / 2

  ctx.beginPath()
  ctx.arc(c, c, SELECTED.discRadius * ratio, 0, Math.PI * 2)
  ctx.fillStyle = SELECTED.discColor
  ctx.fill()
  ctx.lineWidth = SELECTED.haloWidth * ratio
  ctx.strokeStyle = COLORS.rated
  ctx.stroke()

  ctx.font = `${SELECTED.sizePx * ratio}px ${EMOJI_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(SELECTED.emoji, c, c + ratio)

  const img = ctx.getImageData(0, 0, box, box)
  return { width: box, height: box, data: new Uint8Array(img.data.buffer) }
}

function toFeatureCollection(
  markers: MapMarker[],
  project: (p: LatLng) => LatLng,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => {
      const p = project(m)
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { id: m.id, rated: m.reviewCount > 0 ? 1 : 0 },
      }
    }),
  }
}

function pointCollection(
  p: LatLng | null,
  project: (q: LatLng) => LatLng,
): GeoJSON.FeatureCollection {
  if (!p) return { type: 'FeatureCollection', features: [] }
  const q = project(p)
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [q.lng, q.lat] }, properties: {} },
    ],
  }
}

export function createMap(opts: CreateMapOptions): MapHandle {
  const tiles = tileConfigFor(opts.region, opts.lang)

  const toDisplay = (p: LatLng): LatLng => (tiles.gcj02 ? wgs84ToGcj02(p) : p)
  const toWgs = (p: LatLng): LatLng => (tiles.gcj02 ? gcj02ToWgs84(p) : p)

  const start = toDisplay(opts.center)

  const map: MlMap = new maplibregl.Map({
    container: opts.container,
    style: tiles.style,
    center: [start.lng, start.lat],
    zoom: opts.zoom ?? 15,
    maxZoom: tiles.maxZoom,
    attributionControl: false,
    fadeDuration: 120,
    dragRotate: false,
    pitchWithRotate: false,
  })

  map.touchZoomRotate.disableRotation()
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false, showZoom: true }),
    'bottom-right',
  )

  let ready = false
  let destroyed = false
  let selectedId: string | null = null
  let pendingToilets: MapMarker[] = []
  let pendingUser: LatLng | null = null
  let cameraPadding = { top: 0, right: 0, bottom: 0, left: 0 }

  function radiusMeters(): number {
    const b = map.getBounds()
    const c = map.getCenter()
    return distanceMeters(
      toWgs({ lat: c.lat, lng: c.lng }),
      toWgs({ lat: b.getNorth(), lng: b.getEast() }),
    )
  }

  map.on('load', () => {
    if (destroyed) return

    map.addSource(SRC_TOILETS, {
      type: 'geojson',
      data: toFeatureCollection(pendingToilets, toDisplay),
    })
    map.addSource(SRC_USER, { type: 'geojson', data: pointCollection(pendingUser, toDisplay) })

    const icon = makeEmojiIcon()
    if (icon && !map.hasImage(IMG_SELECTED)) {
      map.addImage(IMG_SELECTED, icon, { pixelRatio: 2 })
    }

    map.addLayer({
      id: LAYER_DOT,
      type: 'circle',
      source: SRC_TOILETS,
      paint: {
        'circle-radius': radiusExpression(PIN.bare.radius, PIN.rated.radius) as never,
        'circle-color': ['case', ['==', ['get', 'rated'], 1], COLORS.rated, COLORS.bare],
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'rated'], 1],
          PIN.rated.strokeWidth,
          PIN.bare.strokeWidth,
        ] as never,
        'circle-stroke-color': COLORS.stroke,
      },
    })

    map.addLayer({
      id: LAYER_SELECTED_HALO,
      type: 'circle',
      source: SRC_TOILETS,
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-radius': SELECTED.discRadius + 6,
        'circle-color': COLORS.selectedHalo,
      },
    })

    // 选中的点盖一个 🚽（可在 mapStyle.ts 里换）
    map.addLayer({
      id: LAYER_SELECTED_ICON,
      type: 'symbol',
      source: SRC_TOILETS,
      filter: ['==', ['get', 'id'], ''],
      layout: {
        'icon-image': IMG_SELECTED,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })

    map.addLayer({
      id: 'pooping-user-halo',
      type: 'circle',
      source: SRC_USER,
      paint: { 'circle-radius': USER_DOT.haloRadius, 'circle-color': COLORS.userHalo },
    })
    map.addLayer({
      id: 'pooping-user-dot',
      type: 'circle',
      source: SRC_USER,
      paint: {
        'circle-radius': USER_DOT.radius,
        'circle-color': COLORS.userDot,
        'circle-stroke-width': USER_DOT.strokeWidth,
        'circle-stroke-color': COLORS.stroke,
      },
    })

    ready = true
    applySelected()

    // 用带容差的框去查，而不是 map.on('click', layer) 的精确命中 ——
    // 手指戳不准，容差在 mapStyle.ts 的 PIN.hitSlopPx
    map.on('click', (e) => {
      const s = PIN.hitSlopPx
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - s, e.point.y - s],
          [e.point.x + s, e.point.y + s],
        ],
        { layers: [LAYER_DOT] },
      )
      const id = feats[0]?.properties?.['id']
      if (typeof id === 'string') opts.onSelectMarker?.(id)
    })

    map.on('mousemove', (e) => {
      const s = PIN.hitSlopPx
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - s, e.point.y - s],
          [e.point.x + s, e.point.y + s],
        ],
        { layers: [LAYER_DOT] },
      )
      map.getCanvas().style.cursor = feats.length > 0 ? 'pointer' : ''
    })
  })

  function applySelected(): void {
    if (!ready) return
    const filter = ['==', ['get', 'id'], selectedId ?? ''] as never
    map.setFilter(LAYER_SELECTED_HALO, filter)
    map.setFilter(LAYER_SELECTED_ICON, filter)
  }

  if (opts.onMoveEnd) {
    map.on('moveend', () => {
      if (destroyed) return
      const c = map.getCenter()
      opts.onMoveEnd?.(toWgs({ lat: c.lat, lng: c.lng }), map.getZoom(), radiusMeters())
    })
  }

  return {
    setMarkers(next) {
      if (destroyed) return
      pendingToilets = next
      if (!ready) return
      ;(map.getSource(SRC_TOILETS) as GeoJSONSource | undefined)?.setData(
        toFeatureCollection(next, toDisplay),
      )
    },

    setSelected(id) {
      selectedId = id
      applySelected()
    },

    setUserLocation(p) {
      if (destroyed) return
      pendingUser = p
      if (!ready) return
      ;(map.getSource(SRC_USER) as GeoJSONSource | undefined)?.setData(
        pointCollection(p, toDisplay),
      )
    },

    setPadding(padding) {
      if (destroyed) return
      cameraPadding = {
        top: padding.top ?? 0,
        right: padding.right ?? 0,
        bottom: padding.bottom ?? 0,
        left: padding.left ?? 0,
      }
      map.easeTo({ padding: cameraPadding, duration: 160 })
    },

    moveTo(p, zoom) {
      if (destroyed) return
      const pos = toDisplay(p)
      map.easeTo({
        center: [pos.lng, pos.lat],
        zoom: zoom ?? map.getZoom(),
        padding: cameraPadding,
        duration: 420,
      })
    },

    fitBounds(points, paddingPx = 60) {
      if (destroyed || points.length === 0) return
      const first = toDisplay(points[0]!)
      const bounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat])
      for (const p of points.slice(1)) {
        const d = toDisplay(p)
        bounds.extend([d.lng, d.lat])
      }
      map.fitBounds(bounds, {
        padding: {
          top: cameraPadding.top + paddingPx,
          right: cameraPadding.right + paddingPx,
          bottom: cameraPadding.bottom + paddingPx,
          left: cameraPadding.left + paddingPx,
        },
        maxZoom: 17,
        duration: 420,
      })
    },

    getCenter() {
      const c = map.getCenter()
      return toWgs({ lat: c.lat, lng: c.lng })
    },

    getZoom: () => map.getZoom(),
    getRadiusMeters: () => (destroyed ? 0 : radiusMeters()),

    resize: () => {
      if (!destroyed) map.resize()
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      ready = false
      map.remove()
    },
  }
}

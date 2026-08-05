import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpDown, Crosshair, Loader2, Plus, Search, X } from 'lucide-react'

import { isSupabaseConfigured, type LatLng, type Toilet, type ToiletFilters } from '@/api'
import AddToiletSheet from '@/components/AddToiletSheet'
import FilterBar from '@/components/FilterBar'
import ToiletCard from '@/components/ToiletCard'
import TopBar from '@/components/TopBar'
import { useGeolocation } from '@/hooks/useGeolocation'
import { movedEnough, useToilets } from '@/hooks/useToilets'
import { useI18n } from '@/i18n/useI18n'
import { overallScore } from '@/lib/format'
// 从具体模块引，不要走 '@/map' 桶文件 —— 桶文件会把 adapter（进而把 maplibre-gl）
// 拉进这个模块的静态依赖图，MapView 的懒加载就白做了。见 src/map/index.ts 的说明。
import { defaultCenterFor, resolveRegion, type Region } from '@/map/region'
import type { MapHandle } from '@/map/adapter'

/**
 * 地图库单独异步加载。
 *
 * maplibre-gl 压缩后还有 ~800KB（gzip 218KB），静态引入的话首屏要等它下完再画。
 * 国内网络下这一等就是好几秒 —— 而列表其实不需要地图：
 * bootstrap.json 只有 12KB，先把附近厕所列出来，地图随后补上（见 8.3）。
 */
const MapView = lazy(() => import('@/components/MapView'))

/** 报新厕所的三步：浏览 → 拖地图选点 → 填表 */
type AddMode = 'off' | 'placing' | 'form'

type SortBy = 'distance' | 'rating'

/**
 * 视野半径决定查多大范围。
 * 之前写死 1500m，拉远之后视野一大片、结果还是那几个，看起来就是"搜不到"。
 * 上下限是为了防止贴地时半径小到查不出东西、拉到全球时把整库拖回来。
 */
const MIN_RADIUS_M = 400
const MAX_RADIUS_M = 20000

export default function MapPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()

  const [region, setRegionState] = useState<Region>(resolveRegion)
  const [filters, setFilters] = useState<ToiletFilters>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /** 实际用于查询的中心点。拖地图不会自动改它 —— 那样会打爆请求。 */
  const [queryCenter, setQueryCenter] = useState<LatLng | null>(null)
  /** 地图当前中心，用于判断要不要弹「搜这片区域」 */
  const [viewCenter, setViewCenter] = useState<LatLng | null>(null)

  const [sortBy, setSortBy] = useState<SortBy>('distance')
  /** 查询半径，跟着地图视野走 */
  const [radiusM, setRadiusM] = useState(1500)

  const [addMode, setAddMode] = useState<AddMode>('off')
  const [pinLocation, setPinLocation] = useState<LatLng | null>(null)

  const mapRef = useRef<MapHandle | null>(null)
  const { position, status, locate } = useGeolocation()
  const { toilets, loading, isStale, refresh } = useToilets(queryCenter, filters, radiusM)

  // 定位拿到就用定位，拿不到就落到当前地区的默认城市，绝不让地图停在 0,0
  useEffect(() => {
    if (queryCenter) return
    if (position) {
      setQueryCenter(position)
    } else if (status === 'denied' || status === 'unsupported') {
      setQueryCenter(defaultCenterFor(region))
    }
  }, [position, status, region, queryCenter])

  // 换地区 = 换底图坐标系，地图会整个重建，查询中心也跟着回到该地区的默认城市
  const handleRegionChange = useCallback((next: Region) => {
    setRegionState(next)
    setSelectedId(null)
    setAddMode('off')
    setQueryCenter(defaultCenterFor(next))
    setViewCenter(null)
  }, [])

  const showSearchHere = useMemo(
    () => addMode === 'off' && viewCenter !== null && movedEnough(queryCenter, viewCenter),
    [queryCenter, viewCenter, addMode],
  )

  /**
   * 地图停下来时同时记录中心和视野半径。
   * 半径变化超过 25% 就直接重查 —— 缩放不该还要用户手点「搜这片区域」，
   * 那个按钮是给"拖到别处"用的。
   */
  function handleMoveEnd(center: LatLng, _zoom: number, nextRadius: number) {
    setViewCenter(center)
    const clamped = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(nextRadius)))
    setRadiusM((cur) => (Math.abs(clamped - cur) / cur > 0.25 ? clamped : cur))
  }

  const sorted = useMemo(() => {
    if (sortBy === 'distance') return toilets
    // 没人评过的排在最后，否则空白项会霸占榜首
    return [...toilets].sort((a: Toilet, b: Toilet) => {
      const sa = overallScore(a)
      const sb = overallScore(b)
      if (sa === null && sb === null) return (a.distanceM ?? 0) - (b.distanceM ?? 0)
      if (sa === null) return 1
      if (sb === null) return -1
      return sb - sa
    })
  }, [toilets, sortBy])

  const selected = toilets.find((x) => x.id === selectedId) ?? null

  /** 地图上点图钉：直接进详情。地图上的点没有列表卡片那种"先选中再看"的中间态。 */
  function handleMarkerClick(id: string) {
    if (addMode !== 'off') return
    setSelectedId(id)
    navigate(`/t/${id}`)
  }

  /** 列表卡片：第一次点选中并定位到地图，第二次（点卡片任意位置）进详情。 */
  function handleCardClick(id: string) {
    if (selectedId === id) {
      navigate(`/t/${id}`)
      return
    }
    setSelectedId(id)
    const hit = toilets.find((x) => x.id === id)
    if (hit) mapRef.current?.moveTo(hit)
  }

  function recenter() {
    if (position) {
      mapRef.current?.moveTo(position, 16)
      setQueryCenter(position)
    } else {
      locate()
    }
  }

  function startPlacing() {
    setSelectedId(null)
    setAddMode('placing')
  }

  function confirmPin() {
    // 从适配器拿中心点，它已经把 GCJ-02 转回 WGS-84 了，别自己算
    const center = mapRef.current?.getCenter() ?? queryCenter
    if (!center) return
    setPinLocation(center)
    setAddMode('form')
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <TopBar region={region} onRegionChange={handleRegionChange} />

      <div className="relative flex-1">
        {queryCenter ? (
          <Suspense fallback={<MapPlaceholder label={t.loading} />}>
            <MapView
              region={region}
              lang={locale}
              initialCenter={queryCenter}
              toilets={toilets}
              selectedId={selectedId}
              userPosition={position}
              onSelect={handleMarkerClick}
              onMoveEnd={handleMoveEnd}
              handleRef={mapRef}
              className="absolute inset-0"
            />
          </Suspense>
        ) : (
          <MapPlaceholder label={t.locating} />
        )}

        {/* 选点用的十字准星。固定在屏幕中心，用户拖地图去对准它 ——
            比让用户捏着一个小图钉拖要稳得多，尤其单手操作时。 */}
        {addMode === 'placing' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="relative -translate-y-3">
              <div className="h-9 w-9 rounded-full border-[3px] border-poo-600 bg-poo-600/20" />
              <div className="absolute left-1/2 top-full h-4 w-0.5 -translate-x-1/2 bg-poo-600" />
            </div>
          </div>
        )}

        {showSearchHere && (
          <button
            type="button"
            onClick={() => {
              setQueryCenter(viewCenter)
              setViewCenter(null)
            }}
            className="absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-lg"
          >
            <Search size={14} className="mr-1.5 inline" />
            {t.searchThisArea}
          </button>
        )}

        {addMode === 'off' && (
          <>
            <button
              type="button"
              onClick={recenter}
              className="absolute bottom-4 left-3 z-10 rounded-xl bg-white p-2.5 shadow-lg"
              aria-label={t.recenter}
            >
              <Crosshair size={18} className={status === 'locating' ? 'animate-pulse' : ''} />
            </button>

            <button
              type="button"
              onClick={startPlacing}
              className="absolute bottom-16 left-3 z-10 flex items-center gap-1.5 rounded-xl bg-poo-600 px-3 py-2.5 text-sm font-medium text-white shadow-lg"
            >
              <Plus size={16} />
              {t.addToilet}
            </button>
          </>
        )}
      </div>

      {addMode === 'placing' ? (
        <div className="safe-bottom z-10 shrink-0 border-t border-poo-100 bg-white px-4 py-3">
          <p className="mb-2.5 text-center text-sm text-ink-soft">{t.pinHint}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddMode('off')} className="btn btn--ghost">
              <X size={16} />
              {t.cancel}
            </button>
            <button type="button" onClick={confirmPin} className="btn btn--primary flex-1">
              {t.pinConfirm}
            </button>
          </div>
        </div>
      ) : (
        /* 底部面板：地图和列表同屏，不做 tab 切换 —— 找厕所时两者都要看 */
        <div className="safe-bottom z-10 flex max-h-[46vh] shrink-0 flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
          <div className="px-3 pb-1 pt-3">
            <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-poo-200" />
            <FilterBar value={filters} onChange={setFilters} />
          </div>

          <div className="flex items-center justify-between gap-2 px-4 pb-1.5 pt-1">
            <h2 className="shrink-0 text-sm font-semibold">{t.nearby}</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint">
                {loading ? t.loading : t.resultCount(sorted.length)}
              </span>
              <button
                type="button"
                onClick={() => setSortBy((s) => (s === 'distance' ? 'rating' : 'distance'))}
                className="inline-flex items-center gap-1 rounded-lg bg-poo-50 px-2 py-1 text-xs font-medium text-poo-800"
              >
                <ArrowUpDown size={12} />
                {sortBy === 'distance' ? t.sortDistance : t.sortRating}
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
            {!isSupabaseConfigured && (
              <Notice title={t.dbNotConfigured} hint={t.dbNotConfiguredHint} />
            )}
            {isStale && sorted.length > 0 && (
              <p className="px-1 text-[11px] text-ink-faint">{t.loading}</p>
            )}

            {sorted.length === 0 && !loading ? (
              <div className="px-1 py-6 text-center">
                <p className="text-sm text-ink-soft">{t.noResults}</p>
                <p className="mt-1 text-xs text-ink-faint">{t.noResultsHint}</p>
              </div>
            ) : (
              sorted.map((toilet) => (
                <ToiletCard
                  key={toilet.id}
                  toilet={toilet}
                  selected={selected?.id === toilet.id}
                  onClick={() => handleCardClick(toilet.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {addMode === 'form' && pinLocation && (
        <AddToiletSheet
          location={pinLocation}
          onCancel={() => setAddMode('off')}
          onRetakeLocation={() => setAddMode('placing')}
          onCreated={(id) => {
            setAddMode('off')
            refresh()
            navigate(`/t/${id}`)
          }}
        />
      )}
    </div>
  )
}

function MapPlaceholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-poo-100 text-sm text-ink-faint">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  )
}

function Notice({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-xs font-medium text-amber-900">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-amber-800">{hint}</p>}
    </div>
  )
}

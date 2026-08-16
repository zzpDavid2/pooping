import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpDown, Crosshair, Loader2, Plus, Search, ThumbsDown, ThumbsUp, X } from 'lucide-react'

import {
  getTopReviews,
  getTopToilets,
  isSupabaseConfigured,
  voteReviewFunny,
  voteToiletFunny,
  type FeaturedReview,
  type LatLng,
  type Review,
  type Toilet,
  type ToiletFilters,
} from '@/api'
import AddressSearchBox from '@/components/AddressSearchBox'
import AddToiletSheet from '@/components/AddToiletSheet'
import FilterBar from '@/components/FilterBar'
import ReviewCard from '@/components/ReviewCard'
import ShareCard from '@/components/ShareCard'
import ToiletCard from '@/components/ToiletCard'
import TopBar from '@/components/TopBar'
import { useGeolocation } from '@/hooks/useGeolocation'
import { movedEnough, useToilets } from '@/hooks/useToilets'
import { useI18n } from '@/i18n/useI18n'
import { loadBootstrap } from '@/lib/bootstrap'
import { displayFeaturedToiletName, displayName, displayPlace, overallScore } from '@/lib/format'
import PooScore from '@/components/PooScore'
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
type HomeMode = 'funny' | 'map'

/**
 * 视野半径决定查多大范围。
 * 之前写死 1500m，拉远之后视野一大片、结果还是那几个，看起来就是"搜不到"。
 * 上下限是为了防止贴地时半径小到查不出东西、拉到全球时把整库拖回来。
 */
const MIN_RADIUS_M = 400
const MAX_RADIUS_M = 20000
const SHEET_MAX_VH = 88
const SHEET_MIN_VH: Record<HomeMode, number> = {
  funny: 50,
  map: 42,
}
const SHEET_EXPAND_WHEEL_PX = 320
const SHEET_COLLAPSE_WHEEL_PX = 520
const SHEET_DRAG_GAIN = 1.45
const FEATURED_TOILET_PAGE_SIZE = 24
const FEATURED_REVIEW_PAGE_SIZE = 12

export default function MapPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()

  const [region, setRegionState] = useState<Region>(resolveRegion)
  const [filters, setFilters] = useState<ToiletFilters>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /** 实际用于查询的中心点。拖地图不会自动改它 —— 那样会打爆请求。 */
  const [queryCenter, setQueryCenter] = useState<LatLng | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('distance')
  const [mode, setMode] = useState<HomeMode>('funny')
  const [sheetProgress, setSheetProgress] = useState(0)
  const [sheetInteracting, setSheetInteracting] = useState(false)
  const [featuredToilets, setFeaturedToilets] = useState<Toilet[]>([])
  const [featuredReviews, setFeaturedReviews] = useState<FeaturedReview[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)
  const [hasMoreFeaturedToilets, setHasMoreFeaturedToilets] = useState(true)
  const [hasMoreFeaturedReviews, setHasMoreFeaturedReviews] = useState(true)
  const [viewportHeight, setViewportHeight] = useState(
    () => (typeof window === 'undefined' ? 800 : window.innerHeight),
  )
  /** 查询半径，跟着地图视野走 */
  const [radiusM, setRadiusM] = useState(1500)

  const [addMode, setAddMode] = useState<AddMode>('off')
  const [pinLocation, setPinLocation] = useState<LatLng | null>(null)
  const [browseSearchOpen, setBrowseSearchOpen] = useState(false)
  const [sharing, setSharing] = useState<{ review: Review; toiletName: string } | null>(null)

  const mapRef = useRef<MapHandle | null>(null)
  const autoSearchTimer = useRef<number | null>(null)
  const sheetDragRef = useRef<{ y: number; progress: number } | null>(null)
  const sheetTouchRef = useRef<{
    y: number
    progress: number
    resizing: boolean
  } | null>(null)
  const sheetProgressRef = useRef(0)
  const wheelSnapTimer = useRef<number | null>(null)
  const featuredBootstrapped = useRef(false)
  const featuredLoadingRef = useRef(false)
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

  useEffect(() => {
    if (featuredBootstrapped.current) return
    featuredBootstrapped.current = true
    void loadMoreFeatured()
    // loadMoreFeatured reads current offsets from state; first run is intentionally once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 换地区 = 换底图坐标系，地图会整个重建，查询中心也跟着回到该地区的默认城市
  const handleRegionChange = useCallback((next: Region) => {
    setRegionState(next)
    setSelectedId(null)
    setAddMode('off')
    setBrowseSearchOpen(false)
    setQueryCenter(defaultCenterFor(next))
  }, [])

  useEffect(() => {
    return () => {
      if (autoSearchTimer.current) window.clearTimeout(autoSearchTimer.current)
      if (wheelSnapTimer.current) window.clearTimeout(wheelSnapTimer.current)
    }
  }, [])

  /**
   * 地图停下来时同时记录中心和视野半径。
   * 地图移动/缩放后自动重查，替代之前的「搜这片区域」按钮。
   */
  function handleMoveEnd(center: LatLng, _zoom: number, nextRadius: number) {
    const clamped = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(nextRadius)))
    setRadiusM((cur) => (Math.abs(clamped - cur) / cur > 0.25 ? clamped : cur))
    if (addMode !== 'off') return
    if (!movedEnough(queryCenter, center)) return
    if (autoSearchTimer.current) window.clearTimeout(autoSearchTimer.current)
    autoSearchTimer.current = window.setTimeout(() => {
      setQueryCenter(center)
    }, 350)
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
  const sheetMinVh = SHEET_MIN_VH[mode]
  const sheetHeightVh = sheetMinVh + (SHEET_MAX_VH - sheetMinVh) * sheetProgress
  const mapBottomInsetPx = Math.round((sheetHeightVh / 100) * viewportHeight)
  const hasMoreFeatured = hasMoreFeaturedToilets || hasMoreFeaturedReviews

  async function loadMoreFeatured() {
    if (featuredLoadingRef.current) return
    featuredLoadingRef.current = true
    setFeaturedLoading(true)
    try {
      const toiletOffset = featuredToilets.length
      const reviewOffset = featuredReviews.length

      const [toiletRes, reviewRes] = await Promise.all([
        hasMoreFeaturedToilets
          ? getTopToilets(FEATURED_TOILET_PAGE_SIZE, toiletOffset)
          : Promise.resolve({ data: [] as Toilet[], error: null }),
        hasMoreFeaturedReviews
          ? getTopReviews(FEATURED_REVIEW_PAGE_SIZE, reviewOffset)
          : Promise.resolve({ data: [] as FeaturedReview[], error: null }),
      ])

      if (toiletRes.data) {
        setFeaturedToilets((cur) => mergeById(cur, toiletRes.data))
        setHasMoreFeaturedToilets(toiletRes.data.length === FEATURED_TOILET_PAGE_SIZE)
      } else if (toiletOffset === 0) {
        const fallback = await loadBootstrap()
        const fallbackToilets = fallback
          ? pickFeaturedToilets(fallback.toilets, FEATURED_TOILET_PAGE_SIZE)
          : []
        setFeaturedToilets(fallbackToilets)
        setHasMoreFeaturedToilets(Boolean(fallback && fallback.toilets.length > fallbackToilets.length))
      } else {
        setHasMoreFeaturedToilets(false)
      }

      if (reviewRes.data) {
        setFeaturedReviews((cur) => mergeById(cur, reviewRes.data))
        setHasMoreFeaturedReviews(reviewRes.data.length === FEATURED_REVIEW_PAGE_SIZE)
      } else {
        setHasMoreFeaturedReviews(false)
      }
    } finally {
      featuredLoadingRef.current = false
      setFeaturedLoading(false)
    }
  }

  useEffect(() => {
    function syncViewportHeight() {
      setViewportHeight(window.innerHeight)
    }

    syncViewportHeight()
    window.addEventListener('resize', syncViewportHeight)
    window.visualViewport?.addEventListener('resize', syncViewportHeight)
    return () => {
      window.removeEventListener('resize', syncViewportHeight)
      window.visualViewport?.removeEventListener('resize', syncViewportHeight)
    }
  }, [])

  function handleMarkerClick(id: string) {
    if (addMode !== 'off') return
    setMode('map')
    handleCardClick(id)
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

  function handleFeaturedToiletClick(id: string) {
    navigate(`/t/${id}`)
  }

  function handleReviewVote(review: Review, value: -1 | 1) {
    setFeaturedReviews((cur) =>
      cur
        .map((r) => (r.id === review.id ? { ...r, ...applyReviewVote(r, value) } : r))
        .sort((a, b) => b.funnyScore - a.funnyScore || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    )
    void voteReviewFunny(review.id, value).then((res) => {
      if (!res.data) return
      setFeaturedReviews((cur) =>
        cur
          .map((r) => (r.id === res.data!.id ? { ...r, ...res.data! } : r))
          .sort((a, b) => b.funnyScore - a.funnyScore || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      )
    })
  }

  function handleFeaturedToiletVote(toilet: Toilet, value: -1 | 1) {
    setFeaturedToilets((cur) =>
      cur
        .map((t) => (t.id === toilet.id ? applyToiletVote(t, value) : t))
        .sort(sortFeaturedToilets),
    )
    void voteToiletFunny(toilet.id, value).then((res) => {
      if (!res.data) return
      setFeaturedToilets((cur) =>
        cur
          .map((t) => (t.id === res.data!.id ? { ...t, ...res.data! } : t))
          .sort(sortFeaturedToilets),
      )
    })
  }

  function handleFeaturedReviewShare(review: FeaturedReview) {
    setSharing({
      review,
      toiletName: displayFeaturedToiletName(review.toilet, locale),
    })
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
    setBrowseSearchOpen(false)
    setAddMode('placing')
  }

  function confirmPin() {
    // 从适配器拿中心点，它已经把 GCJ-02 转回 WGS-84 了，别自己算
    const center = mapRef.current?.getCenter() ?? queryCenter
    if (!center) return
    setPinLocation(center)
    setAddMode('form')
  }

  function handleSheetPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation()
    sheetDragRef.current = { y: e.clientY, progress: sheetProgressRef.current }
    setSheetInteracting(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleSheetPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation()
    const drag = sheetDragRef.current
    if (!drag) return
    e.preventDefault()
    const rangePx = ((SHEET_MAX_VH - sheetMinVh) / 100) * window.innerHeight
    if (rangePx <= 0) return
    setSheetProgressValue(drag.progress + ((drag.y - e.clientY) / rangePx) * SHEET_DRAG_GAIN)
  }

  function handleSheetPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (!sheetDragRef.current) return
    sheetDragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    snapSheet()
  }

  function startSheetTouch(clientY: number) {
    sheetTouchRef.current = {
      y: clientY,
      progress: sheetProgressRef.current,
      resizing: true,
    }
    setSheetInteracting(true)
  }

  function resizeSheetFromTouch(clientY: number, startY: number, startProgress: number) {
    const rangePx = ((SHEET_MAX_VH - sheetMinVh) / 100) * window.innerHeight
    if (rangePx <= 0) return
    setSheetProgressValue(startProgress + ((startY - clientY) / rangePx) * SHEET_DRAG_GAIN)
  }

  function handleSheetTouchStart(e: React.TouchEvent) {
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return
    startSheetTouch(touch.clientY)
  }

  function handleSheetTouchMove(e: React.TouchEvent) {
    e.stopPropagation()
    const touch = e.touches[0]
    const drag = sheetTouchRef.current
    if (!touch || !drag) return
    e.preventDefault()
    resizeSheetFromTouch(touch.clientY, drag.y, drag.progress)
  }

  function handleSheetTouchEnd(e: React.TouchEvent) {
    e.stopPropagation()
    if (!sheetTouchRef.current?.resizing) return
    sheetTouchRef.current = null
    snapSheet()
  }

  function setSheetProgressValue(next: number | ((current: number) => number)) {
    const value = clamp01(
      typeof next === 'function' ? next(sheetProgressRef.current) : next,
    )
    sheetProgressRef.current = value
    setSheetProgress(value)
  }

  function snapSheet() {
    setSheetInteracting(false)
    setSheetProgressValue((p) => (p > 0.45 ? 1 : 0))
  }

  function handlePanelWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.deltaY === 0) return
    e.stopPropagation()
    const atTop = e.currentTarget.scrollTop <= 0
    const progress = sheetProgressRef.current
    const shouldResize =
      (e.deltaY > 0 && progress < 1) || (e.deltaY < 0 && atTop && progress > 0)

    if (!shouldResize) return

    e.preventDefault()
    setSheetInteracting(true)
    const wheelRange = e.deltaY > 0 ? SHEET_EXPAND_WHEEL_PX : SHEET_COLLAPSE_WHEEL_PX
    setSheetProgressValue((cur) => cur + e.deltaY / wheelRange)

    if (wheelSnapTimer.current) window.clearTimeout(wheelSnapTimer.current)
    wheelSnapTimer.current = window.setTimeout(() => {
      wheelSnapTimer.current = null
      snapSheet()
    }, 140)
  }

  function handlePanelTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return
    sheetTouchRef.current = {
      y: touch.clientY,
      progress: sheetProgressRef.current,
      resizing: false,
    }
  }

  function handlePanelTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation()
    const touch = e.touches[0]
    const drag = sheetTouchRef.current
    if (!touch || !drag) return

    const deltaY = drag.y - touch.clientY
    const atTop = e.currentTarget.scrollTop <= 0
    const progress = sheetProgressRef.current
    const shouldResize =
      (deltaY > 0 && progress < 1) || (deltaY < 0 && atTop && progress > 0)

    if (!shouldResize) return

    e.preventDefault()
    drag.resizing = true
    setSheetInteracting(true)
    resizeSheetFromTouch(touch.clientY, drag.y, drag.progress)
  }

  function handlePanelTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation()
    const wasResizing = sheetTouchRef.current?.resizing
    sheetTouchRef.current = null
    if (wasResizing) snapSheet()
  }

  function stopSheetEvent(e: React.SyntheticEvent) {
    e.stopPropagation()
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <TopBar region={region} onRegionChange={handleRegionChange} />

      <div className="relative flex-1 overflow-hidden">
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
              bottomInsetPx={mapBottomInsetPx}
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

        {addMode === 'off' && (
          <>
            <div
              className="absolute left-3 z-[5] flex flex-col items-start gap-3 transition-[bottom] duration-200 ease-out"
              style={{ bottom: `calc(${sheetMinVh}vh + 1rem)` }}
            >
              <button
                type="button"
                onClick={startPlacing}
                className="flex items-center gap-1.5 rounded-xl bg-poo-600 px-3 py-2.5 text-sm font-medium text-white shadow-lg"
              >
                <Plus size={16} />
                {t.addToilet}
              </button>
              <button
                type="button"
                onClick={recenter}
                className="rounded-xl bg-white p-2.5 shadow-lg"
                aria-label={t.recenter}
              >
                <Crosshair size={18} className={status === 'locating' ? 'animate-pulse' : ''} />
              </button>
              <button
                type="button"
                onClick={() => setBrowseSearchOpen((v) => !v)}
                aria-pressed={browseSearchOpen}
                className={`rounded-xl p-2.5 shadow-lg ${
                  browseSearchOpen ? 'bg-poo-600 text-white' : 'bg-white'
                }`}
                aria-label={t.addressSearchButton}
              >
                <Search size={18} />
              </button>
            </div>

            {browseSearchOpen && (
              <div className="safe-top absolute inset-x-3 top-16 z-20">
                <AddressSearchBox
                  region={region}
                  near={mapRef.current?.getCenter() ?? queryCenter}
                  onPick={(r) => {
                    mapRef.current?.moveTo(r, 16)
                    setQueryCenter(r)
                    setBrowseSearchOpen(false)
                  }}
                />
              </div>
            )}
          </>
        )}

        {addMode === 'placing' ? (
          <div className="safe-bottom absolute inset-x-0 bottom-0 z-10 border-t border-poo-100 bg-white px-4 py-3">
            <AddressSearchBox
              region={region}
              near={mapRef.current?.getCenter() ?? queryCenter}
              onPick={(r) => mapRef.current?.moveTo(r, 17)}
              className="mb-2.5"
            />

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
          <div
            className={`safe-bottom absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.08)] ${
              sheetInteracting ? '' : 'transition-[height] duration-200 ease-out'
            }`}
            style={{ height: `${sheetHeightVh}vh` }}
            onPointerDown={stopSheetEvent}
            onPointerMove={stopSheetEvent}
            onTouchMove={stopSheetEvent}
            onWheel={stopSheetEvent}
          >
            <div className="sticky top-0 z-10 rounded-t-2xl bg-white px-3 pb-1 pt-2.5">
              <button
                type="button"
                onPointerDown={handleSheetPointerDown}
                onPointerMove={handleSheetPointerMove}
                onPointerUp={handleSheetPointerUp}
                onPointerCancel={handleSheetPointerUp}
                onTouchStart={handleSheetTouchStart}
                onTouchMove={handleSheetTouchMove}
                onTouchEnd={handleSheetTouchEnd}
                onTouchCancel={handleSheetTouchEnd}
                onDoubleClick={() => {
                  setSheetInteracting(false)
                  setSheetProgressValue((p) => (p > 0.5 ? 0 : 1))
                }}
                className="mx-auto mb-2.5 flex h-7 w-16 touch-none items-center justify-center rounded-full"
                aria-label={sheetProgress > 0.5 ? t.collapsePanel : t.expandPanel}
                title={sheetProgress > 0.5 ? t.collapsePanel : t.expandPanel}
              >
                <span className="h-1.5 w-12 rounded-full bg-poo-300" />
              </button>
              {mode === 'map' ? <FilterBar value={filters} onChange={setFilters} /> : null}
            </div>

            <div className="flex items-center justify-between gap-2 px-4 pb-1.5 pt-1">
              <h2 className="shrink-0 text-sm font-semibold">
                {mode === 'map' ? t.nearby : t.funnyMode}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-faint">
                  {loading
                    ? t.loading
                    : t.resultCount(
                        mode === 'map' ? sorted.length : featuredToilets.length + featuredReviews.length,
                      )}
                </span>
                {mode === 'map' && (
                  <button
                    type="button"
                    onClick={() => setSortBy((s) => (s === 'distance' ? 'rating' : 'distance'))}
                    className="inline-flex items-center gap-1 rounded-lg bg-poo-50 px-2 py-1 text-xs font-medium text-poo-800"
                  >
                    <ArrowUpDown size={12} />
                    {sortBy === 'distance' ? t.sortDistance : t.sortRating}
                  </button>
                )}
              </div>
            </div>

            <div
              data-bottom-sheet-content
              className="flex-1 touch-pan-y space-y-2 overflow-y-auto overscroll-contain px-3 pb-20"
              onWheel={handlePanelWheel}
              onTouchStart={handlePanelTouchStart}
              onTouchMove={handlePanelTouchMove}
              onTouchEnd={handlePanelTouchEnd}
              onTouchCancel={handlePanelTouchEnd}
            >
              {!isSupabaseConfigured && (
                <Notice title={t.dbNotConfigured} hint={t.dbNotConfiguredHint} />
              )}
              {isStale && sorted.length > 0 && (
                <p className="px-1 text-[11px] text-ink-faint">{t.loading}</p>
              )}

              {mode === 'funny' ? (
                <FunnyMasonry
                  toilets={featuredToilets}
                  reviews={featuredReviews}
                  onToiletClick={handleFeaturedToiletClick}
                  onToiletVote={handleFeaturedToiletVote}
                  onReviewVote={handleReviewVote}
                  onReviewShare={handleFeaturedReviewShare}
                  onLoadMore={loadMoreFeatured}
                  hasMore={hasMoreFeatured}
                  loadingMore={featuredLoading}
                />
              ) : sorted.length === 0 && !loading ? (
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

        {addMode === 'off' && (
          <button
            type="button"
            onClick={() => setMode((cur) => (cur === 'map' ? 'funny' : 'map'))}
            className="safe-bottom absolute bottom-4 left-1/2 z-40 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border-2 border-poo-600 bg-white text-2xl text-poo-700 shadow-xl"
            aria-label={mode === 'map' ? t.funnyMode : t.discoverMode}
            title={mode === 'map' ? t.funnyMode : t.discoverMode}
          >
            {mode === 'map' ? '💩' : '🔍'}
          </button>
        )}
      </div>

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

      {sharing && (
        <ShareCard
          review={sharing.review}
          toiletName={sharing.toiletName}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  )
}

function FunnyMasonry({
  toilets,
  reviews,
  onToiletClick,
  onToiletVote,
  onReviewVote,
  onReviewShare,
  onLoadMore,
  hasMore,
  loadingMore,
}: {
  toilets: Toilet[]
  reviews: FeaturedReview[]
  onToiletClick: (id: string) => void
  onToiletVote: (toilet: Toilet, value: -1 | 1) => void
  onReviewVote: (review: Review, value: -1 | 1) => void
  onReviewShare: (review: FeaturedReview) => void
  onLoadMore: () => void
  hasMore: boolean
  loadingMore: boolean
}) {
  const { t, locale } = useI18n()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const items = interleave(
    toilets.map((toilet) => ({ kind: 'toilet' as const, id: toilet.id, toilet })),
    reviews.map((review) => ({ kind: 'review' as const, id: review.id, review })),
  )

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasMore || loadingMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore()
      },
      { rootMargin: '360px 0px 520px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, onLoadMore])

  if (items.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-ink-soft">{t.noResults}</p>
  }

  return (
    <>
      <div className="columns-2 gap-2 [column-fill:_balance] md:columns-3">
        {items.map((item) =>
          item.kind === 'toilet' ? (
            <article
              key={`toilet-${item.id}`}
              className="mb-2 w-full break-inside-avoid rounded-xl border border-poo-100 bg-poo-50 p-3 text-left"
            >
              <button
                type="button"
                onClick={() => onToiletClick(item.toilet.id)}
                className="block w-full text-left"
              >
                <p className="text-[11px] font-medium text-poo-700">{t.featuredToilets}</p>
                <h3 className="mt-1 text-sm font-semibold leading-snug">
                  {displayName(item.toilet, locale)}
                </h3>
                {displayPlace(item.toilet) && (
                  <p className="mt-1 text-xs text-ink-faint">{displayPlace(item.toilet)}</p>
                )}
              </button>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-soft">
                <PooScore toilet={item.toilet} />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToiletVote(item.toilet, 1)}
                    className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 ${
                      item.toilet.funnyVote === 1
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-ink-faint hover:bg-white hover:text-ink-soft'
                    }`}
                    aria-label={t.funnyUp}
                  >
                    <ThumbsUp size={14} />
                    {item.toilet.funnyUp}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToiletVote(item.toilet, -1)}
                    className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 ${
                      item.toilet.funnyVote === -1
                        ? 'bg-rose-50 text-rose-700'
                        : 'text-ink-faint hover:bg-white hover:text-ink-soft'
                    }`}
                    aria-label={t.funnyDown}
                  >
                    <ThumbsDown size={14} />
                    {item.toilet.funnyDown}
                  </button>
                </div>
              </div>
            </article>
          ) : (
            <div key={`review-${item.id}`} className="mb-2 break-inside-avoid">
              <p className="mb-1 px-1 text-[11px] font-medium text-poo-700">
                {t.featuredReviews} · {displayFeaturedToiletName(item.review.toilet, locale)}
              </p>
              <ReviewCard
                review={item.review}
                onVote={onReviewVote}
                onShare={() => onReviewShare(item.review)}
              />
            </div>
          ),
        )}
      </div>
      {hasMore && (
        <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center py-4">
          {loadingMore ? <PooLoader label={t.loadingMore} /> : <div className="h-8" />}
        </div>
      )}
    </>
  )
}

function PooLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-poo-700" aria-label={label} role="status">
      <span className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute bottom-1 h-2 w-8 rounded-full bg-poo-200/80 blur-[1px]" />
        <span className="relative animate-bounce text-3xl drop-shadow-sm">💩</span>
      </span>
      <span className="flex items-end gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-poo-500" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-poo-400 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-poo-300 [animation-delay:240ms]" />
      </span>
    </div>
  )
}

function pickFeaturedToilets(toilets: Toilet[], limit = 12): Toilet[] {
  const candidates = toilets.filter((t) => overallScore(t) !== null || t.funnyScore > 0)
  const pool = candidates.length > 0 ? candidates : toilets
  return [...pool]
    .sort((a, b) => {
      const score = (overallScore(b) ?? 0) - (overallScore(a) ?? 0)
      if (score !== 0) return score
      const funny = b.funnyScore - a.funnyScore
      if (funny !== 0) return funny
      return stableJitter(a.id) - stableJitter(b.id)
    })
    .slice(0, limit)
}

function interleave<A, B>(a: A[], b: B[]): Array<A | B> {
  const out: Array<A | B> = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left !== undefined) out.push(left)
    if (right !== undefined) out.push(right)
  }
  return out
}

function mergeById<T extends { id: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map((x) => x.id))
  return [...current, ...next.filter((x) => !seen.has(x.id))]
}

function stableJitter(id: string): number {
  let n = 0
  for (let i = 0; i < id.length; i += 1) n = (n * 31 + id.charCodeAt(i)) % 997
  return n
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function applyReviewVote(review: Review, value: -1 | 1): Review {
  if (review.funnyVote === value) return review
  const next = { ...review }
  if (review.funnyVote === 1) next.funnyUp -= 1
  if (review.funnyVote === -1) next.funnyDown -= 1
  if (value === 1) next.funnyUp += 1
  if (value === -1) next.funnyDown += 1
  next.funnyVote = value
  next.funnyScore = next.funnyUp - next.funnyDown
  return next
}

function applyToiletVote(toilet: Toilet, value: -1 | 1): Toilet {
  if (toilet.funnyVote === value) return toilet
  const next = { ...toilet }
  if (toilet.funnyVote === 1) next.funnyUp -= 1
  if (toilet.funnyVote === -1) next.funnyDown -= 1
  if (value === 1) next.funnyUp += 1
  if (value === -1) next.funnyDown += 1
  next.funnyVote = value
  next.funnyScore = next.funnyUp - next.funnyDown
  return next
}

function sortFeaturedToilets(a: Toilet, b: Toilet): number {
  const funny = b.funnyScore - a.funnyScore
  if (funny !== 0) return funny
  const score = (overallScore(b) ?? 0) - (overallScore(a) ?? 0)
  if (score !== 0) return score
  return stableJitter(a.id) - stableJitter(b.id)
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

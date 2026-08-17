import { useEffect, useRef, type MutableRefObject } from 'react'

import type { LatLng, Toilet } from '@/api/types'
import { createMap, type MapHandle, type Region } from '@/map'

/**
 * 画一个点需要的最小信息。
 * 收窄成这个而不是整个 Toilet：修正位置那个界面只有一个坐标要画，
 * 没必要为了满足类型去凑一个假的完整 Toilet 出来。
 */
export type MapMarkerToilet = Pick<Toilet, 'id' | 'lat' | 'lng' | 'reviewCount'>

interface MapViewProps {
  region: Region
  lang: 'zh' | 'en'
  /** WGS-84。地图适配器负责按地区做 GCJ-02 偏移，这里不用管。 */
  initialCenter: LatLng
  toilets: readonly MapMarkerToilet[]
  selectedId: string | null
  userPosition: LatLng | null
  onSelect: (id: string) => void
  /** radiusM = 当前视野半径（米），用来决定查询范围 */
  onMoveEnd?: (center: LatLng, zoom: number, radiusM: number) => void
  /** 父组件要主动推地图（比如「回到我的位置」）时挂这个 ref */
  handleRef?: MutableRefObject<MapHandle | null>
  /** 底部 UI 覆盖地图的高度。传给 MapLibre camera padding，让可见区域居中。 */
  bottomInsetPx?: number
  className?: string
}

export default function MapView({
  region,
  lang,
  initialCenter,
  toilets,
  selectedId,
  userPosition,
  onSelect,
  onMoveEnd,
  handleRef: externalHandleRef,
  bottomInsetPx = 0,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<MapHandle | null>(null)

  // 回调放 ref 里：地图只在 region/lang 变化时重建，
  // 不能因为父组件重渲染换了个函数引用就把整张图掀了
  const onSelectRef = useRef(onSelect)
  const onMoveEndRef = useRef(onMoveEnd)
  onSelectRef.current = onSelect
  onMoveEndRef.current = onMoveEnd

  const centerRef = useRef(initialCenter)

  useEffect(() => {
    if (!containerRef.current) return

    // 换地区 = 换瓦片源 + 换坐标系，MapLibre 没法就地切，只能重建
    const handle = createMap({
      container: containerRef.current,
      region,
      lang,
      center: centerRef.current,
      zoom: 15,
      onSelectMarker: (id) => onSelectRef.current(id),
      onMoveEnd: (c, z, r) => {
        centerRef.current = c
        onMoveEndRef.current?.(c, z, r)
      },
    })
    handleRef.current = handle
    if (externalHandleRef) externalHandleRef.current = handle

    return () => {
      handle.destroy()
      handleRef.current = null
      if (externalHandleRef) externalHandleRef.current = null
    }
  }, [region, lang, externalHandleRef])

  useEffect(() => {
    handleRef.current?.setMarkers(
      toilets.map((t) => ({
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        reviewCount: t.reviewCount,
      })),
    )
  }, [toilets])

  useEffect(() => {
    handleRef.current?.setSelected(selectedId)
  }, [selectedId])

  useEffect(() => {
    handleRef.current?.setUserLocation(userPosition)
  }, [userPosition])

  useEffect(() => {
    handleRef.current?.setPadding({ bottom: bottomInsetPx })
  }, [bottomInsetPx])

  return <div ref={containerRef} className={className} />
}

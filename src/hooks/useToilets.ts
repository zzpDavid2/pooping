import { useCallback, useEffect, useRef, useState } from 'react'
import { getNearbyToilets, type ApiError, type LatLng, type Toilet, type ToiletFilters } from '@/api'
import { loadBootstrap, withDistance } from '@/lib/bootstrap'
import { distanceMeters } from '@/map/coords'

interface UseToiletsResult {
  toilets: Toilet[]
  loading: boolean
  error: ApiError | null
  /** 数据来自构建期烤好的静态文件，还没被真实数据替换 */
  isStale: boolean
  refresh: () => void
}

export function useToilets(
  center: LatLng | null,
  filters: ToiletFilters,
  radiusM = 1500,
): UseToiletsResult {
  // 半径由调用方按当前视野传进来。写死 1500m 会导致"拉远了反而搜不到"：
  // 视野变大但查询范围没变，屏幕上一大片空白，用户以为那儿真没有厕所。
  const [toilets, setToilets] = useState<Toilet[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [nonce, setNonce] = useState(0)

  // 慢请求回来时可能已经不是当前查询了，用序号丢弃过期结果
  const requestSeq = useRef(0)

  // 首屏：静态数据先顶上，不等网络
  useEffect(() => {
    let cancelled = false
    void loadBootstrap().then((payload) => {
      if (cancelled || !payload) return
      setToilets((current) => {
        if (current.length > 0) return current // 真实数据已经到了，别覆盖回去
        setIsStale(true)
        return withDistance(payload.toilets, center)
      })
    })
    return () => {
      cancelled = true
    }
    // 只在挂载时跑一次：这是首屏兜底，不该随 center 抖动重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterKey = `${filters.hasPaper}|${filters.isFree}|${filters.accessible}|${filters.seated}`

  useEffect(() => {
    if (!center) return

    const seq = ++requestSeq.current
    setLoading(true)

    void getNearbyToilets({ ...center, radiusM, filters, limit: 300 }).then((res) => {
      if (seq !== requestSeq.current) return // 过期结果，丢掉

      setLoading(false)
      if (res.error) {
        setError(res.error)
        // 请求失败时保留静态数据，让用户至少还有东西看
        return
      }
      setError(null)
      setIsStale(false)
      setToilets(res.data)
    })
    // filterKey 把对象展平成基本类型，避免每次渲染新对象引用触发重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng, radiusM, filterKey, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { toilets, loading, error, isStale, refresh }
}

/** 拖动地图后，中心点挪得够远才值得重新查一次。 */
export function movedEnough(a: LatLng | null, b: LatLng | null, thresholdM = 300): boolean {
  if (!a || !b) return true
  return distanceMeters(a, b) > thresholdM
}

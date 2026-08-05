import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatLng } from '@/api/types'

export type GeoStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unsupported'

interface GeoState {
  position: LatLng | null
  status: GeoStatus
}

/**
 * 浏览器定位。返回的是 WGS-84 —— 注意国内很多机型（尤其国产 Android 浏览器）
 * 会直接给 GCJ-02，这层没法可靠区分，所以只保证「传给地图适配器」这条路是对的：
 * 适配器把它当 WGS-84 再偏移一次，最坏情况是自身位置略偏，不影响厕所点位的准确性。
 */
export function useGeolocation(auto = true): GeoState & { locate: () => void } {
  const [state, setState] = useState<GeoState>({ position: null, status: 'idle' })
  const watchId = useRef<number | null>(null)

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ position: null, status: 'unsupported' })
      return
    }

    setState((s) => ({ ...s, status: 'locating' }))

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          status: 'ready',
        })
      },
      () => {
        // 拒绝和超时都按「拿不到」处理，UI 上不区分 —— 用户不关心区别
        setState({ position: null, status: 'denied' })
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    )
  }, [])

  useEffect(() => {
    if (auto) locate()
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [auto, locate])

  return { ...state, locate }
}

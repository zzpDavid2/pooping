import { useEffect, useState } from 'react'
import { Navigate, useLocation, useMatch } from 'react-router-dom'

import { ensureSession, isSupabaseConfigured } from '@/api'
import MapPage from '@/pages/MapPage'
import ToiletPage from '@/pages/ToiletPage'

/**
 * 路由没有用 <Routes> 互斥切换，而是**详情页盖在地图上**。
 *
 * 原因：<Routes> 会在跳详情时把 MapPage 整个卸载，回来时重新挂载 ——
 * MapLibre 实例被销毁重建，用户之前拖到哪、缩放到几级、选中了谁全部丢失，
 * 还会重新请求一次定位。对一个「找附近厕所」的产品来说，回来发现地图跳回原点是很烦的。
 *
 * 地图挂上之后就一直留着，详情页以 fixed 覆盖层的形式出现在它上面。
 * 被盖住的地图是静止的，MapLibre 空闲时不重绘，没有额外开销。
 */
export default function App() {
  const location = useLocation()
  const detail = useMatch('/t/:id')
  const isDetail = Boolean(detail)

  /**
   * 地图一旦挂上就不再卸载。
   *
   * 但**深链直接打开详情页时不要提前挂** —— 那会在用户还没看地图的时候
   * 就弹出定位授权、并且白拉一次 800KB 的地图库。等他返回地图时再挂。
   */
  const [mapMounted, setMapMounted] = useState(!isDetail)
  useEffect(() => {
    if (!isDetail) setMapMounted(true)
  }, [isDetail])

  // 打开即用：后台悄悄开一个匿名号，用户完全无感（CLAUDE.md 第 5 节）。
  // 失败也不拦路 —— 只看评价不需要登录，写的时候会再试一次。
  useEffect(() => {
    if (isSupabaseConfigured) void ensureSession()
  }, [])

  const known = location.pathname === '/' || isDetail
  if (!known) return <Navigate to="/" replace />

  return (
    <>
      {mapMounted && <MapPage />}
      {detail?.params.id && <ToiletPage toiletId={detail.params.id} />}
    </>
  )
}

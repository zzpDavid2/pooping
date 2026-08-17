import { Suspense, lazy, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'

import { fixToiletLocation, type LatLng } from '@/api'
import AddressSearchBox from '@/components/AddressSearchBox'
import { useI18n } from '@/i18n/useI18n'
import { distanceMeters } from '@/map/coords'
import { resolveRegion } from '@/map/region'
import type { MapHandle } from '@/map/adapter'

const MapView = lazy(() => import('@/components/MapView'))

interface FixLocationSheetProps {
  toiletId: string
  /** 显示在标题上，让人确认自己在挪的是哪个厕所 */
  name: string
  /** 现在的坐标（WGS-84） */
  current: LatLng
  onClose: () => void
  onSaved: (next: LatLng) => void
}

/**
 * 把一个已有点位挪到对的地方。
 *
 * 交互和"报个新厕所"的选点完全一样：拖地图去对准固定在屏幕中间的准星。
 * 这里比地图页简单一点——地图独占一块 flex 区域，底部控制栏不压在它上面，
 * 所以相机不需要 bottom padding，也就没有那个"相机中心 ≠ 准星"的坑。
 * 即便如此，取坐标仍然走 unprojectClientPoint 按准星的真实屏幕位置反算，
 * 以后布局再改也不会悄悄错位（那个 bug 最坏差了 719 米）。
 *
 * 能不能改由数据库判断（自己报的点 / 管理员），前端只负责别把入口露给不该看到的人。
 */
export default function FixLocationSheet({
  toiletId,
  name,
  current,
  onClose,
  onSaved,
}: FixLocationSheetProps) {
  const { t, locale } = useI18n()
  const mapRef = useRef<MapHandle | null>(null)
  const crosshairRef = useRef<HTMLDivElement | null>(null)

  const [region] = useState(resolveRegion)
  const [movedM, setMovedM] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 原来的位置留一个点在图上，方便对比"我把它从哪挪到哪"
  const originMarker = [
    { id: toiletId, lat: current.lat, lng: current.lng, reviewCount: 0 },
  ]

  /** 准星此刻指着哪儿。取不到地图时退回原坐标，绝不返回一个瞎猜的点。 */
  function pickedPoint(): LatLng {
    const map = mapRef.current
    const el = crosshairRef.current
    if (!map || !el) return current
    const r = el.getBoundingClientRect()
    return map.unprojectClientPoint({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }

  function handleMoveEnd() {
    setMovedM(Math.round(distanceMeters(current, pickedPoint())))
  }

  async function handleSave() {
    const next = pickedPoint()
    setSaving(true)
    setError(null)

    const res = await fixToiletLocation(toiletId, next.lat, next.lng)
    setSaving(false)

    if (res.error) {
      setError(
        res.error.code === 'too_far'
          ? t.fixLocationTooFar
          : res.error.code === 'forbidden'
            ? t.fixLocationForbidden
            : res.error.code === 'rate_limited'
              ? t.fixLocationRateLimited
              : t.fixLocationFailed,
      )
      return
    }

    onSaved({ lat: res.data.lat, lng: res.data.lng })
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-poo-50">
      <header className="safe-top flex items-center gap-2 border-b border-poo-100 bg-white px-2 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-soft hover:bg-poo-50"
          aria-label={t.cancel}
        >
          <X size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{t.fixLocationTitle}</h1>
          <p className="truncate text-xs text-ink-faint">{name}</p>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-poo-100 text-sm text-ink-faint">
              <Loader2 size={16} className="mr-2 animate-spin" />
              {t.loading}
            </div>
          }
        >
          <MapView
            region={region}
            lang={locale}
            initialCenter={current}
            toilets={originMarker}
            selectedId={null}
            userPosition={null}
            onSelect={() => {}}
            onMoveEnd={handleMoveEnd}
            handleRef={mapRef}
            className="absolute inset-0"
          />
        </Suspense>

        {/* 准星固定在地图区正中。这块区域没有被底部栏盖住，居中就是相机中心 */}
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="relative">
            <div
              ref={crosshairRef}
              className="h-9 w-9 rounded-full border-[3px] border-poo-600 bg-poo-600/20"
            />
            <div className="absolute left-1/2 top-full h-4 w-0.5 -translate-x-1/2 bg-poo-600" />
          </div>
        </div>
      </div>

      <div className="safe-bottom border-t border-poo-100 bg-white px-4 py-3">
        <AddressSearchBox
          region={region}
          near={mapRef.current?.getCenter() ?? current}
          onPick={(r) => mapRef.current?.moveTo(r, 17)}
          className="mb-2.5"
        />

        <p className="mb-2.5 text-center text-sm text-ink-soft">
          {movedM > 0 ? t.fixLocationMoved(movedM) : t.fixLocationHint}
        </p>

        {error && (
          <p className="mb-2.5 rounded-xl bg-rose-50 px-3 py-2 text-center text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn btn--ghost">
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="btn btn--primary flex-1"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t.fixLocationSaving}
              </>
            ) : (
              t.fixLocationSave
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

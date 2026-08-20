import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, MapPin } from 'lucide-react'

import {
  getFlaggedToilets,
  resolveToiletReports,
  type FlaggedToilet,
  type ToiletReportReason,
} from '@/api'
import FixLocationSheet from '@/components/FixLocationSheet'
import { useI18n } from '@/i18n/useI18n'

/**
 * 管理端：被上报的点位列表，能直接挪位置、能标记已处理。
 *
 * CLAUDE.md 第 2 节说不做管理后台，指的是不做录入内容的 CMS。
 * 这一块不产内容，只是把 Supabase Studio 里那张 flagged_toilets 视图
 * 搬到手机上——点位错了要对着地图才改得动，在 Studio 里改坐标是灾难。
 *
 * 权限在数据库：列表和"标记已处理"两个 RPC 第一句都查 is_admin()，
 * 前端这层只是不给非管理员看到入口。
 */
export default function AdminFlaggedToilets() {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [items, setItems] = useState<FlaggedToilet[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [fixing, setFixing] = useState<FlaggedToilet | null>(null)

  useEffect(() => {
    let cancelled = false

    void getFlaggedToilets().then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.error) {
        setFailed(true)
        return
      }
      setItems(res.data)
    })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleResolve(toiletId: string) {
    setBusyId(toiletId)
    const res = await resolveToiletReports(toiletId)
    setBusyId(null)
    if (res.error) return
    // 处理完就从列表里拿掉，不用重新拉一遍
    setItems((cur) => cur.filter((x) => x.toiletId !== toiletId))
  }

  const reasonLabel: Record<ToiletReportReason, string> = {
    not_exist: t.reasonNotExist,
    closed: t.reasonClosed,
    other: t.reasonOther,
  }

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-sm font-semibold">{t.adminSection}</h3>

      {loading ? (
        <div className="card flex justify-center py-4">
          <Loader2 size={18} className="animate-spin text-ink-faint" />
        </div>
      ) : failed ? (
        <div className="card text-center">
          <p className="text-sm text-ink-soft">{t.adminLoadFailed}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-ink-soft">{t.adminEmpty}</p>
        </div>
      ) : (
        items.map((item) => (
          <div key={item.toiletId} className="card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold">{item.name}</h4>
                {item.address && (
                  <p className="mt-0.5 truncate text-xs text-ink-faint">{item.address}</p>
                )}
              </div>
              <span className="shrink-0 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                {t.adminReportCount(item.reportCount)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {item.reasons.length === 0 ? (
                <span className="rounded-lg bg-poo-50 px-2 py-0.5 text-[11px] text-ink-soft">
                  {t.adminNoReason}
                </span>
              ) : (
                item.reasons.map((r) => (
                  <span
                    key={r}
                    className="rounded-lg bg-poo-50 px-2 py-0.5 text-[11px] text-ink-soft"
                  >
                    {reasonLabel[r] ?? r}
                  </span>
                ))
              )}
            </div>

            {item.notes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {item.notes.map((note, i) => (
                  <li key={i} className="rounded-lg bg-poo-50 px-2 py-1.5 text-xs text-ink-soft">
                    「{note}」
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFixing(item)}
                className="inline-flex items-center gap-1 rounded-lg bg-poo-600 px-2.5 py-1.5 text-xs font-medium text-white"
              >
                <MapPin size={13} />
                {t.fixLocation}
              </button>
              <button
                type="button"
                onClick={() => void handleResolve(item.toiletId)}
                disabled={busyId === item.toiletId}
                className="inline-flex items-center gap-1 rounded-lg bg-poo-50 px-2.5 py-1.5 text-xs font-medium text-ink-soft disabled:opacity-50"
              >
                {busyId === item.toiletId ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {t.adminResolving}
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    {t.adminResolve}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/t/${item.toiletId}`)}
                className="text-xs text-ink-faint underline"
              >
                {t.adminOpenToilet}
              </button>
            </div>
          </div>
        ))
      )}

      {fixing && (
        <FixLocationSheet
          toiletId={fixing.toiletId}
          name={fixing.name}
          current={{ lat: fixing.lat, lng: fixing.lng }}
          onClose={() => setFixing(null)}
          onSaved={(next) => {
            const fixedId = fixing.toiletId
            setFixing(null)
            setItems((cur) =>
              cur.map((x) => (x.toiletId === fixedId ? { ...x, ...next } : x)),
            )
            // 挪完顺手把上报标掉——管理员来这儿就是为了处理它
            void handleResolve(fixedId)
          }}
        />
      )}
    </section>
  )
}

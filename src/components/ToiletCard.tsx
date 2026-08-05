import { Accessibility, ChevronRight, MessageSquareText, ScrollText } from 'lucide-react'

import type { Toilet } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'
import { displayName, displayPlace, formatDistance } from '@/lib/format'
import PooScore from './PooScore'

interface ToiletCardProps {
  toilet: Toilet
  selected?: boolean
  onClick?: () => void
}

export default function ToiletCard({ toilet, selected, onClick }: ToiletCardProps) {
  const { t, locale } = useI18n()
  const place = displayPlace(toilet)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border bg-white p-3.5 text-left transition-colors ${
        selected ? 'border-poo-600 bg-poo-50' : 'border-poo-100 hover:bg-poo-50/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-snug">{displayName(toilet, locale)}</h3>
          {place && <p className="mt-0.5 truncate text-xs text-ink-faint">{place}</p>}
        </div>
        {toilet.distanceM !== null && (
          <span className="shrink-0 rounded-lg bg-poo-100 px-2 py-1 text-xs font-medium text-poo-800">
            {formatDistance(toilet.distanceM, t)}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        <PooScore toilet={toilet} />

        <span className="inline-flex items-center gap-1">
          <MessageSquareText size={13} />
          {t.reviewCount(toilet.reviewCount)}
        </span>
        {toilet.hasPaper === true && (
          <span className="inline-flex items-center gap-1 text-poo-700">
            <ScrollText size={13} />
            {t.facPaper}
          </span>
        )}
        {toilet.accessible === true && (
          <span className="inline-flex items-center gap-1 text-poo-700">
            <Accessibility size={13} />
            {t.facAccessible}
          </span>
        )}
      </div>

      {/*
        选中后才露出「查看详情」。
        第一次点是"在地图上定位到它"，第二次才进详情 —— 不给个可见的按钮，
        用户根本不知道还要再点一次。整张卡片都可点，这个按钮只是提示，不是唯一入口。
      */}
      {selected && (
        <div className="mt-3 flex items-center justify-center gap-1 rounded-xl bg-poo-600 py-2 text-sm font-medium text-white">
          {t.viewDetail}
          <ChevronRight size={15} />
        </div>
      )}
    </button>
  )
}

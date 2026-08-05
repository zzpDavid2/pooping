import {
  Accessibility,
  Armchair,
  Baby,
  Clock,
  CircleDollarSign,
  Footprints,
  Hand,
  KeyRound,
  ScrollText,
  Wind,
  type LucideIcon,
} from 'lucide-react'

import type { Toilet } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'

/**
 * 设施图标墙。
 *
 * 三态很重要：有 / 没有 / **没人填**。
 * 把「未知」画成「没有」是在骗人 —— OSM 导入的点绝大多数字段是空的，
 * 用户看到"没纸"跑去别处，结果那儿其实有纸，这种错比不显示更伤。
 */
interface FacilityWallProps {
  toilet: Toilet
}

export default function FacilityWall({ toilet }: FacilityWallProps) {
  const { t } = useI18n()

  const items: { label: string; Icon: LucideIcon; value: boolean | null }[] = [
    { label: t.facPaper, Icon: ScrollText, value: toilet.hasPaper },
    { label: t.facSoap, Icon: Hand, value: toilet.hasSoap },
    { label: t.facDryer, Icon: Wind, value: toilet.hasDryer },
    { label: t.facHook, Icon: Hand, value: toilet.hasHook },
    { label: t.facAccessible, Icon: Accessibility, value: toilet.accessible },
    { label: t.facBaby, Icon: Baby, value: toilet.babyChanging },
    { label: t.facFree, Icon: CircleDollarSign, value: toilet.isFree },
    { label: t.facOpen24h, Icon: Clock, value: toilet.open24h },
    // needs_code 是反向的：需要密码是坏事，所以取反后再展示
    { label: t.facNeedsCode, Icon: KeyRound, value: toilet.needsCode },
  ]

  if (toilet.seatType) {
    items.push(
      toilet.seatType === 'squat'
        ? { label: t.facSquat, Icon: Footprints, value: true }
        : { label: t.facSeated, Icon: Armchair, value: true },
    )
  }

  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      {items.map(({ label, Icon, value }) => (
        <div
          key={label}
          className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center ${
            value === true
              ? 'border-poo-200 bg-poo-50 text-poo-800'
              : value === false
                ? 'border-poo-100 bg-white text-ink-faint line-through decoration-1'
                : 'border-dashed border-poo-100 bg-white text-ink-faint/60'
          }`}
        >
          <Icon size={17} strokeWidth={2} />
          <span className="text-[10px] leading-tight">{label}</span>
        </div>
      ))}

      {toilet.stallCount !== null && (
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-poo-200 bg-poo-50 px-1 py-2.5 text-center text-poo-800">
          <span className="text-base font-bold leading-none">{toilet.stallCount}</span>
          <span className="text-[10px] leading-tight">{t.stallCount(toilet.stallCount)}</span>
        </div>
      )}
    </div>
  )
}

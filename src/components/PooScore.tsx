import type { Toilet } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'
import { overallScore } from '@/lib/format'

/**
 * 总分，5 颗 💩 制。
 *
 * 用 💩 当"星"是这个产品该有的样子 —— 但要注意它在语义上是**正向**的：
 * 5 颗 💩 = 好厕所，不是"很屎"。所以旁边永远带上数字，避免歧义。
 */
interface PooScoreProps {
  toilet: Toilet
  size?: 'sm' | 'md'
  /** 没人评分时显示占位文案，列表里通常不需要 */
  showEmpty?: boolean
}

export default function PooScore({ toilet, size = 'sm', showEmpty = false }: PooScoreProps) {
  const { t } = useI18n()
  const score = overallScore(toilet)

  if (score === null) {
    if (!showEmpty) return null
    return <span className="text-xs text-ink-faint">{t.noRatingsYet}</span>
  }

  const full = Math.floor(score + 0.001)
  // 余数 ≥0.25 才画半颗，否则 4.1 分看起来像 4.5，虚高
  const half = score - full >= 0.25

  const emojiClass = size === 'md' ? 'text-lg' : 'text-[13px]'
  const numClass = size === 'md' ? 'text-base font-bold' : 'text-xs font-semibold'

  return (
    <span className="inline-flex items-center gap-1" title={`${score.toFixed(1)} / 5`}>
      <span className={`${emojiClass} leading-none tracking-tight`} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={i < full ? '' : i === full && half ? 'opacity-50' : 'opacity-20 grayscale'}
          >
            💩
          </span>
        ))}
      </span>
      <span className={`${numClass} tabular-nums text-ink-soft`}>{score.toFixed(1)}</span>
    </span>
  )
}

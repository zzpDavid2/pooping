import type { Toilet } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'
import { ratingBucket } from '@/lib/format'

const BUCKET_CLASS = {
  good: 'bg-emerald-500',
  mid: 'bg-amber-500',
  bad: 'bg-rose-500',
  none: 'bg-poo-200',
} as const

/** 详情页只读的评分条。 */
export function RatingBars({ toilet }: { toilet: Toilet }) {
  const { t } = useI18n()

  const rows = [
    { label: t.rateClean, value: toilet.avgClean },
    { label: t.rateSmell, value: toilet.avgSmell },
    { label: t.rateQueue, value: toilet.avgQueue },
  ]

  if (rows.every((r) => r.value === null)) {
    return <p className="text-sm text-ink-faint">{t.noRatingsYet}</p>
  }

  return (
    <div className="space-y-2">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-xs text-ink-soft">{label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-poo-100">
            <div
              className={`h-full rounded-full transition-all ${BUCKET_CLASS[ratingBucket(value)]}`}
              style={{ width: `${((value ?? 0) / 5) * 100}%` }}
            />
          </div>
          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-ink-soft">
            {value === null ? '–' : value.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

interface RatingPickerProps {
  label: string
  value: number
  onChange: (v: number) => void
}

/** 写评价时的 1–5 选择器。故意做成大按钮：单手、着急、可能站着。 */
export function RatingPicker({ label, value, onChange }: RatingPickerProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-sm text-ink-soft">{label}</span>
      <div className="flex flex-1 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${label} ${n}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={`h-9 flex-1 rounded-lg text-sm font-medium transition-colors ${
              value >= n ? 'bg-poo-600 text-white' : 'bg-poo-100 text-ink-faint'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

import { Accessibility, Armchair, CircleDollarSign, ScrollText, X } from 'lucide-react'

import type { ToiletFilters } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'

interface FilterBarProps {
  value: ToiletFilters
  onChange: (next: ToiletFilters) => void
}

export default function FilterBar({ value, onChange }: FilterBarProps) {
  const { t } = useI18n()

  // V1 就这四个（CLAUDE.md 第 9 节）。多了没人点，少了不够用。
  const items = [
    { key: 'hasPaper' as const, label: t.filterHasPaper, Icon: ScrollText },
    { key: 'isFree' as const, label: t.filterFree, Icon: CircleDollarSign },
    { key: 'accessible' as const, label: t.filterAccessible, Icon: Accessibility },
    { key: 'seated' as const, label: t.filterSeated, Icon: Armchair },
  ]

  const anyOn = items.some((i) => value[i.key])

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map(({ key, label, Icon }) => {
        const on = Boolean(value[key])
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            className={`chip shrink-0 ${on ? 'chip--on' : ''}`}
            onClick={() => onChange({ ...value, [key]: on ? undefined : true })}
          >
            <Icon size={14} strokeWidth={2.2} />
            {label}
          </button>
        )
      })}

      {anyOn && (
        <button
          type="button"
          className="chip shrink-0 border-dashed"
          onClick={() => onChange({})}
        >
          <X size={14} />
          {t.clearFilters}
        </button>
      )}
    </div>
  )
}

import { useNavigate } from 'react-router-dom'
import { CircleUserRound, Globe, Languages } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
// 同样绕开桶文件，别把地图库拉进首屏（见 src/map/index.ts）
import { setRegion, type Region } from '@/map/region'

interface TopBarProps {
  region: Region
  onRegionChange: (r: Region) => void
}

/**
 * 语言、地图版本、账号的入口。
 *
 * 地图版本放在最外层是刻意的：在北京上海实测时，第一件要确认的事就是
 * 「现在用的是不是高德底图、点位有没有偏」，切换必须一步到位，不能埋进二级菜单。
 */
export default function TopBar({ region, onRegionChange }: TopBarProps) {
  const { t, locale, toggleLocale } = useI18n()
  const navigate = useNavigate()

  function switchRegion(next: Region) {
    if (next === region) return
    setRegion(next)
    onRegionChange(next)
  }

  return (
    <header className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20">
      <div className="pointer-events-auto flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-baseline gap-1.5 rounded-xl bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur">
          <span className="text-base leading-none" aria-hidden="true">
            💩
          </span>
          {locale === 'zh' ? (
            <>
              <span className="text-base font-bold tracking-tight">{t.appName}</span>
              <span className="text-[10px] font-medium text-ink-faint">{t.appNameLatin}</span>
            </>
          ) : (
            <span className="text-base font-bold tracking-tight">{t.appNameLatin}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* 地区切换：两态开关，当前态高亮 */}
          <div className="flex overflow-hidden rounded-xl bg-white/95 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => switchRegion('cn')}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                region === 'cn' ? 'bg-poo-600 text-white' : 'text-ink-soft'
              }`}
              title={t.regionHint}
            >
              <Globe size={13} className="mr-1 inline" />
              CN
            </button>
            <button
              type="button"
              onClick={() => switchRegion('intl')}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                region === 'intl' ? 'bg-poo-600 text-white' : 'text-ink-soft'
              }`}
            >
              INTL
            </button>
          </div>

          <button
            type="button"
            onClick={toggleLocale}
            className="rounded-xl bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink-soft shadow-sm backdrop-blur"
            aria-label={t.language}
          >
            <Languages size={13} className="mr-1 inline" />
            {locale === 'zh' ? 'EN' : '中'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/me')}
            className="rounded-xl bg-white/95 p-1.5 shadow-sm backdrop-blur"
            aria-label={t.account}
          >
            <CircleUserRound size={18} />
          </button>
        </div>
      </div>
    </header>
  )
}

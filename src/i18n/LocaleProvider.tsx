import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Locale } from '@/api/types'
import { COPY, type Copy } from '@/constants/copy'

const STORAGE_KEY = 'pooping.locale'

interface LocaleContextValue {
  locale: Locale
  /** 文案字典。组件里写 `t.publish`，不写字符串字面量。 */
  t: Copy
  setLocale: (l: Locale) => void
  toggleLocale: () => void
}

export const LocaleContext = createContext<LocaleContextValue | null>(null)

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh'

  // ?lang=en 优先，真机上直接切，方便对着截图比对两版文案
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (fromUrl === 'zh' || fromUrl === 'en') return fromUrl

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* 隐私模式 */
  }

  const fromEnv = import.meta.env.VITE_DEFAULT_LOCALE?.trim()
  if (fromEnv === 'zh' || fromEnv === 'en') return fromEnv

  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    // 让浏览器知道当前语言：影响换行断词、字体回退和读屏器发音
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.title = locale === 'zh' ? '厕评 · pooping' : 'pooping'
  }, [locale])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: COPY[locale],
      setLocale,
      toggleLocale: () => setLocale(locale === 'zh' ? 'en' : 'zh'),
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

import { useContext } from 'react'
import { LocaleContext } from './LocaleProvider'

export function useI18n() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useI18n 必须在 <LocaleProvider> 内使用')
  return ctx
}

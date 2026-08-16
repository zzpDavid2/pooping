import type { FeaturedReview, Locale, Review, Toilet } from '@/api/types'
import type { Copy } from '@/constants/copy'

/**
 * 名称回退链：英文界面优先 name_en，没有就用中文名 —— 显示中文名也比显示空白强。
 * OSM 上大量 amenity=toilets 是没有 name 的，导入脚本会补一个默认名。
 */
export function displayName(t: Toilet, locale: Locale): string {
  // 票选出来的名字优先 —— 那是这个地方现在实际被叫做什么
  const voted = t.votedName?.trim()
  if (voted) return voted

  if (locale === 'en') return t.nameEn?.trim() || t.name
  return t.name?.trim() || t.nameEn || ''
}

/**
 * 总分：四个维度的平均，5 分制。没人评过返回 null。
 * 只算填了的维度 —— 老数据可能没有 avg_privacy。
 */
export function overallScore(t: Toilet): number | null {
  if (t.reviewCount === 0) return null
  const parts = [t.avgClean, t.avgSmell, t.avgQueue, t.avgPrivacy].filter(
    (v): v is number => v !== null,
  )
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0) / parts.length
}

export function displayAddress(t: Toilet, locale: Locale): string | null {
  const primary = locale === 'en' ? t.addressEn : t.address
  const fallback = locale === 'en' ? t.address : t.addressEn
  return primary?.trim() || fallback?.trim() || null
}

/** 楼栋 + 楼层，两个都可能为空 */
export function displayPlace(t: Toilet): string | null {
  return [t.building, t.floor].filter(Boolean).join(' · ') || null
}

/** FeaturedReview 里带的是精简版厕所信息（没有 review count 等字段），跟 displayName 分开一个实现 */
export function displayFeaturedToiletName(toilet: FeaturedReview['toilet'], locale: Locale): string {
  const voted = toilet.votedName?.trim()
  if (voted) return voted
  if (locale === 'en') return toilet.nameEn?.trim() || toilet.name
  return toilet.name?.trim() || toilet.nameEn || ''
}

export function formatDistance(meters: number | null, t: Copy): string {
  if (meters === null || !Number.isFinite(meters)) return ''
  return t.meters(meters)
}

export function formatRelativeTime(iso: string, t: Copy): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''

  const diffMin = Math.floor((Date.now() - then) / 60000)
  if (diffMin < 1) return t.justNow
  if (diffMin < 60) return t.minutesAgo(diffMin)

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return t.hoursAgo(diffHour)

  return t.daysAgo(Math.floor(diffHour / 24))
}

export function reviewAuthor(r: Review, t: Copy): string {
  return r.nickname?.trim() || t.anonymous
}

/** 评分 1–5，5 最好。null 表示没人评过。 */
export function ratingBucket(v: number | null): 'good' | 'mid' | 'bad' | 'none' {
  if (v === null) return 'none'
  if (v >= 4) return 'good'
  if (v >= 2.5) return 'mid'
  return 'bad'
}

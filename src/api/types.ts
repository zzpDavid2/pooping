// 领域类型。UI 只认这里的类型，不认 Supabase 的行类型。

export type Locale = 'zh' | 'en'

export type ReviewStyle =
  | 'wenyan' // 文言文体
  | 'xiaohongshu' // 小红书体
  | 'waimai' // 外卖差评体
  | 'eulogy' // 悼词体
  | 'luxun' // 鲁迅体
  | 'documentary' // 纪录片旁白
  | 'michelin' // 米其林指南体
  | 'rap' // 说唱

export const REVIEW_STYLES: readonly ReviewStyle[] = [
  'wenyan',
  'xiaohongshu',
  'waimai',
  'eulogy',
  'luxun',
  'documentary',
  'michelin',
  'rap',
]

export type Gender = 'male' | 'female' | 'unisex' | 'both'
export type SeatType = 'squat' | 'seated' | 'both'
export type Category =
  | 'public'
  | 'mall'
  | 'campus'
  | 'restaurant'
  | 'transit'
  | 'office'
  | 'park'
  | 'other'

export type ReportReason =
  | 'offensive'
  | 'false_info'
  | 'spam'
  | 'privacy'
  | 'other'

/** 举报"这个点位有问题"，跟举报评价（ReportReason）是两回事——理由体系不一样。 */
export type ToiletReportReason = 'not_exist' | 'closed' | 'other'

/** 永远是 WGS-84。转 GCJ-02 只发生在 src/map/coords.ts。 */
export interface LatLng {
  lat: number
  lng: number
}

export interface Toilet extends LatLng {
  id: string
  name: string
  nameEn: string | null
  /** 投票选出来的名字，胜过 name/nameEn。见 src/lib/format.ts 的 displayName */
  votedName: string | null
  address: string | null
  addressEn: string | null
  building: string | null
  floor: string | null
  gender: Gender | null
  category: Category | null

  hasPaper: boolean | null
  hasSoap: boolean | null
  hasDryer: boolean | null
  hasHook: boolean | null
  accessible: boolean | null
  babyChanging: boolean | null
  seatType: SeatType | null
  stallCount: number | null
  isFree: boolean | null
  needsCode: boolean | null
  open24h: boolean | null

  reviewCount: number
  avgClean: number | null
  avgQueue: number | null
  avgSmell: number | null
  avgPrivacy: number | null

  source: string | null
  funnyUp: number
  funnyDown: number
  funnyScore: number
  funnyVote: -1 | 0 | 1
  /** 只有 nearby 查询会带上，详情页没有 */
  distanceM: number | null
  /**
   * 当前用户能不能改这个点的坐标（自己报的点 或 自己是管理员）。
   * 由数据库算好（toilet_by_id），列表查询不算，恒为 false。
   */
  canFixLocation: boolean
}

export interface Review {
  id: string
  toiletId: string
  userId: string
  clean: number | null
  smell: number | null
  queue: number | null
  privacy: number | null
  quickTags: string[]
  rawNote: string | null
  /** 展示正文。AI 生成或用户手写，看 isAi */
  aiText: string
  /** 手写评价没有文风，为 null */
  aiStyle: ReviewStyle | null
  /** false = 用户自己写的，不能挂「AI 润色」标（CLAUDE.md 10.2） */
  isAi: boolean
  lang: Locale
  editedByUser: boolean
  isSeed: boolean
  nickname: string | null
  funnyUp: number
  funnyDown: number
  funnyScore: number
  funnyVote: -1 | 0 | 1
  createdAt: string
}

export interface FeaturedReview extends Review {
  toilet: Pick<Toilet, 'id' | 'name' | 'nameEn' | 'votedName' | 'building' | 'floor'>
}

/** 一个候选名 + 票数。Discord reaction 那种玩法。 */
export interface NameProposal {
  id: string
  name: string
  votes: number
  votedByMe: boolean
  isWinner: boolean
}

export interface ToiletFilters {
  hasPaper?: boolean
  isFree?: boolean
  accessible?: boolean
  seated?: boolean
}

export interface ApiError {
  message: string
  /** 机器可读，UI 用它挑文案（如 'rate_limited'），不要直接展示 message */
  code: string
}

/**
 * 所有 api 函数的返回形状。不向 UI 抛异常（CLAUDE.md 3.1）。
 * 判别式联合：`if (res.error) return` 之后 `res.data` 自动收窄成非 null。
 */
export type Result<T> = { data: T; error: null } | { data: null; error: ApiError }

export function ok<T>(data: T): Result<T> {
  return { data, error: null }
}

export function fail<T = never>(code: string, message: string): Result<T> {
  return { data: null, error: { code, message } }
}

/** 把任意抛出物收敛成 ApiError，保证 api 层永不抛。 */
export function fromThrown<T = never>(e: unknown, fallbackCode = 'unknown'): Result<T> {
  if (e && typeof e === 'object' && 'message' in e) {
    const code =
      'code' in e && typeof (e as { code: unknown }).code === 'string'
        ? (e as { code: string }).code
        : fallbackCode
    return fail(code, String((e as { message: unknown }).message))
  }
  return fail(fallbackCode, String(e))
}

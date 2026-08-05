// UI 层的唯一数据入口。组件只从这里 import，绝不碰 supabase 客户端本身。
export * from './types'
export { isSupabaseConfigured } from './client'
export { ensureSession, getCurrentUser, setNickname, type CurrentUser } from './auth'
export {
  getNearbyToilets,
  getToiletById,
  getTopToilets,
  createToilet,
  voteToiletFunny,
  type NearbyOptions,
  type CreateToiletInput,
} from './toilets'
export {
  getReviews,
  getTopReviews,
  getRecentReviews,
  voteReviewFunny,
  generateReview,
  createReview,
  deleteReview,
  type GenerateInput,
  type GeneratedReview,
  type CreateReviewInput,
} from './reviews'
export { reportReview } from './reports'
export {
  getToiletNames,
  voteToiletName,
  unvoteToiletName,
  proposeToiletName,
} from './names'

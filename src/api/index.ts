// UI 层的唯一数据入口。组件只从这里 import，绝不碰 supabase 客户端本身。
export * from './types'
export { isSupabaseConfigured } from './client'
export {
  ensureSession,
  getCurrentUser,
  setNickname,
  startEmailLogin,
  verifyEmailLogin,
  signOut,
  type CurrentUser,
  type EmailLoginMode,
} from './auth'
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
  getMyReviews,
  getMyReviewStats,
  type GenerateInput,
  type GeneratedReview,
  type CreateReviewInput,
  type ReviewStats,
} from './reviews'
export { reportReview, reportToilet } from './reports'
export { getMyPin, saveMyPin, deleteMyPin, type ToiletPin } from './pins'
export { searchAddress, type GeocodeResult } from './geocode'
export {
  getToiletNames,
  voteToiletName,
  unvoteToiletName,
  proposeToiletName,
} from './names'

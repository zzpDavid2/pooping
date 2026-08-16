import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Loader2, LogOut } from 'lucide-react'

import {
  getCurrentUser,
  getMyReviews,
  getMyReviewStats,
  signOut,
  startEmailLogin,
  verifyEmailLogin,
  voteReviewFunny,
  type CurrentUser,
  type EmailLoginMode,
  type FeaturedReview,
  type Review,
  type ReviewStats,
} from '@/api'
import ReviewCard from '@/components/ReviewCard'
import { useI18n } from '@/i18n/useI18n'
import { displayFeaturedToiletName } from '@/lib/format'

/**
 * "我的" 独立页面（跟厕所详情页一样盖在地图上，见 App.tsx 的路由说明）。
 *
 * 原来是个小弹窗，塞不下"我写的评论"这种可能很长的列表，改成页面。
 * 访客模式下是邮箱验证码登录表单；登录后展示战绩 + 按好笑度排序的自己写的评论。
 */
export default function ProfilePage() {
  const { t, locale } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()

  const [user, setUser] = useState<CurrentUser | null>(null)
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [reviews, setReviews] = useState<FeaturedReview[]>([])
  const [loadingUser, setLoadingUser] = useState(true)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<EmailLoginMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void getCurrentUser().then((res) => {
      if (cancelled) return
      setUser(res.data ?? null)
      setLoadingUser(false)
      if (res.data && !res.data.isAnonymous) loadMyStuff()
    })

    return () => {
      cancelled = true
    }
  }, [])

  function loadMyStuff() {
    void getMyReviewStats().then((s) => setStats(s.data))
    void getMyReviews().then((r) => {
      if (r.data) setReviews(r.data)
    })
  }

  function goBack() {
    if (location.key === 'default') {
      navigate('/', { replace: true })
      return
    }
    navigate(-1)
  }

  async function handleSendCode() {
    setBusy(true)
    setError(null)
    const res = await startEmailLogin(email)
    setBusy(false)

    if (res.error) {
      setError(t.accountSendFailed)
      return
    }
    setMode(res.data)
  }

  async function handleVerify() {
    if (!mode) return
    setBusy(true)
    setError(null)
    const res = await verifyEmailLogin(email, code, mode)
    setBusy(false)

    if (res.error) {
      setError(t.accountVerifyFailed)
      return
    }
    setUser(res.data)
    loadMyStuff()
  }

  async function handleSignOut() {
    setBusy(true)
    const res = await signOut()
    setBusy(false)
    if (res.data) {
      setUser(res.data)
      setStats(null)
      setReviews([])
      setEmail('')
      setCode('')
      setMode(null)
    }
  }

  function handleReviewVote(review: Review, value: -1 | 1) {
    setReviews((cur) =>
      cur
        .map((r) => (r.id === review.id ? applyReviewVote(r, value) : r))
        .sort((a, b) => b.funnyScore - a.funnyScore || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    )
    void voteReviewFunny(review.id, value).then((res) => {
      if (!res.data) return
      setReviews((cur) =>
        cur
          .map((r) => (r.id === res.data!.id ? { ...r, ...res.data! } : r))
          .sort((a, b) => b.funnyScore - a.funnyScore || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      )
    })
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-poo-50">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 border-b border-poo-100 bg-white/95 px-2 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          className="rounded-lg p-1.5 text-ink-soft hover:bg-poo-50"
          aria-label={t.back}
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{t.account}</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-6">
        {loadingUser ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-ink-faint" />
          </div>
        ) : user && !user.isAnonymous ? (
          <>
            <section className="card">
              <p className="text-sm text-ink-soft">{user.email}</p>

              <div className="mt-3 rounded-xl border border-poo-200 bg-poo-50 p-4">
                <p className="mb-3 text-sm font-semibold">{t.accountStats}</p>
                {stats ? (
                  <div className="flex gap-6">
                    <div>
                      <p className="text-2xl font-bold text-poo-700">{stats.aiCount}</p>
                      <p className="text-xs text-ink-soft">
                        {t.accountStatsAi}
                        {t.accountStatsUnit}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-poo-700">{stats.manualCount}</p>
                      <p className="text-xs text-ink-soft">
                        {t.accountStatsManual}
                        {t.accountStatsUnit}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Loader2 size={16} className="animate-spin text-ink-faint" />
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={busy}
                className="btn btn--ghost mt-3 w-full"
              >
                <LogOut size={16} />
                {t.accountSignOut}
              </button>
            </section>

            <section className="space-y-2">
              <h3 className="px-1 text-sm font-semibold">{t.accountMyReviews}</h3>
              {reviews.length === 0 ? (
                <div className="card text-center">
                  <p className="text-sm text-ink-soft">{t.accountNoReviews}</p>
                </div>
              ) : (
                reviews.map((r) => (
                  <div key={r.id}>
                    <p className="mb-1 px-1 text-[11px] font-medium text-poo-700">
                      {displayFeaturedToiletName(r.toilet, locale)}
                    </p>
                    <ReviewCard review={r} onVote={handleReviewVote} />
                  </div>
                ))
              )}
            </section>
          </>
        ) : (
          <section className="card">
            <p className="text-sm font-semibold">{t.accountGuestMode}</p>
            <p className="mt-1 text-xs text-ink-soft">{t.accountGuestHint}</p>

            <div className="mt-4">
              <input
                id="accountEmail"
                name="accountEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={mode !== null}
                placeholder={t.accountEmailPlaceholder}
                className="w-full rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500 disabled:bg-poo-50 disabled:text-ink-soft"
              />
            </div>

            {mode === null ? (
              <button
                type="button"
                onClick={() => void handleSendCode()}
                disabled={busy || !email.trim()}
                className="btn btn--primary mt-3 w-full"
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t.accountSending}
                  </>
                ) : (
                  t.accountSendCode
                )}
              </button>
            ) : (
              <>
                <p className="mt-3 text-xs text-ink-soft">{t.accountCodeSent}</p>
                <input
                  id="accountCode"
                  name="accountCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder={t.accountCodePlaceholder}
                  className="mt-1.5 w-full rounded-xl border border-poo-200 px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-poo-500"
                />
                <button
                  type="button"
                  onClick={() => void handleVerify()}
                  disabled={busy || code.length < 4}
                  className="btn btn--primary mt-3 w-full"
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t.accountVerifying}
                    </>
                  ) : (
                    t.accountVerify
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSendCode()}
                  disabled={busy}
                  className="mt-2 w-full text-center text-xs text-ink-soft underline"
                >
                  {t.accountResendCode}
                </button>
              </>
            )}

            {error && (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function applyReviewVote(review: FeaturedReview, value: -1 | 1): FeaturedReview {
  if (review.funnyVote === value) return review
  const next = { ...review }
  if (review.funnyVote === 1) next.funnyUp -= 1
  if (review.funnyVote === -1) next.funnyDown -= 1
  if (value === 1) next.funnyUp += 1
  if (value === -1) next.funnyDown += 1
  next.funnyVote = value
  next.funnyScore = next.funnyUp - next.funnyDown
  return next
}

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Flag, MapPin, PenLine, ThumbsDown, ThumbsUp } from 'lucide-react'

import {
  getReviews,
  getToiletById,
  voteReviewFunny,
  voteToiletFunny,
  type Review,
  type Toilet,
} from '@/api'
import FacilityWall from '@/components/FacilityWall'
import FixLocationSheet from '@/components/FixLocationSheet'
import { RatingBars } from '@/components/Ratings'
import ReviewCard from '@/components/ReviewCard'
import NameVote from '@/components/NameVote'
import PinBox from '@/components/PinBox'
import PooScore from '@/components/PooScore'
import ReportToiletDialog from '@/components/ReportToiletDialog'
import ReviewComposer from '@/components/ReviewComposer'
import ShareCard from '@/components/ShareCard'
import { useI18n } from '@/i18n/useI18n'
import { displayAddress, displayName, displayPlace } from '@/lib/format'

interface ToiletPageProps {
  /** 由 App 从路由里取出后传进来。这个页面是覆盖在地图上的，不是独立路由。 */
  toiletId: string
}

export default function ToiletPage({ toiletId: id }: ToiletPageProps) {
  const { t, locale } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()

  const [toilet, setToilet] = useState<Toilet | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [sharing, setSharing] = useState<Review | null>(null)
  const [reportingToilet, setReportingToilet] = useState(false)
  const [fixingLocation, setFixingLocation] = useState(false)
  const [locationFixed, setLocationFixed] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)

    void Promise.all([getToiletById(id), getReviews(id)]).then(([tRes, rRes]) => {
      if (cancelled) return
      setLoading(false)
      if (tRes.data) setToilet(tRes.data)
      if (rRes.data) setReviews(rRes.data)
    })

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return <CenteredMessage>{t.loading}</CenteredMessage>
  }

  if (!toilet) {
    return (
      <CenteredMessage>
        <p>{t.notFound}</p>
        <Link to="/" className="btn btn--ghost mt-3">
          {t.back}
        </Link>
      </CenteredMessage>
    )
  }

  const address = displayAddress(toilet, locale)
  const place = displayPlace(toilet)

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
          .map((r) => (r.id === res.data!.id ? res.data! : r))
          .sort((a, b) => b.funnyScore - a.funnyScore || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      )
    })
  }

  function handleToiletFunnyVote(value: -1 | 1) {
    if (!toilet) return
    const toiletId = toilet.id
    setToilet((cur) => (cur ? applyToiletVote(cur, value) : cur))
    void voteToiletFunny(toiletId, value).then((res) => {
      if (res.data) setToilet(res.data)
    })
  }

  function goBack() {
    if (location.key === 'default') {
      navigate('/', { replace: true })
      return
    }
    navigate(-1)
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
        <h1 className="min-w-0 flex-1 truncate font-semibold">{displayName(toilet, locale)}</h1>
      </header>

      {/* pb 要盖过底部固定的「写条锐评」栏（约 65px + 安全区），否则滚到底时
          最后一块内容会被压在按钮下面，点不到 —— 加密码框那次就踩了这个坑 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-32">
        <section className="card">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 flex-1 text-lg font-bold leading-snug">
              {displayName(toilet, locale)}
            </h2>
            <PooScore toilet={toilet} size="md" />
          </div>
          {place && <p className="mt-0.5 text-sm text-ink-soft">{place}</p>}
          {address && <p className="mt-1 text-xs text-ink-faint">{address}</p>}

          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">{t.ratings}</h3>
            <RatingBars toilet={toilet} />
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-poo-50 px-3 py-2">
            <span className="text-sm font-medium text-ink-soft">{t.funnyScore}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleToiletFunnyVote(1)}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm ${
                  toilet.funnyVote === 1
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-white text-ink-soft hover:bg-emerald-50'
                }`}
                aria-label={t.funnyUp}
              >
                <ThumbsUp size={15} />
                {toilet.funnyUp}
              </button>
              <button
                type="button"
                onClick={() => handleToiletFunnyVote(-1)}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm ${
                  toilet.funnyVote === -1
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-white text-ink-soft hover:bg-rose-50'
                }`}
                aria-label={t.funnyDown}
              >
                <ThumbsDown size={15} />
                {toilet.funnyDown}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setReportingToilet(true)}
              className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink-soft"
            >
              <Flag size={12} />
              {t.reportToiletEntry}
            </button>

            {/* 只有自己报的点、或管理员才看得到。能不能真改由数据库说了算 */}
            {toilet.canFixLocation && (
              <button
                type="button"
                onClick={() => setFixingLocation(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-poo-700 hover:text-poo-800"
              >
                <MapPin size={12} />
                {t.fixLocation}
              </button>
            )}
          </div>

          {locationFixed && (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t.fixLocationDone}
            </p>
          )}
        </section>

        <section className="card">
          <NameVote
            toiletId={toilet.id}
            fallbackName={originalDisplayName(toilet, locale)}
            onWinnerChange={(name) =>
              setToilet((cur) => (cur && cur.votedName !== name ? { ...cur, votedName: name } : cur))
            }
          />
        </section>

        <section className="card">
          <h3 className="mb-2.5 text-sm font-semibold">{t.facilities}</h3>
          <FacilityWall toilet={toilet} />
        </section>

        <section className="card">
          <PinBox toiletId={toilet.id} />
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-semibold">{t.reviews}</h3>
            <span className="text-xs text-ink-faint">{t.reviewCount(reviews.length)}</span>
          </div>

          {reviews.length === 0 ? (
            <div className="card text-center">
              <p className="text-sm text-ink-soft">{t.beFirst}</p>
            </div>
          ) : (
            reviews.map((r) => (
              <ReviewCard key={r.id} review={r} onShare={setSharing} onVote={handleReviewVote} />
            ))
          )}
        </section>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 border-t border-poo-100 bg-white/95 px-3 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="btn btn--primary w-full"
        >
          <PenLine size={16} />
          {t.writeReview}
        </button>
      </div>

      {composing && (
        <ReviewComposer
          toilet={toilet}
          onClose={() => setComposing(false)}
          onPublished={(review) => {
            setComposing(false)
            setReviews((cur) => [review, ...cur])
            // 聚合字段由数据库触发器更新，本地先乐观加一，省一次往返
            setToilet((cur) => (cur ? { ...cur, reviewCount: cur.reviewCount + 1 } : cur))
            setSharing(review)
          }}
        />
      )}

      {sharing && (
        <ShareCard
          review={sharing}
          toiletName={displayName(toilet, locale)}
          onClose={() => setSharing(null)}
        />
      )}

      {reportingToilet && (
        <ReportToiletDialog toiletId={toilet.id} onClose={() => setReportingToilet(false)} />
      )}

      {fixingLocation && (
        <FixLocationSheet
          toiletId={toilet.id}
          name={displayName(toilet, locale)}
          current={{ lat: toilet.lat, lng: toilet.lng }}
          onClose={() => setFixingLocation(false)}
          onSaved={(next) => {
            setFixingLocation(false)
            setLocationFixed(true)
            setToilet((cur) => (cur ? { ...cur, ...next } : cur))
          }}
        />
      )}
    </div>
  )
}

function applyReviewVote(review: Review, value: -1 | 1): Review {
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

function applyToiletVote(toilet: Toilet, value: -1 | 1): Toilet {
  if (toilet.funnyVote === value) return toilet
  const next = { ...toilet }
  if (toilet.funnyVote === 1) next.funnyUp -= 1
  if (toilet.funnyVote === -1) next.funnyDown -= 1
  if (value === 1) next.funnyUp += 1
  if (value === -1) next.funnyDown += 1
  next.funnyVote = value
  next.funnyScore = next.funnyUp - next.funnyDown
  return next
}

function originalDisplayName(toilet: Toilet, locale: 'zh' | 'en'): string {
  if (locale === 'en') return toilet.nameEn?.trim() || toilet.name
  return toilet.name?.trim() || toilet.nameEn || ''
}

/** 加载中和找不到时也要盖住地图，否则会透出下面那张图，看着像没跳转成功。 */
function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-poo-50 text-sm text-ink-soft">
      {children}
    </div>
  )
}

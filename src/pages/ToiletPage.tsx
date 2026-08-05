import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, PenLine } from 'lucide-react'

import { getReviews, getToiletById, type Review, type Toilet } from '@/api'
import FacilityWall from '@/components/FacilityWall'
import { RatingBars } from '@/components/Ratings'
import ReviewCard from '@/components/ReviewCard'
import NameVote from '@/components/NameVote'
import PooScore from '@/components/PooScore'
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
  const navigate = useNavigate()

  const [toilet, setToilet] = useState<Toilet | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [sharing, setSharing] = useState<Review | null>(null)

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

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-poo-50">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 border-b border-poo-100 bg-white/95 px-2 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 text-ink-soft hover:bg-poo-50"
          aria-label={t.back}
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{displayName(toilet, locale)}</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-24">
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
        </section>

        <section className="card">
          <NameVote
            toiletId={toilet.id}
            fallbackName={displayName(toilet, locale)}
            onWinnerChange={(name) =>
              setToilet((cur) => (cur && cur.votedName !== name ? { ...cur, votedName: name } : cur))
            }
          />
        </section>

        <section className="card">
          <h3 className="mb-2.5 text-sm font-semibold">{t.facilities}</h3>
          <FacilityWall toilet={toilet} />
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
            reviews.map((r) => <ReviewCard key={r.id} review={r} onShare={setSharing} />)
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
    </div>
  )
}

/** 加载中和找不到时也要盖住地图，否则会透出下面那张图，看着像没跳转成功。 */
function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-poo-50 text-sm text-ink-soft">
      {children}
    </div>
  )
}

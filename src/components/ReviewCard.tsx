import { useState } from 'react'
import { Flag, PenLine, Share2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'

import type { Review } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'
import { formatRelativeTime, reviewAuthor } from '@/lib/format'
import { styleMeta } from '@/constants/styles'
import { tagLabel, tagTone } from '@/constants/tags'
import ReportDialog from './ReportDialog'

interface ReviewCardProps {
  review: Review
  onShare?: (review: Review) => void
  onVote?: (review: Review, value: -1 | 1) => void
}

const TONE_CLASS = {
  bad: 'bg-rose-50 text-rose-700',
  good: 'bg-emerald-50 text-emerald-700',
  neutral: 'bg-poo-100 text-ink-soft',
} as const

export default function ReviewCard({ review, onShare, onVote }: ReviewCardProps) {
  const { t, locale } = useI18n()
  const [reporting, setReporting] = useState(false)
  // 手写评价没有文风，也不该有文风标签
  const meta = review.isAi && review.aiStyle ? styleMeta(review.aiStyle) : null

  return (
    <article className="card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{reviewAuthor(review, t)}</span>
          <span className="shrink-0 text-xs text-ink-faint">
            {formatRelativeTime(review.createdAt, t)}
          </span>
        </div>

        {meta && (
          <span className="shrink-0 rounded-full bg-poo-100 px-2 py-0.5 text-[11px] text-poo-800">
            {meta.emoji} {meta.label[locale]}
          </span>
        )}
      </div>

      <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-relaxed">{review.aiText}</p>

      {review.quickTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {review.quickTags.map((key) => (
            <span
              key={key}
              className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CLASS[tagTone(key)]}`}
            >
              {tagLabel(key, locale)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-poo-100 pt-2.5">
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          {/*
            AI 标识必须可见（CLAUDE.md 10.2）。它是卖点，不是要藏的东西。
            反过来同样重要：**手写的绝不能挂 AI 标**，否则这个标识就失去意义了。
          */}
          {review.isAi ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-poo-50 px-2 py-0.5 text-poo-700">
              <Sparkles size={11} />
              {t.aiBadge}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-ink-soft">
              <PenLine size={11} />
              {t.humanBadge}
            </span>
          )}
          {review.editedByUser && <span>{t.editedBadge}</span>}
          {review.isSeed && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              {t.seedBadge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onVote && (
            <>
              <button
                type="button"
                onClick={() => onVote(review, 1)}
                className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs ${
                  review.funnyVote === 1
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-ink-faint hover:bg-poo-50 hover:text-ink-soft'
                }`}
                aria-label={t.funnyUp}
              >
                <ThumbsUp size={14} />
                {review.funnyUp}
              </button>
              <button
                type="button"
                onClick={() => onVote(review, -1)}
                className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs ${
                  review.funnyVote === -1
                    ? 'bg-rose-50 text-rose-700'
                    : 'text-ink-faint hover:bg-poo-50 hover:text-ink-soft'
                }`}
                aria-label={t.funnyDown}
              >
                <ThumbsDown size={14} />
                {review.funnyDown}
              </button>
            </>
          )}
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(review)}
              className="rounded-lg p-1.5 text-ink-faint hover:bg-poo-50 hover:text-ink-soft"
              aria-label={t.share}
            >
              <Share2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="rounded-lg p-1.5 text-ink-faint hover:bg-poo-50 hover:text-ink-soft"
            aria-label={t.report}
          >
            <Flag size={15} />
          </button>
        </div>
      </div>

      {reporting && <ReportDialog reviewId={review.id} onClose={() => setReporting(false)} />}
    </article>
  )
}

import { useState } from 'react'

import { reportReview, type ReportReason } from '@/api'
import { useI18n } from '@/i18n/useI18n'

interface ReportDialogProps {
  reviewId: string
  onClose: () => void
}

/** V1 只收集，不做处理流程（CLAUDE.md 第 9 节）。 */
export default function ReportDialog({ reviewId, onClose }: ReportDialogProps) {
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const reasons: { key: ReportReason; label: string }[] = [
    { key: 'offensive', label: t.reasonOffensive },
    { key: 'false_info', label: t.reasonFalseInfo },
    { key: 'spam', label: t.reasonSpam },
    { key: 'privacy', label: t.reasonPrivacy },
    { key: 'other', label: t.reasonOther },
  ]

  async function submit(reason: ReportReason) {
    setSubmitting(true)
    await reportReview(reviewId, reason)
    // 举报失败也告诉用户"收到了"：这里没有让用户重试的价值，
    // 反复弹错误只会让人以为自己做错了什么
    setSubmitting(false)
    setDone(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 animate-fade-in sm:items-center"
      onClick={onClose}
    >
      <div
        className="safe-bottom w-full max-w-sm rounded-t-2xl bg-white p-4 animate-slide-up sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <p className="py-6 text-center text-sm text-ink-soft">{t.reportSubmitted}</p>
        ) : (
          <>
            <h3 className="mb-3 font-semibold">{t.reportTitle}</h3>
            <div className="space-y-1.5">
              {reasons.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit(key)}
                  className="w-full rounded-xl bg-poo-50 px-4 py-2.5 text-left text-sm hover:bg-poo-100 disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} className="btn btn--ghost mt-3 w-full">
              {t.cancel}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'

import { reportToilet, type ToiletReportReason } from '@/api'
import { useI18n } from '@/i18n/useI18n'

interface ReportToiletDialogProps {
  toiletId: string
  onClose: () => void
}

/**
 * 上报"这个厕所有问题"。V1 只收集，人工在 Supabase Studio 里看
 * flagged_toilets 视图决定删不删（CLAUDE.md 第 2 节：不做管理后台）。
 *
 * 跟评价举报不一样的地方：reason 允许完全不填——用户可能就是路过觉得
 * 不对劲，说不出具体原因，不能逼着他们编一个。
 */
export default function ReportToiletDialog({ toiletId, onClose }: ReportToiletDialogProps) {
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [otherNote, setOtherNote] = useState<string | null>(null)

  async function submit(reason?: ToiletReportReason, note?: string) {
    setSubmitting(true)
    await reportToilet(toiletId, reason, note)
    // 提交失败也告诉用户"收到了"：这里没有让用户重试的价值，
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
            <h3 className="mb-3 font-semibold">{t.reportToiletTitle}</h3>

            <div className="space-y-1.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit('not_exist')}
                className="w-full rounded-xl bg-poo-50 px-4 py-2.5 text-left text-sm hover:bg-poo-100 disabled:opacity-50"
              >
                {t.reasonNotExist}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit('closed')}
                className="w-full rounded-xl bg-poo-50 px-4 py-2.5 text-left text-sm hover:bg-poo-100 disabled:opacity-50"
              >
                {t.reasonClosed}
              </button>

              {otherNote === null ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setOtherNote('')}
                  className="w-full rounded-xl bg-poo-50 px-4 py-2.5 text-left text-sm hover:bg-poo-100 disabled:opacity-50"
                >
                  {t.reasonOther}
                </button>
              ) : (
                <div className="rounded-xl bg-poo-50 p-3">
                  <input
                    autoFocus
                    value={otherNote}
                    onChange={(e) => setOtherNote(e.target.value.slice(0, 500))}
                    placeholder={t.reportOtherPlaceholder}
                    className="w-full rounded-lg border border-poo-200 bg-white px-3 py-2 text-sm outline-none focus:border-poo-500"
                  />
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submit('other', otherNote)}
                    className="btn btn--primary mt-2 w-full"
                  >
                    {t.reportOtherSubmit}
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="mt-3 w-full text-center text-xs text-ink-soft underline disabled:opacity-50"
            >
              {t.reportSkipReason}
            </button>

            <button type="button" onClick={onClose} className="btn btn--ghost mt-3 w-full">
              {t.cancel}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

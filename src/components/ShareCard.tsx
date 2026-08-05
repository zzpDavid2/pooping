import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

import type { Review } from '@/api/types'
import { useI18n } from '@/i18n/useI18n'
import { downloadDataUrl, renderShareCard } from '@/lib/shareImage'

interface ShareCardProps {
  review: Review
  toiletName: string
  onClose: () => void
}

export default function ShareCard({ review, toiletName, onClose }: ShareCardProps) {
  const { t, locale } = useI18n()
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    // 画一张 1080×1350 的 PNG 要几十毫秒，让出一帧免得点击后界面卡住
    const id = window.setTimeout(() => {
      setDataUrl(renderShareCard({ review, toiletName, locale }))
    }, 0)
    return () => window.clearTimeout(id)
  }, [review, toiletName, locale])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {dataUrl ? (
          // 用 <img> 而不是 <canvas>：iOS Safari 上只有 img 支持长按存图
          <img
            src={dataUrl}
            alt={t.shareTitle}
            className="max-h-[70vh] w-full rounded-2xl shadow-2xl"
          />
        ) : (
          <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl bg-white/10 text-sm text-white/70">
            {t.shareGenerating}
          </div>
        )}

        <p className="text-center text-xs text-white/70">{t.shareHint}</p>

        <div className="flex w-full gap-2">
          <button type="button" onClick={onClose} className="btn btn--ghost flex-1">
            <X size={16} />
            {t.close}
          </button>
          <button
            type="button"
            disabled={!dataUrl}
            onClick={() => dataUrl && downloadDataUrl(dataUrl, `pooping-${review.id.slice(0, 8)}.png`)}
            className="btn btn--primary flex-1"
          >
            <Download size={16} />
            {t.saveImage}
          </button>
        </div>
      </div>
    </div>
  )
}

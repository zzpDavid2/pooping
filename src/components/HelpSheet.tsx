import { createPortal } from 'react-dom'
import { CircleUserRound, Crosshair, MapPin, PenLine, Plus, Search, X } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'

interface HelpSheetProps {
  onClose: () => void
}

/**
 * 新手导览：简单介绍每个按钮是干什么的。纯静态内容，不用去后端拿数据，
 * 所以没有加载态。用 portal 的原因跟 AccountSheet 以前踩过的坑一样——
 * 从 TopBar 里弹出来会被 TopBar 自己的层叠上下文限制住，盖不住下面的地图面板。
 */
export default function HelpSheet({ onClose }: HelpSheetProps) {
  const { t } = useI18n()

  const items = [
    { icon: MapPin, title: t.helpMapTitle, body: t.helpMapBody },
    { icon: null, emoji: '💩', title: t.helpModeTitle, body: t.helpModeBody },
    { icon: Search, title: t.helpSearchTitle, body: t.helpSearchBody },
    { icon: Plus, title: t.helpAddTitle, body: t.helpAddBody },
    { icon: Crosshair, title: t.helpLocateTitle, body: t.helpLocateBody },
    { icon: PenLine, title: t.helpReviewTitle, body: t.helpReviewBody },
    { icon: CircleUserRound, title: t.helpAccountTitle, body: t.helpAccountBody },
  ]

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 animate-fade-in sm:items-center">
      <div className="safe-bottom flex max-h-[92vh] w-full max-w-sm flex-col rounded-t-2xl bg-white animate-slide-up sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-poo-100 px-4 py-3">
          <h2 className="font-semibold">{t.helpTitle}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-faint">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-sm text-ink-soft">{t.helpIntro}</p>

          <ul className="space-y-3">
            {items.map((item, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-poo-50 text-poo-700">
                  {item.icon ? <item.icon size={18} /> : <span className="text-base">{item.emoji}</span>}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  )
}
